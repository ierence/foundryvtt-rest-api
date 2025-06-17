import { Router} from "./baseRouter"
import { ModuleLogger } from "../../utils/logger"

export const router = new Router(
    "pingRouter"
)

router.addRoute(
    {
        actionType: "ping",
        handler: async (_data, context) => {
            const socketManager = context?.socketManager;
            ModuleLogger.info(`Received ping, sending pong`)
            socketManager?.send({ type: "pong" });
        }
    }
)

router.addRoute(
    {
        actionType: "pong",
        handler: async (_data, _context) => {
            ModuleLogger.info(`Received pong`);
        }
    }
)
