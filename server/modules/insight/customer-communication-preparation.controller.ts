import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Post,
  ParseUUIDPipe,
  Param,
  Patch,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import type {
  CustomerCommunicationPreparationResponse,
  CustomerPreparationResultSnapshot,
  CustomerPreparationDeliveryStatus,
  ConfirmPreparationDeliveryRequest,
  ConfirmPreparationDeliveryResponse,
  PlatformPermission,
  PlatformSessionResponse,
  SaveCustomerPreparationDraftRequest,
} from '@shared/api.interface';
import {
  CONTROL_STORE,
  type ControlStore,
} from '@server/modules/agent-core/agent.ports';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import {
  PlatformAccessDeniedError,
  PlatformSessionService,
} from '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from
  '@server/modules/platform-shell/platform-shell.service';
import {
  FeishuWebAuthError,
  FeishuWebAuthService,
} from '@server/modules/web-auth/feishu-web-auth.service';
import { readSessionCookie } from
  '@server/modules/web-auth/feishu-web-auth.controller';
import type { AuthenticatedWebSession } from
  '@server/modules/web-auth/web-auth.ports';
import { CustomerCommunicationPreparationService } from
  './customer-communication-preparation.service';
import { CustomerPreparationAccessService } from './customer-preparation-access.service';
import { parsePreparationDraftEdit } from './preparation-draft-edit';

const REQUIRED_PERMISSIONS: PlatformPermission[] = [
  'customer:read',
  'opportunity:read',
  'followup:read',
  'playbook:read',
];

const formatLocalDate = (value: Date, timezone: string): string => {
  const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
  ).formatToParts(value);
  const partValue = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(
      (part: Intl.DateTimeFormatPart): boolean => part.type === type,
    )?.value ?? '';
  return [partValue('year'), partValue('month'), partValue('day')].join('-');
};

@Controller('api/platform/customer-communications')
class CustomerCommunicationPreparationController {
  constructor(
    private readonly auth: FeishuWebAuthService,
    private readonly shell: PlatformShellService,
    private readonly sessions: PlatformSessionService,
    private readonly preparations: CustomerCommunicationPreparationService,
    @Inject(CONTROL_STORE)
    private readonly controlStore: ControlStore,
    @Optional() private readonly access?: CustomerPreparationAccessService,
  ) {}

