import { ModuleData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/packages.mjs";
import { CommunicationPanel } from "./apps/communicationPanel";
import { WebSocketManager } from "./network/webSocketManager";

export enum WSCloseCodes {
  Normal = 1000,
  NoClientId = 4001,
  NoAuth = 4002,
  NoConnectedGuild = 4003,
  InternalError = 4000,
  DuplicateConnection = 4004,
  ServerShutdown = 4005,
}

export interface FoundryGetActorsExternal extends Game.ModuleData<ModuleData> {
  communicationPanel: CommunicationPanel;
  socketManager?: WebSocketManager;
}
