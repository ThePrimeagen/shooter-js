import { Writer } from "./data-writer";

export function ticker(rate: number, writer: Writer) {
    let next = Date.now() + rate;
    let previousNow = 0;
    return function getNextTick() {
        const now = Date.now();
        const interval = now - previousNow;

        if (previousNow !== 0) {
            writer.write("tickInterval", interval);
            if (interval > rate + 1) {
                writer.count("tickIntervalOverrun");
            } else if (interval < Math.floor(rate - 1)) {
                writer.count("tickIntervalUnderrun");
            } else {
                writer.count("tickOnTime");
            }
        }

        let out = next;

        next = next + rate;
        previousNow = now;

        return Math.floor(out);
    };
}


