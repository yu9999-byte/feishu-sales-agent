import { Body, ConflictException, Controller, ForbiddenException, Get, Header, Inject, NotFoundException,
  Param, Post, Query, Req, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import type { Request } from 'express';
import type { RecordTaskPromiseEvidenceRequest, TaskPromiseEvidenceEvent, TaskPromiseEvidenceResponse } from '@shared/api.interface';
import { PlatformAccessDeniedError } from '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from '@server/modules/platform-shell/platform-shell.service';
import { readSessionCookie } from '@server/modules/web-auth/feishu-web-auth.controller';
import { FeishuWebAuthError, FeishuWebAuthService } from '@server/modules/web-auth/feishu-web-auth.service';
import type { AuthenticatedWebSession } from '@server/modules/web-auth/web-auth.ports';
import { TaskPromiseEvidenceError, TaskPromiseEvidenceService } from './task-promise-evidence.service';

@Controller('api/platform/task-promises/:actionId/evidence')
class TaskPromiseEvidenceController {
  constructor(@Inject(FeishuWebAuthService) private readonly auth: FeishuWebAuthService,
    @Inject(PlatformShellService) private readonly shell: PlatformShellService,
    @Inject(TaskPromiseEvidenceService) private readonly evidence: TaskPromiseEvidenceService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Req() request: Request, @Param('actionId') actionId: string,
    @Query('beforeRevision') before?: string): Promise<TaskPromiseEvidenceResponse> {
    const session: AuthenticatedWebSession = await this.authorize(request, false);
    try { return await this.evidence.list({ tenantId: session.tenantId, actionId,
      actorOpenId: session.member.feishuOpenId }, before); }
    catch (error: unknown) { this.rethrow(error); }
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async record(@Req() request: Request, @Param('actionId') actionId: string,
    @Body() body: unknown): Promise<TaskPromiseEvidenceEvent> {
    const session: AuthenticatedWebSession = await this.authorize(request, true);
    const input: RecordTaskPromiseEvidenceRequest = this.parseBody(body);
    try { return await this.evidence.record({ ...input, tenantId: session.tenantId, actionId,
      actorOpenId: session.member.feishuOpenId, actorMemberId: session.member.id }); }
    catch (error: unknown) { this.rethrow(error); }
  }

  private parseBody(body: unknown): RecordTaskPromiseEvidenceRequest {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '凭证参数格式无效' });
    }
    const value = body as Record<string, unknown>;
    if (typeof value.requestId !== 'string' || typeof value.expectedRevision !== 'number' ||
      typeof value.note !== 'string' || (value.evidenceUrl !== null && typeof value.evidenceUrl !== 'string') ||
      !['reported_fulfilled', 'reported_partial', 'retracted'].includes(String(value.state))) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '请填写完整的声明和凭证' });
    }
    return { requestId: value.requestId, expectedRevision: value.expectedRevision,
      state: value.state as RecordTaskPromiseEvidenceRequest['state'], note: value.note,
      evidenceUrl: value.evidenceUrl as string | null };
  }

  private async authorize(request: Request, write: boolean): Promise<AuthenticatedWebSession> {
    const token: string | null = readSessionCookie(request);
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '请先通过飞书登录' });
    let session: AuthenticatedWebSession;
    try { session = await this.auth.authenticateSession(token); }
    catch (error: unknown) {
      if (error instanceof FeishuWebAuthError && error.code === 'UNAUTHENTICATED') {
        throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '登录状态已失效' });
      }
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无法验证当前身份' });
    }
    try {
      await this.shell.assertPermission(session, 'task:read');
      if (write) await this.shell.assertPermission(session, 'followup:create-own');
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权执行此凭证操作' });
      }
      throw new ServiceUnavailableException({ code: 'UNAVAILABLE', message: '权限暂时无法验证' });
    }
    return session;
  }
  private rethrow(error: unknown): never {
    if (!(error instanceof TaskPromiseEvidenceError)) throw error;
    const response = { code: error.code, message: error.message };
    if (error.code === 'NOT_FOUND') throw new NotFoundException(response);
    if (error.code === 'CONFLICT') throw new ConflictException(response);
    if (error.code === 'VALIDATION_FAILED') throw new UnprocessableEntityException(response);
    throw new ServiceUnavailableException(response);
  }
}
export { TaskPromiseEvidenceController };
