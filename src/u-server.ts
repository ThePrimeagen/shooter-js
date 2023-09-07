import { playGame, receiveMessage, receiveClose } from "./game/u-runner";
import * as consts from "./game/consts";
import { getConfig } from "./cli";
import { initLogger } from "./logger";
import { getWriter } from "./game/data-writer";
import { createGameRunner } from "./game/game-runner";
import uWS from "uWebSockets.js";

const args = getConfig();
consts.initFromEnv();
consts.initFromCLI(args);
initLogger(args);
getWriter(args);

const runner = createGameRunner(playGame);

uWS.App().ws("/*", {
    open: (ws) => {
        runner(ws);
    },
    message: (ws, message) => {
        receiveMessage(ws, message);
    },
    close: (ws) => {
        receiveClose(ws);
    },
}).listen(args.port, (listenSocket) => {
    if (listenSocket) {
        console.log(`Listening to port ${args.port}`);
    } else {
        console.log("failed to listen to port");
    }
});
