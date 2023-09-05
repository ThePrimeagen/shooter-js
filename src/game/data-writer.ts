import { getLogger } from "../logger";

export class Writer {
    private data: Map<string, number[]>;
    private lastTime: number;

    constructor(private reportIntervalMS: number = 1000) {
        this.data = new Map();
        this.lastTime = 0;
    }

    write(title: string, data: number) {
        if (this.lastTime === 0) {
            this.lastTime = Date.now();
        }

        let pointSet = this.data.get(title);
        if (!pointSet) {
            pointSet = [];
            this.data.set(title, pointSet);
        }
        pointSet.push(data);

        if (this.lastTime + this.reportIntervalMS < Date.now()) {
            this.lastTime = Date.now();
            this.flush();
        }
    }

    private async flush() {
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
    }

}

export const writer = new Writer();

