import ws from "ws";
import cli from "command-line-args";
import { createGameRunner } from "./game";
import * as consts from "./game/consts";

const args = cli([{
    name: "port",
    type: Number,
    alias: "p",
    defaultValue: 42069,
}, {
    name: "bulletSpeed",
    type: Number,
    alias: "b",
    defaultValue: 500,
}]);

consts.initFromEnv();
consts.initFromCLI(args);

const server = new ws.Server({ port: args.port });
const runner = createGameRunner();

server.on("connection", (socket) => {
    runner(socket);
});


