import { Message } from "node-telegram-bot-api";
import { telegramConfig } from "../config/telegram.config";
import { mainLogger } from "./logs/logger";
import { TelegramService, MessageStorageService, ChatService, AuthService } from "../services";
import { BusinessConnection, BusinessMessage } from "../shared/types";
import { getTextPreview, isCommand, formatUserName } from "../shared/utils";

/**
 * Main Telegram application class
 */
export class TelegramApp {
  private readonly telegramService: TelegramService;
  private readonly messageStorageService: MessageStorageService;
  private readonly authService: AuthService;
  private readonly chatService: ChatService;
  private assistantEnabled: boolean;
  private businessOwners: Map<string, number> = new Map();

  constructor() {
    this.telegramService = new TelegramService();
    this.messageStorageService = new MessageStorageService();
    this.authService = new AuthService();
    this.chatService = new ChatService(this.authService);
    this.assistantEnabled = telegramConfig.assistantEnabledByDefault;

    this.setupEventHandlers();
    this.setupCommandHandlers();
    this.setupPeriodicTasks();
    this.setupGracefulShutdown();

    mainLogger.info("Telegram application initialized");
  }

  /**
   * Sets up event handlers for the bot
   */
  private setupEventHandlers(): void {
    // Business connection handler
    this.telegramService.onBusinessConnection((connection: BusinessConnection) => {
      mainLogger.info("Business account connection established", {
        user: connection.user.first_name,
        connectionId: connection.id,
        status: connection.status,
      });
      // Store business owner ID for this connection
      if (connection.status === "active") {
        this.businessOwners.set(connection.id, connection.user.id);
      } else {
        this.businessOwners.delete(connection.id);
      }
    });

    // Business message handler
    this.telegramService.onBusinessMessage(async (msg: BusinessMessage) => {
      await this.handleBusinessMessage(msg);
    });

    // Regular message handler
    this.telegramService.onMessage(async (msg: Message) => {
      await this.handleRegularMessage(msg);
    });
  }

  /**
   * Sets up command handlers
   */
  private setupCommandHandlers(): void {
    // Start command
    this.telegramService.onCommand(/\/start/, (msg: Message) => {
      this.handleStartCommand(msg);
    });

    // Status command
    this.telegramService.onCommand(/\/status/, (msg: Message) => {
      this.handleStatusCommand(msg);
    });

    // Sessions command
    this.telegramService.onCommand(/\/sessions/, (msg: Message) => {
      this.handleSessionsCommand(msg);
    });

    // Enable assistant command
    this.telegramService.onCommand(/\/on/, (msg: Message) => {
      this.handleEnableCommand(msg);
    });

    // Disable assistant command
    this.telegramService.onCommand(/\/off/, (msg: Message) => {
      this.handleDisableCommand(msg);
    });

    // Save command
    this.telegramService.onCommand(/\/save/, (msg: Message) => {
      this.handleSaveCommand(msg);
    });

    // Clear command
    this.telegramService.onCommand(/\/clear/, (msg: Message) => {
      this.handleClearCommand(msg);
    });

    // Migrate command
    this.telegramService.onCommand(/\/migrate/, (msg: Message) => {
      this.handleMigrateCommand(msg);
    });
  }

  /**
   * Sets up periodic tasks
   */
  private setupPeriodicTasks(): void {
    // Periodic session cleanup
    setInterval(
      () => {
        const cleanedCount = this.chatService.cleanupOldSessions();
        if (cleanedCount > 0) {
          mainLogger.info("Periodic session cleanup completed", { cleanedCount });
        }
      },
      telegramConfig.sessionCleanupIntervalHours * 60 * 60 * 1000,
    );
  }

  /**
   * Sets up graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    process.on("SIGINT", () => {
      this.shutdown("SIGINT");
    });

    process.on("SIGTERM", () => {
      this.shutdown("SIGTERM");
    });

    process.on("uncaughtException", error => {
      mainLogger.error("Uncaught Exception", {
        message: error.message,
        stack: error.stack,
      });
      this.shutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason, promise) => {
      mainLogger.error("Unhandled Rejection", {
        reason: reason,
        promise: promise,
      });
    });
  }

  /**
   * Handles business messages
   * @param msg - Business message
   */
  private async handleBusinessMessage(msg: BusinessMessage): Promise<void> {
    if (!this.assistantEnabled) return;

    const chatId = msg.chat.id;
    const messageText = msg.text || "";
    const businessConnectionId = msg.business_connection_id;
    const userName = formatUserName(msg.from?.first_name, msg.from?.last_name);

    console.log(msg);

    // Save incoming message
    await this.messageStorageService.saveIncomingMessage(msg, true, businessConnectionId);

    mainLogger.info("Business message received", {
      chatId,
      chatType: msg.chat.type,
      fromId: msg.from?.id,
      messageText: getTextPreview(messageText),
      userName,
      businessConnectionId,
    });

    // Skip commands
    if (isCommand(messageText)) {
      mainLogger.info("Business message is a command, skipping AI processing", {
        command: messageText,
      });
      return;
    }

    // Determine direction: if sender is business owner, it's outgoing
    // Heuristic: in private business chats, if from.id != chat.id, it's the account owner (support)
    const ownerId = this.businessOwners.get(businessConnectionId);
    let direction: "incoming" | "outgoing";

    if (msg.chat.type === "private") {
      direction = msg.from?.id === msg.chat.id ? "incoming" : "outgoing";
    } else {
      direction = msg.from?.id === ownerId ? "outgoing" : "incoming";
    }

    if (direction === "outgoing") {
      mainLogger.info("Business message is from support agent or bot (outgoing), skipping AI", {
        chatId,
        fromId: msg.from?.id,
        chatId_val: msg.chat.id,
        ownerId,
      });
    }

    await this.processMessage(chatId, messageText, userName, businessConnectionId, direction);
  }

