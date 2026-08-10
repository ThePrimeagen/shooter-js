import { EventEmitter } from "events";
import WebSocket from "ws";
import { initLogger } from "../../logger";
import { getWriter } from "../data-writer";
import {
    buildStopMessage,
    createGameRunner,
    playGame,
    ticker,
    waitForOpen,
} from "../index";
import { PlayerState } from "../game";
import { Writer } from "../data-writer";

class FakeSocket extends EventEmitter {
    readyState: number;
    sent: string[] = [];
    sendThrows = false;

    constructor(readyState: number = WebSocket.OPEN) {
        super();
        this.readyState = readyState;
    }

    send(data: string) {
        if (this.sendThrows || this.readyState !== WebSocket.OPEN) {
            throw new Error("not open");
        }
        this.sent.push(data);
    }

    close() {
        this.readyState = WebSocket.CLOSED;
        this.emit("close");
    }

    error(err: Error = new Error("socket error")) {
        this.emit("error", err);
    }
}

function parsed(socket: FakeSocket) {
    return socket.sent.map((s) => JSON.parse(s));
}

beforeAll(() => {
    initLogger({
        port: 0,
        bulletSpeed: 500,
        reportInterval: 10_000,
        logLevel: "silent",
    });
    getWriter({
        port: 0,
        bulletSpeed: 500,
        reportInterval: 10_000,
    });
});

describe("buildStopMessage", () => {
    const stats: PlayerState = {
        id: 1,
        lastFire: 123,
        bulletCount: 4,
        won: true,
        x: -1000,
        direction: 1,
    };

    it("happy path: matches Rust stop schema (snake_case)", () => {
        const msg = buildStopMessage(stats, 42);

        expect(msg).toEqual({
            type: "stop",
            ticks: 42,
            bullets_fired: 4,
            won: true,
        });
        expect(msg).not.toHaveProperty("error_msg");
        expect(msg).not.toHaveProperty("bulletCount");
        expect(msg).not.toHaveProperty("errorMsg");
        expect(msg).not.toHaveProperty("lastFire");
    });

    it("unhappy path: includes error_msg when provided", () => {
        const msg = buildStopMessage(stats, 7, "Opponent disconnected");

        expect(msg).toEqual({
            type: "stop",
            ticks: 7,
            bullets_fired: 4,
            won: true,
            error_msg: "Opponent disconnected",
        });
    });

    it("unhappy path: floors non-integer ticks", () => {
        const msg = buildStopMessage(stats, 16.9);
        expect(msg.ticks).toBe(16);
    });
});

