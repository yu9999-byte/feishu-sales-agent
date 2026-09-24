import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { Request } from 'express';
import type {
  CreateFollowupDraftRequest,
  ConfirmFollowupDraftRequest,
  AgentExecutionResult,
  FollowupCardFormInput,
  FollowupDraftResponse,
  PlatformPermission,
  PlatformSessionResponse,
  UpdateFollowupDraftRequest,
} from '@shared/api.interface';
import {
  parseFollowupDraft,
} from '@server/modules/agent-core/agent.validation';
import { FollowupExtractionUnavailableError } from '@server/modules/agent-core/agent.errors';
import {
  PlatformSessionService,
} from '@server/modules/platform-shell/platform-session.service';
import { readSessionCookie } from '@server/modules/web-auth/feishu-web-auth.controller';
import {
  FeishuWebAuthService,
} from '@server/modules/web-auth/feishu-web-auth.service';
import type {
  AuthenticatedWebSession,
} from '@server/modules/web-auth/web-auth.ports';
import type { FollowupDraftRecord } from './followup-draft.repository';
import {
  FollowupConfirmationError,
  FollowupConfirmationService,
} from './followup-confirmation.service';
import {
  FollowupDraftConflictError,
  FollowupDraftWorkflowService,
} from './followup-draft-workflow.service';

const optionalText = z.string().trim().min(1).max(500).optional();
const createSchema = z.object({
  sourceType: z.enum(['card_form', 'text']),
  text: z.string().trim().min(1).max(20_000),
  idempotencyKey: z.string().trim().min(8).max(255),
  form: z.object({
    customerName: optionalText,
    contactName: optionalText,
    communicationMethod: optionalText,
    communicationAt: optionalText,
    topic: optionalText,
    nextAction: optionalText,
    dueAt: optionalText,
    nextActionChannel: optionalText,
    nextActionParticipants: z.array(
      z.string().trim().min(1).max(100),
    ).max(30).optional(),
    participants: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  }).optional(),
});

const updateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  generatedBody: z.string().trim().min(1).max(10_000),
  draft: z.unknown(),
});
const confirmSchema = z.object({
  expectedVersion: z.number().int().positive(),
  selectedTaskCandidateIds: z.array(
    z.string().trim().min(1).max(255),
  ).max(20),
});

@Controller('api/platform')
class FollowupDraftController {
  constructor(
    private readonly auth: FeishuWebAuthService,
    private readonly sessions: PlatformSessionService,
    private readonly workflow: FollowupDraftWorkflowService,
    private readonly confirmation: FollowupConfirmationService,
  ) {}

