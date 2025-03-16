import { WSCloseCodes } from "../types";
import { moduleId } from "../constants";
import { ModuleLogger } from "../utils/logger";

type MessageHandler = (data: any) => void;

export class WebSocketManager {
  private url: string;
  private token: string;
  private socket: WebSocket | null = null;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private reconnectTimer: number | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 20;
  private clientId: string;
  private pingInterval: number | null = null;
  private isConnecting: boolean = false;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
    this.clientId = `foundry-${(game as Game).user?.id || Math.random().toString(36).substring(2, 15)}`;
    ModuleLogger.info(`${moduleId} | Created WebSocketManager with clientId: ${this.clientId}`);
  }

  connect(): void {
    if (this.isConnecting) {
      ModuleLogger.info(`${moduleId} | Already attempting to connect`);
      return;
    }

    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
      ModuleLogger.info(`${moduleId} | WebSocket already connected or connecting`);
      return;
    }

    this.isConnecting = true;

    try {
      // Build the WebSocket URL with query parameters
      const wsUrl = new URL(this.url);
      wsUrl.searchParams.set('id', this.clientId);
      wsUrl.searchParams.set('token', this.token);
      
      ModuleLogger.info(`${moduleId} | Connecting to WebSocket at ${wsUrl.toString()}`);
      
      // Create WebSocket and set up event handlers
      this.socket = new WebSocket(wsUrl.toString());

      // Add timeout for connection attempt
      const connectionTimeout = window.setTimeout(() => {
        if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
          ModuleLogger.error(`${moduleId} | Connection timed out`);
          this.socket.close();
          this.socket = null;
          this.isConnecting = false;
          this.scheduleReconnect();
        }
      }, 5000); // 5 second timeout

      this.socket.addEventListener('open', (event) => {
        window.clearTimeout(connectionTimeout);
        this.onOpen(event);
      });
      
      this.socket.addEventListener('close', (event) => {
        window.clearTimeout(connectionTimeout);
        this.onClose(event);
      });
      
      this.socket.addEventListener('error', (event) => {
        window.clearTimeout(connectionTimeout);
        this.onError(event);
      });
      
      this.socket.addEventListener('message', this.onMessage.bind(this));
    } catch (error) {
      ModuleLogger.error(`${moduleId} | Error creating WebSocket:`, error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.socket) {
      ModuleLogger.info(`${moduleId} | Disconnecting WebSocket`);
      this.socket.close(WSCloseCodes.Normal, "Disconnecting");
      this.socket = null;
    }
    
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.pingInterval !== null) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    this.reconnectAttempts = 0;
    this.isConnecting = false;
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  send(data: any): boolean {
    ModuleLogger.info(`${moduleId} | Send called, readyState: ${this.socket?.readyState}`);
    
    // Ensure we're connected
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        ModuleLogger.info(`${moduleId} | Sending message:`, data);
        this.socket.send(JSON.stringify(data));
        return true;
      } catch (error) {
        ModuleLogger.error(`${moduleId} | Error sending message:`, error);
        return false;
      }
    } else {
      ModuleLogger.warn(`${moduleId} | WebSocket not ready, state: ${this.socket?.readyState}`);
      return false;
    }
  }

  onMessageType(type: string, handler: MessageHandler): void {
    this.messageHandlers.set(type, handler);
  }

  private onOpen(_event: Event): void {
    ModuleLogger.info(`${moduleId} | WebSocket connected`);
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    
    // Send a ping to test connection
    this.send({ type: "ping" });
    
    // Start ping interval
    this.pingInterval = window.setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: "ping" });
      }
    }, 30000);
  }

  private onClose(event: CloseEvent): void {
    ModuleLogger.info(`${moduleId} | WebSocket disconnected: ${event.code} - ${event.reason}`);
    this.socket = null;
    this.isConnecting = false;
    
    // Clear ping interval
    if (this.pingInterval !== null) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    // Don't reconnect if this was a normal closure
    if (event.code !== WSCloseCodes.Normal) {
      this.scheduleReconnect();
    }
  }

  private onError(event: Event): void {
    ModuleLogger.error(`${moduleId} | WebSocket error:`, event);
    this.isConnecting = false;
  }

  private async onMessage(event: MessageEvent): Promise<void> {
    try {
      const data = JSON.parse(event.data);
      ModuleLogger.info(`${moduleId} | Received message:`, data);
      
      if (data.type && this.messageHandlers.has(data.type)) {
        ModuleLogger.info(`${moduleId} | Handling message of type: ${data.type}`);
        this.messageHandlers.get(data.type)!(data);
      } else if (data.type) {
        ModuleLogger.warn(`${moduleId} | No handler for message type: ${data.type}`);
      }
    } catch (error) {
      ModuleLogger.error(`${moduleId} | Error processing message:`, error);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      ModuleLogger.error(`${moduleId} | Maximum reconnection attempts reached`);
      return;
    }
    
    const delay = Math.min(30000, Math.pow(2, this.reconnectAttempts) * 1000);
    ModuleLogger.info(`${moduleId} | Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}