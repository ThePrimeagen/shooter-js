
type Callback = () => void;

class Timeout {
    private timeouts: Map<number, Callback[]>;
    private lastProcessed: number;
    private boundRun: () => void;
    constructor() {
        this.timeouts = new Map();
        this.lastProcessed = Date.now();
        this.boundRun = this.run.bind(this);
    }

    add(cb: Callback, when: number): void {
        let callbacks = this.timeouts.get(when);
        if (!callbacks) {
            callbacks = [];
            this.timeouts.set(when, callbacks);
        }

        callbacks.push(cb);
    }

    run() {
        const startTime = Date.now();

        while (this.lastProcessed < startTime) {

            // move forward
            this.lastProcessed += 1;

            const callbacks = this.timeouts.get(this.lastProcessed);
            if (!callbacks) {
                continue;
            }

            for (const cb of callbacks) {
                cb();
            }

            this.timeouts.delete(this.lastProcessed);
        }

        setTimeout(this.boundRun, 0);
    }
}

export const timeout = new Timeout();
timeout.run();

