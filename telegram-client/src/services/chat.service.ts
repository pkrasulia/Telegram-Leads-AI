import { telegramConfig } from "../config/telegram.config";
import { BaseService } from "../shared/base/base-service";
import { AuthService } from "./auth.service";
import { ChatSession, ChatMessage, SendMessageResponse, SessionMetadata, MessageMetadata } from "../shared/types";
import { HttpMethod } from "../shared/types";
import { ServiceCredentials } from "../shared/types";

/**
 * Chat service for managing chat sessions and messages
 */
export class ChatService extends BaseService {
  private readonly authService: AuthService;
  private readonly credentials: ServiceCredentials;

  constructor(authService: AuthService) {
    super("ChatService");
    this.authService = authService;
    this.credentials = {
      email: telegramConfig.serviceAccountLogin,
      password: telegramConfig.serviceAccountPassword,
    };
    this.logInitialization();
  }

  /**
   * Creates a new chat session
   * @param userId - User ID
   * @param title - Session title
   * @param metadata - Additional metadata
   * @returns Promise with created session or null
   */
  async createSession(userId: string, title: string, metadata: SessionMetadata = { source: "telegram" }): Promise<ChatSession | null> {
    return this.safeExecute(
      async () => {
        this.validateRequired({ userId, title }, ["userId", "title"]);

        this.logInfo("Creating new chat session", { userId, title });

        const payload = {
          title,
          userId,
          userName: (metadata as any)?.userName,
          metadata: {
            source: "telegram",
            ...metadata,
          },
        };

        const response = await this.authService.makeAuthenticatedRequest<ChatSession>("POST" as HttpMethod, "/chat/sessions", { data: payload }, this.credentials);

        this.logInfo("Chat session created successfully", {
          sessionId: response.id,
          userId: response.userId,
        });

        return response;
      },
      "createSession",
      { userId, title },
    );
  }

  /**
   * Gets a chat session by ID
   * @param sessionId - Session ID
   * @returns Promise with session or null
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    return this.safeExecute(
      async () => {
        this.validateRequired({ sessionId }, ["sessionId"]);

        const response = await this.authService.makeAuthenticatedRequest<ChatSession>("GET" as HttpMethod, `/chat/sessions/${sessionId}`, {}, this.credentials);

        return response;
      },
      "getSession",
      { sessionId },
    );
  }

  /**
   * Gets all sessions for a user
   * @param userId - User ID
   * @returns Promise with user sessions
   */
  async getUserSessions(userId: string): Promise<ChatSession[]> {
    const result = await this.safeExecute(
      async () => {
        this.validateRequired({ userId }, ["userId"]);

        const response = await this.authService.makeAuthenticatedRequest<ChatSession[]>("GET" as HttpMethod, `/chat/sessions?userId=${userId}`, {}, this.credentials);

        return response;
      },
      "getUserSessions",
      { userId },
    );
    return result || [];
  }

  /**
   * Sends a message to a chat session
   * @param sessionId - Session ID
   * @param text - Message text
   * @param metadata - Additional metadata
   * @returns Promise with response or null
   */
  async sendMessage(sessionId: string, text: string, metadata: MessageMetadata = { source: "telegram" }): Promise<SendMessageResponse | null> {
    return this.safeExecute(
      async () => {
        this.validateRequired({ sessionId, text }, ["sessionId", "text"]);

        this.logInfo("Sending message to chat session", {
          sessionId,
          textPreview: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
        });

        const payload = {
          sessionId,
          text,
          type: "text",
          direction: metadata.direction || "incoming",
          isBot: metadata.isBot || false,
          metadata: {
            source: "telegram",
            ...metadata,
          },
        };

        const response = await this.authService.makeAuthenticatedRequest<SendMessageResponse>("POST" as HttpMethod, "/chat/messages", { data: payload }, this.credentials);

        this.logInfo("Message sent successfully", {
          sessionId,
          messageId: response.message.id,
          hasAiResponse: !!response.aiResponse,
        });

        return response;
      },
      "sendMessage",
      { sessionId, textPreview: text.substring(0, 50) },
    );
  }

