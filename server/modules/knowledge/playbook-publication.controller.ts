import {
  Body, ConflictException, Controller, ForbiddenException, Get, Header, Inject,
  NotFoundException, Param, Post, Query, Req, ServiceUnavailableException,
  UnauthorizedException, UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  PlaybookPublicationEvent, PlaybookPublicationResponse, PublishedPlaybook,
  PublishedPlaybookListResponse, RecordPlaybookPublicationRequest,
} from '@shared/api.interface';
import { PlatformAccessDeniedError } from '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from '@server/modules/platform-shell/platform-shell.service';
import { readSessionCookie } from '@server/modules/web-auth/feishu-web-auth.controller';
import { FeishuWebAuthError, FeishuWebAuthService } from '@server/modules/web-auth/feishu-web-auth.service';
import type { AuthenticatedWebSession } from '@server/modules/web-auth/web-auth.ports';
import { PlaybookPublicationError, PlaybookPublicationService } from './playbook-publication.service';

@Controller('api/platform')
class PlaybookPublicationController {
  constructor(
    @Inject(FeishuWebAuthService) private readonly auth: FeishuWebAuthService,
    @Inject(PlatformShellService) private readonly shell: PlatformShellService,
    @Inject(PlaybookPublicationService) private readonly publication: PlaybookPublicationService,
  ) {}

  @Get('playbook-candidates/:candidateId/publication')
  @Header('Cache-Control', 'no-store')
  async list(@Req() request: Request, @Param('candidateId') candidateId: string,
    @Query('beforeSequence') before?: string): Promise<PlaybookPublicationResponse> {
    const session = await this.authorizedSession(request, 'playbook:review');
    try { return await this.publication.list(session.tenantId, candidateId, before); }
    catch (error: unknown) { this.rethrow(error); }
  }

  @Post('playbook-candidates/:candidateId/publication')
  @Header('Cache-Control', 'no-store')
  async record(@Req() request: Request, @Param('candidateId') candidateId: string,
    @Body() body: unknown): Promise<PlaybookPublicationEvent> {
    const session = await this.authorizedSession(request, 'playbook:publish');
    const input: RecordPlaybookPublicationRequest = this.parse(body);
    try { return await this.publication.record({ ...input, tenantId: session.tenantId,
      candidateId, actorMemberId: session.member.id }); }
    catch (error: unknown) { this.rethrow(error); }
  }

  @Get('playbooks')
  @Header('Cache-Control', 'no-store')
  async catalog(@Req() request: Request, @Query('afterCandidateId') after?: string): Promise<PublishedPlaybookListResponse> {
    const session = await this.authorizedSession(request, 'playbook:read');
    try { return await this.publication.listPublished(session.tenantId, after); }
    catch (error: unknown) { this.rethrow(error); }
  }

  @Get('playbooks/:candidateId')
  @Header('Cache-Control', 'no-store')
  async published(@Req() request: Request, @Param('candidateId') candidateId: string): Promise<PublishedPlaybook> {
    const session = await this.authorizedSession(request, 'playbook:read');
    try { return await this.publication.getPublished(session.tenantId, candidateId); }
    catch (error: unknown) { this.rethrow(error); }
  }

  private parse(body: unknown): RecordPlaybookPublicationRequest {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '发布参数格式无效' });
    }
    const value = body as Record<string, unknown>;
    if (typeof value.requestId !== 'string' || typeof value.expectedVersion !== 'number' ||
      typeof value.expectedPublicationSequence !== 'number' || typeof value.note !== 'string' ||
      (value.action !== 'publish' && value.action !== 'withdraw') ||
      (value.action === 'publish' ? typeof value.expectedReviewSequence !== 'number' : value.expectedReviewSequence !== null)) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '请填写完整的发布操作和说明' });
    }
    const base = { requestId: value.requestId, expectedVersion: value.expectedVersion,
      expectedPublicationSequence: value.expectedPublicationSequence, note: value.note };
    return value.action === 'publish' ? { ...base, action: 'publish', expectedReviewSequence: value.expectedReviewSequence as number }
      : { ...base, action: 'withdraw', expectedReviewSequence: null };
  }

  private async authorizedSession(request: Request, permission: 'playbook:review' | 'playbook:publish' | 'playbook:read'):
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
        throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权访问此 Playbook 操作' });
      }
      throw error;
    }
    return session;
  }

  private rethrow(error: unknown): never {
    if (!(error instanceof PlaybookPublicationError)) throw error;
    const response = { code: error.code, message: error.message };
    if (error.code === 'NOT_FOUND') throw new NotFoundException(response);
    if (error.code === 'CONFLICT') throw new ConflictException(response);
    if (error.code === 'VALIDATION_FAILED') throw new UnprocessableEntityException(response);
    throw new ServiceUnavailableException(response);
  }
}
export { PlaybookPublicationController };
