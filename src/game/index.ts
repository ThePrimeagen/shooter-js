import { getLogger } from "../logger";
import WebSocket from "ws";
import { Game, PlayerState } from "./game";
import { Writer, getWriter } from "./data-writer";

const FPS = 1000 / 60;

export function ticker(rate: number, writer: Writer) {
    let next = Date.now() + rate;
    let previousNow = 0;

    return async function tickRunner() {
        const now = Date.now();

        if (previousNow !== 0) {
            const interval = now - previousNow;
            writer.write("tickInterval", interval);
            if (interval > rate + 1) {
                writer.count("tickIntervalOverrun");
            } else if (interval < Math.floor(rate - 1)) {
                writer.count("tickIntervalUnderrun");
            } else {
                writer.count("tickOnTime");
            }
        }

        const flooredNext = Math.floor(next);
        const remaining = flooredNext - now;

        if (remaining > 0) {
            await new Promise(resolve => setTimeout(resolve, remaining));
        } else {
            // Yield a macrotask when behind so Date.now() can advance and the
            // event loop is not starved by a microtask busy-loop.
            await new Promise(resolve => setImmediate(resolve));
        }

        const endNow = Date.now();
        const frameStart = previousNow === 0 ? now : previousNow;
        const delta = Math.max(0, endNow - frameStart);

        next = next + rate;
        if (next < endNow) {
            next = endNow;
        }

        previousNow = endNow;

        writer.write("tickRuntime", endNow - now);

        return delta;
    }
}

export async function waitForOpen(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) {
        return;
    }

    if (
        socket.readyState === WebSocket.CLOSED ||
        socket.readyState === WebSocket.CLOSING
    ) {
        throw new Error("socket is closed");
    }

    return new Promise(function waitForOpen(resolve, reject) {
        const onOpen = () => {
            cleanup();
            resolve();
        };
        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };
        const onClose = () => {
            cleanup();
            reject(new Error("socket closed before open"));
        };
        const cleanup = () => {
            socket.off("open", onOpen);
            socket.off("error", onError);
            socket.off("close", onClose);
        };

        socket.once("open", onOpen);
        socket.once("error", onError);
        socket.once("close", onClose);
    });
}

type State = {
    messages: Message[],
    error: boolean,
    close: boolean,
}

function createState(): State {
    return {
        messages: [],
        error: false,
        close: false,
    };
}

type Start = {
    type: "start"
}

export type Stop = {
    type: "stop",
    ticks: number,
    bullets_fired: number,
    won: boolean,
    error_msg?: string,
}

type Fire = {
    type: "fire",
}

type Message = Stop | Start | Fire;

export function buildStopMessage(
    stats: PlayerState,
    ticks: number,
    errorMsg?: string,
): Stop {
    const msg: Stop = {
        type: "stop",
        ticks: Math.floor(ticks),
        bullets_fired: stats.bulletCount,
        won: stats.won,
    };

    if (errorMsg !== undefined) {
        msg.error_msg = errorMsg;
    }

    return msg;
}

function safeSend(socket: WebSocket, payload: unknown) {
    if (socket.readyState !== WebSocket.OPEN) {
        return;
    }

    try {
        socket.send(JSON.stringify(payload));
    } catch (e) {
        getLogger().error({ err: e }, "failed to send websocket message");
    }
}

function onMessage(state: State) {
    return function onMessage(msg: string | Buffer) {
        try {
            state.messages.push(JSON.parse(msg.toString()) as Message);
        } catch (e) {
            state.error = true;
        }
    }
}

let gamesPlayed = 0;
export async function playGame(p1: WebSocket, p2: WebSocket) {
    try {
        await Promise.all([waitForOpen(p1), waitForOpen(p2)]);
    } catch (e) {
        getLogger().error({ err: e }, "failed to open player sockets");
        return;
    }

    const s1 = createState();
    const s2 = createState();

    p1.on("message", onMessage(s1));
    p2.on("message", onMessage(s2));
    p1.on("close", () => s1.close = true);
    p2.on("close", () => s2.close = true);
    p1.on("error", () => s1.error = true);
    p2.on("error", () => s2.error = true);

    safeSend(p1, { type: "start" });
    safeSend(p2, { type: "start" });

    const gameTicker = ticker(FPS, getWriter());
    const game = new Game(100);
    let ticksTotal = 0;

    do {
        // state checking / clean up

        let ticks = await gameTicker();
        ticksTotal += ticks;
        while (ticks > 0) {
            if (ticks > 16) {
                game.update(16);
                ticks -= 16;
            } else {
                game.update(ticks);
                ticks = 0;
            }
        }

        for (const msg of s1.messages) {
            if (msg.type === "fire") {
                game.fire(1);
            }
        }

        for (const msg of s2.messages) {
            if (msg.type === "fire") {
                game.fire(2);
            }
        }

        s1.messages = [];
        s2.messages = [];

    } while (!game.ended && !s1.close && !s2.close && !s1.error && !s2.error);

    const stopped1 = s1.close || s1.error;
    const stopped2 = s2.close || s2.error;
    const [
        stats1,
        stats2,
    ] = game.gameStats();

    const ticks = game.loopCount > 0 ? game.loopCount : Math.floor(ticksTotal);

    // no need to do anything, both somehow stopped
    if (stopped1 && stopped2) { }

    else if (stopped1) {
        safeSend(p2, buildStopMessage(
            { ...stats2, won: true },
            ticks,
            "Opponent disconnected",
        ));
    }

    else if (stopped2) {
        safeSend(p1, buildStopMessage(
            { ...stats1, won: true },
            ticks,
            "Opponent disconnected",
        ));
    }

    else {
        safeSend(p1, buildStopMessage(stats1, ticks));
        safeSend(p2, buildStopMessage(stats2, ticks));
    }

    gamesPlayed++;
    if (gamesPlayed % 100 == 0) {
        getLogger().error(`Played ${gamesPlayed} games`);
    }

    getWriter().count("games-played");
}

export function createGameRunner() {
    let waitingPlayer: WebSocket | undefined = undefined;

    function clearWaiting(socket: WebSocket) {
        if (waitingPlayer === socket) {
            waitingPlayer = undefined;
        }
    }

    return function addPlayer(socket: WebSocket) {
        if (!waitingPlayer) {
            waitingPlayer = socket;
            socket.once("close", () => clearWaiting(socket));
            socket.once("error", () => clearWaiting(socket));
            getLogger().info("Player 1 connected");
            return;
        }

        getLogger().info("Player 2 connected");
        const p1 = waitingPlayer;
        waitingPlayer = undefined;
        void playGame(p1, socket).catch((err) => {
            getLogger().error({ err }, "playGame failed");
        });
    };
}
