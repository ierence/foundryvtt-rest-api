import { moduleId } from "../ts/constants";
import { FoundryGetActorsExternal } from "../ts/types";

// Interface for actor system type
// @ts-ignore - used for documentation
interface FoundryActorWithSystem extends Actor {
  system?: {
    type?: string;
    [key: string]: any;
  };
}

/**
 * Main function to export actors from a folder
 * This is simplified to just relay data via WebSocket without file operations
 */
export async function exportActors() {
  const folderUuid = (game as Game).settings.get(moduleId, "actorFolderUuid");
  const folder = await fromUuid(folderUuid as string);
  
  if (!folder || !(folder instanceof Folder)) {
    ui.notifications?.error("Invalid folder UUID or not a folder");
    return null;
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, "_");
  const actors = await getActorsRecursive(folder);
  
  if (actors.length === 0) {
    ui.notifications?.warn("No actors found in the specified folder");
    return null;
  }
  
  // Get the module instance
  const moduleInstance = (game as Game).modules.get(moduleId);
  
  // Check if WebSocket is connected
  // Cast moduleInstance to proper type
  if (!moduleInstance || !(moduleInstance as FoundryGetActorsExternal).api?.getWebSocketManager?.()?.isConnected?.()) {
    console.error(`${moduleId} | WebSocket manager not connected!`);
    ui.notifications?.error("WebSocket connection not available");
    return null;
  }
  
  // Send each actor via WebSocket
  try {
    let successCount = 0;
    console.log(`${moduleId} | Starting export of ${actors.length} actors with timestamp ${timestamp}`);
    
    // Send count first so server knows how many to expect
    const socketManager = (moduleInstance as FoundryGetActorsExternal).socketManager;
    socketManager.send({
      type: "actor-export-start",
      worldId: (game as Game).world.id,
      actorCount: actors.length,
      backup: timestamp
    });
    
    for (const actor of actors) {
      const actorData = actor.toObject();
      const success = socketManager.send({
        type: "actor-data",
        worldId: (game as Game).world.id,
        actorId: actor.id,
        data: actorData,
        backup: timestamp
      });
      
      if (success) successCount++;
      
      // Add a small delay to prevent overwhelming the WebSocket
      if (successCount % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Also send a "latest" version
    let latestSuccessCount = 0;
    for (const actor of actors) {
      const actorData = actor.toObject();
      const success = socketManager.send({
        type: "actor-data",
        worldId: (game as Game).world.id,
        actorId: actor.id,
        data: actorData,
        backup: "latest"
      });
      
      if (success) latestSuccessCount++;
      
      // Add a small delay to prevent overwhelming the WebSocket
      if (latestSuccessCount % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Send completion notification
    socketManager.send({
      type: "actor-export-complete",
      worldId: (game as Game).world.id,
      successCount,
      backup: timestamp
    });
    
    console.log(`${moduleId} | Export completed: ${successCount}/${actors.length} actors exported to ${timestamp}, ${latestSuccessCount}/${actors.length} to latest`);
    ui.notifications?.info(`${successCount} actors exported via WebSocket with backup: ${timestamp}`);
    return timestamp;
  } catch (error) {
    console.error(`${moduleId} | Error exporting actors:`, error);
    ui.notifications?.error("Error exporting actors. See console for details.");
    return null;
  }
}

/**
 * Recursively get actors from a folder and its subfolders
 */
async function getActorsRecursive(folder: Folder): Promise<Actor[]> {
  const actors = [];
  
  // Get actors in this folder
  for (const actor of folder.contents) {
    if (actor instanceof Actor) {
      actors.push(actor);
    }
  }
  
  // Get subfolders
  const subfolders = (game as Game).folders?.filter(f => f.folder === folder.id && f.type === "Actor") || [];
  
  // Recursively get actors from subfolders
  for (const subfolder of subfolders) {
    const subfolderActors = await getActorsRecursive(subfolder);
    actors.push(...subfolderActors);
  }
  
  return actors;
}

