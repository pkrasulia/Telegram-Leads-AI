import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { LeadStatus, LeadSource } from '../dto/create-lead.dto';
import { AiSessionEntity } from 'src/ai-session/entities/ai-session.entity';

@Entity('leads')
export class LeadEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'citext', nullable: true })
  email?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string;

  @Column({ type: 'text', nullable: true })
  company?: string;

  @Column({ type: 'text', nullable: true })
  position?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @OneToOne(() => AiSessionEntity, (session) => session.lead, {
    eager: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ai_session_id' })
  aiSession: AiSessionEntity;

  @Column({
    type: 'enum',
    enum: LeadStatus,
    default: LeadStatus.NEW,
  })
  status: LeadStatus;

  @Column({
    type: 'enum',
    enum: LeadSource,
    default: LeadSource.TELEGRAM,
  })
  source: LeadSource;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}
