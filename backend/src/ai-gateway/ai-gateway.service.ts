// Gateway ADK service

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { CreateAiGatewayDto } from './dto/create-ai-gateway.dto';

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly adkClient: AxiosInstance;
  private readonly adkBaseUrl: string;
  private readonly appName: string;
  private connectionChecked = false;

  constructor(private configService: ConfigService) {
    this.adkBaseUrl =
      this.configService.get<string>('ADK_BASE_URL', { infer: true }) ||
      'http://agent:8000';
    this.appName =
      this.configService.get<string>('ADK_APP_NAME', { infer: true }) ||
      'telegram-assistant';

    this.adkClient = axios.create({
      baseURL: this.adkBaseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Логируем конфигурацию ADK
    this.logger.log('ADK Gateway initialized', {
      baseURL: this.adkBaseUrl,
      appName: this.appName,
    });
  }

  async create(createAiGatewayDto: CreateAiGatewayDto) {
    this.logger.log('Processing AI Gateway request', {
      text: createAiGatewayDto.text,
      userId: createAiGatewayDto.userId,
      sessionId: createAiGatewayDto.sessionId,
    });

    // Проверяем подключение к ADK при первом запросе
    if (!this.connectionChecked) {
      const isConnected = await this.checkAdkConnection();
      this.connectionChecked = true;

      if (!isConnected) {
        this.logger.warn('ADK is not available, but continuing with request');
      }
    }

    try {
      // Отправляем сообщение в ADK с переданными параметрами
      const {
        response,
        sessionId: newSessionId,
        wasNewSessionCreated,
      } = await this.sendMessageToAdk(
        createAiGatewayDto.text,
        createAiGatewayDto.userId,
        createAiGatewayDto.userName,
        createAiGatewayDto.sessionId,
      );

      this.logger.log('AI Gateway request processed successfully');
      return {
        success: true,
        response: response,
        sessionId: newSessionId, // Возвращаем sessionId (может быть новый, если была создана новая сессия)
        wasNewSessionCreated: wasNewSessionCreated, // Возвращаем флаг, что была создана новая сессия
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Error processing AI Gateway request', {
        message: error?.message,
        stack: error?.stack,
        status: error?.response?.status,
        responseData: error?.response?.data,
        config: error?.config
          ? {
            url: error.config.url,
            method: error.config.method,
            baseURL: error.config.baseURL,
          }
          : undefined,
      });

      // Формируем детальное сообщение об ошибке
      let errorMessage = error?.message || 'Unknown error';
      if (error?.response?.data) {
        errorMessage += ` - Response: ${JSON.stringify(error.response.data)}`;
      }
      if (error?.response?.status) {
        errorMessage += ` - Status: ${error.response.status}`;
      }

      return {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Отправляет сообщение в ADK
   * @param message - текст сообщения
   * @param userId - ID пользователя (опционально)
   * @param userName - имя пользователя (опционально)
   * @param sessionId - ID сессии (опционально)
   * @returns объект с ответом, sessionId и флагом wasNewSessionCreated
   */
  /**
   * Отправляет сообщение в ADK
   */
  private async sendMessageToAdk(
    message: string,
    userId?: string,
    userName?: string,
    sessionId?: string,
  ): Promise<{
    response: string;
    sessionId: string;
    wasNewSessionCreated: boolean;
  }> {
    try {
      this.logger.debug('Sending message to ADK', {
        message: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
        userId,
        sessionId,
        userName,
      });

      // Обрабатываем userId - если уже в формате tg_user_, используем как есть
      let targetUserId: string;
      if (userId) {
        if (userId.startsWith('tg_user_')) {
          targetUserId = userId; // Уже в правильном формате
        } else {
          targetUserId = `tg_user_${userId}`; // Добавляем префикс
        }
      } else {
        targetUserId = `temp_user_${Date.now()}`;
      }

      // Если нет sessionId или это не UUID, создаем новую сессию
      let targetSessionId: string | undefined = sessionId;
      let wasNewSessionCreated = false;

      if (!targetSessionId || (sessionId && !this.isValidUUID(sessionId))) {
        // Создаем новую ADK-сессию (нет или неверный формат sessionId)
        const newSessionId = await this.createAdkSession(targetUserId);
        if (!newSessionId) {
          throw new Error('Failed to create ADK session');
        }
        targetSessionId = newSessionId;
        wasNewSessionCreated = true;

        this.logger.log('New session created', {
          sessionId: targetSessionId,
          userId: targetUserId,
        });
      }

      // 🎯 ИСПРАВЛЕННЫЙ payload - ТЕПЕРЬ camelCase и stateDelta согласно схеме google-adk
      const payload = {
        appName: this.appName,
        userId: targetUserId,
        sessionId: targetSessionId,
        newMessage: {
          role: 'user',
          parts: [{ text: message }],
        },
        streaming: false,
        stateDelta: {
          // 👇 ДОБАВЛЯЕМ ID ЯВНО СЮДА
          adk_session_id: targetSessionId,
          adk_user_id: targetUserId,

          // Ваши остальные поля
          telegram_chat_id: userId || 'test_chat_123',
          telegram_username: userName || 'test_user',
          telegram_first_name: 'Test',
          telegram_last_name: 'User',
          timestamp: new Date().toISOString(),
        },
      };

      console.log('>>>> PAYLOAD');
      console.log(payload);

      this.logger.debug('ADK payload prepared', {
        appName: payload.appName,
        userId: payload.userId,
        sessionId: payload.sessionId,
        messagePreview:
          message.substring(0, 100) + (message.length > 100 ? '...' : ''),
        stateDelta: payload.stateDelta,
      });

      let response;
      try {
        response = await this.adkClient.post('/run', payload);
        this.logger.debug('ADK request sent successfully');
      } catch (error: any) {
        // Если сессия не найдена, создаем новую
        if (
          error?.response?.status === 404 &&
          error?.response?.data?.detail?.includes('Session not found')
        ) {
          this.logger.warn('Session not found, creating new one', {
            userId: targetUserId,
            oldSessionId: targetSessionId,
          });

          // Создаем новую сессию
          const newSessionId = await this.createAdkSession(targetUserId);
          if (!newSessionId) {
            throw new Error('Failed to create ADK session after 404');
          }

          targetSessionId = newSessionId;
          wasNewSessionCreated = true;

          this.logger.log('New session created after 404', {
            sessionId: targetSessionId,
            oldSessionId: sessionId,
          });

          // Обновляем payload с новым sessionId
          payload.sessionId = newSessionId;

          // Повторяем запрос
          response = await this.adkClient.post('/run', payload);
        } else {
          throw error;
        }
      }

      const responseData = response.data;
      this.logger.debug('ADK response received', {
        responseType: typeof responseData,
        isArray: Array.isArray(responseData),
        dataLength: Array.isArray(responseData) ? responseData.length : 0,
      });

      let aiResponse = 'Sorry, no response received from system';

      if (Array.isArray(responseData)) {
        this.logger.debug('Processing array response', {
          arrayLength: responseData.length,
        });

        // Ищем последнее сообщение от модели с текстом
        for (let i = responseData.length - 1; i >= 0; i--) {
          const item = responseData[i];

          // Проверяем content.parts
          if (item?.content?.parts && Array.isArray(item.content.parts)) {
            const textPart = item.content.parts.find(
              (part: any) => part.text && typeof part.text === 'string',
            );

            if (textPart?.text) {
              aiResponse = textPart.text;
              this.logger.debug('Found text in content.parts', {
                text: textPart.text.substring(0, 100),
                itemIndex: i,
              });
              break;
            }
          }

          // Fallback на item.text
          if (item?.text && typeof item.text === 'string') {
            aiResponse = item.text;
            this.logger.debug('Found text in item', {
              text: item.text.substring(0, 100),
              itemIndex: i,
            });
            break;
          }
        }
      } else if (typeof responseData === 'string') {
        aiResponse = responseData;
        this.logger.debug('Processing string response', {
          text: responseData.substring(0, 100),
        });
      } else if (responseData?.message) {
        aiResponse = responseData.message;
        this.logger.debug('Processing message response', {
          message: responseData.message.substring(0, 100),
        });
      } else if (responseData?.content) {
        aiResponse = responseData.content;
        this.logger.debug('Processing content response', {
          content: responseData.content.substring(0, 100),
        });
      } else {
        this.logger.warn('Unknown response format', {
          responseData: JSON.stringify(responseData).substring(0, 200),
        });
      }

      // Гарантируем, что targetSessionId определен
      if (!targetSessionId) {
        throw new Error('Session ID is not set after processing ADK request');
      }

      this.logger.log('ADK response processed', {
        responsePreview:
          aiResponse.substring(0, 50) + (aiResponse.length > 50 ? '...' : ''),
        sessionId: targetSessionId,
        wasNewSessionCreated: wasNewSessionCreated,
        originalSessionId: sessionId,
      });

      return {
        response: aiResponse,
        sessionId: targetSessionId,
        wasNewSessionCreated: wasNewSessionCreated,
      };
    } catch (error: any) {
      this.logger.error('Error sending message to ADK', {
        message: error?.message,
        status: error?.response?.status,
        responseData: error?.response?.data,
        config: error?.config
          ? {
            url: error.config.url,
            method: error.config.method,
            baseURL: error.config.baseURL,
          }
          : undefined,
        stack: error?.stack,
      });

      // Создаем более информативную ошибку
      const enhancedError = new Error(`ADK request failed: ${error?.message}`);
      (enhancedError as any).originalError = error;
      (enhancedError as any).status = error?.response?.status;
      (enhancedError as any).responseData = error?.response?.data;

      throw enhancedError;
    }
  }

  /**
   * Создает новую сессию в ADK
   * @param userId - ID пользователя (будет отформатирован с префиксом tg_user_ если нужно)
   */
  async createAdkSession(userId: string): Promise<string | null> {
    try {
      // Форматируем userId так же, как в sendMessageToAdk
      let targetUserId: string;
      if (userId.startsWith('tg_user_')) {
        targetUserId = userId; // Уже в правильном формате
      } else {
        targetUserId = `tg_user_${userId}`; // Добавляем префикс
      }

      this.logger.log('Creating new ADK session', {
        originalUserId: userId,
        formattedUserId: targetUserId,
      });

      const response = await this.adkClient.post(
        `/apps/${this.appName}/users/${targetUserId}/sessions`,
      );
      const sessionId = response.data.session_id || response.data.id;

      this.logger.log('ADK session created', {
        userId: targetUserId,
        sessionId,
      });
      return sessionId;
    } catch (error: any) {
      this.logger.error('Error creating ADK session', {
        userId,
        message: error?.message,
        responseData: error?.response?.data,
      });
      return null;
    }
  }

  /**
   * Проверяет, является ли строка валидным UUID
   */
  private isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Проверяет подключение к ADK
   */
  private async checkAdkConnection(): Promise<boolean> {
    try {
      this.logger.log('Checking ADK connection', {
        baseURL: this.adkBaseUrl,
        appName: this.appName,
      });

      const response = await this.adkClient.get('/list-apps');
      this.logger.log('ADK connection successful', {
        availableApps: response.data,
      });
      return true;
    } catch (error: any) {
      this.logger.warn('ADK connection failed', {
        message: error?.message,
        status: error?.response?.status,
        responseData: error?.response?.data,
        baseURL: this.adkBaseUrl,
      });
      return false;
    }
  }
}
