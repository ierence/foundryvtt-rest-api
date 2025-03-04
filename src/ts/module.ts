// src/ts/module.ts
import "../styles/style.scss";
import { FoundryGetActorsExternal } from "./types";
import { moduleId } from "./constants";
import { WebSocketManager } from "./network/webSocketManager";

// Declare QuickInsert interface
declare global {
  interface Window {
    QuickInsert: {
      open: (context: any) => void;
      search: (text: string, filter?: ((item: any) => boolean) | null, max?: number) => Promise<any[]>;
      forceIndex: () => void;
      handleKeybind: (event: KeyboardEvent, context: any) => void;
      hasIndex: boolean;
    };
  }
}

Hooks.once("init", () => {
  console.log(`Initializing ${moduleId}`);
  
  // Register module settings for WebSocket configuration
  (game as Game).settings.register(moduleId, "wsRelayUrl", {
    name: "WebSocket Relay URL",
    hint: "URL for the WebSocket relay server",
    scope: "world",
    config: true,
    type: String,
    default: "ws://localhost:3010",
    onChange: () => {
      const module = (game as Game).modules.get(moduleId) as FoundryGetActorsExternal;
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
      const module = (game as Game).modules.get(moduleId) as FoundryGetActorsExternal;
      if (module.socketManager) {
        module.socketManager.disconnect();
        initializeWebSocket();
      }
    }
  });

  // Create and expose module API
  const module = (game as Game).modules.get(moduleId) as FoundryGetActorsExternal;
  module.api = {
    getWebSocketManager: () => module.socketManager,
    search: async (query: string, filter?: string) => {
      if (!window.QuickInsert) {
        console.error(`${moduleId} | QuickInsert not available`);
        return [];
      }
      
      if (!window.QuickInsert.hasIndex) {
        console.log(`${moduleId} | QuickInsert index not ready, forcing index creation`);
        try {
          window.QuickInsert.forceIndex();
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`${moduleId} | Failed to force QuickInsert index:`, error);
        }
      }
      
      let filterFunc = null;
      if (filter) {
        filterFunc = (item: any) => item.documentType === filter;
      }
      
      return window.QuickInsert.search(query, filterFunc, 100);
    },
    getByUuid: async (uuid: string) => {
      try {
        return await fromUuid(uuid);
      } catch (error) {
        console.error(`${moduleId} | Error getting entity by UUID:`, error);
        return null;
      }
    }
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
  const module = (game as Game).modules.get(moduleId) as FoundryGetActorsExternal;
  
  if (!wsRelayUrl) {
    console.error(`${moduleId} | WebSocket relay URL is empty. Please configure it in module settings.`);
    return;
  }
  
  console.log(`${moduleId} | Initializing WebSocket with URL: ${wsRelayUrl}, token: ${wsRelayToken}`);
  
  try {
    // Create and connect the WebSocket manager
    module.socketManager = new WebSocketManager(wsRelayUrl, wsRelayToken);
    module.socketManager.connect();
    
    // Register message handlers
    module.socketManager.onMessageType("ping", () => {
      console.log(`${moduleId} | Received ping, sending pong`);
      module.socketManager.send({ type: "pong" });
    });

    module.socketManager.onMessageType("pong", () => {
      console.log(`${moduleId} | Received pong`);
    });
    
    // Handle search requests
    module.socketManager.onMessageType("perform-search", async (data) => {
      console.log(`${moduleId} | Received search request:`, data);
      
      try {
        if (!window.QuickInsert) {
          console.error(`${moduleId} | QuickInsert not available`);
          module.socketManager.send({
            type: "search-results",
            requestId: data.requestId,
            error: "QuickInsert not available",
            results: []
          });
          return;
        }
        
        if (!window.QuickInsert.hasIndex) {
          console.log(`${moduleId} | QuickInsert index not ready, forcing index creation`);
          try {
            window.QuickInsert.forceIndex();
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            console.error(`${moduleId} | Failed to force QuickInsert index:`, error);
            module.socketManager.send({
              type: "search-results",
              requestId: data.requestId,
              error: "QuickInsert index not ready",
              results: []
            });
            return;
          }
        }
        
        const allResults = await window.QuickInsert.search(data.query, null, 200);
        console.log(`${moduleId} | Initial search returned ${allResults.length} results`);
        
        let filteredResults = allResults;
        if (data.filter) {
          console.log(`${moduleId} | Applying filters:`, data.filter);
          const filters = typeof data.filter === 'string' ? 
            parseFilterString(data.filter) : data.filter;
            
          filteredResults = allResults.filter(result => {
            return matchesAllFilters(result, filters);
          });
        }
        
        module.socketManager.send({
          type: "search-results",
          requestId: data.requestId,
          results: filteredResults.map(result => {
            const item = result.item;
            
            return {
              documentType: item.documentType,
              folder: item.folder,
              id: item.id,
              name: item.name,
              package: item.package,
              packageName: item.packageName,
              subType: item.subType,
              uuid: item.uuid,
              icon: item.icon,
              journalLink: item.journalLink,
              tagline: item.tagline || "",
              formattedMatch: result.formattedMatch || "",
              resultType: item.constructor?.name
            };
          })
        });
      } catch (error) {
        console.error(`${moduleId} | Error performing search:`, error);
        module.socketManager.send({
          type: "search-results",
          requestId: data.requestId,
          error: (error as Error).message,
          results: []
        });
      }
    });
    
    // Handle entity requests
    module.socketManager.onMessageType("get-entity", async (data) => {
      console.log(`${moduleId} | Received entity request:`, data);
      
      try {
        const entity = await fromUuid(data.uuid);
        
        if (!entity) {
          console.error(`${moduleId} | Entity not found for UUID: ${data.uuid}`);
          module.socketManager.send({
            type: "entity-data",
            requestId: data.requestId,
            uuid: data.uuid,
            error: "Entity not found",
            data: null
          });
          return;
        }
        
        const entityData = entity.toObject ? entity.toObject() : entity;
        console.log(`${moduleId} | Sending entity data for: ${data.uuid}`, entityData);
        
        module.socketManager.send({
          type: "entity-data",
          requestId: data.requestId,
          uuid: data.uuid,
          data: entityData
        });
      } catch (error) {
        console.error(`${moduleId} | Error getting entity:`, error);
        module.socketManager.send({
          type: "entity-data",
          requestId: data.requestId,
          uuid: data.uuid,
          error: (error as Error).message,
          data: null
        });
      }
    });
  } catch (error) {
    console.error(`${moduleId} | Error initializing WebSocket:`, error);
  }
}

function parseFilterString(filterStr: string): Record<string, string> {
  if (!filterStr.includes(':')) {
    return { documentType: filterStr };
  }
  
  const filters: Record<string, string> = {};
  const parts = filterStr.split(',');
  
  for (const part of parts) {
    if (part.includes(':')) {
      const [key, value] = part.split(':');
      if (key && value) {
        filters[key.trim()] = value.trim();
      }
    }
  }
  
  return filters;
}

function matchesAllFilters(result: any, filters: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    
    if (key === "resultType") {
      const itemConstructorName = result.item?.constructor?.name;
      if (!itemConstructorName || itemConstructorName.toLowerCase() !== value.toLowerCase()) {
        return false;
      }
      continue;
    }
    
    let propertyValue;
    if (!key.includes('.') && result.item && result.item[key] !== undefined) {
      propertyValue = result.item[key];
    } else {
      const parts = key.split('.');
      let current = result;
      
      for (const part of parts) {
        if (current === undefined || current === null) {
          propertyValue = undefined;
          break;
        }
        current = current[part];
      }
      
      propertyValue = current;
    }
    
    if (propertyValue === undefined || 
        (typeof propertyValue === 'string' &&
         propertyValue.toLowerCase() !== value.toLowerCase())) {
      return false;
    }
  }
  
  return true;
}