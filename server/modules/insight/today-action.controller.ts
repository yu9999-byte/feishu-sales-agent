import { randomUUID } from 'node:crypto';
import { todayTaskActionId } from './today-task-action-id';
import { FollowupDraftWorkflowService } from '@server/modules/sales-behavior/followup-draft-workflow.service';
import { AgentActionExecutorService } from '@server/modules/agent-core/agent-action-executor.service';
import { PostgresTodayActionStateStore } from './postgres-today-action-state.store';
import {
  BadRequestException,
  Body,
  Post,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Optional,
  Param,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import type {
  TodayActionResponse,
  TodayActionDraftRequest,
  TodayActionDraftResponse,
  TodayActionOperationRequest,
  TodayActionState,
  PlatformSessionResponse,
  TodayActionTaskDraftRequest,
  TodayActionTaskDraftResponse,
  TodayActionTaskConfirmResponse,
  TodayActionTaskStatusResponse,
} from '@shared/api.interface';
import {
  CONTROL_STORE,
  type ControlStore,
} from '@server/modules/agent-core/agent.ports';
import type { PendingAction, TenantIntegration } from
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
import { TodayActionService } from './today-action.service';

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

@Controller('api/platform')
class TodayActionController {
  constructor(
    private readonly auth: FeishuWebAuthService,
    private readonly shell: PlatformShellService,
    private readonly sessions: PlatformSessionService,
    private readonly decisions: TodayActionService,
    @Inject(CONTROL_STORE)
    private readonly controlStore: ControlStore,
    @Optional() private readonly actionStates?: PostgresTodayActionStateStore,
    @Optional() private readonly followupDrafts?: FollowupDraftWorkflowService,
    @Optional() private readonly executor?: AgentActionExecutorService,
  ) {}

  @Get('today-actions')
  async getTodayActions(
    @Req() request: Request,
    @Query('date') requestedDate?: string,
  ): Promise<TodayActionResponse> {
    const session: AuthenticatedWebSession =
      await this.authenticatedSession(request);
    let platformSession: PlatformSessionResponse;
    try {
      await this.shell.assertPermission(session, 'opportunity:read');
      await this.shell.assertPermission(session, 'customer:read');
      await this.shell.assertPermission(session, 'task:read');
      platformSession = await this.sessions.getSessionByMembership(
        session.tenantId,
        session.member.id,
      );
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: '无权读取今日行动中心',
        });
      }
      throw error;
    }

    const integration: TenantIntegration | null =
      await this.controlStore.resolveTenantById(session.tenantId);
    if (
      integration === null ||
      integration.status !== 'active' ||
      integration.tenantId !== session.tenantId
    ) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: '今日行动数据源暂时不可用',
      });
    }
    const referenceDate: string = requestedDate?.trim() ||
      formatLocalDate(new Date(), platformSession.tenant.timezone);
    const parsedDate: Date = new Date(`${referenceDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(referenceDate) ||
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== referenceDate) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '日期格式或日期无效' });
    }
    const response: TodayActionResponse = await this.decisions.analyze({
      integration,
      actorOpenId: session.member.feishuOpenId,
      referenceDate,
      timezone: platformSession.tenant.timezone,
    });
    if (this.actionStates) {
      for (const item of response.items) {
        const saved = await this.actionStates.read({ tenantId: session.tenantId,
          memberId: session.member.id, actorOpenId: session.member.feishuOpenId }, item.id, item.version);
        if (saved) item.state = saved;
      }
    }
    return response;
  }

  @Post('today-actions/operations')
  async operate(
    @Req() request: Request,
    @Body() input: TodayActionOperationRequest,
  ): Promise<TodayActionState> {
    if (request.headers.origin !== this.auth.publicOrigin) {
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权执行此操作' });
    }
    const session: AuthenticatedWebSession = await this.authenticatedSession(request);
    if (!input || typeof input.itemId !== 'string' || typeof input.itemVersion !== 'string' ||
      typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      !['resolve', 'snooze'].includes(input.operation) ||
      (input.remindAt !== undefined && typeof input.remindAt !== 'string')) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '操作参数无效或需要进入确认流程' });
    }
    const visible: TodayActionResponse = await this.getTodayActions(request);
    if (!visible.items.some((item): boolean => item.id === input.itemId && item.version === input.itemVersion)) {
      throw new ConflictException({ code: 'CONFLICT', message: '事项已变化，请刷新后重试' });
    }
    if (!this.actionStates) throw new ServiceUnavailableException('行动状态服务不可用');
    try {
      return await this.actionStates.apply({ tenantId: session.tenantId,
        memberId: session.member.id, actorOpenId: session.member.feishuOpenId }, input, new Date());
    } catch (error: unknown) {
      const code: string = error instanceof Error ? error.message : '';
      if (code === 'ACTION_CONFLICT' || code === 'IDEMPOTENCY_CONFLICT') {
        throw new ConflictException({ code: 'CONFLICT', message: '事项已处理或请求发生变化，请刷新' });
      }
      if (code.startsWith('INVALID_')) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '提醒时间或操作参数无效' });
      }
      throw error;
    }
  }

  @Post('today-actions/followup-drafts')
  async createFollowup(
    @Req() request: Request,
    @Body() input: TodayActionDraftRequest,
  ): Promise<TodayActionDraftResponse> {
    if (request.headers.origin !== this.auth.publicOrigin) throw new ForbiddenException('无权执行此操作');
    const session: AuthenticatedWebSession = await this.authenticatedSession(request);
    try {
      await this.shell.assertPermission(session, 'followup:create-own');
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权创建跟进草案' });
      }
      throw error;
    }
    if (!input || typeof input.itemId !== 'string' || !input.itemId.trim() ||
      input.itemId.length > 512 || typeof input.itemVersion !== 'string' ||
      !input.itemVersion.trim() || input.itemVersion.length > 128 ||
      typeof input.communicationText !== 'string' || !input.communicationText.trim() ||
      input.communicationText.length > 20000 || typeof input.idempotencyKey !== 'string' ||
      !input.idempotencyKey.trim()) throw new BadRequestException('请填写真实沟通内容');
    const visible: TodayActionResponse = await this.getTodayActions(request);
    const item = visible.items.find((candidate): boolean => candidate.id === input.itemId && candidate.version === input.itemVersion);
    if (!item) throw new ConflictException('事项已变化，请刷新');
    if (!this.followupDrafts) throw new ServiceUnavailableException('草案服务不可用');
    const draft = await this.followupDrafts.create({ tenantId: session.tenantId,
      ownerMemberId: session.member.id, ownerOpenId: session.member.feishuOpenId,
      sourceType: 'text', text: input.communicationText,
      idempotencyKey: `today:${item.id}:${item.version}:${input.idempotencyKey}`,
      timezone: visible.timezone, now: new Date() });
    return { draftId: draft.id, requiresConfirmation: true };
  }

  @Post('today-actions/task-drafts')
  async createTaskDraft(
    @Req() request: Request,
    @Body() input: TodayActionTaskDraftRequest,
  ): Promise<TodayActionTaskDraftResponse> {
    this.assertSameOrigin(request);
    const session: AuthenticatedWebSession = await this.authenticatedSession(request);
    try {
      await this.shell.assertPermission(session, 'task:assign');
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权创建任务草案' });
      }
      throw error;
    }
    if (!input || typeof input.itemId !== 'string' || !input.itemId.trim() ||
      typeof input.itemVersion !== 'string' || !input.itemVersion.trim() ||
      typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() ||
      typeof input.title !== 'string' || !input.title.trim() || input.title.length > 3000 ||
      typeof input.dueAt !== 'string' || !Number.isFinite(Date.parse(input.dueAt)) ||
      (input.participants !== undefined && (!Array.isArray(input.participants) ||
        input.participants.some((value: unknown): boolean => typeof value !== 'string'))) ||
      (input.channel !== undefined && typeof input.channel !== 'string')) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '任务草案参数无效' });
    }
    const visible: TodayActionResponse = await this.getTodayActions(request);
    const item = visible.items.find((candidate): boolean =>
      candidate.id === input.itemId && candidate.version === input.itemVersion);
    if (!item) throw new ConflictException({ code: 'CONFLICT', message: '事项已变化，请刷新' });
    if (!this.executor) throw new ServiceUnavailableException('任务执行服务不可用');
    const actionId: string = todayTaskActionId(session.tenantId,
      session.member.id, item.id, item.version, input.idempotencyKey);
    const existing: PendingAction | null = await this.controlStore.getPendingAction(
      session.tenantId, actionId,
    );
    if (existing && existing.actorOpenId !== session.member.feishuOpenId) {
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权访问任务草案' });
    }
    const action: PendingAction = existing ?? await this.controlStore.createPendingAction({
      id: actionId,
      tenantId: session.tenantId,
      actorOpenId: session.member.feishuOpenId,
      chatId: `web:${session.member.id}`,
      payload: {
        version: 1,
        actionKind: 'task',
        sourceMessageId: `today-action:${item.id}:${item.version}`,
        rawText: item.suggestedAction,
        draft: {
          customerName: null, contactName: null, opportunityName: null,
          summary: item.reason, customerNeeds: [], objections: [], risks: [],
          progress: null, expectedAmount: null, nextAction: input.title,
          dueAt: input.dueAt, evidenceQuotes: [], nextActionChannel: input.channel ?? null,
          nextActionParticipants: input.participants ?? [],
        },
      },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    if (action.actorOpenId !== session.member.feishuOpenId || action.payload.actionKind !== 'task') {
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权访问任务草案' });
    }
    const draft = action.payload.draft;
    if (draft.nextAction !== input.title || draft.dueAt !== input.dueAt ||
      (draft.nextActionChannel ?? null) !== (input.channel ?? null) ||
      JSON.stringify(draft.nextActionParticipants ?? []) !== JSON.stringify(input.participants ?? [])) {
      throw new ConflictException({ code: 'CONFLICT', message: '此请求已用于不同任务内容，请重新提交' });
    }
    return { actionId: action.id, title: action.payload.draft.nextAction ?? input.title,
      dueAt: action.payload.draft.dueAt ?? input.dueAt, requiresConfirmation: true,
      status: action.status === 'pendingConfirmation' || action.status === 'failed' ||
        action.status === 'partialFailure' ? action.status : 'pendingConfirmation' };
  }

  @Get('today-actions/task-drafts/:id')
  async getTaskStatus(
    @Req() request: Request,
    @Param('id') actionId: string,
  ): Promise<TodayActionTaskStatusResponse> {
    const session = await this.authenticatedSession(request);
    await this.shell.assertPermission(session, 'task:read');
    const action = await this.controlStore.getPendingAction(session.tenantId, actionId);
    if (!action || action.actorOpenId !== session.member.feishuOpenId ||
      action.payload.actionKind !== 'task') {
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权查看任务执行结果' });
    }
    return { actionId: action.id, status: action.status,
      title: action.payload.draft.nextAction ?? undefined, dueAt: action.payload.draft.dueAt ?? undefined,
      taskGuid: action.result.taskGuid,
      taskUrl: action.result.taskUrl, errorMessage: action.result.errorMessage };
  }

  @Post('today-actions/task-drafts/:id/confirm')
  async confirmTaskDraft(
    @Req() request: Request,
    @Body() body: { expectedVersion?: number },
    @Param('id') actionId: string,
  ): Promise<TodayActionTaskConfirmResponse> {
    this.assertSameOrigin(request);
    const session: AuthenticatedWebSession = await this.authenticatedSession(request);
    await this.shell.assertPermission(session, 'task:assign');
    if (!body || body.expectedVersion !== undefined && body.expectedVersion !== 1) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: '确认版本无效' });
    }
    const action: PendingAction | null = await this.controlStore.getPendingAction(
      session.tenantId, actionId,
    );
    if (!action || action.actorOpenId !== session.member.feishuOpenId ||
      action.payload.actionKind !== 'task') {
      throw new ConflictException({ code: 'CONFLICT', message: '任务草案不存在或已变化' });
    }
    if (action.status === 'succeeded' || action.status === 'executing') {
      return { actionId: action.id, status: action.status,
        taskGuid: action.result.taskGuid, taskUrl: action.result.taskUrl };
    }
    if (!['pendingConfirmation', 'failed', 'partialFailure'].includes(action.status)) {
      throw new ConflictException({ code: 'CONFLICT', message: '任务草案已取消或过期，请重新创建' });
    }
    const integration: TenantIntegration | null = await this.controlStore.resolveTenantById(
      session.tenantId,
    );
    if (!integration || integration.status !== 'active') {
      throw new ServiceUnavailableException({ code: 'DEPENDENCY_UNAVAILABLE', message: '企业任务连接不可用' });
    }
    if (!this.executor) throw new ServiceUnavailableException('任务执行服务不可用');
    const acquired: PendingAction | null = await this.controlStore.acquirePendingAction(
      session.tenantId, action.id, session.member.feishuOpenId,
      ['pendingConfirmation', 'failed', 'partialFailure'], new Date(),
    );
    if (!acquired) {
      const latest: PendingAction | null = await this.controlStore.getPendingAction(
        session.tenantId, action.id,
      );
      if (!latest) throw new ConflictException({ code: 'CONFLICT', message: '任务草案状态已变化' });
      if (!['succeeded', 'executing', 'failed', 'partialFailure'].includes(latest.status)) {
        throw new ConflictException({ code: 'CONFLICT', message: '任务草案状态已变化，请刷新' });
      }
      return { actionId: latest.id, status: latest.status === 'succeeded' ? 'succeeded' :
        latest.status === 'executing' ? 'executing' : latest.status === 'failed' ? 'failed' : 'partialFailure',
        taskGuid: latest.result.taskGuid, taskUrl: latest.result.taskUrl };
    }
    this.executor.schedule(integration, acquired, null, randomUUID());
    return { actionId: acquired.id, status: 'executing' };
  }

  private assertSameOrigin(request: Request): void {
    if (request.headers.origin !== this.auth.publicOrigin) {
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权执行此操作' });
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

export { TodayActionController };








