import { getLogger } from "../logger";
import { WebSocket } from "uWebSockets.js";
import { Game } from "./game";
import { getWriter } from "./data-writer";
import { timeout } from "./timeout";
import { ticker } from "./ticker";

const FPS = 1000 / 60;

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

const onClose = new Map<WebSocket<any>, () => void>();
const onMessage = new Map<WebSocket<any>, (msg: any) => void>();

function processMessage(state: State) {
    return function onMessage(msg: string | Buffer | ArrayBuffer) {
        try {
            if (msg instanceof ArrayBuffer) {
                msg = Buffer.from(msg);
            }
            state.messages.push(JSON.parse(msg.toString()) as Message);
        } catch (e) {
            state.error = true;
        }
    }
}

let gamesPlayed = 0;
export function playGame(p1: WebSocket<any>, p2: WebSocket<any>) {

    p1.send(JSON.stringify({ type: "start" }));
    p2.send(JSON.stringify({ type: "start" }));

    const s1 = createState();
    const s2 = createState();

    onMessage.set(p1, processMessage(s1));
    onMessage.set(p2, processMessage(s2));
    onClose.set(p1, () => s1.close = true);
    onClose.set(p2, () => s2.close = true);

    const gameTicker = ticker(FPS, getWriter());
    const game = new Game(100);
    let ticksTotal = 0;

    let lastNow = Date.now();
    function run() {
        const now = Date.now();
        let deltaMS = now - lastNow;
        lastNow = now;

        ticksTotal += deltaMS;
        while (deltaMS > 0) {
            if (deltaMS > 16) {
                game.update(16);
                deltaMS -= 16;
            } else {
                game.update(deltaMS);
                deltaMS = 0;
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

        if (!game.ended && !s1.close && !s2.close && !s1.error && !s2.error) {
            const next = gameTicker();
            timeout.add(run, next);
        } else {
            finish();
        }
    }
    run();

    function finish() {
        const stopped1 = s1.close || s1.error;
        const stopped2 = s2.close || s2.error;
        const [
        stats1,
        stats2,
    ] = game.gameStats();

        // no need to do anything, both somehow stopped
        if (stopped1 && stopped2) { }

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

        gamesPlayed++;
        if (gamesPlayed % 100 == 0) {
            getLogger().error(`Played ${gamesPlayed} games`);
        }
    }

    getWriter().count("games-played");
}

export function receiveMessage(ws: WebSocket<any>, msg: any) {
    const handler = onMessage.get(ws);
    if (handler) {
        handler(msg);
    }
}

export function receiveClose(ws: WebSocket<any>) {
    const handler = onClose.get(ws);
    if (handler) {
        handler();
    }
}
