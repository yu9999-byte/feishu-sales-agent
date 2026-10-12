import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { PlatformSessionResponse } from '@shared/api.interface';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import {
  PlatformAccessDeniedError,
  PlatformSessionService,
} from '@server/modules/platform-shell/platform-session.service';
import {
  FEISHU_USER_TOKEN_PROVIDER,
  FeishuUserTokenError,
  type FeishuUserTokenProvider,
} from '@server/modules/web-auth/feishu-user-token.service';
import {
  findMinutesReference,
  MinutesReferenceError,
} from './minutes-reference';
import {
  normalizeMinutesTranscript,
  type MinutesTranscriptSegment,
} from './minutes-transcript.normalizer';

interface MinutesTranscriptGateway {
  readTranscript(input: {
    integration: TenantIntegration;
    minuteToken: string;
    accessToken: string;
  }): Promise<{ title: string; transcript: string }>;
}

type MinutesTranscriptGatewayErrorCode = 'ACCESS_DENIED' | 'UNAVAILABLE';

class MinutesTranscriptGatewayError extends Error {
  constructor(readonly code: MinutesTranscriptGatewayErrorCode) {
    super(code === 'ACCESS_DENIED'
      ? 'Minutes transcript access denied'
      : 'Minutes transcript unavailable');
    this.name = 'MinutesTranscriptGatewayError';
  }
}

interface MinutesIngestionResult {
  sourceType: 'minutes';
  sourceRefHash: string;
  title: string;
  normalizedText: string;
  segments: MinutesTranscriptSegment[];
  segmentCount: number;
  truncated: boolean;
}

type MinutesIngestionErrorCode =
  | 'MINUTES_INVALID_REFERENCE'
  | 'MINUTES_AUTHORIZATION_REQUIRED'
  | 'MINUTES_ACCESS_DENIED'
  | 'MINUTES_TRANSCRIPT_EMPTY'
  | 'MINUTES_DEPENDENCY_UNAVAILABLE';

class MinutesIngestionError extends Error {
  constructor(
    readonly code: MinutesIngestionErrorCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'MinutesIngestionError';
  }
}

const MINUTES_TRANSCRIPT_GATEWAY = Symbol('MINUTES_TRANSCRIPT_GATEWAY');

@Injectable()
class MinutesIngestionService {
  constructor(
    private readonly sessions: PlatformSessionService,
    @Inject(FEISHU_USER_TOKEN_PROVIDER)
    private readonly tokens: FeishuUserTokenProvider,
    @Inject(MINUTES_TRANSCRIPT_GATEWAY)
    private readonly gateway: MinutesTranscriptGateway,
  ) {}

  async ingest(input: {
    integration: TenantIntegration;
    actorOpenId: string;
    sourceText: string;
    now: Date;
  }): Promise<MinutesIngestionResult> {
    let reference;
    try {
      reference = findMinutesReference(input.sourceText);
    } catch (error: unknown) {
      if (error instanceof MinutesReferenceError) {
        throw new MinutesIngestionError(
          'MINUTES_INVALID_REFERENCE',
          false,
          '妙记链接安全校验失败',
        );
      }
      throw error;
    }
    if (reference === null) {
      throw new MinutesIngestionError(
        'MINUTES_INVALID_REFERENCE',
        false,
        '未找到可用的妙记链接',
      );
    }

    let session: PlatformSessionResponse;
    try {
      session = await this.sessions.getSession(
        {
          feishuTenantKey: input.integration.feishuTenantKey,
          feishuOpenId: input.actorOpenId,
        },
        input.now,
      );
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new MinutesIngestionError(
          'MINUTES_ACCESS_DENIED',
          false,
          '无法读取这条妙记',
        );
      }
      throw error;
    }
    if (
      session.tenant.id !== input.integration.tenantId ||
      session.member.feishuOpenId !== input.actorOpenId ||
      !session.permissions.includes('followup:create-own')
    ) {
      throw new MinutesIngestionError(
        'MINUTES_ACCESS_DENIED',
        false,
        '无法读取这条妙记',
      );
    }

    let accessToken: string | null;
    try {
      accessToken = await this.tokens.getValidAccessToken(
        input.integration,
        session.member.id,
        input.now,
      );
    } catch (error: unknown) {
      if (error instanceof FeishuUserTokenError) {
        throw new MinutesIngestionError(
          error.code === 'AUTHORIZATION_REQUIRED'
            ? 'MINUTES_AUTHORIZATION_REQUIRED'
            : 'MINUTES_DEPENDENCY_UNAVAILABLE',
          error.code !== 'AUTHORIZATION_REQUIRED',
          '飞书用户授权不可用',
        );
      }
      throw error;
    }
    if (!accessToken) {
      throw new MinutesIngestionError(
        'MINUTES_AUTHORIZATION_REQUIRED',
        false,
        '飞书用户授权尚未完成',
      );
    }

    let source: { title: string; transcript: string };
    try {
      source = await this.gateway.readTranscript({
        integration: input.integration,
        minuteToken: reference.minuteToken,
        accessToken,
      });
    } catch (error: unknown) {
      if (
        error instanceof MinutesTranscriptGatewayError &&
        error.code === 'ACCESS_DENIED'
      ) {
        throw new MinutesIngestionError(
          'MINUTES_ACCESS_DENIED',
          false,
          '无法读取这条妙记',
        );
      }
      throw new MinutesIngestionError(
        'MINUTES_DEPENDENCY_UNAVAILABLE',
        true,
        '妙记读取暂时不可用',
      );
    }
    const normalized = normalizeMinutesTranscript(source.transcript);
    if (normalized.segments.length === 0) {
      throw new MinutesIngestionError(
        'MINUTES_TRANSCRIPT_EMPTY',
        false,
        '当前没有可用逐字稿',
      );
    }
    return {
      sourceType: 'minutes',
      sourceRefHash: createHash('sha256')
        .update(input.integration.tenantId, 'utf8')
        .update('\0', 'utf8')
        .update(reference.minuteToken, 'utf8')
        .digest('hex'),
      title: source.title.trim() || '飞书妙记',
      normalizedText: normalized.normalizedText,
      segments: normalized.segments,
      segmentCount: normalized.segments.length,
      truncated: normalized.truncated,
    };
  }
}

export {
  MINUTES_TRANSCRIPT_GATEWAY,
  MinutesIngestionError,
  MinutesIngestionService,
  MinutesTranscriptGatewayError,
};
export type {
  MinutesIngestionErrorCode,
  MinutesIngestionResult,
  MinutesTranscriptGateway,
  MinutesTranscriptGatewayErrorCode,
};
