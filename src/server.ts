import ws from "ws";
import { playGame } from "./game";
import * as consts from "./game/consts";
import { getConfig } from "./cli";
import { initLogger } from "./logger";
import { getWriter } from "./game/data-writer";
import { createGameRunner } from "./game/game-runner";

const args = getConfig();
consts.initFromEnv();
consts.initFromCLI(args);
initLogger(args);
getWriter(args);

const server = new ws.Server({ port: args.port });
const runner = createGameRunner(playGame);

let id = 0;
server.on("connection", (socket) => {
    // @ts-ignore
    socket.MY_ID = ++id;

    runner(socket);
});

