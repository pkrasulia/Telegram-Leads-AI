import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import { LeadService } from './lead.service';
import { CreateLeadDto, LeadStatus } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadEntity } from './entities/lead.entity';

@ApiBearerAuth()
@Roles(RoleEnum.admin, RoleEnum.service, RoleEnum.user)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiTags('leads')
@Controller({
  path: 'leads',
  version: '1',
})
export class LeadController {
  constructor(private readonly leadService: LeadService) {}

  @Post()
  @ApiOperation({ summary: 'Создать нового лида' })
  @ApiResponse({
    status: 201,
    description: 'Лид успешно создан',
    type: LeadEntity,
  })
  @ApiResponse({ status: 400, description: 'Некорректные данные' })
  async create(@Body() createLeadDto: CreateLeadDto): Promise<LeadEntity> {
    return this.leadService.create(createLeadDto);
  }

  @Get()
  @ApiOperation({ summary: 'Получить всех лидов' })
  @ApiQuery({
    name: 'status',
    enum: LeadStatus,
    required: false,
    description: 'Фильтр по статусу',
  })
  @ApiResponse({ status: 200, description: 'Список лидов', type: [LeadEntity] })
  async findAll(@Query('status') status?: LeadStatus): Promise<LeadEntity[]> {
    if (status) {
      return this.leadService.findByStatus(status);
    }
    return this.leadService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить лида по ID' })
  @ApiParam({ name: 'id', description: 'ID лида' })
  @ApiResponse({ status: 200, description: 'Лид найден', type: LeadEntity })
  @ApiResponse({ status: 404, description: 'Лид не найден' })
  async findOne(@Param('id', ParseIntPipe) id: string): Promise<LeadEntity> {
    return this.leadService.findOne(id);
  }

  // @Get('telegram/:telegramId')
  // @ApiOperation({ summary: 'Найти лида по Telegram ID' })
  // @ApiParam({ name: 'telegramId', description: 'Telegram ID лида' })
  // @ApiResponse({ status: 200, description: 'Лид найден', type: Lead })
  // @ApiResponse({ status: 404, description: 'Лид не найден' })
  // async findByTelegramId(
  //   @Param('telegramId') telegramId: string,
  // ): Promise<Lead> {
  //   const lead = await this.leadService.findByTelegramId(telegramId);
  //   if (!lead) {
  //     throw new Error(`Lead with Telegram ID ${telegramId} not found`);
  //   }
  //   return lead;
  // }

  @Get('email/:email')
  @ApiOperation({ summary: 'Найти лида по email' })
  @ApiParam({ name: 'email', description: 'Email лида' })
  @ApiResponse({ status: 200, description: 'Лид найден', type: LeadEntity })
  @ApiResponse({ status: 404, description: 'Лид не найден' })
  async findByEmail(@Param('email') email: string): Promise<LeadEntity> {
    const lead = await this.leadService.findByEmail(email);
    if (!lead) {
      throw new Error(`Lead with email ${email} not found`);
    }
    return lead;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить лида' })
  @ApiParam({ name: 'id', description: 'ID лида' })
  @ApiResponse({ status: 200, description: 'Лид обновлен', type: LeadEntity })
  @ApiResponse({ status: 404, description: 'Лид не найден' })
  async update(
    @Param('id', ParseIntPipe) id: string,
    @Body() updateLeadDto: UpdateLeadDto,
  ): Promise<LeadEntity> {
    return this.leadService.update(id, updateLeadDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить лида' })
  @ApiParam({ name: 'id', description: 'ID лида' })
  @ApiResponse({ status: 204, description: 'Лид удален' })
  @ApiResponse({ status: 404, description: 'Лид не найден' })
  async remove(@Param('id', ParseIntPipe) id: string): Promise<void> {
    return this.leadService.remove(id);
  }
}
