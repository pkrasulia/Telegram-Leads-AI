import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateLeadDto, LeadStatus } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadEntity } from './entities/lead.entity';
import { AiSessionEntity } from 'src/ai-session/entities/ai-session.entity';

@Injectable()
export class LeadService {
  constructor(
    @InjectRepository(LeadEntity)
    private readonly leadRepository: Repository<LeadEntity>,
    @InjectRepository(AiSessionEntity)
    private readonly sessionRepository: Repository<AiSessionEntity>,
  ) { }

  async create(createLeadDto: CreateLeadDto): Promise<LeadEntity> {
    const { adkSessionId, ...leadData } = createLeadDto;

    console.log('>>>> CREATE LEAD REQUEST', { adkSessionId });

    if (adkSessionId) {
      // Ищем сессию по adkSessionId
      const session = await this.sessionRepository.findOne({
        where: { adkSessionId: adkSessionId },
        relations: ['lead'],
      });

      if (session) {
        if (session.lead) {
          // Если у сессии уже есть лид, обновляем его
          console.log('>>>> UPDATING EXISTING LEAD FOR SESSION', session.lead.id);
          Object.assign(session.lead, leadData);
          return await this.leadRepository.save(session.lead);
        } else {
          // Если сессия есть, но лида нет, создаем и привязываем
          console.log('>>>> CREATING NEW LEAD FOR EXISTING SESSION', session.id);
          const newLead = this.leadRepository.create({
            ...leadData,
            status: leadData.status || LeadStatus.NEW,
            aiSession: session,
          });
          return await this.leadRepository.save(newLead);
        }
      }
    }

    // Если adkSessionId не передан или сессия не найдена
    console.log('>>>> CREATING STANDALONE LEAD');
    const lead = this.leadRepository.create({
      ...leadData,
      status: leadData.status || LeadStatus.NEW,
    });
    return await this.leadRepository.save(lead);
  }

  async findAll(): Promise<LeadEntity[]> {
    return await this.leadRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<LeadEntity> {
    const lead = await this.leadRepository.findOne({ where: { id } });
    if (!lead) {
      throw new NotFoundException(`Lead with ID ${id} not found`);
    }
    return lead;
  }

  async update(id: string, updateLeadDto: UpdateLeadDto): Promise<LeadEntity> {
    const lead = await this.findOne(id);
    Object.assign(lead, updateLeadDto);
    return await this.leadRepository.save(lead);
  }

  async remove(id: string): Promise<void> {
    const lead = await this.findOne(id);
    await this.leadRepository.remove(lead);
  }

  // async findByTelegramId(telegramId: string): Promise<Lead | null> {
  //   return await this.leadRepository.findOne({ where: { telegramId } });
  // }

  async findByEmail(email: string): Promise<LeadEntity | null> {
    return await this.leadRepository.findOne({ where: { email } });
  }

  async findByStatus(status: LeadStatus): Promise<LeadEntity[]> {
    return await this.leadRepository.find({
      where: { status },
      order: { createdAt: 'DESC' },
    });
  }
}
