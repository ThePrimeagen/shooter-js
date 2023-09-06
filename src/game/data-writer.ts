import { Config } from "../cli";
import { getLogger } from "../logger";

export class Writer {
    private data: Map<string, number[]>;
    private counters: Map<string, number>;
    private lastTime: number;

    constructor(private reportIntervalMS: number = 1000) {
        this.data = new Map();
        this.counters = new Map();
        this.lastTime = 0;
    }

    count(title: string) {
        let count = this.counters.get(title);
        if (!count) {
            count = 0;
            this.counters.set(title, count);
        }
        this.counters.set(title, count + 1);
        this.flush();
    }

    write(title: string, data: number) {
        let pointSet = this.data.get(title);
        if (!pointSet) {
            pointSet = [];
            this.data.set(title, pointSet);
        }
        pointSet.push(data);

        this.flush();
    }

    private async flush() {

        if (this.lastTime === 0) {
            this.lastTime = Date.now();
        }

        if (this.lastTime + this.reportIntervalMS > Date.now()) {
            return;
        }

        const points: Map<string, Map<number, number>> = new Map();

        for (const [title, data] of this.data.entries()) {
            let pointSet = points.get(title);
            if (!pointSet) {
                pointSet = new Map();
                points.set(title, pointSet);
            }

            for (let i = 0; i < data.length; ++i) {
                // @ts-ignore DON'T BE AFRAID TYPESCRIPT
                pointSet.set(data[i], (pointSet.get(data[i]) | 0) + 1);
            }
        }

        for (const [title, pointSet] of points.entries()) {
            getLogger().warn({ title, pointSet: Object.fromEntries(pointSet) });
        }

        this.data.clear();

        for (const [title, count] of this.counters.entries()) {
            getLogger().warn({ title, count });
        }

        this.counters.clear();
        this.lastTime = Date.now();
    }

}

let writer: Writer | undefined = undefined;

export function getWriter(args?: Config): Writer {
    if (args) {
        writer = new Writer(args.reportInterval);
    }

    if (!writer) {
        throw new Error("No writer");
    }

    return writer;
}

