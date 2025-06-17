import { Router } from "./baseRouter";
import { ModuleLogger } from "../../utils/logger";


export const router = new Router("scheneRouter");

enum SceneMessage {
  getScenes = "get-scenes",
  getScenesResult = "get-scenes-result",
  getScene = "get-scene",
  getSceneResult = "get-scene-result",
  activateScene = "activate-scene",
  activateSceneResult = "activate-scene-result",
  getActiveScene = "get-active-scene",
  getActiveSceneResult = "get-active-scene-result"
}

router.addRoute({
  actionType: SceneMessage.getScenes,
  handler: async (data, context) => {
    ModuleLogger.info(`Received request for scenes`);
    const socketManager = context?.socketManager;

    let scenes: Scene[] | undefined;
    let error: string | undefined;

    try {
      scenes = (game as Game).scenes?.contents.map((scene) => {
        const fixed_scene = scene as Scene & {ownership: object, navigation: boolean, navName: string, navOrder: number}
        return fixed_scene}) || [];
    } catch (error) {
      ModuleLogger.error(`Error getting scene list:`, error);
      error = (error as Error).message;
    };
    socketManager?.send({
      type: SceneMessage.getScenesResult,
      requestId: data.requestId,
      error: error,
      scene: scenes
    });
  }
});


router.addRoute(
  {
    actionType: SceneMessage.getScene,
    handler: async (data, context) => {
      const socketManager = context?.socketManager;

      let scene: Scene | undefined;
      let error: string | undefined;

      try {
        const id = data.id
        const scene = (game as Game).scenes?.find((scene) => scene.id == id)
        socketManager?.send({
          type: SceneMessage.getSceneResult,
          requestId: data.requestId,
          scene: scene
        })
      } catch (error) {
        ModuleLogger.error(`Error getting scene:`, error);
        error = (error as Error).message;
      }

      socketManager?.send({
        type: SceneMessage.getSceneResult,
        requestId: data.requestId,
        error: error,
        scene: scene
      });

    }
  }
)

router.addRoute({
  actionType: SceneMessage.activateScene,
  handler: async (data, context) => {
    const socketManager = context?.socketManager;
    let scene: Scene | undefined;
    let error: string | undefined;

    try {
      scene = (game as Game).scenes?.find((s) => s.id === data.id);
      if (!scene) {
        throw new Error(`Scene with id ${data.id} not found`);
      }
      await scene.activate();
    } catch (err) {
      ModuleLogger.error(`Error activating scene:`, err);
      error = (err as Error).message;
    }

    socketManager?.send({
      type: SceneMessage.activateSceneResult,
      requestId: data.requestId,
      error: error,
      scene: scene
    });
  }
});


router.addRoute({
  actionType: SceneMessage.getActiveScene,
  handler: async (data, context) => {
    const socketManager = context?.socketManager;
    let scene: Scene | undefined;
    let error: string | undefined;

    try {
      scene = (game as Game).scenes?.find((s) => s.active === true);
      if (!scene) {
        throw new Error("No active scene found");
      }
    } catch (err) {
      ModuleLogger.error(`Error getting active scene:`, err);
      error = (err as Error).message;
    }

    socketManager?.send({
      type: SceneMessage.getActiveSceneResult,
      requestId: data.requestId,
      error: error,
      scene: scene
    });
  }
});
