import { moduleId } from "../constants";
import { WSCloseCodes } from "../types";

export class WebSocketManager {
  private socket: WebSocket | null = null;
  private url: string;
  private clientId: string;
  private token: string;
  private reconnectAttempts = 0;
  private reconnectTimeout: number | null = null;
  private messageCallbacks: Map<string, (data: any) => void> = new Map();

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
    // Use the world ID and user ID to create a unique client ID
    this.clientId = `foundry-${(game as Game).world.id}-${(game as Game).user?.id || 'unknown'}`;
  }

  public connect(): void {
    if (this.socket) this.disconnect();

    const wsUrl = `${this.url}/relay?id=${this.clientId}&token=${this.token}`;
    console.log(`${moduleId} | Attempting to connect to: ${wsUrl}`);
    
    try {
      this.socket = new WebSocket(wsUrl);
      
      this.socket.onopen = this.handleOpen.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
      this.socket.onmessage = this.handleMessage.bind(this);
      this.socket.onerror = this.handleError.bind(this);
      
      console.log(`${moduleId} | Connecting to WebSocket relay`);
    } catch (error) {
      console.error(`${moduleId} | WebSocket connection error:`, error);
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    if (this.reconnectTimeout) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  public send(message: any): void {
    console.log(`${moduleId} | Send called, readyState: ${this.socket?.readyState}`);
    
    if (!this.socket) {
      console.warn(`${moduleId} | Cannot send message, socket is null`);
      return;
    }
    
    if (this.socket.readyState !== WebSocket.OPEN) {
      console.warn(`${moduleId} | Cannot send message, socket not in OPEN state (${this.socket.readyState})`);
      return;
    }
    
    try {
      const jsonMessage = JSON.stringify(message);
      console.log(`${moduleId} | Sending message: ${jsonMessage}`);
      this.socket.send(jsonMessage);
    } catch (error) {
      console.error(`${moduleId} | Error sending message:`, error);
    }
  }

  public onMessageType(type: string, callback: (data: any) => void): void {
    this.messageCallbacks.set(type, callback);
  }

  private handleOpen(): void {
    console.log(`${moduleId} | WebSocket connection established`);
    this.reconnectAttempts = 0;
    
    // Send an initial ping
    this.send({ type: "ping" });
    
    // Setup regular ping to keep the connection alive
    setInterval(() => {
      this.send({ type: "ping" });
    }, 30000);
  }

  private handleClose(event: CloseEvent): void {
    console.log(`${moduleId} | WebSocket connection closed: ${event.code}`);
    
    // Don't reconnect on normal closure or if the server explicitly rejected us
    if (event.code === WSCloseCodes.Normal || 
        event.code === WSCloseCodes.NoClientId || 
        event.code === WSCloseCodes.NoAuth) {
      return;
    }
    
    this.scheduleReconnect();
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      
      if (message.type && this.messageCallbacks.has(message.type)) {
        this.messageCallbacks.get(message.type)?.(message);
      }
    } catch (error) {
      console.error(`${moduleId} | Error handling message:`, error);
    }
  }

  private handleError(event: Event): void {
    console.error(`${moduleId} | WebSocket error:`, event);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;
    
    // Exponential backoff with a max delay
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    
    console.log(`${moduleId} | Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }
}