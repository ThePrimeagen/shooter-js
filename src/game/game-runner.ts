import { getLogger } from "../logger";

export function createGameRunner<T>(playGame: (p1: T, p2: T) => void) {
    let waitingPlayer: T | undefined = undefined;
    return function addPlayer(socket: T) {
        if (!waitingPlayer) {
            waitingPlayer = socket;
            getLogger().info("Player 1 connected");
            return;
        }

        getLogger().info("Player 2 connected");
        playGame(waitingPlayer, socket);
        waitingPlayer = undefined;
    };
}