  @Get('results/:id')
  async getPreparationResult(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CustomerPreparationResultSnapshot> {
    const session: AuthenticatedWebSession = await this.authenticatedSession(request);
    return this.accessiblePreparation(session, id);
  }

  @Get('results/:id/delivery')
  async getPreparationDelivery(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CustomerPreparationDeliveryStatus> {
    const session: AuthenticatedWebSession = await this.authenticatedSession(request);
    await this.accessiblePreparation(session, id);
    return await this.controlStore.getPreparationDelivery({
      tenantId: session.tenantId, actorOpenId: session.member.feishuOpenId, resultId: id,
    }) ?? { status: 'not_recorded' };
  }

  @Post('results/:id/delivery/confirm')
  async confirmPreparationDelivery(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<ConfirmPreparationDeliveryResponse> {
    const session: AuthenticatedWebSession = await this.authenticatedSession(request);
    await this.accessiblePreparation(session, id);
    const confirmation: ConfirmPreparationDeliveryRequest = this.parseDeliveryConfirmation(body);
    const sentAt: Date = new Date(confirmation.sentAt);
    const now: Date = new Date();
    if (sentAt.getTime() > now.getTime()) {
      throw new BadRequestException('发送时间不能晚于当前时间');
    }
    const saved: boolean = await this.controlStore.confirmPreparationDelivery({
      tenantId: session.tenantId, actorOpenId: session.member.feishuOpenId,
      resultId: id, operatorOpenId: session.member.feishuOpenId,
      expectedVersion: confirmation.expectedVersion, sentAt, messageId: confirmation.messageId,
      note: confirmation.note.trim(), now,
    });
    if (!saved) throw new ConflictException('投递记录已变化或不处于待核查状态，请刷新后确认');
    const delivery = await this.controlStore.getPreparationDelivery({
      tenantId: session.tenantId, actorOpenId: session.member.feishuOpenId, resultId: id,
    });
    if (delivery?.status !== 'sent' || !delivery.updatedAt) {
      throw new ServiceUnavailableException('核查结果已提交，但状态读取暂不可用');
    }
    return { status: 'sent', updatedAt: delivery.updatedAt };
  }

  private parseDeliveryConfirmation(body: unknown): ConfirmPreparationDeliveryRequest {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('核查信息格式无效');
    }
    const value: Record<string, unknown> = body as Record<string, unknown>;
    const messageId: unknown = value.messageId;
    const note: unknown = value.note;
    const expectedVersion: unknown = value.expectedVersion;
    const sentAt: unknown = value.sentAt;
    if (Object.keys(value).some((key: string) => !['expectedVersion', 'messageId', 'sentAt', 'note'].includes(key)) ||
      typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 1 ||
      typeof sentAt !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/u.test(sentAt) || !Number.isFinite(Date.parse(sentAt)) ||
      typeof messageId !== 'string' || !messageId.trim() || messageId.length > 255 ||
      typeof note !== 'string' || note.trim().length < 5 || note.trim().length > 2000) {
      throw new BadRequestException('需提供有效版本、飞书消息 ID、发送时间和核查说明');
    }
    return { expectedVersion, sentAt, messageId: messageId.trim(), note };
  }

  @Patch('results/:id/draft')
  async savePreparationDraft(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<CustomerPreparationResultSnapshot> {
    const session: AuthenticatedWebSession = await this.authenticatedSession(request);
    const result = await this.accessiblePreparation(session, id);
    let edit: SaveCustomerPreparationDraftRequest;
    try { edit = parsePreparationDraftEdit(body); }
    catch { throw new BadRequestException('话术字段、长度或版本无效'); }
    if (!result.report.drafts.some((draft) => draft.channel === edit.channel)) {
      throw new BadRequestException('准备包中不存在该渠道话术');
    }
    const saved = await this.controlStore.savePreparationDraft({
      tenantId: session.tenantId, actorOpenId: session.member.feishuOpenId, id, edit,
    });
    if (!saved) throw new ConflictException('准备包版本已变化，请刷新后重试；本地修改尚未保存');
    return saved;
  }

  private async accessiblePreparation(
    session: AuthenticatedWebSession,
    id: string,
  ): Promise<CustomerPreparationResultSnapshot> {
    await this.authorizedPlatformSession(session);
    const result = await this.controlStore.getPreparationResult(session.tenantId, session.member.feishuOpenId, id);
    if (!result) throw new NotFoundException('准备结果不存在或不可访问');
    const integration = await this.controlStore.resolveTenantById(session.tenantId);
    if (!integration || integration.status !== 'active' || integration.tenantId !== session.tenantId || !this.access) {
      throw new ServiceUnavailableException('准备结果暂时不可访问');
    }
    const customer = result.report.customer;
    if (!customer) throw new NotFoundException('准备结果没有可访问的客户');
    const resolution = await this.access.resolve(integration, session.member.feishuOpenId, customer.name)
      .catch(() => { throw new ForbiddenException('无权访问当前准备结果'); });
    if (resolution.status === 'unavailable') throw new ServiceUnavailableException('无法核验客户权限，请稍后重试');
    if (!resolution.candidates.some((candidate) => candidate.recordId === customer.recordId)) {
      throw new NotFoundException('准备结果不存在或不可访问');
    }
    return result;
  }

  @Get(':customerRecordId')
  async getCustomerCommunication(
    @Req() request: Request,
    @Param('customerRecordId') customerRecordId: string,
    @Query('date') requestedDate?: string,
  ): Promise<CustomerCommunicationPreparationResponse> {
    const session: AuthenticatedWebSession =
      await this.authenticatedSession(request);
    const platformSession: PlatformSessionResponse =
      await this.authorizedPlatformSession(session);
    const integration: TenantIntegration | null =
      await this.controlStore.resolveTenantById(session.tenantId);
    if (
      integration === null ||
      integration.status !== 'active' ||
      integration.tenantId !== session.tenantId
    ) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: '客户与商机数据源暂时不可用',
      });
    }
    const referenceDate: string = requestedDate?.trim() ||
      formatLocalDate(new Date(), platformSession.tenant.timezone);
    return this.preparations.generate({
      integration,
      actorOpenId: session.member.feishuOpenId,
      customerRecordId,
      referenceDate,
      timezone: platformSession.tenant.timezone,
    });
  }

  private async authorizedPlatformSession(
    session: AuthenticatedWebSession,
  ): Promise<PlatformSessionResponse> {
    try {
      for (const permission of REQUIRED_PERMISSIONS) {
        await this.shell.assertPermission(session, permission);
      }
      const platformSession: PlatformSessionResponse =
        await this.sessions.getSessionByMembership(
          session.tenantId,
          session.member.id,
        );
      if (
        platformSession.tenant.id !== session.tenantId ||
        platformSession.member.id !== session.member.id ||
        platformSession.member.feishuOpenId !== session.member.feishuOpenId
      ) {
        throw new PlatformAccessDeniedError();
      }
      return platformSession;
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: '无权准备该客户的沟通内容',
        });
      }
      throw error;
    }
  }

  private async authenticatedSession(
    request: Request,
  ): Promise<AuthenticatedWebSession> {
    const token: string | null = readSessionCookie(request);
    if (token === null) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: '请先通过飞书登录',
      });
    }
    try {
      const session: AuthenticatedWebSession =
        await this.auth.authenticateSession(token);
      if (
        session.member.status !== 'active' ||
        session.member.tenantId !== session.tenantId
      ) {
        throw new FeishuWebAuthError(
          'ACCESS_DENIED',
          '当前成员身份不可用',
        );
      }
      return session;
    } catch (error: unknown) {
      if (
        error instanceof FeishuWebAuthError &&
        error.code === 'UNAUTHENTICATED'
      ) {
        throw new UnauthorizedException({
          code: 'UNAUTHENTICATED',
          message: '登录状态已失效，请重新登录',
        });
      }
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: '无权访问当前工作区',
      });
    }
  }
}

export { CustomerCommunicationPreparationController };
