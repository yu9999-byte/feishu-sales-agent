import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
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
  PlaybookOptimizationCandidateListResponse,
  PlaybookOptimizationReviewDecision,
  PlaybookOptimizationReviewRequest,
  PlaybookOptimizationReviewResponse,
} from '@shared/api.interface';
import { PlatformAccessDeniedError } from
  '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from
  '@server/modules/platform-shell/platform-shell.service';
import { readSessionCookie } from
  '@server/modules/web-auth/feishu-web-auth.controller';
import {
  FeishuWebAuthError,
  FeishuWebAuthService,
} from '@server/modules/web-auth/feishu-web-auth.service';
import type { AuthenticatedWebSession } from
  '@server/modules/web-auth/web-auth.ports';
import {
  PlaybookOptimizationError,
  PlaybookOptimizationService,
} from './playbook-optimization.service';

const VALID_DECISIONS: PlaybookOptimizationReviewDecision[] = [
  'accept_for_authoring',
  'dismiss',
];

@Controller('api/platform/playbook-candidates')
class PlaybookOptimizationController {
  constructor(
    private readonly auth: FeishuWebAuthService,
    private readonly shell: PlatformShellService,
    private readonly optimization: PlaybookOptimizationService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Req() request: Request,
    @Query('limit') rawLimit?: string,
  ): Promise<PlaybookOptimizationCandidateListResponse> {
    const session: AuthenticatedWebSession =
      await this.authorizedSession(request);
    const limit: number | undefined = rawLimit === undefined
      ? undefined
      : Number(rawLimit);
    try {
      return await this.optimization.list(session.tenantId, limit);
    } catch (error: unknown) {
      this.rethrow(error);
    }
  }

  @Post(':candidateId/review')
  @Header('Cache-Control', 'no-store')
  async review(
    @Req() request: Request,
    @Param('candidateId') candidateId: string,
    @Body() body: unknown,
  ): Promise<PlaybookOptimizationReviewResponse> {
    const session: AuthenticatedWebSession =
      await this.authorizedSession(request);
    const input: PlaybookOptimizationReviewRequest = this.parseReview(body);
    try {
      return await this.optimization.review({
        ...input,
        tenantId: session.tenantId,
        candidateId,
        reviewerMemberId: session.member.id,
      });
    } catch (error: unknown) {
      this.rethrow(error);
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
        message: '无权访问知识优化候选',
      });
    }
    try {
      await this.shell.assertPermission(session, 'playbook:review');
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: '只有知识审核角色可以处理优化候选',
        });
      }
      throw error;
    }
    return session;
  }

  private parseReview(body: unknown): PlaybookOptimizationReviewRequest {
    if (typeof body !== 'object' || body === null) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '审核参数格式无效',
      });
    }
    const value = body as Record<string, unknown>;
    if (
      typeof value.decision !== 'string' ||
      !VALID_DECISIONS.includes(
        value.decision as PlaybookOptimizationReviewDecision,
      ) ||
      typeof value.expectedUpdatedAt !== 'string' ||
      typeof value.note !== 'string'
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '审核参数不完整',
      });
    }
    return {
      decision: value.decision as PlaybookOptimizationReviewDecision,
      expectedUpdatedAt: value.expectedUpdatedAt,
      note: value.note,
    };
  }

  private rethrow(error: unknown): never {
    if (!(error instanceof PlaybookOptimizationError)) throw error;
    const response = {
      code: error.code,
      message: error.message,
      currentUpdatedAt: error.currentUpdatedAt,
    };
    if (error.code === 'VALIDATION_FAILED') {
      throw new UnprocessableEntityException(response);
    }
    if (error.code === 'NOT_FOUND') throw new NotFoundException(response);
    if (error.code === 'CONFLICT') throw new ConflictException(response);
    throw new ServiceUnavailableException(response);
  }
}

export { PlaybookOptimizationController };