  /**
   * Handles regular messages
   * @param msg - Regular message
   */
  private async handleRegularMessage(msg: Message): Promise<void> {
    if (!this.assistantEnabled || !msg.text) return;

    const chatId = msg.chat.id;
    const messageText = msg.text;
    const userName = formatUserName(msg.from?.first_name, msg.from?.last_name);

    // Save incoming message
    await this.messageStorageService.saveIncomingMessage(msg, false);

    mainLogger.info("Regular message received", {
      chatId,
      messageText: getTextPreview(messageText),
      userName,
    });

    await this.processMessage(chatId, messageText, userName);
  }

  /**
   * Processes a message through the AI gateway
   * @param chatId - Chat ID
   * @param messageText - Message text
   * @param userName - User name
   * @param businessConnectionId - Business connection ID (optional)
   * @param direction - Message direction (incoming/outgoing)
   */
  private async processMessage(
    chatId: number,
    messageText: string,
    userName: string,
    businessConnectionId?: string,
    direction: "incoming" | "outgoing" = "incoming",
  ): Promise<void> {
    try {
      // Get or create chat session
      const session = await this.chatService.getOrCreateUserSession(chatId, userName);
      if (!session) {
        mainLogger.error("Failed to get chat session", { chatId, userName });
        if (direction === "incoming") {
          await this.sendFallbackResponse(chatId, businessConnectionId);
        }
        return;
      }

      // Send message to chat service
      const response = await this.chatService.sendMessage(session.id, messageText, {
        source: "telegram",
        chatId: chatId.toString(),
        userName,
        businessConnectionId,
        direction,
      });

      // If it's an outgoing message, we just saved it and don't expect an AI response
      if (direction === "outgoing") {
        return;
      }

      let responseText: string;
      if (response && response.aiResponse) {
        responseText = response.aiResponse.message.text;
      } else {
        responseText = this.getFallbackResponse();
      }

      // Send response with typing simulation
      await this.telegramService.sendMessageWithTyping(chatId, responseText, businessConnectionId);

      mainLogger.info("Response sent successfully", {
        chatId,
        userName,
        responseLength: responseText.length,
        isBusiness: !!businessConnectionId,
      });
    } catch (error) {
      mainLogger.error("Error processing message", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        chatId,
        userName,
      });

      await this.sendFallbackResponse(chatId, businessConnectionId);
    }
  }

  /**
   * Sends a fallback response when AI is unavailable
   * @param chatId - Chat ID
   * @param businessConnectionId - Business connection ID (optional)
   */
  private async sendFallbackResponse(chatId: number, businessConnectionId?: string): Promise<void> {
    const fallbackResponse = this.getFallbackResponse();
    await this.telegramService.sendMessage(chatId, fallbackResponse, businessConnectionId);
  }

  /**
   * Gets a random fallback response
   * @returns Fallback response text
   */
  private getFallbackResponse(): string {
    const responses = [
      "Service temporarily unavailable. Please try again.",
      "Connection error. Retrying...",
      "Technical issues detected. Please retry your request.",
      "I'm having trouble connecting right now. Please try again in a moment.",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Handles start command
   * @param msg - Message object
   */
  private handleStartCommand(msg: Message): void {
    const helpMessage = this.getHelpMessage();
    this.telegramService.sendMessage(msg.chat.id, helpMessage);
  }

  /**
   * Handles status command
   * @param msg - Message object
   */
  private handleStatusCommand(msg: Message): void {
    const status = this.assistantEnabled ? "ACTIVE" : "INACTIVE";

    const statusMessage = `
🤖 **Telegram Assistant Status**

**State:** ${status}
**Backend URL:** ${telegramConfig.backendBaseUrl}
**Started:** ${new Date().toLocaleString("en-US")}

**Note:** All sessions are managed on the backend
Send any message to test functionality
    `;

    this.telegramService.sendMessage(msg.chat.id, statusMessage);
  }

  /**
   * Handles sessions command
   * @param msg - Message object
   */
  private async handleSessionsCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;

    try {
      const session = await this.chatService.getOrCreateUserSession(chatId, "User");

      if (!session) {
        this.telegramService.sendMessage(chatId, "No active session found. Send any message to create one.");
        return;
      }

      const sessionInfo = `
📊 **Session Information**

**Title:** ${session.title}
**User ID:** ${session.userId}
**Session ID:** ${session.id}
**Created:** ${new Date(session.createdAt).toLocaleString("en-US")}
**Updated:** ${new Date(session.updatedAt).toLocaleString("en-US")}

**Backend URL:** ${telegramConfig.backendBaseUrl}
      `;

      this.telegramService.sendMessage(chatId, sessionInfo);
    } catch (error) {
      mainLogger.error("Error getting session info", error);
      this.telegramService.sendMessage(chatId, "Error getting session information. Please try again.");
    }
  }

  /**
   * Handles enable command
   * @param msg - Message object
   */
  private handleEnableCommand(msg: Message): void {
    this.assistantEnabled = true;
    this.telegramService.sendMessage(msg.chat.id, "✅ AI assistant ENABLED. Ready to use Backend Chat API.");
  }

  /**
   * Handles disable command
   * @param msg - Message object
   */
  private handleDisableCommand(msg: Message): void {
    this.assistantEnabled = false;
    this.telegramService.sendMessage(msg.chat.id, "❌ AI assistant DISABLED");
  }

  /**
   * Handles save command
   * @param msg - Message object
   */
  private handleSaveCommand(msg: Message): void {
    // Sessions are now managed on the backend, no need to save locally
    this.telegramService.sendMessage(msg.chat.id, "💾 Sessions are automatically managed on the backend.");
  }

  /**
   * Handles clear command
   * @param msg - Message object
   */
  private handleClearCommand(msg: Message): void {
    // No local sessions to clear - everything is on backend
    this.telegramService.sendMessage(msg.chat.id, "🗑️ No local sessions to clear - all data is stored on the backend");
  }

  /**
   * Handles migrate command
   * @param msg - Message object
   */
  private async handleMigrateCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;

    try {
      const session = await this.chatService.getOrCreateUserSession(chatId, "User");

      if (session) {
        this.telegramService.sendMessage(chatId, `✅ Session is already using the Chat API! Session ID: ${session.id}`);
      } else {
        this.telegramService.sendMessage(chatId, "❌ Failed to get or create session. Please try again.");
      }
    } catch (error) {
      mainLogger.error("Migration error", {
        error: error instanceof Error ? error.message : String(error),
        chatId,
      });
      this.telegramService.sendMessage(chatId, "❌ Migration failed. Please try again later.");
    }
  }

  /**
   * Gets help message
   * @returns Help message text
   */
  private getHelpMessage(): string {
    return `
🤖 **Telegram Assistant (Backend Chat API)**

🔗 **Connections:**
- Backend Chat API
- Telegram Business API

📊 **Status:** ${this.assistantEnabled ? "🟢 Active" : "🔴 Inactive"}

⚙️ **Main Commands:**
/on - enable assistant
/off - disable assistant  
/status - show status
/sessions - session information

🛠 **Data Management:**
/clear - clear local cache (no-op)
/save - force save (no-op)
/migrate - check session status

🔧 **Environment Settings:**
- Backend URL: ${telegramConfig.backendBaseUrl}

💡 **Features:**
- All data stored on backend
- No local caching
- Simple and reliable
    `;
  }

  /**
   * Shuts down the application gracefully
   * @param signal - Shutdown signal
   */
  private async shutdown(signal: string): Promise<void> {
    mainLogger.info(`Telegram assistant shutting down (${signal})...`);
    mainLogger.info("Sessions are managed on the backend, no local saving needed.");
    this.telegramService.stopPolling();
    mainLogger.info("All data saved. Goodbye!");
    process.exit(0);
  }

  /**
   * Starts the application
   */
  async start(): Promise<void> {
    try {
      mainLogger.info("Starting Telegram assistant...");
      mainLogger.info("Configuration check:");
      mainLogger.info(`- Telegram Bot Token: ${telegramConfig.botToken.length > 10 ? "Configured" : "Missing"}`);
      mainLogger.info(`- Backend Base URL: ${telegramConfig.backendBaseUrl}`);

      // All sessions are managed on the backend
      mainLogger.info(`📱 Telegram assistant is ready! All sessions are managed on the backend`);
    } catch (error) {
      mainLogger.error("Failed to start Telegram assistant", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      process.exit(1);
    }
  }
}
