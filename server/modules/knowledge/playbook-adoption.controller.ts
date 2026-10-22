import {
  Body, ConflictException, Controller, ForbiddenException, Get, Header, Inject, NotFoundException,
  Param, Post, Query, Req, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PlaybookAdoptionEvent, PlaybookAdoptionResponse, RecordPlaybookAdoptionRequest } from '@shared/api.interface';
import { PlatformAccessDeniedError } from '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from '@server/modules/platform-shell/platform-shell.service';
import { readSessionCookie } from '@server/modules/web-auth/feishu-web-auth.controller';
import { FeishuWebAuthError, FeishuWebAuthService } from '@server/modules/web-auth/feishu-web-auth.service';
import type { AuthenticatedWebSession } from '@server/modules/web-auth/web-auth.ports';
import { PlaybookAdoptionError, PlaybookAdoptionService } from './playbook-adoption.service';

@Controller('api/platform')
class PlaybookAdoptionController {
  constructor(
    @Inject(FeishuWebAuthService) private readonly auth: FeishuWebAuthService,
    @Inject(PlatformShellService) private readonly shell: PlatformShellService,
    @Inject(PlaybookAdoptionService) private readonly adoption: PlaybookAdoptionService,
  ) {}

  @Get('playbook-candidates/:candidateId/adoption')
  @Header('Cache-Control', 'no-store')
  async list(@Req() request: Request, @Param('candidateId') candidateId: string,
    @Query('beforeSequence') before?: string): Promise<PlaybookAdoptionResponse> {
    const session = await this.authorizedSession(request, 'playbook:read');
    try { return await this.adoption.list(session.tenantId, candidateId, before); }
    catch (error: unknown) { this.rethrow(error); }
  }

  @Post('playbook-candidates/:candidateId/adoption')
  @Header('Cache-Control', 'no-store')
  async record(@Req() request: Request, @Param('candidateId') candidateId: string,
    @Body() body: unknown): Promise<PlaybookAdoptionEvent> {
    const session = await this.authorizedSession(request, 'playbook:adopt');
    const input = this.parse(body);
    try { return await this.adoption.record({ ...input, tenantId: session.tenantId, candidateId,
      actorMemberId: session.member.id, actorOpenId: session.member.feishuOpenId }); }
    catch (error: unknown) { this.rethrow(error); }
  }

  private parse(body: unknown): RecordPlaybookAdoptionRequest {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '采用参数格式无效' });
    }
    const value = body as Record<string, unknown>;
    if (typeof value.requestId !== 'string' || typeof value.expectedAdoptionSequence !== 'number' ||
      typeof value.publicationVersion !== 'number' || typeof value.publicationSequence !== 'number' ||
      typeof value.note !== 'string' || (value.action !== 'record' && value.action !== 'retract')) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '请填写完整的采用操作和说明' });
    }
    if (value.action === 'retract' && value.evidence !== null) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '撤回采用不应携带业务证据' });
    }
    if (value.action === 'record' && (typeof value.evidence !== 'object' || value.evidence === null || Array.isArray(value.evidence))) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '采用记录必须携带业务证据' });
    }
    return { requestId: value.requestId, expectedAdoptionSequence: value.expectedAdoptionSequence,
      publicationVersion: value.publicationVersion, publicationSequence: value.publicationSequence,
      action: value.action, evidence: value.evidence as RecordPlaybookAdoptionRequest['evidence'], note: value.note };
  }

  private async authorizedSession(request: Request, permission: 'playbook:read' | 'playbook:adopt'):
  Promise<AuthenticatedWebSession> {
    const token = readSessionCookie(request);
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
      if (error instanceof PlatformAccessDeniedError) throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权访问此 Playbook 操作' });
      throw error;
    }
    return session;
  }

  private rethrow(error: unknown): never {
    if (!(error instanceof PlaybookAdoptionError)) throw error;
    const response = { code: error.code, message: error.message };
    if (error.code === 'NOT_FOUND') throw new NotFoundException(response);
    if (error.code === 'CONFLICT') throw new ConflictException(response);
    if (error.code === 'VALIDATION_FAILED') throw new UnprocessableEntityException(response);
    throw new ServiceUnavailableException(response);
  }
}
export { PlaybookAdoptionController };
