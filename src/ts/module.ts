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
    default: "wss://foundryvtt-rest-api-relay.fly.dev",
    requiresReload: true
  } as any);
  
  (game as Game).settings.register(moduleId, "apiKey", {
    name: "API Key",
    hint: "API Key for authentication with the relay server",
    scope: "world",
    config: true,
    type: String,
    default: (game as Game).world.id,
    requiresReload: true
  } as any);;

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
  const apiKey = (game as Game).settings.get(moduleId, "apiKey") as string;
  const module = (game as Game).modules.get(moduleId) as FoundryRestApi;
  
  if (!wsRelayUrl) {
    ModuleLogger.error(`${moduleId} | WebSocket relay URL is empty. Please configure it in module settings.`);
    return;
  }
  
  ModuleLogger.info(`${moduleId} | Initializing WebSocket with URL: ${wsRelayUrl}, api key: ${apiKey}`);
  
  try {
    // Create and connect the WebSocket manager
    module.socketManager = new WebSocketManager(wsRelayUrl, apiKey);
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

        let filterFunc = null;
        if (data.filter) {
          const filters = typeof data.filter === 'string' ? 
            parseFilterString(data.filter) : data.filter;

          filterFunc = (result: any) => {
            return matchesAllFilters(result, filters);
          };
        }
        
        const filteredResults = await window.QuickInsert.search(data.query, filterFunc, 200);
        ModuleLogger.info(`${moduleId} | Search returned ${filteredResults.length} results`);
        
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
      try {
        const { formula, itemUuid, flavor, createChatMessage, speaker, target, whisper, requestId } = data;
        
        let rollResult;
        let speakerData = {};
        let rollMode = whisper && whisper.length > 0 ? CONST.DICE_ROLL_MODES.PRIVATE : CONST.DICE_ROLL_MODES.PUBLIC;
        
        // Process speaker if provided
        if (speaker) {
          try {
            // Check if it's a token UUID or actor UUID
            const speakerEntity = await fromUuid(speaker);
            
            if (speakerEntity) {
              if (speakerEntity instanceof TokenDocument) {
                // It's a token
                speakerData = {
                  token: speakerEntity?.id,
                  actor: speakerEntity?.actor?.id,
                  scene: speakerEntity?.parent?.id,
                  alias: speakerEntity?.name || speakerEntity?.actor?.name
                };
              } else if (speakerEntity instanceof Actor) {
                // It's an actor - try to find a token that represents it on the active scene
                const activeScene = (game as Game).scenes?.active;
                if (activeScene) {
                  const tokens = activeScene.tokens?.filter(t => t.actor?.id === speakerEntity.id);
                  if (tokens && tokens.length > 0) {
                    // Use the first token found
                    const token = tokens[0];
                    speakerData = {
                      token: token.id,
                      actor: speakerEntity.id,
                      scene: activeScene.id,
                      alias: token.name || speakerEntity.name
                    };
                  } else {
                    // No token found, just use actor
                    speakerData = {
                      actor: speakerEntity.id,
                      alias: speakerEntity.name
                    };
                  }
                }
              }
            }
          } catch (err) {
            ModuleLogger.warn(`${moduleId} | Failed to process speaker: ${err}`);
          }
        }
        
        // Process the roll
        if (itemUuid) {
          try {
            // Get the item document
            const document = await fromUuid(itemUuid);
            if (!document) {
              throw new Error(`Item with UUID ${itemUuid} not found`);
            }
            
            // Cast to an Item with any to access system-specific properties
            const item = document as any;
            
            ModuleLogger.info(`${moduleId} | Creating chat message for item: ${(item as any).name}`);
            
            let messageId;
            let targetAcquired = false;
            let targetToken = null;
            
            // Process target if provided
            if (target) {
              try {
                const targetDocument = await fromUuid(target);
                
                if (targetDocument) {
                  if (targetDocument instanceof TokenDocument) {
                    // It's a token
                    targetToken = targetDocument;
                    targetAcquired = true;
                    ModuleLogger.info(`${moduleId} | Target token acquired: ${targetDocument.name}`);
                  } else if (targetDocument instanceof Actor) {
                    // It's an actor - try to find a token that represents it on the active scene
                    const activeScene = (game as Game).scenes?.active;
                    if (activeScene) {
                      const tokens = activeScene.tokens?.filter(t => t.actor?.id === targetDocument.id);
                      if (tokens && tokens.length > 0) {
                        // Use the first token found
                        targetToken = tokens[0];
                        targetAcquired = true;
                        ModuleLogger.info(`${moduleId} | Target token acquired from actor: ${tokens[0].name}`);
                      }
                    }
                  }
                  
                  // If we found a token, set it as the target
                  if (targetAcquired && targetToken) {
                    // For D&D 5e and similar systems, we need to target the token on the canvas
                    // This will ensure that systems like Midi-QOL can properly apply effects
                    if (canvas && canvas.ready) {
                      // Clear current targets first
                      if (canvas.tokens) {
                        (game as Game).user?.targets.forEach(t => t.setTarget(false, { user: (game as Game).user, releaseOthers: false, groupSelection: false }));
                        (game as Game).user?.targets.clear();
                        
                        // Get the actual token object from the canvas
                        if (targetToken.id) {  // Check that the ID is not null or undefined
                          const targetObject = canvas.tokens.get(targetToken.id);
                          if (targetObject) {
                            // Set as target
                            targetObject.setTarget(true, { user: (game as Game).user, releaseOthers: true, groupSelection: false });
                            ModuleLogger.info(`${moduleId} | Token targeted on canvas: ${targetObject.name}`);
                          }
                        }
                      }
                    }
                  }
                }
              } catch (err) {
                ModuleLogger.warn(`${moduleId} | Failed to process target: ${err}`);
              }
            }
            
            // Different systems have different methods for displaying items in chat
            if ((item as any).system?.actionType) {
              // This is a D&D 5e item with an action type - use specific handling for Midi-QOL
              ModuleLogger.info(`${moduleId} | Using D&D 5e item with action type: ${(item as any).system.actionType}`);
              
              // For D&D 5e with Midi-QOL, we need to use the item's use method
              if (((item as Record<string, any>).system as Record<string, any>)?.actionType) {
                // Create options for item use
                const useOptions: any = {
                  configureDialog: false,
                  createMessage: true,
                  skipDialog: true,
                  fastForward: true,
                  consume: false, // Don't consume limited uses by default
                  speaker: speakerData,
                  target: targetToken
                };
                
                // If target was acquired, add it
                if (targetAcquired && targetToken) {
                  useOptions.target = targetToken;
                }
                
                // Set up automatic dialog handling before using the item
                const originalRenderDialog = Dialog.prototype.render;
                
                // Override Dialog.prototype.render to add auto-clicking behavior
                Dialog.prototype.render = function(...args) {
                  const result = originalRenderDialog.apply(this, args);
                  
                  // After the dialog renders, click the default or first button
                  setTimeout(() => {
                    if (this.element && this.element.length) {
                      const defaultButton = this.element.find('.dialog-button.default');
                      if (defaultButton.length) {
                        ModuleLogger.info(`${moduleId} | Auto-clicking default button in rendered dialog`);
                        defaultButton.trigger('click');
                      } else {
                        const firstButton = this.element.find('.dialog-button').first();
                        if (firstButton.length) {
                          ModuleLogger.info(`${moduleId} | Auto-clicking first button in rendered dialog`);
                          firstButton.trigger('click');
                        }
                      }
                    }
                  }, 100);
                  
                  return result;
                };
                
                try {
                  // Use the item which should trigger Midi-QOL if installed
                  ModuleLogger.info(`${moduleId} | Using item with dialog auto-click enabled: ${(item as any).name}`);
                  const useResult = await (((item as Record<string, any>).use) as Function)(useOptions);
                  messageId = useResult?.id || useResult; // Handle different return types
                  
                  ModuleLogger.info(`${moduleId} | Item used with use() method, should trigger Midi-QOL: ${(item as any).name}`);
                } finally {
                  Dialog.prototype.render = originalRenderDialog;
                  
                  ModuleLogger.info(`${moduleId} | Restored original dialog methods after item use`);
                }
              } else if ((item as any).displayCard && typeof (item as any).displayCard === 'function') {
                // Fallback to displayCard if use() not available
                const cardResult = await (item as any).displayCard({
                  createMessage: true,
                  speaker: speakerData,
                  ...(targetAcquired ? { target: targetToken } : {})
                });
                messageId = cardResult?.id;
              }
            } else if (typeof (item as any).toChat === 'function') {
              // Some systems use toChat()
              const chatOptions = targetAcquired ? { target: targetToken } : {};
              const chatResult = await (item as any).toChat(chatOptions);
              messageId = chatResult?.id;
            } else if (typeof (item as any).displayCard === 'function') {
              // DnD5e uses displayCard()
              // Use type assertion to ensure TypeScript knows displayCard is a function
              const displayCard = (item as any).displayCard as (options: any) => Promise<any>;
              const cardResult = await displayCard({
                createMessage: true,
                speaker: speakerData,
                // If target acquired, add it to the options
                ...(targetAcquired ? { target: targetToken } : {})
              });
              messageId = cardResult?.id;
            } else {
              // Fallback: Create a simple chat message with item details
              const chatData = {
                user: (game as Game).user?.id,
                speaker: speakerData,
                content: `
                  <div class="item-card">
                    <div class="item-name">${(item as any).name}</div>
                    <div class="item-image"><img src="${(item as any).img}" width="50" height="50"/></div>
                    <div class="item-description">${(item as any).system?.description?.value || ""}</div>
                    ${targetAcquired ? `<div class="item-target">Target: ${targetToken?.name}</div>` : ""}
                  </div>
                `,
                type: CONST.CHAT_MESSAGE_TYPES.OTHER,
                flavor: `Item: ${(item as any).name}${targetAcquired ? ` (Target: ${targetToken?.name})` : ""}`
              };
              
              const message = await ChatMessage.create(chatData);
              messageId = message?.id;
            }
            
            // Format the result
            rollResult = {
              id: `item_display_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
              chatMessageCreated: true,
              itemDisplayed: {
                uuid: (item as any).uuid,
                name: (item as any).name,
                type: (item as any).type,
                img: (item as any).img
              },
              target: targetAcquired ? {
                uuid: targetToken?.uuid,
                name: targetToken?.name
              } : null,
              messageId: messageId
            };
            
            ModuleLogger.info(`${moduleId} | Item chat message created with ID: ${messageId}`);
          } catch (err) {
            ModuleLogger.error(`${moduleId} | Error displaying item in chat: ${err}`);
            module.socketManager.send({
              type: "roll-result",
              requestId: requestId,
              success: false,
              error: `Failed to display item in chat: ${(err as Error).message}`
            });
            return;
          }
        } else {
          // Roll from formula
          try {
            // Create the Roll instance
            const roll = new Roll(formula);
            
            // Evaluate the roll
            await roll.evaluate();
            
            // Create chat message if requested
            if (createChatMessage) {
              await roll.toMessage({
                speaker: speakerData,
                flavor: flavor || "",
                rollMode,
                whisper: whisper || []
              });
            }
            
            // Format the roll result
            rollResult = {
              id: `manual_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
              chatMessageCreated: !!createChatMessage,
              roll: {
              formula: formula,
              total: roll.total,
              isCritical: roll.terms.some(term => (term as DiceTerm).results?.some(result => result.result === (roll.terms[0] as DiceTerm).faces)),
              isFumble: roll.terms.some(term => (term as DiceTerm).results?.some(result => result.result === 1)),
              dice: roll.dice.map(d => ({
                faces: d.faces,
                results: d.results.map(r => ({
                result: r.result,
                active: r.active
                }))
              })),
              timestamp: Date.now()
              }
            };
          } catch (err) {
            ModuleLogger.error(`${moduleId} | Error rolling formula: ${err}`);
            module.socketManager.send({
              type: "roll-result",
              requestId: requestId,
              success: false,
              error: `Failed to roll formula: ${(err as Error).message}`
            });
            return;
          }
        }
        
        // Send the result back
        module.socketManager.send({
          type: "roll-result",
          requestId: requestId,
          success: true,
          data: rollResult
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error in roll handler: ${error}`);
        module.socketManager.send({
          type: "roll-result",
          requestId: data.requestId,
          success: false,
          error: (error as Error).message || "Unknown error occurred during roll"
        });
      }
    });

    // Handle actor sheet HTML request
    module.socketManager.onMessageType("get-sheet-html", async (data) => {
      ModuleLogger.info(`${moduleId} | Received sheet HTML request for UUID: ${data.uuid}`);
      
      try {
        // Get the actor from its UUID
        const actor = await fromUuid(data.uuid) as Actor;
        if (!actor) {
          ModuleLogger.error(`${moduleId} | Entity not found for UUID: ${data.uuid}`);
          module.socketManager.send({
            type: "actor-sheet-html-response",
            requestId: data.requestId,
            data: { error: "Entity not found", uuid: data.uuid }
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
            
            // Get the sheet's appId for later comparisons
            const sheetAppId = String(sheet.appId);
            
            // 1. Get CSS from style elements with data-appid matching the sheet
            const appStyles = document.querySelectorAll('style[data-appid]');
            appStyles.forEach(style => {
              const styleAppId = (style as HTMLElement).dataset.appid;
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
              .filter((href): href is string => 
                href !== null && 
                !href.includes('fonts.googleapis.com') && 
                !href.includes('//'));
            
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

    // Handle get macros request
    module.socketManager.onMessageType("get-macros", async (data) => {
      ModuleLogger.info(`${moduleId} | Received request for macros`);
      
      try {
        // Get all macros the current user has access to
        const macros = (game as Game).macros?.contents.map(macro => {
          return {
            uuid: macro.uuid,
            id: macro.id,
            name: macro.name,
            type: (macro as any).type || (macro as any).data?.type || "unknown",
            author: (macro as any).author?.name || "unknown",
            command: (macro as any).command || "",
            img: (macro as any).img,
            scope: (macro as any).scope,
            canExecute: (macro as any).canExecute
          };
        }) || [];

        module.socketManager.send({
          type: "macros-list",
          requestId: data.requestId,
          macros
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error getting macros list:`, error);
        module.socketManager.send({
          type: "macros-list",
          requestId: data.requestId,
          error: (error as Error).message,
          macros: []
        });
      }
    });

    // Handle execute macro request
    module.socketManager.onMessageType("execute-macro", async (data) => {
      ModuleLogger.info(`${moduleId} | Received request to execute macro: ${data.uuid}`);
      
      try {
        if (!data.uuid) {
          throw new Error("Macro UUID is required");
        }
        
        // Get the macro by UUID
        const macro = await fromUuid(data.uuid) as Macro;
        if (!macro) {
          throw new Error(`Macro not found with UUID: ${data.uuid}`);
        }
        
        // Check if it's actually a macro
        if (!(macro instanceof CONFIG.Macro.documentClass)) {
          throw new Error(`Entity with UUID ${data.uuid} is not a macro`);
        }
        
        // Check if the macro can be executed
        if (!macro.canExecute) {
          throw new Error(`Macro '${macro.name}' cannot be executed by the current user`);
        }
        
        // Execute the macro
        const result = await macro.execute(data.args || {});
        
        // Return success
        module.socketManager.send({
          type: "macro-execution-result",
          requestId: data.requestId,
          uuid: data.uuid,
          success: true,
          result: typeof result === 'object' ? result : { value: result }
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error executing macro:`, error);
        module.socketManager.send({
          type: "macro-execution-result",
          requestId: data.requestId,
          uuid: data.uuid || "",
          success: false,
          error: (error as Error).message
        });
      }
    });

    // Handle get encounters request
    module.socketManager.onMessageType("get-encounters", async (data) => {
      ModuleLogger.info(`${moduleId} | Received request for encounters`);
      
      try {
        // Get all combats (encounters) in the world
        const encounters = (game as Game).combats?.contents.map(combat => {
          return {
            id: combat.id,
            name: combat.name,
            round: combat.round,
            turn: combat.turn,
            current: combat.id === (game as Game).combat?.id,
            combatants: combat.combatants.contents.map(c => ({
              id: c.id,
              name: c.name,
              tokenUuid: c.token?.uuid,
              actorUuid: c.actor?.uuid,
              img: c.img,
              initiative: c.initiative,
              hidden: c.hidden,
              defeated: c.isDefeated
            }))
          };
        }) || [];

        module.socketManager.send({
          type: "encounters-list",
          requestId: data.requestId,
          encounters
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error getting encounters list:`, error);
        module.socketManager.send({
          type: "encounters-list",
          requestId: data.requestId,
          error: (error as Error).message,
          encounters: []
        });
      }
    });

    // Handle start encounter request
    module.socketManager.onMessageType("start-encounter", async (data) => {
      ModuleLogger.info(`${moduleId} | Received request to start encounter with options:`, data);
      
      try {
        // Create a new combat encounter
        const combat = await Combat.create({ name: data.name || "New Encounter" });
        
        if (combat) {
          await combat.startCombat();
          // Add the specified tokens if any were provided
          if (data.tokenUuids && data.tokenUuids.length > 0) {
            const tokensData = [];
            
            for (const uuid of data.tokenUuids) {
              try {
                const token = await fromUuid(uuid);
                if (token) {
                  tokensData.push({
                    tokenId: token.id ?? '',
                    sceneId: token.parent.id
                  });
                }
              } catch (err) {
                ModuleLogger.warn(`${moduleId} | Failed to add token ${uuid} to combat:`, err);
              }
            }
            
            if (tokensData.length > 0) {
              await combat.createEmbeddedDocuments("Combatant", tokensData);
            }
          }

          let addedTokenIds = new Set();

          // Add player combatants if specified
          if (data.startWithPlayers) {
            // Get the current viewed scene
            const currentScene = (game as Game).scenes?.viewed;
            
            if (currentScene) {
              // Get all tokens on the scene that have player actors
              const playerTokens = currentScene.tokens?.filter(token => {
              // Check if token has an actor and the actor is a player character
              return !!token.actor && token.actor.hasPlayerOwner;
              }) ?? [];
              
              // Create combatants from these tokens
              const tokenData = playerTokens.map(token => {
              addedTokenIds.add(token.id);
              return {
                tokenId: token.id,
                sceneId: currentScene.id
              };
              });
              
              if (tokenData.length > 0) {
              await combat.createEmbeddedDocuments("Combatant", tokenData);
              }
            }
          }

          // Add selected tokens if specified, but only if they weren't already added
          if (data.startWithSelected) {
            const selectedTokens = canvas?.tokens?.controlled
              .filter(token => !addedTokenIds.has(token.id))
              .map(token => {
              return {
                tokenId: token.id,
                sceneId: token.scene.id
              };
              }) ?? [];
            
            if (selectedTokens.length > 0) {
              await combat.createEmbeddedDocuments("Combatant", selectedTokens);
            }
          } 
          
          // Roll initiative for all npc combatants
          if (data.rollNPC) {
            await combat.rollNPC();
          }

          // Roll initiative for all combatants
          if (data.rollAll) {
            await combat.rollAll();
          }
          
          // Activate this combat
          await combat.activate();
          
          module.socketManager.send({
            type: "encounter-started",
            requestId: data.requestId,
            encounterId: combat.id,
            encounter: {
              id: combat.id,
              name: combat.name,
              round: combat.round,
              turn: combat.turn,
              combatants: combat.combatants.contents.map(c => ({
                id: c.id,
                name: c.name,
                tokenUuid: c.token?.uuid,
                actorUuid: c.actor?.uuid,
                img: c.img,
                initiative: c.initiative,
                hidden: c.hidden,
                defeated: c.isDefeated
              }))
            }
          });
        } else {
          throw new Error("Failed to create encounter");
        }
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error starting encounter:`, error);
        module.socketManager.send({
          type: "encounter-started",
          requestId: data.requestId,
          error: (error as Error).message
        });
      }
    });

    // Handle next turn request
    module.socketManager.onMessageType("encounter-next-turn", async (data) => {
      ModuleLogger.info(`${moduleId} | Received request for next turn in encounter: ${data.encounterId || 'active'}`);
      
      try {
        const combat = data.encounterId ? (game as Game).combats?.get(data.encounterId) : (game as Game).combat;
        
        if (!combat) {
          throw new Error(data.encounterId ? 
            `Encounter with ID ${data.encounterId} not found` : 
            "No active encounter");
        }
        
        await combat.nextTurn();
        
        module.socketManager.send({
          type: "encounter-navigation",
          requestId: data.requestId,
          encounterId: combat.id,
          action: "nextTurn",
          currentTurn: combat.turn,
          currentRound: combat.round,
          actorTurn: combat.combatant?.actor?.uuid,
          tokenTurn: combat.combatant?.token?.uuid,
          encounter: {
            id: combat.id,
            name: combat.name,
            round: combat.round,
            turn: combat.turn
          }
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error advancing to next turn:`, error);
        module.socketManager.send({
          type: "encounter-navigation",
          requestId: data.requestId,
          error: (error as Error).message
        });
      }
    });

    // Handle next round request
    module.socketManager.onMessageType("encounter-next-round", async (data) => {
      ModuleLogger.info(`${moduleId} | Received request for next round in encounter: ${data.encounterId || 'active'}`);
      
      try {
        const combat = data.encounterId ? (game as Game).combats?.get(data.encounterId) : (game as Game).combat;
        
        if (!combat) {
          throw new Error(data.encounterId ? 
            `Encounter with ID ${data.encounterId} not found` : 
            "No active encounter");
        }
        
        await combat.nextRound();
        
        module.socketManager.send({
          type: "encounter-navigation",
          requestId: data.requestId,
          encounterId: combat.id,
          action: "nextRound",
          currentTurn: combat.turn,
          currentRound: combat.round,
          actorTurn: combat.combatant?.actor?.uuid,
          tokenTurn: combat.combatant?.token?.uuid,
          encounter: {
            id: combat.id,
            name: combat.name,
            round: combat.round,
            turn: combat.turn
          }
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error advancing to next round:`, error);
        module.socketManager.send({
          type: "encounter-navigation",
          requestId: data.requestId,
          error: (error as Error).message
        });
      }
    });

    // Handle previous turn request
    module.socketManager.onMessageType("encounter-previous-turn", async (data) => {
      ModuleLogger.info(`${moduleId} | Received request for previous turn in encounter: ${data.encounterId || 'active'}`);
      
      try {
        const combat = data.encounterId ? (game as Game).combats?.get(data.encounterId) : (game as Game).combat;
        
        if (!combat) {
          throw new Error(data.encounterId ? 
            `Encounter with ID ${data.encounterId} not found` : 
            "No active encounter");
        }
        
        await combat.previousTurn();
        
        module.socketManager.send({
          type: "encounter-navigation",
          requestId: data.requestId,
          encounterId: combat.id,
          action: "previousTurn",
          currentTurn: combat.turn,
          currentRound: combat.round,
          actorTurn: combat.combatant?.actor?.uuid,
          tokenTurn: combat.combatant?.token?.uuid,
          encounter: {
            id: combat.id,
            name: combat.name,
            round: combat.round,
            turn: combat.turn
          }
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error going back to previous turn:`, error);
        module.socketManager.send({
          type: "encounter-navigation",
          requestId: data.requestId,
          error: (error as Error).message
        });
      }
    });

    // Handle previous round request
    module.socketManager.onMessageType("encounter-previous-round", async (data) => {
      ModuleLogger.info(`${moduleId} | Received request for previous round in encounter: ${data.encounterId || 'active'}`);
      
      try {
        const combat = data.encounterId ? (game as Game).combats?.get(data.encounterId) : (game as Game).combat;
        
        if (!combat) {
          throw new Error(data.encounterId ? 
            `Encounter with ID ${data.encounterId} not found` : 
            "No active encounter");
        }
        
        await combat.previousRound();
        
        module.socketManager.send({
          type: "encounter-navigation",
          requestId: data.requestId,
          encounterId: combat.id,
          action: "previousRound",
          currentTurn: combat.turn,
          currentRound: combat.round,
          actorTurn: combat.combatant?.actor?.uuid,
          tokenTurn: combat.combatant?.token?.uuid,
          encounter: {
            id: combat.id,
            name: combat.name,
            round: combat.round,
            turn: combat.turn
          }
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error going back to previous round:`, error);
        module.socketManager.send({
          type: "encounter-navigation",
          requestId: data.requestId,
          error: (error as Error).message
        });
      }
    });

    // Handle end encounter request
    module.socketManager.onMessageType("end-encounter", async (data) => {
      ModuleLogger.info(`${moduleId} | Received request to end encounter: ${data.encounterId}`);
      
      try {
        let encounterId = data.encounterId;
        if (!encounterId) {
          encounterId = (game as Game).combat?.id;
        }
        
        const combat = (game as Game).combats?.get(encounterId);
        
        if (!combat) {
          throw new Error(`No encounter not found`);
        }
        
        await combat.delete();
        
        module.socketManager.send({
          type: "encounter-ended",
          requestId: data.requestId,
          encounterId: encounterId,
          message: "Encounter successfully ended"
        });
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error ending encounter:`, error);
        module.socketManager.send({
          type: "encounter-ended",
          requestId: data.requestId,
          error: (error as Error).message
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
    
    // Special handling for resultType (constructor name)
    if (key === "resultType") {
      const itemConstructorName = result.item?.constructor?.name;
      if (!itemConstructorName || itemConstructorName.toLowerCase() !== value.toLowerCase()) {
        return false;
      }
      continue;
    }
    
    // Special handling for package (compendium) paths
    if (key === "package" && result.item) {
      const packageValue = result.item.package;
      if (!packageValue) return false;
      
      // Check if the package matches or if it's a part of the full path
      if (packageValue.toLowerCase() !== value.toLowerCase() && 
          !(`Compendium.${packageValue}`.toLowerCase() === value.toLowerCase())) {
        return false;
      }
      continue;
    }
    
    // Special handling for folder references
    if (key === "folder" && result.item) {
      const folderValue = result.item.folder;
      
      // No folder when one is required
      if (!folderValue && value) return false;
      
      // Folder exists, check various formats:
      if (folderValue) {
        const folderIdMatch = typeof folderValue === 'object' ? folderValue.id : folderValue;
        
        // Accept any of these formats:
        // - Just the ID: "zmAZJmay9AxvRNqh"
        // - Full Folder UUID: "Folder.zmAZJmay9AxvRNqh"
        // - Object format with ID
        if (value === folderIdMatch || 
            value === `Folder.${folderIdMatch}` ||
            `Folder.${value}` === folderIdMatch) {
          continue; // Match found, continue to next filter
        }
        
        // If we get here, folder doesn't match
        return false;
      }
      
      continue;
    }
    
    // Standard property handling
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
    
    // If the property is missing or doesn't match, filter it out
    if (propertyValue === undefined || 
        (typeof propertyValue === 'string' &&
         propertyValue.toLowerCase() !== value.toLowerCase())) {
      return false;
    }
  }
  
  return true;
}