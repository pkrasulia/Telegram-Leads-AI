import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiSessionEntity } from '../ai-session/entities/ai-session.entity';
import {
  MessageEntity,
  MessageType,
  MessageDirection,
} from '../message/entities/message.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { AiSessionService } from '../ai-session/ai-session.service';
import { MessageService } from '../message/message.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(AiSessionEntity)
    private readonly sessionRepository: Repository<AiSessionEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    private readonly aiSessionService: AiSessionService,
    private readonly messageService: MessageService,
    private readonly aiGatewayService: AiGatewayService,
  ) { }

  /**
   * Создать новую сессию чата
   */
  async createSession(
    createSessionDto: CreateSessionDto,
  ): Promise<AiSessionEntity> {
    return this.aiSessionService.create({
      title: createSessionDto.title,
      user_id: createSessionDto.userId,
      user_name: createSessionDto.userName,
    });
  }

  /**
   * Получить сессию по ID
   */
  async getSession(sessionId: string): Promise<AiSessionEntity> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['messages'],
    });

    if (!session) {
      throw new NotFoundException(`Сессия с ID ${sessionId} не найдена`);
    }

    return session;
  }

  /**
   * Получить все сессии пользователя
   * Возвращает сессии, отсортированные по активности (с валидным adkSessionId и наибольшим количеством сообщений)
   */
  async getUserSessions(userId: string): Promise<AiSessionEntity[]> {
    const sessions = await this.sessionRepository.find({
      where: { userId },
      relations: ['messages'],
      order: { createdAt: 'DESC' },
    });

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const sortedSessions = sessions.sort((a, b) => {
      const aHasValidAdk = a.adkSessionId && uuidRegex.test(a.adkSessionId);
      const bHasValidAdk = b.adkSessionId && uuidRegex.test(b.adkSessionId);

      if (aHasValidAdk && !bHasValidAdk) {
        return -1;
      }
      if (!aHasValidAdk && bHasValidAdk) {
        return 1;
      }

      const aMessagesCount = a.messages?.length || 0;
      const bMessagesCount = b.messages?.length || 0;

      if (aMessagesCount !== bMessagesCount) {
        return bMessagesCount - aMessagesCount;
      }

      const aUpdated = a.updatedAt?.getTime() || 0;
      const bUpdated = b.updatedAt?.getTime() || 0;
      return bUpdated - aUpdated;
    });

    return sortedSessions;
  }

  /**
   * Получить активную сессию пользователя (с валидным adkSessionId и наибольшей активностью)
   */
  async getActiveUserSession(userId: string): Promise<AiSessionEntity | null> {
    const sessions = await this.getUserSessions(userId);

    if (sessions.length === 0) {
      return null;
    }

    // Фильтруем сессии с валидным adkSessionId (UUID формат)
    const validSessions = sessions.filter((session) => {
      if (!session.adkSessionId) return false;
      // Проверяем, что это валидный UUID
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      return uuidRegex.test(session.adkSessionId);
    });

    if (validSessions.length === 0) {
      // Если нет сессий с валидным adkSessionId, возвращаем первую
      return sessions[0];
    }

    // Сортируем по количеству сообщений (убывание), затем по дате обновления (убывание)
    validSessions.sort((a, b) => {
      const aMessagesCount = a.messages?.length || 0;
      const bMessagesCount = b.messages?.length || 0;

      if (aMessagesCount !== bMessagesCount) {
        return bMessagesCount - aMessagesCount; // Больше сообщений = выше
      }

      // Если количество сообщений одинаковое, сортируем по дате обновления
      const aUpdated = a.updatedAt?.getTime() || 0;
      const bUpdated = b.updatedAt?.getTime() || 0;
      return bUpdated - aUpdated; // Более свежая = выше
    });

    const selectedSession = validSessions[0];

    return selectedSession;
  }

  /**
   * Отправить сообщение в сессию
   */
  async sendMessage(
    sendMessageDto: SendMessageDto,
  ): Promise<{ message: MessageEntity; aiResponse?: any }> {
    // Проверяем существование сессии
    const session = await this.getSession(sendMessageDto.sessionId);

    // Создаем сообщение пользователя
    const userMessage = await this.messageService.createUniversal({
      text: sendMessageDto.text,
      type: sendMessageDto.type || MessageType.TEXT,
      direction: sendMessageDto.direction || MessageDirection.INCOMING,
      isBot: sendMessageDto.isBot || false,
      metadata: sendMessageDto.metadata,
    });

    // Связываем сообщение с сессией
    userMessage.session = session;
    await this.messageRepository.save(userMessage);

    // Отправляем запрос в AI Gateway для получения ответа ТОЛЬКО для входящих сообщений
    let aiResponse: { message: MessageEntity; aiResult: any } | null = null;

    const isOutgoing =
      sendMessageDto.direction === MessageDirection.OUTGOING ||
      userMessage.direction === MessageDirection.OUTGOING;

    if (isOutgoing) {
      console.log('Skipping AI response for outgoing message');
      return {
        message: userMessage,
        aiResponse: null,
      };
    }

    try {
      const aiResult = await this.aiGatewayService.create({
        text: sendMessageDto.text,
        userId: session.userId,
        userName: session.userName,
        sessionId: session.adkSessionId,
      });

      // Если был создан новый sessionId (например, при 404), сохраняем его в базу
      if (aiResult.success && aiResult.sessionId) {
        // Принудительно обновляем, если была создана новая сессия ИЛИ sessionId изменился
        if (
          aiResult.wasNewSessionCreated ||
          aiResult.sessionId !== session.adkSessionId
        ) {
          session.adkSessionId = aiResult.sessionId;
          const savedSession = await this.sessionRepository.save(session);
          console.log('adkSessionId updated for session', {
            sessionId: savedSession.id,
            adkSessionId: savedSession.adkSessionId,
            wasNewSessionCreated: aiResult.wasNewSessionCreated,
          });
        }
      }

      if (aiResult.success && aiResult.response) {
        // Создаем ответное сообщение от AI
        const aiMessage = await this.messageService.createUniversal({
          text: aiResult.response,
          type: MessageType.TEXT,
          direction: MessageDirection.OUTGOING,
          isBot: true,
        });

        aiMessage.session = session;
        await this.messageRepository.save(aiMessage);

        aiResponse = {
          message: aiMessage,
          aiResult: aiResult,
        };
      }
    } catch (error) {
      console.error('Ошибка при получении ответа от AI:', error);
      // Не прерываем выполнение, просто логируем ошибку
    }

    return {
      message: userMessage,
      aiResponse,
    };
  }

  /**
   * Получить историю сообщений сессии
   */
  async getSessionMessages(
    sessionId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<MessageEntity[]> {
    await this.getSession(sessionId);

    return this.messageRepository.find({
      where: { session: { id: sessionId } },
      order: { messageDate: 'ASC' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Удалить сессию
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.getSession(sessionId);
    await this.sessionRepository.softDelete(sessionId);
  }
}
