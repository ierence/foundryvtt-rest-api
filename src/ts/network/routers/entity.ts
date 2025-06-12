import { Router } from "./baseRouter";
import { ModuleLogger } from "../../utils/logger";
import { deepSerializeEntity } from "../../utils/serialization";

export const router = new Router("entityRouter");

router.addRoute({
  actionType: "get-entity",
  handler: async (data, context) => {
    const socketManager = context?.socketManager;
    ModuleLogger.info(`Received entity request:`, data);

    try {
      let entity;
      let entityData = [];
      let entityUUID = data.uuid;
      if (data.selected) {
        const controlledTokens = canvas?.tokens?.controlled;
        if (controlledTokens) {
          for (let token of controlledTokens) {
            if (data.actor) {
              entity = token.actor;
            } else {
              entity = token.document;
            }
            if (entity) {
              entityUUID = entity.uuid;
              // Use custom deep serialization
              entityData.push(deepSerializeEntity(entity));
            }
          }
        }
      } else {
        entity = await fromUuid(data.uuid);
        // Use custom deep serialization
        entityData = entity ? deepSerializeEntity(entity) : null;
      }

      if (!entityData) {
        ModuleLogger.error(`Entity not found: ${data.uuid}`);
        socketManager?.send({
          type: "entity-data",
          requestId: data.requestId,
          uuid: data.uuid,
          error: "Entity not found",
          data: null,
        });
        return;
      }

      ModuleLogger.info(`Sending entity data for: ${data.uuid}`, entityData);

      socketManager?.send({
        type: "entity-data",
        requestId: data.requestId,
        uuid: entityUUID,
        data: entityData,
      });
    } catch (error) {
      ModuleLogger.error(`Error getting entity:`, error);
      socketManager?.send({
        type: "entity-data",
        requestId: data.requestId,
        uuid: data.uuid,
        error: (error as Error).message,
        data: null,
      });
    }
  },
});

// Similarly add other entity-related routes: create-entity, update-entity, delete-entity, kill-entity, give-item
// Due to length, I will add them in subsequent steps or combine here if allowed.