  /**
   * Gets message history for a session
   * @param sessionId - Session ID
   * @param limit - Number of messages to retrieve
   * @param offset - Offset for pagination
   * @returns Promise with messages
   */
  async getSessionMessages(sessionId: string, limit: number = 50, offset: number = 0): Promise<ChatMessage[]> {
    const result = await this.safeExecute(
      async () => {
        this.validateRequired({ sessionId }, ["sessionId"]);

        const response = await this.authService.makeAuthenticatedRequest<ChatMessage[]>(
          "GET" as HttpMethod,
          `/chat/sessions/${sessionId}/messages?limit=${limit}&offset=${offset}`,
          {},
          this.credentials,
        );

        return response;
      },
      "getSessionMessages",
      { sessionId, limit, offset },
    );
    return result || [];
  }

  /**
   * Deletes a chat session
   * @param sessionId - Session ID
   * @returns Promise with success status
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await this.safeExecute(
      async () => {
        this.validateRequired({ sessionId }, ["sessionId"]);

        await this.authService.makeAuthenticatedRequest("DELETE" as HttpMethod, `/chat/sessions/${sessionId}`, {}, this.credentials);

        this.logInfo("Session deleted successfully", { sessionId });
        return true;
      },
      "deleteSession",
      { sessionId },
    );
    return result || false;
  }

  /**
   * Checks if the chat service is healthy
   * @returns Promise with health status
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Try to get a session to check if the service is responsive
      // This is a lightweight check that doesn't require authentication
      return true;
    } catch (error) {
      this.logError("Health check failed", error);
      return false;
    }
  }

  // ===== SIMPLIFIED SESSION MANAGEMENT =====

  /**
   * Gets or creates a chat session for a user
   * @param chatId - Chat ID
   * @param userName - User name
   * @returns Chat session or null
   */
  async getOrCreateUserSession(chatId: number, userName: string): Promise<ChatSession | null> {
    try {
      this.validateRequired({ chatId, userName }, ["chatId", "userName"]);

      const userId = `tg_user_${chatId}`;

      // Try to find an existing backend chat session for this user
      const existingSessions = await this.getUserSessions(userId);
      if (existingSessions && existingSessions.length > 0) {
        this.logInfo("Found existing chat session", {
          chatId,
          userId,
          sessionId: existingSessions[0].id,
        });
        return existingSessions[0];
      }

      // Create new session if none exists
      const metadata: SessionMetadata = {
        source: "telegram",
        chatId: chatId.toString(),
        userName,
      };

      const createdSession = await this.createSession(userId, `Telegram Chat with ${userName}`, metadata);
      if (createdSession) {
        this.logInfo("Created new chat session", {
          chatId,
          userId,
          sessionId: createdSession.id,
        });
        return createdSession;
      }

      this.logError("Failed to create chat session", new Error("Backend session creation failed"), {
        chatId,
        userId,
      });
      return null;
    } catch (error) {
      this.logError("Failed to get or create user session", error, { chatId, userName });
      return null;
    }
  }

  /**
   * Gets session statistics (simplified - no local cache)
   * @returns Session statistics
   */
  getSessionStatistics(): Record<string, any> {
    return {
      totalSessions: 0, // No local cache
      activeSessions: 0, // No local cache
      totalMessages: 0, // No local cache
      averageMessagesPerSession: 0, // No local cache
    };
  }

  /**
   * Cleans up old sessions (no-op since we don't have local cache)
   * @returns Number of cleaned sessions
   */
  cleanupOldSessions(): number {
    this.logInfo("No local sessions to clean up - using backend storage");
    return 0;
  }

  /**
   * Clears all sessions (no-op since we don't have local cache)
   * @returns Number of cleared sessions
   */
  clearAllSessions(): number {
    this.logInfo("No local sessions to clear - using backend storage");
    return 0;
  }
}
