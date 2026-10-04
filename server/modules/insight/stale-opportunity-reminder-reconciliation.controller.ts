import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { Request } from 'express';
import type {
  StaleOpportunityReminderReconciliationDecision,
  StaleOpportunityReminderReconciliationListResponse,
  StaleOpportunityReminderReconciliationRequest,
  StaleOpportunityReminderReconciliationResponse,
} from '@shared/api.interface';
import {
  FeishuWebAuthError,
  FeishuWebAuthService,
} from '@server/modules/web-auth/feishu-web-auth.service';
import { readSessionCookie } from
  '@server/modules/web-auth/feishu-web-auth.controller';
import type { AuthenticatedWebSession } from
  '@server/modules/web-auth/web-auth.ports';
import { PlatformAccessDeniedError } from
  '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from
  '@server/modules/platform-shell/platform-shell.service';
import {
  StaleOpportunityReminderReconciliationError,
  StaleOpportunityReminderReconciliationService,
} from './stale-opportunity-reminder-reconciliation.service';

const VALID_DECISIONS: StaleOpportunityReminderReconciliationDecision[] = [
  'confirm_sent',
  'authorize_retry',
  'keep_frozen',
];

@Controller('api/platform/stale-opportunity-reminders/reconciliation')
class StaleOpportunityReminderReconciliationController {
  constructor(
    private readonly auth: FeishuWebAuthService,
    private readonly shell: PlatformShellService,
    private readonly reconciliation:
      StaleOpportunityReminderReconciliationService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Req() request: Request,
    @Query('limit') rawLimit?: string,
  ): Promise<StaleOpportunityReminderReconciliationListResponse> {
    const session: AuthenticatedWebSession =
      await this.authorizedSession(request);
    const limit: number | undefined = rawLimit === undefined
      ? undefined
      : Number(rawLimit);
    return this.reconciliation.listUncertain({
      tenantId: session.tenantId,
      limit,
    });
  }

  @Post(':opportunityRecordId')
  @Header('Cache-Control', 'no-store')
  async reconcile(
    @Req() request: Request,
    @Param('opportunityRecordId') opportunityRecordId: string,
    @Body() body: unknown,
  ): Promise<StaleOpportunityReminderReconciliationResponse> {
    const session: AuthenticatedWebSession =
      await this.authorizedSession(request);
    const input: StaleOpportunityReminderReconciliationRequest =
      this.parseRequest(body, opportunityRecordId);
    try {
      return await this.reconciliation.reconcile({
        ...input,
        tenantId: session.tenantId,
        operatorMemberId: session.member.id,
      });
    } catch (error: unknown) {
      this.rethrowReconciliationError(error);
    }
  }

  private async authorizedSession(
    request: Request,
  ): Promise<AuthenticatedWebSession> {
    const token: string | null = readSessionCookie(request);
    if (token === null) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: '请先通过飞书登录',
      });
    }
    let session: AuthenticatedWebSession;
    try {
      session = await this.auth.authenticateSession(token);
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
        message: '无权访问提醒对账',
      });
    }
    try {
      await this.shell.assertPermission(session, 'admin:manage-policies');
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: '只有提醒运营管理员可以执行人工对账',
        });
      }
      throw error;
    }
    return session;
  }

  private parseRequest(
    body: unknown,
    opportunityRecordId: string,
  ): StaleOpportunityReminderReconciliationRequest {
    if (typeof body !== 'object' || body === null) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '提醒对账参数格式无效',
      });
    }
    const value: Record<string, unknown> = body as Record<string, unknown>;
    const decision: unknown = value.decision;
    const note: unknown = value.note;
    const expectedUpdatedAt: unknown = value.expectedUpdatedAt;
    const followupVersion: unknown = value.followupVersion;
    const reminderKind: unknown = value.reminderKind;
    const messageId: unknown = value.messageId;
    const sentAt: unknown = value.sentAt;
    const optionalString = (candidate: unknown): candidate is
      string | undefined =>
      candidate === undefined || typeof candidate === 'string';
    if (
      opportunityRecordId.trim().length === 0 ||
      typeof followupVersion !== 'string' ||
      typeof expectedUpdatedAt !== 'string' ||
      reminderKind !== 'stale_followup' ||
      typeof decision !== 'string' ||
      !VALID_DECISIONS.includes(
        decision as StaleOpportunityReminderReconciliationDecision,
      ) ||
      typeof note !== 'string' ||
      !optionalString(messageId) ||
      !optionalString(sentAt)
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '提醒对账参数不完整',
      });
    }
    return {
      opportunityRecordId,
      followupVersion,
      reminderKind: 'stale_followup',
      expectedUpdatedAt,
      decision: decision as StaleOpportunityReminderReconciliationDecision,
      note,
      messageId,
      sentAt,
    };
  }

  private rethrowReconciliationError(error: unknown): never {
    if (!(error instanceof StaleOpportunityReminderReconciliationError)) {
      throw error;
    }
    const response = {
      code: error.code,
      message: error.message,
      currentStatus: error.currentStatus,
      currentUpdatedAt: error.currentUpdatedAt,
    };
    if (error.code === 'VALIDATION_FAILED') {
      throw new UnprocessableEntityException(response);
    }
    if (error.code === 'NOT_FOUND') {
      throw new NotFoundException(response);
    }
    if (error.code === 'CONFLICT') {
      throw new ConflictException(response);
    }
    if (error.code === 'DEPENDENCY_UNAVAILABLE') {
      throw new ServiceUnavailableException(response);
    }
    throw new InternalServerErrorException(response);
  }
}

export { StaleOpportunityReminderReconciliationController };
