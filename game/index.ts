import WebSocket from "ws";
import { Game } from "./game";

const FPS = 1000 / 60;

function ticker(rate: number) {
    let next = Date.now() + rate;
    return async function() {
        const now = Date.now();
        const flooredNext = Math.floor(next);
        const remaining = flooredNext - now;

        if (remaining > 0) {
            await new Promise(resolve => setTimeout(resolve, remaining));
        }

        const extras = Date.now() - flooredNext;
        next = next + rate;

        return extras + remaining;
    }
}

async function waitForOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) {
            socket.once("open", resolve);
            socket.once("error", reject);
        } else {
            resolve();
        }
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

type Stop = {
    type: "stop",
    ticks: number,
    bulletsFired: number,
    won: boolean,
    errorMsg?: string,
}

type Fire = {
    type: "fire",
}

type Message = Stop | Start | Fire;

function onMessage(state: State) {
    return function(msg: string | Buffer) {
        try {
            state.messages.push(JSON.parse(msg.toString()) as Message);
        } catch (e) {
            state.error = true;
        }
    }
}

async function playGame(p1: WebSocket, p2: WebSocket) {
    try {
        await Promise.all([waitForOpen(p1), waitForOpen(p2)]);
    } catch (e) {
        // handle error
    }

    p1.send(JSON.stringify({ type: "start" }));
    p2.send(JSON.stringify({ type: "start" }));

    const s1 = createState();
    const s2 = createState();

    p1.on("message", onMessage(s1));
    p2.on("message", onMessage(s2));
    p1.on("close", () => s1.close = true);
    p2.on("close", () => s2.close = true);
    p1.on("error", () => s1.error = true);
    p2.on("error", () => s2.error = true);

    const gameTicker = ticker(FPS);
    const game = new Game(100);

    do {
        // state checking / clean up

        game.update(await gameTicker());

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

    // no need to do anything, both somehow stopped
    if (stopped1 && stopped2) {
        return;
    }

    else if (stopped1) {
        p2.send(JSON.stringify({
            type: "stop",
            errorMsg: "Opponent disconnected",
            ...stats2,
        }));
    }

    else if (stopped2) {
        p1.send(JSON.stringify({
            type: "stop",
            errorMsg: "Opponent disconnected",
            ...stats1,
        }));
    }

    else {
        p1.send(JSON.stringify({
            type: "stop",
            ...stats1,
        }));
        p2.send(JSON.stringify({
            type: "stop",
            ...stats2,
        }));
    }
}

export function createGameRunner() {
    let waitingPlayer: WebSocket | undefined = undefined;
    return function addPlayer(socket: WebSocket) {
        if (!waitingPlayer) {
            waitingPlayer = socket;
            return;
        }

        playGame(waitingPlayer, socket);
        waitingPlayer = undefined;
    };
}