  @Post('followup-inputs')
  async create(
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<FollowupDraftResponse> {
    this.assertSameOrigin(request);
    const session: AuthenticatedWebSession =
      await this.authorizedSession(request, 'followup:create-own');
    const parsed: CreateFollowupDraftRequest = createSchema.parse(body);
    const sourceText: string = parsed.sourceType === 'card_form'
      ? this.normalizeForm(parsed.form, parsed.text)
      : parsed.text;
    try {
      const record: FollowupDraftRecord = await this.workflow.create({
        tenantId: session.tenantId,
        ownerMemberId: session.member.id,
        sourceType: parsed.sourceType,
        text: sourceText,
        idempotencyKey: parsed.idempotencyKey,
        timezone: 'Asia/Shanghai',
        now: new Date(),
      });
      return this.toResponse(record);
    } catch (error: unknown) {
      if (error instanceof FollowupExtractionUnavailableError) {
        throw new ServiceUnavailableException({
          code: 'DEPENDENCY_UNAVAILABLE',
          message: '模型当前繁忙，请稍后重试；草案未生成，业务数据未写入',
          retryable: true,
        });
      }
      throw error;
    }
  }

  @Post('followup-drafts/:id/confirm')
  async confirm(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AgentExecutionResult> {
    this.assertSameOrigin(request);
    const session: AuthenticatedWebSession =
      await this.authorizedSession(request, 'followup:confirm-own');
    const parsed: ConfirmFollowupDraftRequest = confirmSchema.parse(body);
    try {
      return await this.confirmation.confirm({
        tenantId: session.tenantId,
        ownerMemberId: session.member.id,
        ownerOpenId: session.member.feishuOpenId,
        draftId: id,
        expectedVersion: parsed.expectedVersion,
        selectedTaskCandidateIds: parsed.selectedTaskCandidateIds,
        traceId: randomUUID(),
        now: new Date(),
      });
    } catch (error: unknown) {
      if (error instanceof FollowupConfirmationError) {
        if (error.code === 'DRAFT_NOT_CONFIRMABLE') {
          throw new UnprocessableEntityException({
            code: error.code,
            message: '请先补全必填字段并修复证据问题',
          });
        }
        if (error.code === 'INTEGRATION_UNAVAILABLE') {
          throw new ServiceUnavailableException({
            code: error.code,
            message: '当前企业集成暂不可用',
          });
        }
        if (error.code === 'TASK_SELECTION_INVALID') {
          throw new ConflictException({
            code: error.code,
            message: '待办预览已变化，请重新检查后确认',
          });
        }
        throw new ConflictException({
          code: error.code,
          message: '草案状态已变化，请刷新后重试',
        });
      }
      throw error;
    }
  }

  @Get('followup-drafts/:id')
  async get(
    @Req() request: Request,
    @Param('id') id: string,
  ): Promise<FollowupDraftResponse> {
    const session: AuthenticatedWebSession =
      await this.authorizedSession(request, 'followup:read');
    try {
      return this.toResponse(await this.workflow.getOwned(
        session.tenantId,
        session.member.id,
        id,
      ));
    } catch (error: unknown) {
      this.rethrowDraftError(error, false);
    }
  }

  @Get('followup-drafts/:id/execution')
  async execution(
    @Req() request: Request,
    @Param('id') id: string,
  ): Promise<AgentExecutionResult | null> {
    const session: AuthenticatedWebSession =
      await this.authorizedSession(request, 'followup:read');
    try {
      return await this.confirmation.getExecution(
        session.tenantId,
        session.member.id,
        session.member.feishuOpenId,
        id,
      );
    } catch (error: unknown) {
      if (error instanceof FollowupConfirmationError) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: '无权访问当前工作区',
        });
      }
      throw error;
    }
  }

  @Patch('followup-drafts/:id')
  async edit(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<FollowupDraftResponse> {
    this.assertSameOrigin(request);
    const session: AuthenticatedWebSession =
      await this.authorizedSession(request, 'followup:create-own');
    const parsed = updateSchema.parse(body) as UpdateFollowupDraftRequest;
    try {
      return this.toResponse(await this.workflow.edit({
        tenantId: session.tenantId,
        ownerMemberId: session.member.id,
        draftId: id,
        expectedVersion: parsed.expectedVersion,
        generatedBody: parsed.generatedBody,
        draft: parseFollowupDraft(parsed.draft),
        now: new Date(),
      }));
    } catch (error: unknown) {
      this.rethrowDraftError(error, true);
    }
  }

  private assertSameOrigin(request: Request): void {
    if (request.headers.origin !== this.auth.publicOrigin) {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: '无权执行此操作',
      });
    }
  }

  private async authorizedSession(
    request: Request,
    permission: PlatformPermission,
  ): Promise<AuthenticatedWebSession> {
    const token: string | null = readSessionCookie(request);
    if (token === null) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: '请先通过飞书登录',
      });
    }
    const session: AuthenticatedWebSession =
      await this.auth.authenticateSession(token);
    const platform: PlatformSessionResponse =
      await this.sessions.getSessionByMembership(
        session.tenantId,
        session.member.id,
      );
    if (!platform.permissions.includes(permission)) {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: '无权访问当前工作区',
      });
    }
    return session;
  }

  private normalizeForm(
    form: FollowupCardFormInput | undefined,
    body: string,
  ): string {
    const values: Array<[string, string | undefined]> = [
      ['客户', form?.customerName],
      ['联系人', form?.contactName],
      ['沟通方式', form?.communicationMethod],
      ['沟通时间', form?.communicationAt],
      ['主题', form?.topic],
      ['沟通内容', body],
      ['下一步', form?.nextAction],
      ['截止时间', form?.dueAt],
      ['下一步方式', form?.nextActionChannel],
      ['下一步参与人', form?.nextActionParticipants?.join('、')],
      ['参与人', form?.participants?.join('、')],
    ];
    return values
      .filter((entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].trim().length > 0,
      )
      .map(([label, value]): string => `${label}：${value.trim()}`)
      .join('\n');
  }

  private toResponse(record: FollowupDraftRecord): FollowupDraftResponse {
    return {
      id: record.id,
      status: record.status,
      sourceType: record.sourceType,
      currentVersion: record.currentVersion,
      version: {
        version: record.version.version,
        creationKind: record.version.creationKind,
        generatedBody: record.version.generatedBody,
        draft: record.version.draft,
        quality: record.version.quality,
        taskCandidates: record.version.taskCandidates,
        createdAt: record.version.createdAt.toISOString(),
      },
    };
  }

  private rethrowDraftError(error: unknown, write: boolean): never {
    if (error instanceof FollowupDraftConflictError) {
      if (write) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: '草案状态已变化或无权访问，请刷新后重试',
        });
      }
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: '无权访问当前工作区',
      });
    }
    throw error;
  }
}

export { FollowupDraftController };
