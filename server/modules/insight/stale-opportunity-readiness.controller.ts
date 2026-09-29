import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  InternalServerErrorException,
  Post,
  Req,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnauthorizedException,
} from '@nestjs/common';

import type { Request } from 'express';
import type {
  StaleOpportunityGovernanceRequest,
  StaleOpportunityGovernanceResponse,
  StaleOpportunityReadinessResponse,
} from '@shared/api.interface';
import {
  CONTROL_STORE,
  type ControlStore,
} from '@server/modules/agent-core/agent.ports';
import {
  FeishuWebAuthError,
  FeishuWebAuthService,
} from '@server/modules/web-auth/feishu-web-auth.service';
import { readSessionCookie } from '@server/modules/web-auth/feishu-web-auth.controller';
import type { AuthenticatedWebSession } from
  '@server/modules/web-auth/web-auth.ports';
import {
  PlatformAccessDeniedError,
} from '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from
  '@server/modules/platform-shell/platform-shell.service';
import {
  StaleOpportunityGovernanceError,
  StaleOpportunityReadinessService,
} from './stale-opportunity-readiness.service';

@Controller('api/platform')
class StaleOpportunityReadinessController {
  constructor(
    private readonly auth: FeishuWebAuthService,
    private readonly shell: PlatformShellService,
    private readonly readiness: StaleOpportunityReadinessService,
    @Inject(CONTROL_STORE)
    private readonly controlStore: ControlStore,
  ) {}

  @Get('stale-opportunity-readiness')
  async getReadiness(
    @Req() request: Request,
  ): Promise<StaleOpportunityReadinessResponse> {
    const session: AuthenticatedWebSession =
      await this.authenticatedSession(request);
    try {
      await this.shell.assertPermission(session, 'review:read-personal');
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: '无权读取商机提醒数据准备度',
        });
      }
      throw error;
    }
    const integration = await this.controlStore.resolveTenantById(
      session.tenantId,
    );
    if (integration === null || integration.status !== 'active') {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: '销售数据源暂时不可用',
      });
    }
    return this.readiness.generate({
      integration,
      actorOpenId: session.member.feishuOpenId,
      now: new Date(),
    });
  }

  @Post('stale-opportunity-readiness/govern')
  async govern(
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<StaleOpportunityGovernanceResponse> {
    const session: AuthenticatedWebSession =
      await this.authenticatedSession(request);
    await this.assertPermission(session);
    const integration = await this.controlStore.resolveTenantById(
      session.tenantId,
    );
    if (integration === null || integration.status !== 'active') {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: '销售数据源暂时不可用',
      });
    }
    const governanceRequest: StaleOpportunityGovernanceRequest =
      this.parseGovernanceRequest(body);
    try {
      return await this.readiness.govern({
        integration,
        actorOpenId: session.member.feishuOpenId,
        request: governanceRequest,
      });
    } catch (error: unknown) {
      if (!(error instanceof StaleOpportunityGovernanceError)) throw error;
      const response = {
        code: error.code,
        message: error.message,
        traceId: error.traceId,
        retryable: error.retryable,
      };
      if (error.code === 'ACCESS_DENIED') {
        throw new ForbiddenException(response);
      }
      if (error.code === 'CONFLICT') {
        throw new ConflictException(response);
      }
      if (error.code === 'VALIDATION_FAILED') {
        throw new UnprocessableEntityException(response);
      }
      if (error.code === 'DEPENDENCY_UNAVAILABLE') {
        throw new ServiceUnavailableException(response);
      }
      throw new InternalServerErrorException(response);
    }
  }

  private async assertPermission(
    session: AuthenticatedWebSession,
  ): Promise<void> {
    try {
      await this.shell.assertPermission(session, 'review:read-personal');
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: '无权读取商机提醒数据准备度',
        });
      }
      throw error;
    }
  }

  private parseGovernanceRequest(
    body: unknown,
  ): StaleOpportunityGovernanceRequest {
    if (typeof body !== 'object' || body === null) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '商机确认参数格式无效',
      });
    }
    const value: Record<string, unknown> = body as Record<string, unknown>;
    const status: unknown = value.status;
    const expectedStatus: unknown = value.expectedStatus;
    const validStatuses: string[] = ['active', 'won', 'lost', 'closed'];
    const validExpectedStatuses: string[] = [...validStatuses, 'unknown'];
    const isStringOrNull = (item: unknown): item is string | null =>
      item === null || typeof item === 'string';
    if (
      typeof value.recordId !== 'string' ||
      !validStatuses.includes(String(status)) ||
      !validExpectedStatuses.includes(String(expectedStatus)) ||
      !isStringOrNull(value.expectedSourceVersion) ||
      !isStringOrNull(value.followupRecordId) ||
      !isStringOrNull(value.expectedFollowupSourceVersion) ||
      typeof value.idempotencyKey !== 'string'
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '商机确认参数不完整',
      });
    }
    const communicationAt: unknown = value.communicationAt;
    if (
      communicationAt !== undefined &&
      communicationAt !== null &&
      typeof communicationAt !== 'string'
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '可信沟通时间格式无效',
      });
    }
    const normalizedCommunicationAt: string | null | undefined =
      typeof communicationAt === 'string'
        ? communicationAt
        : communicationAt === null
          ? null
          : undefined;
    return {
      recordId: value.recordId,
      status: status as StaleOpportunityGovernanceRequest['status'],
      expectedStatus:
        expectedStatus as StaleOpportunityGovernanceRequest['expectedStatus'],
      expectedSourceVersion: value.expectedSourceVersion,
      followupRecordId: value.followupRecordId,
      expectedFollowupSourceVersion: value.expectedFollowupSourceVersion,
      communicationAt: normalizedCommunicationAt,
      idempotencyKey: value.idempotencyKey,
    };
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
      return await this.auth.authenticateSession(token);
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

export { StaleOpportunityReadinessController };
