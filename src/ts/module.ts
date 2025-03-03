import "../styles/style.scss";
import { CommunicationPanel } from "./apps/communicationPanel";
import { moduleId } from "./constants";
import { FoundryGetActorsExternal } from "./types";
import { exportScene } from "../utils/export";
import { importScene } from "../utils/import";
import { WebSocketManager } from "./network/webSocketManager";
import { exportActors } from "../utils/actorExport";
import { ActorExportForm } from "./apps/actorExportForm"; // Add this import

let module: FoundryGetActorsExternal;

Hooks.once("init", () => {
  console.log(`Initializing ${moduleId}`);

  module = (game as Game).modules.get(moduleId) as FoundryGetActorsExternal;
  module.communicationPanel = new CommunicationPanel();
  
  // Register module settings for WebSocket configuration
  (game as Game).settings.register(moduleId, "wsRelayUrl", {
    name: "WebSocket Relay URL",
    hint: "URL for the WebSocket relay server",
    scope: "world",
    config: true,
    type: String,
    default: "ws://localhost:3010",
    onChange: () => {
      if (module.socketManager) {
        module.socketManager.disconnect();
        initializeWebSocket();
      }
    }
  });
  
  (game as Game).settings.register(moduleId, "wsRelayToken", {
    name: "WebSocket Relay Token",
    hint: "Token for the WebSocket relay server (groups users together)",
    scope: "world",
    config: true,
    type: String,
    default: (game as Game).world.id,
    onChange: () => {
      if (module.socketManager) {
        module.socketManager.disconnect();
        initializeWebSocket();
      }
    }
  });

  // Register module settings
  (game as Game).settings.register(moduleId, "actorFolderUuid", {
    name: "Actor Folder UUID",
    hint: "UUID of the folder from which to retrieve actors for export",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  (game as Game).settings.register(moduleId, "exportPath", {
    name: "Disk Folder Path",
    hint: "Path where actor data will be exported",
    scope: "world",
    config: true,
    type: String,
    default: `data/external/${(game as Game).world.id}/actors`
  });

  (game as Game).settings.register(moduleId, "backupLimit", {
    name: "Backup Limit",
    hint: "Number of backup folders to keep (0 = keep all)",
    scope: "world",
    config: true,
    type: Number,
    default: 0
  });

  // Add export button
  (game as Game).settings.registerMenu(moduleId, "exportActors", {
    name: "Export Actors",
    label: "Export Actors to Disk",
    hint: "Export all actors from the specified folder to disk",
    icon: "fas fa-file-export",
    type: ActorExportForm,
    restricted: true
  });
  // Create and expose module API
  module.api = {
    exportActors,
    getWebSocketManager: () => module.socketManager
  };
});

Hooks.once("ready", () => {
  setTimeout(() => {
    initializeWebSocket();
  }, 1000);
});

function initializeWebSocket() {
  // Get settings
  const wsRelayUrl = (game as Game).settings.get(moduleId, "wsRelayUrl") as string;
  const wsRelayToken = (game as Game).settings.get(moduleId, "wsRelayToken") as string;
  
  if (!wsRelayUrl) {
    console.error(`${moduleId} | WebSocket relay URL is empty. Please configure it in module settings.`);
    return;
  }
  
  console.log(`${moduleId} | Initializing WebSocket with URL: ${wsRelayUrl}, token: ${wsRelayToken}`);
  
  try {
    // Create and connect the WebSocket manager
    module.socketManager = new WebSocketManager(wsRelayUrl, wsRelayToken);
    module.socketManager.connect();
    
    // Example of handling "pong" types
    module.socketManager.onMessageType("pong", () => {
      console.log(`${moduleId} | Received pong from server`);
    });
    
    // Handle incoming messages
    module.socketManager.onMessageType("message", (data) => {
      console.log(`${moduleId} | Received message:`, data);
      
      // Add message to the communication panel
      if (data.content && data.sender !== (game as Game).user?.name) {
        module.communicationPanel.addMessage({
          content: data.content,
          sender: "Web App",
          timestamp: data.timestamp || Date.now()
        });
      }
    });
    
    // Handle actor-data-ack messages
    module.socketManager.onMessageType("actor-data-ack", (data) => {
      console.log(`${moduleId} | Actor data acknowledgment:`, data);
    });
  } catch (error) {
    console.error(`${moduleId} | Error initializing WebSocket:`, error);
  }
}

// Add button to the sidebar
Hooks.on("renderActorDirectory", (_: Application, html: JQuery) => {
  const button = $(
    `<button class="cc-sidebar-button" type="button">💬</button>`
  );
  button.on("click", () => {
    module.communicationPanel.render(true);
  });
  html.find(".directory-header .action-buttons").append(button);
});

// Scene directory context menu
Hooks.on(
  "getSceneDirectoryEntryContext",
  (
    _html: JQuery,
    options: {
      name: string;
      icon: string;
      condition: ((li: any) => any) | (() => any);
      callback: ((li: any) => Promise<void>) | (() => Promise<void>);
    }[]
  ) => {
    options.push({
      name: "Export Scene Package",
      icon: '<i class="fas fa-file-export"></i>',
      condition: (_) => (game as Game).user?.isGM,
      callback: (li) => exportScene(li.data("documentId")),
    });

    options.push({
      name: "Import Scene Package", 
      icon: '<i class="fas fa-file-import"></i>',
      condition: () => (game as Game).user?.isGM,
      callback: async () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".zip";
        input.onchange = async (event: Event) => {
          const file = (event.target as HTMLInputElement).files?.[0];
          if (file) {
            await importScene(file);
          }
        };
        input.click();
      },
    });
  }
);
