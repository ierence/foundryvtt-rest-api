import { moduleId } from "../constants";
import { FoundryGetActorsExternal } from "../types";

export class CommunicationPanel extends Application {
  private messages: { content: string, timestamp: number, sender?: string }[] = [];

  override get title(): string {
    return (game as Game).i18n.localize("foundryvtt-get-actors-external.communication-panel");
  }

  static override get defaultOptions(): ApplicationOptions {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "foundryvtt-get-actors-external-communication",
      template: `modules/${moduleId}/templates/communication.hbs`,
      width: 500,
      height: 400,
      resizable: true
    }) as ApplicationOptions;
  }

  override getData() {
    return {
      messages: this.messages
    };
  }

  override activateListeners(html: JQuery<HTMLElement>): void {
    super.activateListeners(html);
    
    // Send button
    html.find("button[data-action='send-message']").on("click", this._onSendMessage.bind(this));
    
    // Enter key in message input
    html.find("#message-input").on("keydown", (event) => {
      if (event.key === "Enter") {
        this._onSendMessage(event);
      }
    });
  }

  async _onSendMessage(event: JQuery.TriggeredEvent): Promise<void> {
    event.preventDefault();
    const module = (game as Game).modules.get(moduleId) as FoundryGetActorsExternal;
    const messageInput = $(this.element).find("#message-input") as JQuery<HTMLInputElement>;
    const messageContent = messageInput.val() as string;

    const placeholderText = (game as Game).i18n.localize("foundryvtt-get-actors-external.message-placeholder");
    const finalMessageContent = messageContent.trim() || placeholderText;
    if (!finalMessageContent) return;

    if (module.socketManager) {
      const message = {
        type: "message",
        content: finalMessageContent,
        sender: (game as Game).user?.name || "Unknown",
        timestamp: Date.now()
      };
      
      console.log(`${moduleId} | Sending message:`, message);
      
      // Add to local messages
      this.addMessage({
        content: finalMessageContent,
        sender: (game as Game).user?.name || "Unknown",
        timestamp: Date.now()
      });
      
      module.socketManager.send(message);
      messageInput.val("");
    } else {
      console.error(`${moduleId} | Socket manager not initialized!`);
      ui.notifications?.error("WebSocket not connected");
    }
  }

  public addMessage(message: { content: string, timestamp: number, sender?: string }): void {
    this.messages.push(message);
    if (this.messages.length > 50) {
      this.messages.shift(); // Keep only the last 50 messages
    }
    this.render();
  }
}
