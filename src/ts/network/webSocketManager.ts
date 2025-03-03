import { WSCloseCodes, WebSocketMessage } from "../types";
import { moduleId } from "../constants";

type MessageHandler = (data: any) => void;

export class WebSocketManager {
  private url: string;
  private token: string;
  private socket: WebSocket | null = null;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private reconnectTimer: number | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private clientId: string;
  private isConnecting: boolean = false;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
    this.clientId = `foundry-${game.user?.id || Math.random().toString(36).substring(2, 15)}`;
    console.log(`${moduleId} | Created WebSocketManager with clientId: ${this.clientId}`);
  }

  connect(): void {
    if (this.isConnecting) {
      console.log(`${moduleId} | Already attempting to connect`);
      return;
    }

    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
      console.log(`${moduleId} | WebSocket already connected or connecting`);
      return;
    }

    this.isConnecting = true;

    try {
      // Build the WebSocket URL with query parameters
      const wsUrl = new URL(this.url);
      wsUrl.searchParams.set('id', this.clientId);
      wsUrl.searchParams.set('token', this.token);
      
      console.log(`${moduleId} | Connecting to WebSocket at ${wsUrl.toString()}`);
      this.socket = new WebSocket(wsUrl.toString());

      this.socket.addEventListener('open', this.onOpen.bind(this));
      this.socket.addEventListener('close', this.onClose.bind(this));
      this.socket.addEventListener('error', this.onError.bind(this));
      this.socket.addEventListener('message', this.onMessage.bind(this));
    } catch (error) {
      console.error(`${moduleId} | Error creating WebSocket:`, error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.socket) {
      console.log(`${moduleId} | Disconnecting WebSocket`);
      this.socket.close(WSCloseCodes.Normal, "Disconnecting");
      this.socket = null;
    }
    
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.reconnectAttempts = 0;
    this.isConnecting = false;
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  send(data: any): boolean {
    if (!this.isConnected()) {
      console.warn(`${moduleId} | Cannot send message, WebSocket not connected`);
      return false;
    }

    try {
      console.log(`${moduleId} | Send called, readyState: ${this.socket?.readyState}`);
      
      // Ensure we're connected
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        console.log(`${moduleId} | Sending message:`, data);
        this.socket.send(JSON.stringify(data));
        return true;
      } else {
        console.warn(`${moduleId} | WebSocket not ready, state: ${this.socket?.readyState}`);
        return false;
      }
    } catch (error) {
      console.error(`${moduleId} | Error sending message:`, error);
      return false;
    }
  }

  onMessageType(type: string, handler: MessageHandler): void {
    this.messageHandlers.set(type, handler);
  }

  private onOpen(event: Event): void {
    console.log(`${moduleId} | WebSocket connected`);
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    
    // Send a ping to test connection
    this.send({ type: "ping" });
    
    // Start ping interval
    window.setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: "ping" });
      }
    }, 30000);
  }

  private onClose(event: CloseEvent): void {
    console.log(`${moduleId} | WebSocket disconnected: ${event.code} - ${event.reason}`);
    this.socket = null;
    this.isConnecting = false;
    
    // Don't reconnect if this was a normal closure
    if (event.code !== WSCloseCodes.Normal) {
      this.scheduleReconnect();
    }
  }

  private onError(event: Event): void {
    console.error(`${moduleId} | WebSocket error:`, event);
    this.isConnecting = false;
  }

  private onMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type && this.messageHandlers.has(data.type)) {
        this.messageHandlers.get(data.type)!(data);
      }
    } catch (error) {
      console.error(`${moduleId} | Error processing message:`, error);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error(`${moduleId} | Maximum reconnection attempts reached`);
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);
    console.log(`${moduleId} | Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}