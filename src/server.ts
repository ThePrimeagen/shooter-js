import ws from "ws";
import { createGameRunner } from "./game";
import * as consts from "./game/consts";
import { getConfig } from "./cli";
import { initLogger } from "./logger";
import { getWriter } from "./game/data-writer";

const args = getConfig();
consts.initFromEnv();
consts.initFromCLI(args);
initLogger(args);
getWriter(args);

const server = new ws.Server({ port: args.port });
const runner = createGameRunner();

server.on("connection", (socket) => {
    runner(socket);
});


