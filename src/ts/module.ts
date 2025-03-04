// src/ts/module.ts
import "../styles/style.scss";
import { FoundryRestApi } from "./types";
import { moduleId } from "./constants";
import { WebSocketManager } from "./network/webSocketManager";
import { ModuleLogger } from "./utils/logger";

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

// Store the rolls made during this session
const recentRolls: any[] = [];
const MAX_ROLLS_STORED = 20; // Store up to 20 recent rolls

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
      const module = (game as Game).modules.get(moduleId) as FoundryRestApi;
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
      const module = (game as Game).modules.get(moduleId) as FoundryRestApi;
      if (module.socketManager) {
        module.socketManager.disconnect();
        initializeWebSocket();
      }
    }
  });

  (game as Game).settings.register(moduleId, "logLevel", {
    name: "Log Level",
    hint: "Set the level of detail for module logging",
    scope: "world",
    config: true,
    type: Number,
    choices: {
      0: "debug",
      1: "info",
      2: "warn",
      3: "error"
    } as any,
    default: 2
  });

  // Create and expose module API
  const module = (game as Game).modules.get(moduleId) as FoundryRestApi;
  module.api = {
    getWebSocketManager: () => module.socketManager,
    search: async (query: string, filter?: string) => {
      if (!window.QuickInsert) {
        ModuleLogger.error(`${moduleId} | QuickInsert not available`);
        return [];
      }
      
      if (!window.QuickInsert.hasIndex) {
        ModuleLogger.info(`${moduleId} | QuickInsert index not ready, forcing index creation`);
        try {
          window.QuickInsert.forceIndex();
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          ModuleLogger.error(`${moduleId} | Failed to force QuickInsert index:`, error);
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
        ModuleLogger.error(`${moduleId} | Error getting entity by UUID:`, error);
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

Hooks.on("createChatMessage", (message: any) => {
  if (message.isRoll && message.rolls?.length > 0) {
    ModuleLogger.info(`${moduleId} | Detected dice roll from ${message.user?.name || 'unknown'}`);
    
    // Generate a unique ID using the message ID to prevent duplicates
    const rollId = message.id;
    
    // Format roll data
    const rollData = {
      id: rollId,
      messageId: message.id,
      user: {
        id: message.user?.id,
        name: message.user?.name
      },
      speaker: message.speaker,
      flavor: message.flavor || "",
      rollTotal: message.rolls[0].total,
      formula: message.rolls[0].formula,
      isCritical: message.rolls[0].isCritical || false,
      isFumble: message.rolls[0].isFumble || false,
      dice: message.rolls[0].dice?.map((d: any) => ({
        faces: d.faces,
        results: d.results.map((r: any) => ({
          result: r.result,
          active: r.active
        }))
      })),
      timestamp: Date.now()
    };
    
    // Check if this roll ID already exists in recentRolls
    const existingIndex = recentRolls.findIndex(roll => roll.id === rollId);
    if (existingIndex !== -1) {
      // If it exists, update it instead of adding a new entry
      recentRolls[existingIndex] = rollData;
    } else {
      // Add to recent rolls
      recentRolls.unshift(rollData);
      
      // Trim the array if needed
      if (recentRolls.length > MAX_ROLLS_STORED) {
        recentRolls.length = MAX_ROLLS_STORED;
      }
    }
    
    // Send to relay server if connected
    const module = (game as Game).modules.get(moduleId) as FoundryRestApi;
    if (module.socketManager?.isConnected()) {
      module.socketManager.send({
        type: "roll-data",
        data: rollData
      });
    }
  }
});

function initializeWebSocket() {
  // Get settings
  const wsRelayUrl = (game as Game).settings.get(moduleId, "wsRelayUrl") as string;
  const wsRelayToken = (game as Game).settings.get(moduleId, "wsRelayToken") as string;
  const module = (game as Game).modules.get(moduleId) as FoundryRestApi;
  
  if (!wsRelayUrl) {
    ModuleLogger.error(`${moduleId} | WebSocket relay URL is empty. Please configure it in module settings.`);
    return;
  }
  
  ModuleLogger.info(`${moduleId} | Initializing WebSocket with URL: ${wsRelayUrl}, token: ${wsRelayToken}`);
  
  try {
    // Create and connect the WebSocket manager
    module.socketManager = new WebSocketManager(wsRelayUrl, wsRelayToken);
    module.socketManager.connect();
    
    // Register message handlers
    module.socketManager.onMessageType("ping", () => {
      ModuleLogger.info(`${moduleId} | Received ping, sending pong`);
      module.socketManager.send({ type: "pong" });
    });

    module.socketManager.onMessageType("pong", () => {
      ModuleLogger.info(`${moduleId} | Received pong`);
    });
    
    // Handle search requests
    module.socketManager.onMessageType("perform-search", async (data) => {
      ModuleLogger.info(`${moduleId} | Received search request:`, data);
      
      try {
        if (!window.QuickInsert) {
          ModuleLogger.error(`${moduleId} | QuickInsert not available`);
          module.socketManager.send({
            type: "search-results",
            requestId: data.requestId,
            query: data.query,
            error: "QuickInsert not available",
            results: []
          });
          return;
        }
        
        if (!window.QuickInsert.hasIndex) {
          ModuleLogger.info(`${moduleId} | QuickInsert index not ready, forcing index creation`);
          try {
            window.QuickInsert.forceIndex();
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            ModuleLogger.error(`${moduleId} | Failed to force QuickInsert index:`, error);
            module.socketManager.send({
              type: "search-results",
              requestId: data.requestId,
              query: data.query,
              error: "QuickInsert index not ready",
              results: []
            });
            return;
          }
        }
        
        const allResults = await window.QuickInsert.search(data.query, null, 200);
        ModuleLogger.info(`${moduleId} | Initial search returned ${allResults.length} results`);
        
        let filteredResults = allResults;
        if (data.filter) {
          ModuleLogger.info(`${moduleId} | Applying filters:`, data.filter);
          const filters = typeof data.filter === 'string' ? 
            parseFilterString(data.filter) : data.filter;
            
          filteredResults = allResults.filter(result => {
            return matchesAllFilters(result, filters);
          });
        }
        
        module.socketManager.send({
          type: "search-results",
          requestId: data.requestId,
          query: data.query,
          filter: data.filter,
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
        ModuleLogger.error(`${moduleId} | Error performing search:`, error);
        module.socketManager.send({
          type: "search-results",
          requestId: data.requestId,
          query: data.query,
          error: (error as Error).message,
          results: []
        });
      }
    });
    
    // Handle entity requests
    module.socketManager.onMessageType("get-entity", async (data) => {
      ModuleLogger.info(`${moduleId} | Received entity request:`, data);
      
      try {
        const entity = await fromUuid(data.uuid);
        
        if (!entity) {
          ModuleLogger.error(`${moduleId} | Entity not found for UUID: ${data.uuid}`);
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
        ModuleLogger.info(`${moduleId} | Sending entity data for: ${data.uuid}`, entityData);
        
        module.socketManager.send({
          type: "entity-data",
          requestId: data.requestId,
          uuid: data.uuid,
          data: entityData
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error getting entity:`, error);
        module.socketManager.send({
          type: "entity-data",
          requestId: data.requestId,
          uuid: data.uuid,
          error: (error as Error).message,
          data: null
        });
      }
    });

    // Handle structure request
    module.socketManager.onMessageType("get-structure", async (data) => {
      ModuleLogger.info(`${moduleId} | Received structure request`);
      
      try {
        // Get all folders
        const folders = Object.entries((game as Game).folders?.contents || []).map(([_, folder]) => {
          return {
            id: folder.id,
            name: folder.name,
            type: folder.type,
            parent: folder.parent?.id,
            path: folder.uuid,
            sorting: (folder as any).sort,
            sortingMode: (folder as any).sortingMode
          };
        });
        
        // Get all compendiums
        const compendiums = (game as Game).packs.contents.map(pack => {
          return {
            id: pack.collection,
            name: pack.metadata.label,
            path: `Compendium.${pack.collection}`,
            entity: pack.documentName,
            package: pack.metadata.package,
            packageType: pack.metadata.type,
            system: pack.metadata.system
          };
        });
        
        module.socketManager.send({
          type: "structure-data",
          requestId: data.requestId,
          folders,
          compendiums
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error getting structure:`, error);
        module.socketManager.send({
          type: "structure-data",
          requestId: data.requestId,
          error: (error as Error).message,
          folders: [],
          compendiums: []
        });
      }
    });
    
    // Handle contents request
    module.socketManager.onMessageType("get-contents", async (data) => {
      ModuleLogger.info(`${moduleId} | Received contents request for path: ${data.path}`);
      
      try {
        let contents = [];
        
        if (data.path.startsWith("Compendium.")) {
          // Handle compendium path
          const pack = (game as Game).packs.get(data.path.replace("Compendium.", ""));
          if (!pack) {
            throw new Error(`Compendium not found: ${data.path}`);
          }
          
          // Get the index if not already loaded
          const index = await pack.getIndex();
          
          // Return entries from the index
          contents = index.contents.map(entry => {
            return {
              uuid: `${pack.collection}.${entry._id}`,
              id: entry._id,
              name: entry.name,
              img: 'img' in entry ? entry.img : null,
              type: 'type' in entry ? entry.type : null
            };
          });
        } else {
          // Handle folder path
          // Extract folder ID from path like "Folder.abcdef12345"
          const folderMatch = data.path.match(/Folder\.([a-zA-Z0-9]+)/);
          if (!folderMatch) {
            throw new Error(`Invalid folder path: ${data.path}`);
          }
          
          const folderId = folderMatch[1];
          const folder = (game as Game).folders?.get(folderId);
          
          if (!folder) {
            throw new Error(`Folder not found: ${data.path}`);
          }
          
          // Get entities in folder
          contents = folder.contents.map(entity => {
            return {
              uuid: entity.uuid,
              id: entity.id,
              name: entity.name,
              img: 'img' in entity ? entity.img : null,
              type: entity.documentName
            };
          });
        }
        
        module.socketManager.send({
          type: "contents-data",
          requestId: data.requestId,
          path: data.path,
          entities: contents
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error getting contents:`, error);
        module.socketManager.send({
          type: "contents-data",
          requestId: data.requestId,
          path: data.path,
          error: (error as Error).message,
          entities: []
        });
      }
    });
    
    // Handle entity creation
    module.socketManager.onMessageType("create-entity", async (data) => {
      ModuleLogger.info(`${moduleId} | Received create entity request for type: ${data.entityType}`);
      
      try {
        // Get the document class for the entity type
        const DocumentClass = getDocumentClass(data.entityType);
        if (!DocumentClass) {
          throw new Error(`Invalid entity type: ${data.entityType}`);
        }
        
        // Prepare creation data
        const createData = {
          ...data.data,
          folder: data.folder || null
        };
        
        // Create the entity
        const entity = await DocumentClass.create(createData);
        
        if (!entity) {
          throw new Error("Failed to create entity");
        }
        
        module.socketManager.send({
          type: "entity-created",
          requestId: data.requestId,
          uuid: entity.uuid,
          entity: entity.toObject()
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error creating entity:`, error);
        module.socketManager.send({
          type: "entity-created",
          requestId: data.requestId,
          error: (error as Error).message,
          message: "Failed to create entity"
        });
      }
    });
    
    // Handle entity update
    module.socketManager.onMessageType("update-entity", async (data) => {
      ModuleLogger.info(`${moduleId} | Received update entity request for UUID: ${data.uuid}`);
      
      try {
        // Get the entity by UUID
        const entity = await fromUuid(data.uuid);
        
        if (!entity) {
          throw new Error(`Entity not found: ${data.uuid}`);
        }
        
        // Update the entity
        await entity.update(data.updateData);
        
        // Get the updated entity
        const updatedEntity = await fromUuid(data.uuid);
        
        module.socketManager.send({
          type: "entity-updated",
          requestId: data.requestId,
          uuid: data.uuid,
          entity: updatedEntity?.toObject()
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error updating entity:`, error);
        module.socketManager.send({
          type: "entity-updated",
          requestId: data.requestId,
          uuid: data.uuid,
          error: (error as Error).message,
          message: "Failed to update entity"
        });
      }
    });
    
    // Handle entity deletion
    module.socketManager.onMessageType("delete-entity", async (data) => {
      ModuleLogger.info(`${moduleId} | Received delete entity request for UUID: ${data.uuid}`);
      
      try {
        // Get the entity by UUID
        const entity = await fromUuid(data.uuid);
        
        if (!entity) {
          throw new Error(`Entity not found: ${data.uuid}`);
        }
        
        // Delete the entity
        await entity.delete();
        
        module.socketManager.send({
          type: "entity-deleted",
          requestId: data.requestId,
          uuid: data.uuid,
          success: true
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error deleting entity:`, error);
        module.socketManager.send({
          type: "entity-deleted",
          requestId: data.requestId,
          uuid: data.uuid,
          error: (error as Error).message,
          message: "Failed to delete entity"
        });
      }
    });

    // Handle roll data request (get list of rolls)
    module.socketManager.onMessageType("get-rolls", async (data) => {
      ModuleLogger.info(`${moduleId} | Received request for roll data`);
      
      module.socketManager.send({
        type: "rolls-data",
        requestId: data.requestId,
        data: recentRolls.slice(0, data.limit || 20)
      });
    });

    // Handle last roll request
    module.socketManager.onMessageType("get-last-roll", (data) => {
      ModuleLogger.info(`${moduleId} | Received request for last roll data`);
      
      module.socketManager.send({
        type: "last-roll-data",
        requestId: data.requestId,
        data: recentRolls.length > 0 ? recentRolls[0] : null
      });
    });

    // Handle roll request
    module.socketManager.onMessageType("perform-roll", async (data) => {
      ModuleLogger.info(`${moduleId} | Received roll request:`, data);
      
      try {
        // Validate the roll formula
        if (!data.formula) {
          throw new Error("Roll formula is required");
        }
        
        // Create a new Roll instance
        const roll = new Roll(data.formula);
        
        // Generate a unique rollId for this roll
        const rollId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Evaluate the roll using evaluateSync
        await roll.evaluate();
        
        // Create chat message if requested
        if (data.createChatMessage !== false) {
          // Process whisper recipients
          let whisperRecipients = [];
          
          if (data.whisper && Array.isArray(data.whisper)) {
            // Try to get valid user IDs for whisper
            for (const entry of data.whisper) {
              // If it's already a valid user ID, use it directly
              const user = (game as Game).users?.get(entry);
              if (user) {
                whisperRecipients.push(entry);
                continue;
              }
              
              // Try to find by name
              const userByName = (game as Game).users?.find(u => u.name === entry);
              if (userByName) {
                whisperRecipients.push(userByName.id);
              }
            }
          }
          
          // Determine speaker
          let speaker;
          
          if (data.speaker) {
            // If speaker is provided, use it
            if (typeof data.speaker === 'string') {
              // First try to find as token ID
              const activeScene = (game as Game).scenes?.viewed;
              let token = activeScene?.tokens?.get(data.speaker);
              
              // If not found by ID, try to find token by name
              if (!token) {
                token = activeScene?.tokens?.find(t => t.name === data.speaker);
              }
              
              if (token) {
                speaker = ChatMessage.getSpeaker({ token });
              } else {
                // If not a token, try as actor ID
                const actor = (game as Game).actors?.get(data.speaker);
                if (actor) {
                  // Look for tokens representing this actor on the current scene
                  const tokenForActor = activeScene?.tokens?.find(t => {
                    // Check if this token represents the actor
                    return t.actor?.id === actor.id;
                  });
                  
                  if (tokenForActor) {
                    speaker = ChatMessage.getSpeaker({ token: tokenForActor });
                  } else {
                    // No token found, use actor directly
                    speaker = ChatMessage.getSpeaker({ actor });
                  }
                } else {
                  // Try to find by actor name
                  const actorByName = (game as Game).actors?.find(a => a.name === data.speaker);
                  if (actorByName) {
                    // Look for tokens representing this actor on the current scene
                    const tokenForNamedActor = activeScene?.tokens?.find(t => {
                      return t.actor?.id === actorByName.id;
                    });
                    
                    if (tokenForNamedActor) {
                      speaker = ChatMessage.getSpeaker({ token: tokenForNamedActor });
                    } else {
                      // No token found, use actor directly
                      speaker = ChatMessage.getSpeaker({ actor: actorByName });
                    }
                  } else {
                    // Just set the alias if nothing found
                    speaker = ChatMessage.getSpeaker();
                    speaker.alias = data.speaker;
                  }
                }
              }
            } else {
              // If it's an object, use it directly
              speaker = data.speaker;
            }
          } else {
            // Default speaker
            speaker = ChatMessage.getSpeaker();
          }
          
          const chatData = {
            user: (game as Game).user?.id,
            speaker: speaker,
            flavor: data.flavor || `Rolling ${data.formula}`,
            rolls: [roll],
            sound: CONFIG.sounds.dice,
            whisper: whisperRecipients
          };
          
          // Create chat message
          try {
            await ChatMessage.create(chatData);
            
            // Format roll data for response
            const rollData = {
              formula: roll.formula,
              total: roll.total,
              isCritical: (roll as any).isCritical || false,
              isFumble: (roll as any).isFumble || false,
              dice: roll.dice.map((d: any) => ({
                faces: d.faces,
                results: d.results.map((r: any) => ({
                  result: r.result,
                  active: r.active
                }))
              })),
              timestamp: Date.now()
            };
            // as the createChatMessage hook will handle adding it to recentRolls
            module.socketManager.send({
              type: "roll-result",
              requestId: data.requestId,
              success: true,
              data: {
                id: rollId,
                chatMessageCreated: true,
                roll: rollData
              }
            });
            return;
          } catch (chatError) {
            ModuleLogger.error(`${moduleId} | Error creating chat message with roll property:`, chatError);
          }
        }
        
        // If we get here, either createChatMessage was false or both attempts to create a chat message failed
        // Format roll data for response
        const rollData = {
          id: rollId,
          formula: roll.formula,
          total: roll.total,
          isCritical: (roll as any).isCritical || false,
          isFumble: (roll as any).isFumble || false,
          dice: roll.dice.map((d: any) => ({
            faces: d.faces,
            results: d.results.map((r: any) => ({
              result: r.result,
              active: r.active
            }))
          })),
          timestamp: Date.now()
        };
        
        // Add to recent rolls if chat message wasn't created
        if (data.createChatMessage === false) {
          // Add to recent rolls
          recentRolls.unshift(rollData);
          
          // Trim the array if needed
          if (recentRolls.length > MAX_ROLLS_STORED) {
            recentRolls.length = MAX_ROLLS_STORED;
          }
        }
        
        module.socketManager.send({
          type: "roll-result",
          requestId: data.requestId,
          success: true,
          data: rollData
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error performing roll:`, error);
        module.socketManager.send({
          type: "roll-result",
          requestId: data.requestId,
          success: false,
          error: (error as Error).message
        });
      }
    });

    // Handle actor sheet HTML request
    module.socketManager.onMessageType("get-actor-sheet-html", async (data) => {
      ModuleLogger.info(`${moduleId} | Received actor sheet HTML request for UUID: ${data.uuid}`);
      
      try {
        // Get the actor from its UUID
        const actor = await fromUuid(data.uuid) as Actor;
        if (!actor) {
          ModuleLogger.error(`${moduleId} | Actor not found for UUID: ${data.uuid}`);
          module.socketManager.send({
            type: "actor-sheet-html-response",
            requestId: data.requestId,
            data: { error: "Actor not found", uuid: data.uuid }
          });
          return;
        }
        
        // Check if it's an actor
        if (actor.documentName !== "Actor") {
          ModuleLogger.error(`${moduleId} | Entity is not an Actor: ${data.uuid}`);
          module.socketManager.send({
            type: "actor-sheet-html-response",
            requestId: data.requestId,
            data: { error: "Entity is not an Actor", uuid: data.uuid }
          });
          return;
        }
        
        // Create a temporary sheet to render
        const sheet = actor.sheet?.render(true) as ActorSheet;
        
        // Wait for the sheet to render
        setTimeout(async () => {
          try {
            // Get the HTML content
            if (!sheet.element || !sheet.element[0]) {
              throw new Error("Failed to render actor sheet");
            }
            
            let html = sheet.element[0].outerHTML;
            
            // Get the associated CSS - much more comprehensive approach
            let css = '';
            
            // 1. Get CSS from style elements with data-appid matching the sheet
            const appStyles = document.querySelectorAll('style[data-appid]');
            appStyles.forEach(style => {
              const styleAppId = (style as HTMLElement).dataset.appid;
              const sheetAppId = String(sheet.appId);
              if (styleAppId === sheetAppId) {
                css += style.textContent + '\n';
              }
            });
            
            // 2. Get global system styles that might apply to this sheet
            const systemStyles = document.querySelectorAll(`style[id^="system-${actor.type}"]`);
            systemStyles.forEach(style => {
              css += style.textContent + '\n';
            });
            
            // 3. Extract all classes and IDs from the HTML to capture all relevant styles
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            
            // Create sets to avoid duplicates
            const classNames = new Set<string>();
            const ids = new Set<string>();
            
            // Function to extract classes and IDs from an element and its children
            function extractClassesAndIds(element: Element) {
              // Get classes
              if (element.classList && element.classList.length) {
                element.classList.forEach(className => classNames.add(className));
              }
              
              // Get ID
              if (element.id) {
                ids.add(element.id);
              }
              
              // Process children recursively
              for (let i = 0; i < element.children.length; i++) {
                extractClassesAndIds(element.children[i]);
              }
            }
            
            // Extract classes and IDs from all elements
            extractClassesAndIds(tempDiv);
            
            // Convert sets to arrays
            const uniqueClassNames = Array.from(classNames);
            const uniqueIds = Array.from(ids);
            
            ModuleLogger.debug(`${moduleId} | Extracted ${uniqueClassNames.length} unique classes and ${uniqueIds.length} unique IDs`);
            
            // Create a mapping of elements to their styles for debugging
            const styleMap: Record<string, string[]> = {};
            
            // 4. Collect all stylesheets in the document
            const allStyles = document.querySelectorAll('style');
            const allLinks = document.querySelectorAll('link[rel="stylesheet"]');
            
            // Process inline styles
            allStyles.forEach(style => {
              // Skip if we already added this style sheet (avoid duplicates)
              if (style.dataset.appid && style.dataset.appid === sheetAppId) {
                return; // Already added above
              }
              
              const styleContent = style.textContent || '';
              
              // Check if this style contains any of our classes or IDs
              const isRelevant = uniqueClassNames.some(className => 
                styleContent.includes(`.${className}`)) || 
                uniqueIds.some(id => styleContent.includes(`#${id}`)) ||
                // Common selectors that might apply
                styleContent.includes('.window-app') || 
                styleContent.includes('.sheet') || 
                styleContent.includes('.actor-sheet') ||
                styleContent.includes(`.${actor.type}-sheet`);
              
              if (isRelevant) {
                ModuleLogger.debug(`${moduleId} | Adding relevant inline style`);
                css += styleContent + '\n';
              }
            });
            
            // 5. Process external stylesheets
            const stylesheetPromises = Array.from(allLinks).map(async (link) => {
              try {
                const href = link.getAttribute('href');
                if (!href) return '';
                
                // Skip foundry-specific stylesheets that we'll handle separately
                if (href.includes('fonts.googleapis.com')) return '';
                
                ModuleLogger.debug(`${moduleId} | Fetching external CSS from: ${href}`);
                const fullUrl = href.startsWith('http') ? href : 
                              href.startsWith('/') ? `${window.location.origin}${href}` : 
                              `${window.location.origin}/${href}`;
                
                const response = await fetch(fullUrl);
                if (!response.ok) {
                  ModuleLogger.warn(`${moduleId} | Failed to fetch CSS: ${fullUrl}, status: ${response.status}`);
                  return '';
                }
                
                const styleContent = await response.text();
                return styleContent;
              } catch (e) {
                ModuleLogger.warn(`${moduleId} | Failed to fetch external CSS: ${e}`);
                return '';
              }
            });
            
            // 6. Important: Add foundry core styles
            const baseUrl = window.location.origin;
            ModuleLogger.debug(`${moduleId} | Base URL for fetching CSS: ${baseUrl}`);
            
            // Try different path patterns that might work with Foundry
            const coreStylesheets = [
              // Try various likely paths for foundry core styles
              `${baseUrl}/css/style.css`,
              `${baseUrl}/styles/style.css`,
              `${baseUrl}/styles/foundry.css`,
              `${baseUrl}/ui/sheets.css`,
              // Try with /game path prefix (common in some Foundry setups)
              `${baseUrl}/game/styles/foundry.css`,
              `${baseUrl}/game/ui/sheets.css`,
              // System-specific styles
              `${baseUrl}/systems/${(game as Game).system.id}/system.css`,
              `${baseUrl}/systems/${(game as Game).system.id}/styles/system.css`,
              // Try with /game path prefix for system styles
              `${baseUrl}/game/systems/${(game as Game).system.id}/system.css`,
              `${baseUrl}/game/systems/${(game as Game).system.id}/styles/system.css`
            ];
            
            // Add more debugging to identify the correct paths
            ModuleLogger.debug(`${moduleId} | All stylesheet links in document:`, 
              Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
                .map(link => link.getAttribute('href'))
                .filter(Boolean)
            );
            
            // Extract potential stylesheet paths from existing links
            const existingCSSPaths = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
              .map(link => link.getAttribute('href'))
              .filter(Boolean)
              .filter(href => !href.includes('fonts.googleapis.com') && !href.includes('//'));
            
            // Add these paths to our core stylesheets
            coreStylesheets.push(...existingCSSPaths);
            
            // Debug current document styles to see what's actually loaded
            ModuleLogger.debug(`${moduleId} | All style elements in document:`, 
              document.querySelectorAll('style').length
            );
            
            const corePromises = coreStylesheets.map(async (path) => {
              try {
                ModuleLogger.debug(`${moduleId} | Fetching core CSS from: ${path}`);
                const response = await fetch(path);
                if (!response.ok) {
                  ModuleLogger.warn(`${moduleId} | Failed to fetch CSS: ${path}, status: ${response.status}`);
                  return '';
                }
                
                // If successful, log it clearly
                ModuleLogger.info(`${moduleId} | Successfully loaded CSS from: ${path}`);
                return await response.text();
              } catch (e) {
                ModuleLogger.warn(`${moduleId} | Failed to fetch core CSS: ${e}`);
                return '';
              }
            });
            
            // Wait for all external CSS to be fetched
            const allPromises = [...stylesheetPromises, ...corePromises];
            const externalStyles = await Promise.all(allPromises);
            externalStyles.forEach(style => {
              css += style + '\n';
            });
            
            // 7. Add fallback styles if needed
            if (css.length < 100) {
              ModuleLogger.warn(`${moduleId} | CSS fetch failed or returned minimal content. Adding fallback styles.`);
              css += `
    /* Fallback styles for actor sheet */
    .window-app {
      font-family: "Signika", sans-serif;
      background: #f0f0e0;
      border-radius: 5px;
      box-shadow: 0 0 20px #000;
      color: #191813;
    }
    .window-content {
      background: rgba(255, 255, 240, 0.9);
      padding: 8px;
      overflow-y: auto;
      background: url(${window.location.origin}/ui/parchment.jpg) repeat;
    }
    input, select, textarea {
      border: 1px solid #7a7971;
      background: rgba(255, 255, 255, 0.8);
    }
    button {
      background: rgba(0, 0, 0, 0.1);
      border: 1px solid #7a7971;
      border-radius: 3px;
      cursor: pointer;
    }
    .profile-img {
      border: none;
      max-width: 100%;
      max-height: 220px;
    }
    `;
            }
            
            // Log the CSS collection results
            ModuleLogger.debug(`${moduleId} | Collected CSS: ${css.length} bytes`);
            
            // Before sending the HTML, fix asset URLs
            html = html.replace(/src="([^"]+)"/g, (match, src) => {
              if (src.startsWith('http')) return match;
              if (src.startsWith('/')) return `src="${window.location.origin}${src}"`;
              return `src="${window.location.origin}/${src}"`;
            });

            // Also fix background images in styles
            css = css.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
              if (url.startsWith('http') || url.startsWith('data:')) return match;
              if (url.startsWith('/')) return `url('${window.location.origin}${url}')`;
              return `url('${window.location.origin}/${url}')`;
            });

            // Close the temporary sheet
            sheet.close();
            
            // Send the HTML and CSS back
            module.socketManager.send({
              type: "actor-sheet-html-response",
              requestId: data.requestId,
              data: { html, css, uuid: data.uuid }
            });

            // Add confirmation log
            ModuleLogger.debug(`${moduleId} | Sent actor sheet HTML response with requestId: ${data.requestId}`);
            ModuleLogger.debug(`${moduleId} | HTML length: ${html.length}, CSS length: ${css.length}`);
          } catch (renderError) {
            ModuleLogger.error(`${moduleId} | Error capturing actor sheet HTML:`, renderError);
            module.socketManager.send({
              type: "actor-sheet-html-response",
              requestId: data.requestId,
              data: { error: "Failed to capture actor sheet HTML", uuid: data.uuid }
            });
            
            // Make sure to close the sheet if it was created
            if (sheet && typeof sheet.close === 'function') {
              sheet.close();
            }
          }
        }, 500); // Small delay to ensure rendering is complete
        
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error rendering actor sheet:`, error);
        module.socketManager.send({
          type: "actor-sheet-html-response",
          requestId: data.requestId,
          data: { error: "Failed to render actor sheet", uuid: data.uuid }
        });
      }
    });

  } catch (error) {
    ModuleLogger.error(`${moduleId} | Error initializing WebSocket:`, error);
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