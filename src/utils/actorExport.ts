import { moduleId } from "../ts/constants";

// Add this type extension at the top of actorExport.ts
interface FoundryActorWithSystem extends Actor {
  system?: {
    type?: string;
    [key: string]: any;
  };
}

/**
 * Main function to export actors from a folder
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
  const moduleInstance = game.modules.get(moduleId);
  
  // Check if WebSocket is connected
  if (!moduleInstance?.socketManager?.isConnected?.()) {
    console.error(`${moduleId} | WebSocket manager not connected!`);
    ui.notifications?.error("WebSocket connection not available");
    return null;
  }
  
  // Send each actor via WebSocket
  try {
    let successCount = 0;
    for (const actor of actors) {
      const actorData = actor.toObject();
      const success = moduleInstance.socketManager.send({
        type: "actor-data",
        worldId: game.world.id,
        actorId: actor.id,
        data: actorData,
        backup: timestamp
      });
      
      if (success) successCount++;
    }
    
    // Also send a "latest" version
    let latestSuccessCount = 0;
    for (const actor of actors) {
      const actorData = actor.toObject();
      const success = moduleInstance.socketManager.send({
        type: "actor-data",
        worldId: game.world.id,
        actorId: actor.id,
        data: actorData,
        backup: "latest"
      });
      
      if (success) latestSuccessCount++;
    }
    
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

/**
 * Create directories recursively
 */
async function createDirectoryRecursive(dirPath: string): Promise<void> {
  const parts = dirPath.split(/\/|\\/g);
  let currentPath = "";
  
  for (const part of parts) {
    if (!part) continue;
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    
    try {
      await FilePicker.createDirectory("data", currentPath);
    } catch (error) {
      // Ignore errors if directory already exists
      if (!(error instanceof Error) || !error.toString().includes("already exists")) {
        throw error;
      }
    }
  }
}

/**
 * Save data to a file in the specified directory
 */
async function saveToFile(dirPath: string, filename: string, data: object): Promise<void> {
  const filePath = `${dirPath}/${filename}`;
  const content = JSON.stringify(data, null, 2);
  
  // Use FilePicker.upload to write the file to disk
  try {
      const file = new File([content], filename, { type: "application/json" });
      await FilePicker.upload("data", dirPath, file, {});
  } catch (error) {
      console.error(`${moduleId} | Error saving file:`, error);
      throw error;
  }
}

/**
 * Clean up old backup folders
 */
async function cleanupOldBackups(basePath: string): Promise<void> {
  const limit = (game as Game).settings.get(moduleId, "backupLimit") as number;
  if (!limit || limit <= 0) return; // Keep all backups
  
  try {
    // Get all backup folders
    const { dirs } = await FilePicker.browse("data", basePath);
    
    // Create an array of backup folders (excluding "latest")
    const backupFolders = dirs
      .filter(dir => !dir.endsWith("latest"))
      .map(dir => {
        const name = dir.split("/").pop() || "";
        return { path: dir, name };
      })
      .sort((a, b) => b.name.localeCompare(a.name)); // Sort newest first
    
    // Delete older folders beyond the limit
    if (backupFolders.length > limit) {
      const foldersToDelete = backupFolders.slice(limit);
      for (const folder of foldersToDelete) {
        // Use FilePicker.deleteDirectory
        await FilePicker.deleteDirectory("data", folder.path);
      }
    }
  } catch (error) {
    console.error(`${moduleId} | Error cleaning up old backups:`, error);
  }
}

/**
 * Update or create the "latest" pointer
 */
async function updateLatestPointer(basePath: string, timestamp: string): Promise<void> {
  const latestPath = `${basePath}/latest`;
  const sourcePath = `${basePath}/${timestamp}`;
  
  try {
      // Check if latest already exists and delete it
      try {
          const latestExists = await FilePicker.browse("data", latestPath)
              .then(() => true)
              .catch(() => false);
              
          if (latestExists) {
              await FilePicker.deleteDirectory("data", latestPath);
          }
      } catch (error) {
          console.log(`${moduleId} | Latest directory doesn't exist yet`);
      }
      
      // Create the latest directory
      await createDirectoryRecursive(latestPath);
      
      // Copy files from timestamp folder to latest
      const { files } = await FilePicker.browse("data", sourcePath);
      
      for (const filePath of files) {
          const filename = filePath.split("/").pop() || '';
          
          // Fetch the file content
          const response = await fetch(filePath);
          const blob = await response.blob();
          const file = new File([blob], filename, { type: "application/json" });
          
          // Upload to the latest directory
          await FilePicker.upload("data", latestPath, file);
      }
  } catch (error) {
      console.error(`${moduleId} | Error updating latest pointer:`, error);
  }
}

