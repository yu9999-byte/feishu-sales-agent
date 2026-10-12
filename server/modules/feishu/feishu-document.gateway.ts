import { Injectable } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';

import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import {
  DocumentContentGatewayError,
  type DocumentContentGateway,
} from '@server/modules/sales-behavior/document-ingestion.service';
import type { DocumentReference } from
  '@server/modules/sales-behavior/document-reference';
import { FeishuClientFactory } from './feishu-client.factory';

@Injectable()
class FeishuDocumentGateway implements DocumentContentGateway {
  constructor(private readonly clients: FeishuClientFactory) {}

  async readDocument(input: {
    integration: TenantIntegration;
    reference: DocumentReference;
    accessToken: string;
  }): Promise<{ title: string; revisionId: number; rawContent: string }> {
    const client: lark.Client = this.clients.getClient(input.integration);
    const options = lark.withUserAccessToken(input.accessToken);
    try {
      const documentToken: string = input.reference.referenceType === 'wiki'
        ? await this.resolveWikiDocument(
          client,
          input.reference.token,
          options,
        )
        : input.reference.token;
      const metadata = await client.docx.v1.document.get(
        { path: { document_id: documentToken } },
        options,
      );
      this.assertSuccess(metadata.code);
      const title: string = metadata.data?.document?.title?.trim() ?? '';
      const revisionId: number | undefined =
        metadata.data?.document?.revision_id;
      if (revisionId === undefined) {
        throw new DocumentContentGatewayError('UNAVAILABLE');
      }
      const body = await client.docx.v1.document.rawContent(
        { path: { document_id: documentToken } },
        options,
      );
      this.assertSuccess(body.code);
      return {
        title,
        revisionId,
        rawContent: body.data?.content ?? '',
      };
    } catch (error: unknown) {
      if (error instanceof DocumentContentGatewayError) throw error;
      if (this.isAccessDenied(error)) {
        throw new DocumentContentGatewayError('ACCESS_DENIED');
      }
      throw new DocumentContentGatewayError('UNAVAILABLE');
    }
  }

  private async resolveWikiDocument(
    client: lark.Client,
    token: string,
    options: ReturnType<typeof lark.withUserAccessToken>,
  ): Promise<string> {
    const response = await client.wiki.v2.space.getNode(
      { params: { token } },
      options,
    );
    this.assertSuccess(response.code);
    const node = response.data?.node;
    if (node?.obj_type !== 'docx') {
      throw new DocumentContentGatewayError('UNSUPPORTED_TYPE');
    }
    const documentToken: string | undefined = node.obj_token?.trim();
    if (!documentToken) {
      throw new DocumentContentGatewayError('UNAVAILABLE');
    }
    return documentToken;
  }

  private assertSuccess(code: number | undefined): void {
    if (code === undefined || code === 0) return;
    throw new DocumentContentGatewayError(
      code === 99991679 ? 'ACCESS_DENIED' : 'UNAVAILABLE',
    );
  }

  private isAccessDenied(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const response: unknown = Reflect.get(error, 'response');
    if (typeof response !== 'object' || response === null) return false;
    const status: unknown = Reflect.get(response, 'status');
    if (status === 401 || status === 403 || status === 404) return true;
    const data: unknown = Reflect.get(response, 'data');
    if (typeof data !== 'object' || data === null) return false;
    return Reflect.get(data, 'code') === 99991679;
  }
}

export { FeishuDocumentGateway };
