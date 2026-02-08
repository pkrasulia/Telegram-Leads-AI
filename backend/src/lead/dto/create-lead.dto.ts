import { IsString, IsEmail, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum LeadStatus {
  NEW = 'new',
  CONTACTED = 'contacted',
  QUALIFIED = 'qualified',
  CONVERTED = 'converted',
  LOST = 'lost',
}

export enum LeadSource {
  TELEGRAM = 'telegram',
  WEBSITE = 'website',
  REFERRAL = 'referral',
  SOCIAL_MEDIA = 'social_media',
  OTHER = 'other',
}

export class CreateLeadDto {
  @ApiProperty({ description: 'Имя лида' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Email лида', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ description: 'Номер телефона лида', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ description: 'Компания лида', required: false })
  @IsOptional()
  @IsString()
  company?: string;

  @ApiProperty({ description: 'Должность лида', required: false })
  @IsOptional()
  @IsString()
  position?: string;

  @ApiProperty({ description: 'Заметки о лиде', required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    enum: LeadStatus,
    description: 'Статус лида',
    default: LeadStatus.NEW,
  })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiProperty({
    enum: LeadSource,
    description: 'Источник лида',
    default: LeadSource.TELEGRAM,
  })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiProperty({ description: 'ADK Session ID', required: false })
  @IsOptional()
  @IsString()
  adkSessionId?: string;
}
