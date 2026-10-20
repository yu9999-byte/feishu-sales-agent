import {
  Body, ConflictException, Controller, ForbiddenException, Get, Header, Inject,
  NotFoundException, Param, Post, Query, Req, ServiceUnavailableException,
  UnauthorizedException, UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  PlaybookDraftReviewEvent, PlaybookDraftReviewResponse, PlaybookDraftReviewAction,
  RecordPlaybookDraftReviewRequest,
} from '@shared/api.interface';
import { PlatformAccessDeniedError } from '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from '@server/modules/platform-shell/platform-shell.service';
import { readSessionCookie } from '@server/modules/web-auth/feishu-web-auth.controller';
import { FeishuWebAuthError, FeishuWebAuthService } from '@server/modules/web-auth/feishu-web-auth.service';
import type { AuthenticatedWebSession } from '@server/modules/web-auth/web-auth.ports';
import { PlaybookDraftReviewError, PlaybookDraftReviewService } from './playbook-draft-review.service';

const REVIEW_ACTIONS: readonly PlaybookDraftReviewAction[] = ['submit', 'approve', 'request_changes'];

@Controller('api/platform/playbook-candidates/:candidateId/draft/review')
class PlaybookDraftReviewController {
  constructor(
    @Inject(FeishuWebAuthService) private readonly auth: FeishuWebAuthService,
    @Inject(PlatformShellService) private readonly shell: PlatformShellService,
    @Inject(PlaybookDraftReviewService) private readonly review: PlaybookDraftReviewService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Req() request: Request, @Param('candidateId') candidateId: string,
    @Query('beforeSequence') rawBefore?: string): Promise<PlaybookDraftReviewResponse> {
    const session: AuthenticatedWebSession = await this.authorizedSession(request, 'playbook:review');
    try { return await this.review.list(session.tenantId, candidateId, rawBefore); }
    catch (error: unknown) { this.rethrow(error); }
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async record(@Req() request: Request, @Param('candidateId') candidateId: string,
    @Body() body: unknown): Promise<PlaybookDraftReviewEvent> {
    const input: RecordPlaybookDraftReviewRequest = this.parseBody(body);
    const permission = input.action === 'submit' ? 'playbook:review' : 'playbook:publish';
    const session: AuthenticatedWebSession = await this.authorizedSession(request, permission);
    try {
      return await this.review.record({ ...input, tenantId: session.tenantId,
        candidateId, actorMemberId: session.member.id });
    } catch (error: unknown) { this.rethrow(error); }
  }

  private parseBody(body: unknown): RecordPlaybookDraftReviewRequest {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '审核参数格式无效' });
    }
    const value: Record<string, unknown> = body as Record<string, unknown>;
    if (typeof value.requestId !== 'string' || typeof value.expectedVersion !== 'number' ||
      typeof value.expectedReviewSequence !== 'number' || typeof value.action !== 'string' ||
      typeof value.note !== 'string' || !REVIEW_ACTIONS.includes(value.action as PlaybookDraftReviewAction)) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '请填写完整的审核动作和说明' });
    }
    return {
      requestId: value.requestId,
      expectedVersion: value.expectedVersion,
      expectedReviewSequence: value.expectedReviewSequence,
      action: value.action as PlaybookDraftReviewAction,
      note: value.note,
    };
  }

  private async authorizedSession(request: Request, permission: 'playbook:review' | 'playbook:publish'):
  Promise<AuthenticatedWebSession> {
    const token: string | null = readSessionCookie(request);
    if (token === null) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '请先通过飞书登录' });
    let session: AuthenticatedWebSession;
    try { session = await this.auth.authenticateSession(token); }
    catch (error: unknown) {
      if (error instanceof FeishuWebAuthError && error.code === 'UNAUTHENTICATED') {
        throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '登录状态已失效' });
      }
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无法验证当前身份' });
    }
    try { await this.shell.assertPermission(session, permission); }
    catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权执行此 Playbook 审核动作' });
      }
      throw error;
    }
    return session;
  }

  private rethrow(error: unknown): never {
    if (!(error instanceof PlaybookDraftReviewError)) throw error;
    const response = { code: error.code, message: error.message };
    if (error.code === 'NOT_FOUND') throw new NotFoundException(response);
    if (error.code === 'CONFLICT') throw new ConflictException(response);
    if (error.code === 'VALIDATION_FAILED') throw new UnprocessableEntityException(response);
    throw new ServiceUnavailableException(response);
  }
}

export { PlaybookDraftReviewController };
