import { WebSocketManager } from "./network/webSocketManager";

// WebSocket close codes
export enum WSCloseCodes {
  Normal = 1000,
  NoClientId = 4001,
  NoAuth = 4002,
  NoConnectedGuild = 4003,
  InternalError = 4000,
  DuplicateConnection = 4004,
  ServerShutdown = 4005,
}

// Module-specific interfaces
export interface FoundryGetActorsExternal extends Game.ModuleData<any> {
  socketManager: WebSocketManager;
  api: FoundryGetActorsExternalAPI;
}

export interface FoundryGetActorsExternalAPI {
  getWebSocketManager: () => WebSocketManager;
  search: (query: string, filter?: string) => Promise<any[]>;  // Add this line
  getByUuid: (uuid: string) => Promise<any>;  // Add this line
}

export interface ActorIndexEntry {
  id: string;
  name: string;
  type: string;
  img: string;
  system?: string;
  filename: string;
}

export interface WebSocketMessage {
  type: string;
  data: any;
  sender?: string;
  timestamp?: number;
}

export interface ChatMessage {
  content: string;
  sender: string;
  timestamp: number;
}

export interface BackupFolder {
  path: string;
  name: string;
}

export interface ActorWebSocketResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface ActorExportOptions {
  folderUuid: string;
  exportPath: string;
  backupLimit: number;
}

// Function type signatures
export declare namespace ActorExport {
  export type GetActorsRecursive = (folder: string) => Promise<any>;
  export type CreateDirectoryRecursive = (dirPath: string) => Promise<void>;
  export type SaveToFile = (dirPath: string, filename: string, data: any) => Promise<void>;
  export type CleanupOldBackups = (basePath: string) => Promise<void>;
  export type UpdateLatestPointer = (basePath: string, timestamp: string) => Promise<void>;
}

// Server route types
export declare namespace ServerRoutes {
  export interface BackupResponse {
    backups: string[];
  }
  
  export interface APIDocsResponse {
    message: string;
    endpoints: {
      path: string;
      description: string;
    }[];
  }
}

// Make sure TypeScript sees this file as a module
export {};
