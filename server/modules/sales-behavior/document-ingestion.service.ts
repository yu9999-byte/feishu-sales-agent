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
  normalizeDocumentContent,
  type DocumentContentSegment,
} from './document-content.normalizer';
import {
  DocumentReferenceError,
  findDocumentReference,
  type DocumentReference,
  type DocumentReferenceType,
} from './document-reference';

interface DocumentContentGateway {
  readDocument(input: {
    integration: TenantIntegration;
    reference: DocumentReference;
    accessToken: string;
  }): Promise<{
    title: string;
    revisionId: number;
    rawContent: string;
  }>;
}

type DocumentContentGatewayErrorCode =
  | 'ACCESS_DENIED'
  | 'UNSUPPORTED_TYPE'
  | 'UNAVAILABLE';

class DocumentContentGatewayError extends Error {
  constructor(readonly code: DocumentContentGatewayErrorCode) {
    super(`Document content gateway failed: ${code}`);
    this.name = 'DocumentContentGatewayError';
  }
}

interface DocumentIngestionResult {
  sourceType: 'document';
  referenceType: DocumentReferenceType;
  sourceRefHash: string;
  title: string;
  revisionId: number;
  normalizedText: string;
  segments: DocumentContentSegment[];
  segmentCount: number;
  truncated: boolean;
}

type DocumentIngestionErrorCode =
  | 'DOCUMENT_INVALID_REFERENCE'
  | 'DOCUMENT_MULTIPLE_REFERENCES'
  | 'DOCUMENT_AUTHORIZATION_REQUIRED'
  | 'DOCUMENT_ACCESS_DENIED'
  | 'DOCUMENT_UNSUPPORTED_TYPE'
  | 'DOCUMENT_CONTENT_EMPTY'
  | 'DOCUMENT_DEPENDENCY_UNAVAILABLE';

class DocumentIngestionError extends Error {
  constructor(
    readonly code: DocumentIngestionErrorCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentIngestionError';
  }
}

const DOCUMENT_CONTENT_GATEWAY = Symbol('DOCUMENT_CONTENT_GATEWAY');
const DOCX_SCOPE: string = 'docx:document:readonly';
const WIKI_NODE_SCOPE: string = 'wiki:node:read';

@Injectable()
class DocumentIngestionService {
  constructor(
    private readonly sessions: PlatformSessionService,
    @Inject(FEISHU_USER_TOKEN_PROVIDER)
    private readonly tokens: FeishuUserTokenProvider,
    @Inject(DOCUMENT_CONTENT_GATEWAY)
    private readonly gateway: DocumentContentGateway,
  ) {}

  async ingest(input: {
    integration: TenantIntegration;
    actorOpenId: string;
    sourceText: string;
    now: Date;
  }): Promise<DocumentIngestionResult> {
    const reference: DocumentReference = this.parseReference(
      input.sourceText,
    );
    const session: PlatformSessionResponse = await this.authorizeMember(input);
    const requiredScopes: readonly string[] = reference.referenceType === 'wiki'
      ? [WIKI_NODE_SCOPE, DOCX_SCOPE]
      : [DOCX_SCOPE];
    const accessToken: string = await this.getAccessToken(
      input,
      session.member.id,
      requiredScopes,
    );
    const source = await this.readSource(input, reference, accessToken);
    const normalized = normalizeDocumentContent(source.rawContent);
    if (normalized.segments.length === 0) {
      throw new DocumentIngestionError(
        'DOCUMENT_CONTENT_EMPTY',
        false,
        '当前文档没有可用正文',
      );
    }
    return {
      sourceType: 'document',
      referenceType: reference.referenceType,
      sourceRefHash: createHash('sha256')
        .update(input.integration.tenantId, 'utf8')
        .update('\0', 'utf8')
        .update(reference.referenceType, 'utf8')
        .update('\0', 'utf8')
        .update(reference.token, 'utf8')
        .digest('hex'),
      title: source.title.trim() || '飞书文档',
      revisionId: source.revisionId,
      normalizedText: normalized.normalizedText,
      segments: normalized.segments,
      segmentCount: normalized.segments.length,
      truncated: normalized.truncated,
    };
  }

