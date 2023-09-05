import ws from "ws";
import { createGameRunner } from "./game";
import * as consts from "./game/consts";
import { getConfig } from "./cli";
import { init } from "./logger";

const args = getConfig();
consts.initFromEnv();
consts.initFromCLI(args);
init(args);

const server = new ws.Server({ port: args.port });
const runner = createGameRunner();

server.on("connection", (socket) => {
    runner(socket);
});


