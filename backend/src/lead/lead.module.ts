import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadService } from './lead.service';
import { LeadController } from './lead.controller';
import { LeadEntity } from './entities/lead.entity';
import { AiSessionEntity } from 'src/ai-session/entities/ai-session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([LeadEntity, AiSessionEntity])],
  controllers: [LeadController],
  providers: [LeadService],
  exports: [LeadService],
})
export class LeadModule { }