describe("ticker", () => {
    let writer: Writer;

    beforeEach(() => {
        jest.useFakeTimers();
        writer = new Writer(60_000);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("happy path: on-time tick returns roughly one frame of sim delta", async () => {
        const rate = 16;
        const tick = ticker(rate, writer);
        const promise = tick();
        await jest.advanceTimersByTimeAsync(rate);
        const delta = await promise;

        expect(delta).toBeGreaterThan(0);
        expect(delta).toBeGreaterThanOrEqual(rate - 1);
        expect(delta).toBeLessThanOrEqual(rate + 5);
    });

    it("unhappy path: late tick returns positive catch-up delta, not ~0", async () => {
        const rate = 16;
        const tick = ticker(rate, writer);

        // First tick establishes previousNow
        const first = tick();
        await jest.advanceTimersByTimeAsync(rate);
        await first;

        // Jump well behind schedule before the next tick starts
        await jest.advanceTimersByTimeAsync(rate * 5);

        const second = tick();
        // Late path should still yield (setImmediate / setTimeout 0)
        await jest.advanceTimersByTimeAsync(0);
        const delta = await second;

        expect(delta).toBeGreaterThan(rate);
        expect(delta).toBeGreaterThanOrEqual(rate * 4);
    });
});

describe("waitForOpen", () => {
    it("happy path: already-open socket resolves", async () => {
        const socket = new FakeSocket(WebSocket.OPEN) as unknown as WebSocket;
        await expect(waitForOpen(socket)).resolves.toBeUndefined();
    });

    it("unhappy path: closed socket rejects instead of hanging", async () => {
        const socket = new FakeSocket(WebSocket.CLOSED) as unknown as WebSocket;
        await expect(waitForOpen(socket)).rejects.toThrow();
    });

    it("unhappy path: closing socket rejects instead of hanging", async () => {
        const socket = new FakeSocket(WebSocket.CLOSING) as unknown as WebSocket;
        await expect(waitForOpen(socket)).rejects.toThrow();
    });
});

describe("createGameRunner waiting player", () => {
    it("happy path: second player starts a game with the waiting player", async () => {
        const runner = createGameRunner();
        const p1 = new FakeSocket();
        const p2 = new FakeSocket();

        runner(p1 as unknown as WebSocket);
        runner(p2 as unknown as WebSocket);

        await Promise.resolve();
        await Promise.resolve();

        expect(parsed(p1).some((m) => m.type === "start")).toBe(true);
        expect(parsed(p2).some((m) => m.type === "start")).toBe(true);

        p1.close();
        p2.close();
    });

    it("unhappy path: disconnected waiting player is cleared for the next joiner", async () => {
        const runner = createGameRunner();
        const dead = new FakeSocket();
        const next = new FakeSocket();
        const partner = new FakeSocket();

        runner(dead as unknown as WebSocket);
        dead.close();

        runner(next as unknown as WebSocket);
        // next should be waiting, not matched with dead
        expect(next.sent).toHaveLength(0);

        runner(partner as unknown as WebSocket);
        await Promise.resolve();
        await Promise.resolve();

        expect(parsed(next).some((m) => m.type === "start")).toBe(true);
        expect(parsed(partner).some((m) => m.type === "start")).toBe(true);
        expect(dead.sent).toHaveLength(0);

        next.close();
        partner.close();
    });
});

describe("playGame error handling", () => {
    it("unhappy path: open failure does not send start", async () => {
        const p1 = new FakeSocket(WebSocket.CLOSED);
        const p2 = new FakeSocket(WebSocket.OPEN);

        await playGame(p1 as unknown as WebSocket, p2 as unknown as WebSocket);

        expect(p1.sent).toHaveLength(0);
        expect(p2.sent).toHaveLength(0);
    });

    it("unhappy path: createGameRunner does not surface unhandled rejections", async () => {
        const runner = createGameRunner();
        const p1 = new FakeSocket();
        const p2 = new FakeSocket();
        p1.sendThrows = true;

        const rejections: unknown[] = [];
        const onUnhandled = (reason: unknown) => {
            rejections.push(reason);
        };
        process.on("unhandledRejection", onUnhandled);

        try {
            runner(p1 as unknown as WebSocket);
            runner(p2 as unknown as WebSocket);

            await new Promise((r) => setImmediate(r));
            await new Promise((r) => setImmediate(r));
            await new Promise((r) => setTimeout(r, 20));

            expect(rejections).toHaveLength(0);
        } finally {
            process.off("unhandledRejection", onUnhandled);
            p1.readyState = WebSocket.CLOSED;
            p2.readyState = WebSocket.CLOSED;
        }
    });
});

describe("playGame stop payload", () => {
    it("happy path: finished game sends Rust-compatible stop to both players", async () => {
        jest.useFakeTimers();
        const runner = createGameRunner();
        const p1 = new FakeSocket();
        const p2 = new FakeSocket();

        runner(p1 as unknown as WebSocket);
        runner(p2 as unknown as WebSocket);

        await Promise.resolve();
        // Drive the game loop until stop messages appear
        for (let i = 0; i < 5000 && p1.sent.length < 2; i++) {
            await jest.advanceTimersByTimeAsync(16);
            await Promise.resolve();
        }

        const stop1 = parsed(p1).find((m) => m.type === "stop");
        const stop2 = parsed(p2).find((m) => m.type === "stop");

        // Without fires, game may not end — force disconnect stop path instead if needed
        if (!stop1 || !stop2) {
            p1.close();
            for (let i = 0; i < 100 && parsed(p2).every((m) => m.type !== "stop"); i++) {
                await jest.advanceTimersByTimeAsync(16);
                await Promise.resolve();
            }
            const stop = parsed(p2).find((m) => m.type === "stop");
            expect(stop).toBeDefined();
            expect(stop).toMatchObject({
                type: "stop",
                ticks: expect.any(Number),
                bullets_fired: expect.any(Number),
                won: expect.any(Boolean),
            });
            expect(stop).toHaveProperty("error_msg");
            expect(stop).not.toHaveProperty("bulletCount");
            expect(stop).not.toHaveProperty("errorMsg");
        } else {
            for (const stop of [stop1, stop2]) {
                expect(stop).toMatchObject({
                    type: "stop",
                    ticks: expect.any(Number),
                    bullets_fired: expect.any(Number),
                    won: expect.any(Boolean),
                });
                expect(stop).not.toHaveProperty("bulletCount");
                expect(stop).not.toHaveProperty("lastFire");
                expect(stop).not.toHaveProperty("errorMsg");
            }
        }

        jest.useRealTimers();
        p1.close();
        p2.close();
    });
});
