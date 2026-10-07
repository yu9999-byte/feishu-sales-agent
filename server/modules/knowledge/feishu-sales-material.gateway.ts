import { Injectable, Logger } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';

import type {
  SalesMaterialSourceConfig,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import { FeishuClientFactory } from
  '@server/modules/feishu/feishu-client.factory';
import { assertFeishuSuccess } from
  '@server/modules/feishu/feishu-api.error';
import type {
  SalesMaterialDocument,
  SalesMaterialGateway,
  SalesMaterialReadResult,
} from './sales-material.ports';

const SAFE_UNAVAILABLE_WARNING = '资料来源暂时不可用';
const TENANT_READABLE_ENTITIES: Set<string> = new Set<string>([
  'tenant_readable',
  'tenant_editable',
]);

interface WikiNodeSnapshot {
  spaceId: string;
  objectToken: string;
  objectType: string;
  editedAt: string | null;
}

@Injectable()
class FeishuSalesMaterialGateway implements SalesMaterialGateway {
  private readonly logger: Logger = new Logger(
    FeishuSalesMaterialGateway.name,
  );

  constructor(private readonly clients: FeishuClientFactory) {}

  async readSource(
    integration: TenantIntegration,
    actorOpenId: string,
    source: SalesMaterialSourceConfig,
  ): Promise<SalesMaterialReadResult> {
    try {
      if (source.sourceType === 'docx') {
        return await this.readDocx(
          integration,
          actorOpenId,
          source,
          source.token,
          null,
        );
      }
      return await this.readWikiNode(integration, actorOpenId, source);
    } catch (error: unknown) {
      const errorType: string = error instanceof Error
        ? error.name
        : 'UnknownError';
      this.logger.warn(
        `Sales material source read failed and was withheld (${errorType})`,
      );
      return {
        sourceId: source.id,
        status: 'unavailable',
        warning: SAFE_UNAVAILABLE_WARNING,
      };
    }
  }

  private async readDocx(
    integration: TenantIntegration,
    actorOpenId: string,
    source: SalesMaterialSourceConfig,
    documentToken: string,
    wikiEditedAt: string | null,
    wikiSpaceId: string | null = null,
  ): Promise<SalesMaterialReadResult> {
    const client: lark.Client = this.clients.getClient(integration);
    const options: ReturnType<FeishuClientFactory['getRequestOptions']> =
      this.clients.getRequestOptions(integration);
    const accessAllowed: boolean = source.sourceType === 'wiki'
      ? await this.canReadWiki(client, options, actorOpenId, wikiSpaceId)
      : await this.canReadDocx(client, options, actorOpenId, documentToken);
    if (!accessAllowed) {
      return { sourceId: source.id, status: 'access_denied' };
    }

    const metadata = await client.docx.document.get({
      path: { document_id: documentToken },
    }, options);
    assertFeishuSuccess(
      metadata.code,
      metadata.msg,
      'read sales material metadata',
    );
    const document = metadata.data?.document;
    const title: string | undefined = document?.title?.trim();
    const revisionId: number | undefined = document?.revision_id;
    if (!title || revisionId === undefined) {
      throw new Error('Sales material metadata is incomplete');
    }

    const body = await client.docx.document.rawContent({
      path: { document_id: documentToken },
    }, options);
    assertFeishuSuccess(
      body.code,
      body.msg,
      'read sales material content',
    );
    const content: string | undefined = body.data?.content?.trim();
    if (!content) {
      throw new Error('Sales material content is empty');
    }

    const material: SalesMaterialDocument = {
      sourceId: source.id,
      sourceType: source.sourceType,
      title,
      url: source.url,
      content,
      sourceVersion: wikiEditedAt === null
        ? `revision:${String(revisionId)}`
        : `wiki-edit:${wikiEditedAt}`,
      applicability: source.applicability,
      keywords: [...source.keywords],
      categories: [...source.categories],
      accessVerified: true,
    };
    return {
      sourceId: source.id,
      status: 'ready',
      document: material,
    };
  }

  private async readWikiNode(
    integration: TenantIntegration,
    actorOpenId: string,
    source: SalesMaterialSourceConfig,
  ): Promise<SalesMaterialReadResult> {
    const client: lark.Client = this.clients.getClient(integration);
    const options: ReturnType<FeishuClientFactory['getRequestOptions']> =
      this.clients.getRequestOptions(integration);
    const response = await client.wiki.space.getNode({
      params: { token: source.token, obj_type: 'wiki' },
    }, options);
    assertFeishuSuccess(
      response.code,
      response.msg,
      'resolve sales material wiki node',
    );
    const node = response.data?.node;
    const snapshot: WikiNodeSnapshot | null = node?.space_id &&
      node.obj_token && node.obj_type
      ? {
          spaceId: node.space_id,
          objectToken: node.obj_token,
          objectType: node.obj_type,
          editedAt: node.obj_edit_time ?? null,
        }
      : null;
    if (snapshot === null) {
      throw new Error('Sales material wiki node is incomplete');
    }
    if (snapshot.objectType !== 'docx') {
      return { sourceId: source.id, status: 'unsupported' };
    }
    return this.readDocx(
      integration,
      actorOpenId,
      source,
      snapshot.objectToken,
      snapshot.editedAt,
      snapshot.spaceId,
    );
  }

  private async canReadDocx(
    client: lark.Client,
    options: ReturnType<FeishuClientFactory['getRequestOptions']>,
    actorOpenId: string,
    token: string,
  ): Promise<boolean> {
    const publicPermission = await client.drive.permissionPublic.get({
      params: { type: 'docx' },
      path: { token },
    }, options);
    assertFeishuSuccess(
      publicPermission.code,
      publicPermission.msg,
      'read sales material public permission',
    );
    const linkScope: string | undefined =
      publicPermission.data?.permission_public?.link_share_entity;
    if (linkScope && TENANT_READABLE_ENTITIES.has(linkScope)) {
      return true;
    }

    const members = await client.drive.permissionMember.list({
      params: { type: 'docx', fields: 'member_type,member_id,perm' },
      path: { token },
    }, options);
    assertFeishuSuccess(
      members.code,
      members.msg,
      'read sales material collaborators',
    );
    return (members.data?.items ?? []).some(
      (member): boolean =>
        member.member_type === 'openid' &&
        member.member_id === actorOpenId &&
        ['view', 'edit', 'full_access'].includes(member.perm),
    );
  }

  private async canReadWiki(
    client: lark.Client,
    options: ReturnType<FeishuClientFactory['getRequestOptions']>,
    actorOpenId: string,
    spaceId: string | null,
  ): Promise<boolean> {
    if (!spaceId) {
      throw new Error('Sales material wiki space is missing');
    }
    const spaceResponse = await client.wiki.space.get({
      path: { space_id: spaceId },
    }, options);
    assertFeishuSuccess(
      spaceResponse.code,
      spaceResponse.msg,
      'read sales material wiki space',
    );
    if (spaceResponse.data?.space?.visibility === 'public') {
      return true;
    }

    let pageToken: string | undefined;
    for (let page: number = 0; page < 100; page += 1) {
      const response = await client.wiki.spaceMember.list({
        params: {
          page_size: 50,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
        path: { space_id: spaceId },
      }, options);
      assertFeishuSuccess(
        response.code,
        response.msg,
        'read sales material wiki members',
      );
      const allowed: boolean = (response.data?.members ?? []).some(
        (member): boolean =>
          member.member_type === 'openid' &&
          member.member_id === actorOpenId,
      );
      if (allowed) {
        return true;
      }
      if (!response.data?.has_more || !response.data.page_token) {
        return false;
      }
      pageToken = response.data.page_token;
    }
    throw new Error('Sales material wiki member pagination exceeded');
  }
}

export { FeishuSalesMaterialGateway };