  private parseReference(sourceText: string): DocumentReference {
    try {
      const reference: DocumentReference | null =
        findDocumentReference(sourceText);
      if (reference !== null) return reference;
    } catch (error: unknown) {
      if (error instanceof DocumentReferenceError) {
        throw new DocumentIngestionError(
          error.code,
          false,
          error.message,
        );
      }
      throw error;
    }
    throw new DocumentIngestionError(
      'DOCUMENT_INVALID_REFERENCE',
      false,
      '未找到可用的飞书文档链接',
    );
  }

  private async authorizeMember(input: {
    integration: TenantIntegration;
    actorOpenId: string;
    now: Date;
  }): Promise<PlatformSessionResponse> {
    let session: PlatformSessionResponse;
    try {
      session = await this.sessions.getSession({
        feishuTenantKey: input.integration.feishuTenantKey,
        feishuOpenId: input.actorOpenId,
      }, input.now);
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new DocumentIngestionError(
          'DOCUMENT_ACCESS_DENIED',
          false,
          '无法读取这份飞书文档',
        );
      }
      throw error;
    }
    if (
      session.tenant.id !== input.integration.tenantId ||
      session.member.feishuOpenId !== input.actorOpenId ||
      !session.permissions.includes('followup:create-own')
    ) {
      throw new DocumentIngestionError(
        'DOCUMENT_ACCESS_DENIED',
        false,
        '无法读取这份飞书文档',
      );
    }
    return session;
  }

  private async getAccessToken(
    input: {
      integration: TenantIntegration;
      now: Date;
    },
    memberId: string,
    requiredScopes: readonly string[],
  ): Promise<string> {
    try {
      const token: string | null = await this.tokens.getValidAccessToken(
        input.integration,
        memberId,
        input.now,
        requiredScopes,
      );
      if (token !== null) return token;
    } catch (error: unknown) {
      if (error instanceof FeishuUserTokenError) {
        throw new DocumentIngestionError(
          error.code === 'AUTHORIZATION_REQUIRED'
            ? 'DOCUMENT_AUTHORIZATION_REQUIRED'
            : 'DOCUMENT_DEPENDENCY_UNAVAILABLE',
          error.code !== 'AUTHORIZATION_REQUIRED',
          '飞书用户授权不可用',
        );
      }
      throw error;
    }
    throw new DocumentIngestionError(
      'DOCUMENT_AUTHORIZATION_REQUIRED',
      false,
      '飞书用户授权尚未完成',
    );
  }

  private async readSource(
    input: { integration: TenantIntegration },
    reference: DocumentReference,
    accessToken: string,
  ): Promise<{ title: string; revisionId: number; rawContent: string }> {
    try {
      return await this.gateway.readDocument({
        integration: input.integration,
        reference,
        accessToken,
      });
    } catch (error: unknown) {
      if (error instanceof DocumentContentGatewayError) {
        if (error.code === 'ACCESS_DENIED') {
          throw new DocumentIngestionError(
            'DOCUMENT_ACCESS_DENIED',
            false,
            '无法读取这份飞书文档',
          );
        }
        if (error.code === 'UNSUPPORTED_TYPE') {
          throw new DocumentIngestionError(
            'DOCUMENT_UNSUPPORTED_TYPE',
            false,
            '当前 Wiki 节点不是飞书文档',
          );
        }
      }
      throw new DocumentIngestionError(
        'DOCUMENT_DEPENDENCY_UNAVAILABLE',
        true,
        '飞书文档读取暂时不可用',
      );
    }
  }
}

export {
  DOCUMENT_CONTENT_GATEWAY,
  DocumentContentGatewayError,
  DocumentIngestionError,
  DocumentIngestionService,
};
export type {
  DocumentContentGateway,
  DocumentContentGatewayErrorCode,
  DocumentIngestionErrorCode,
  DocumentIngestionResult,
};
