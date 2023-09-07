
type Callback = () => void;

class Timeout {
    private timeouts: Map<number, Callback[]>;
    private timeoutsIdx: number;
    private lastProcessed: number;
    private boundRun: () => void;
    constructor() {
        this.timeouts = new Map();
        this.lastProcessed = Date.now();
        this.boundRun = this.run.bind(this);
        this.timeoutsIdx = 0;
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

        outer_loop: while (this.lastProcessed < startTime) {

            // move forward
            this.lastProcessed += 1;

            const callbacks = this.timeouts.get(this.lastProcessed);
            if (!callbacks) {
                continue;
            }

            for (; this.timeoutsIdx < callbacks.length; this.timeoutsIdx++) {
                callbacks[this.timeoutsIdx]();

                // ensure that we don't block for too long
                if (Date.now() - startTime > 2) {
                    this.lastProcessed -= 1;
                    break outer_loop;
                }

            }

            this.timeouts.delete(this.lastProcessed);
            this.timeoutsIdx = 0;
        }

        setTimeout(this.boundRun, 0);
    }
}

export const timeout = new Timeout();
timeout.run();

