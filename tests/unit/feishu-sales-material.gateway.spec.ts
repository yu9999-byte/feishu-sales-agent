import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type {
  SalesMaterialSourceConfig,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import type { FeishuClientFactory } from
  '@server/modules/feishu/feishu-client.factory';
import {
  FeishuSalesMaterialGateway,
} from '@server/modules/knowledge/feishu-sales-material.gateway';
import type { SalesMaterialReadResult } from
  '@server/modules/knowledge/sales-material.ports';

const integration: TenantIntegration = {
  tenantId: 'tenant-a',
  feishuTenantKey: 'tenant-key-a',
  name: 'Tenant A',
  status: 'active',
  appId: 'app-a',
  appSecretEnv: 'APP_SECRET_A',
  appType: 'selfBuild',
  base: {
    appToken: 'base-a',
    customers: {
      tableId: 'customers',
      primaryField: '客户',
      fields: { customerName: '客户' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机',
      fields: { opportunityName: '商机', customerLink: '客户关联' },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进',
      fields: {
        sourceMessageId: '消息',
        customerLink: '客户关联',
        opportunityLink: '商机关联',
        rawText: '原文',
        summary: '摘要',
      },
    },
  },
};

const docxSource: SalesMaterialSourceConfig = {
  id: 'solution',
  sourceType: 'docx',
  token: 'docx_solution',
  url: 'https://example.feishu.cn/docx/docx_solution',
  applicability: '售前能力介绍，最终以合同为准',
  keywords: ['协同', '数字化'],
  categories: ['solution_overview'],
};

const wikiSource: SalesMaterialSourceConfig = {
  id: 'case',
  sourceType: 'wiki',
  token: 'wikcn_case',
  url: 'https://example.feishu.cn/wiki/wikcn_case',
  applicability: '案例仅作背景参考',
  keywords: ['案例', '制造业'],
  categories: ['case_reference'],
};

interface ClientHarness {
  client: {
    drive: {
      permissionPublic: { get: ReturnType<typeof vi.fn> };
      permissionMember: { list: ReturnType<typeof vi.fn> };
    };
    docx: {
      document: {
        get: ReturnType<typeof vi.fn>;
        rawContent: ReturnType<typeof vi.fn>;
      };
    };
    wiki: {
      space: {
        getNode: ReturnType<typeof vi.fn>;
        get: ReturnType<typeof vi.fn>;
      };
      spaceMember: { list: ReturnType<typeof vi.fn> };
    };
  };
  gateway: FeishuSalesMaterialGateway;
}

const setup = (): ClientHarness => {
  const client = {
    drive: {
      permissionPublic: {
        get: vi.fn(async () => ({
          code: 0,
          data: { permission_public: { link_share_entity: 'closed' } },
        })),
      },
      permissionMember: {
        list: vi.fn(async () => ({
          code: 0,
          data: {
            items: [{
              member_type: 'openid',
              member_id: 'ou_sales_a',
              perm: 'view',
            }],
          },
        })),
      },
    },
    docx: {
      document: {
        get: vi.fn(async () => ({
          code: 0,
          data: {
            document: {
              document_id: 'docx_solution',
              revision_id: 17,
              title: '数字化协同方案概览',
            },
          },
        })),
        rawContent: vi.fn(async () => ({
          code: 0,
          data: { content: '能力边界\n适用于跨部门协同与流程数字化。' },
        })),
      },
    },
    wiki: {
      space: {
        getNode: vi.fn(async () => ({
          code: 0,
          data: {
            node: {
              space_id: 'space-a',
              node_token: 'wikcn_case',
              obj_token: 'docx_case',
              obj_type: 'docx',
              node_type: 'origin',
              title: '制造业客户案例',
              obj_edit_time: '1791350000',
              url: 'https://example.feishu.cn/wiki/wikcn_case',
            },
          },
        })),
        get: vi.fn(async () => ({
          code: 0,
          data: {
            space: {
              space_id: 'space-a',
              name: '销售知识库',
              visibility: 'private',
            },
          },
        })),
      },
      spaceMember: {
        list: vi.fn(async () => ({
          code: 0,
          data: {
            members: [{
              member_type: 'openid',
              member_id: 'ou_sales_a',
              member_role: 'member',
            }],
            has_more: false,
          },
        })),
      },
    },
  };
  const factory = {
    getClient: vi.fn(() => client),
    getRequestOptions: vi.fn(() => undefined),
  };
  return {
    client,
    gateway: new FeishuSalesMaterialGateway(
      factory as unknown as FeishuClientFactory,
    ),
  };
};

describe('FeishuSalesMaterialGateway', (): void => {
  it('reads a directly shared docx with real metadata and revision', async (): Promise<void> => {
    const harness: ClientHarness = setup();

    const result: SalesMaterialReadResult = await harness.gateway.readSource(
      integration,
      'ou_sales_a',
      docxSource,
    );

    expect(result).toMatchObject({
      status: 'ready',
      document: {
        sourceId: 'solution',
        sourceType: 'docx',
        title: '数字化协同方案概览',
        url: docxSource.url,
        content: '能力边界\n适用于跨部门协同与流程数字化。',
        sourceVersion: 'revision:17',
        accessVerified: true,
      },
    });
    expect(harness.client.drive.permissionMember.list).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ type: 'docx' }),
        path: { token: docxSource.token },
      }),
      undefined,
    );
  });

  it('accepts tenant-readable docx without requiring direct membership', async (): Promise<void> => {
    const harness: ClientHarness = setup();
    harness.client.drive.permissionPublic.get.mockResolvedValueOnce({
      code: 0,
      data: {
        permission_public: { link_share_entity: 'tenant_readable' },
      },
    });

    const result: SalesMaterialReadResult = await harness.gateway.readSource(
      integration,
      'ou_sales_a',
      docxSource,
    );

    expect(result.status).toBe('ready');
    expect(harness.client.drive.permissionMember.list).not.toHaveBeenCalled();
  });

  it.each([
    ['bot app', 'appid'],
    ['chat', 'openchat'],
    ['department', 'opendepartmentid'],
    ['different user', 'openid'],
  ])('does not infer actor access from a %s collaborator', async (
    _label: string,
    memberType: string,
  ): Promise<void> => {
    const harness: ClientHarness = setup();
    harness.client.drive.permissionMember.list.mockResolvedValueOnce({
      code: 0,
      data: {
        items: [{
          member_type: memberType,
          member_id: 'not-the-actor',
          perm: 'view',
        }],
      },
    });

    const result: SalesMaterialReadResult = await harness.gateway.readSource(
      integration,
      'ou_sales_a',
      docxSource,
    );

    expect(result).toMatchObject({ status: 'access_denied' });
    expect(harness.client.docx.document.get).not.toHaveBeenCalled();
    expect(harness.client.docx.document.rawContent).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('数字化协同方案概览');
  });

  it('reads an allowed wiki docx node using the configured node link', async (): Promise<void> => {
    const harness: ClientHarness = setup();
    harness.client.docx.document.get.mockResolvedValueOnce({
      code: 0,
      data: {
        document: {
          document_id: 'docx_case',
          revision_id: 9,
          title: '制造业客户案例',
        },
      },
    });
    harness.client.docx.document.rawContent.mockResolvedValueOnce({
      code: 0,
      data: { content: '项目背景\n制造业客户采用分阶段上线。' },
    });

    const result: SalesMaterialReadResult = await harness.gateway.readSource(
      integration,
      'ou_sales_a',
      wikiSource,
    );

    expect(result).toMatchObject({
      status: 'ready',
      document: {
        sourceId: 'case',
        sourceType: 'wiki',
        title: '制造业客户案例',
        url: wikiSource.url,
        content: '项目背景\n制造业客户采用分阶段上线。',
        sourceVersion: 'wiki-edit:1791350000',
        accessVerified: true,
      },
    });
    expect(harness.client.docx.document.get).toHaveBeenCalledWith(
      { path: { document_id: 'docx_case' } },
      undefined,
    );
  });

  it('accepts a public wiki space without inferring extra memberships', async (): Promise<void> => {
    const harness: ClientHarness = setup();
    harness.client.wiki.space.get.mockResolvedValueOnce({
      code: 0,
      data: {
        space: {
          space_id: 'space-a',
          name: '公开销售知识库',
          visibility: 'public',
        },
      },
    });

    const result: SalesMaterialReadResult = await harness.gateway.readSource(
      integration,
      'ou_sales_a',
      wikiSource,
    );

    expect(result.status).toBe('ready');
    expect(harness.client.wiki.spaceMember.list).not.toHaveBeenCalled();
  });

  it('does not expose a private wiki node without direct actor membership', async (): Promise<void> => {
    const harness: ClientHarness = setup();
    harness.client.wiki.spaceMember.list.mockResolvedValueOnce({
      code: 0,
      data: {
        members: [{
          member_type: 'appid',
          member_id: 'app-a',
          member_role: 'member',
        }],
        has_more: false,
      },
    });

    const result: SalesMaterialReadResult = await harness.gateway.readSource(
      integration,
      'ou_sales_a',
      wikiSource,
    );

    expect(result).toMatchObject({ status: 'access_denied' });
    expect(harness.client.docx.document.get).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('制造业客户案例');
  });

  it('rejects unsupported wiki objects before reading content', async (): Promise<void> => {
    const harness: ClientHarness = setup();
    harness.client.wiki.space.getNode.mockResolvedValueOnce({
      code: 0,
      data: {
        node: {
          space_id: 'space-a',
          node_token: 'wikcn_case',
          obj_token: 'sheet-a',
          obj_type: 'sheet',
          node_type: 'origin',
        },
      },
    });

    const result: SalesMaterialReadResult = await harness.gateway.readSource(
      integration,
      'ou_sales_a',
      wikiSource,
    );

    expect(result).toMatchObject({ status: 'unsupported' });
    expect(harness.client.docx.document.get).not.toHaveBeenCalled();
  });

  it('turns upstream failures into a source-safe unavailable result', async (): Promise<void> => {
    const harness: ClientHarness = setup();
    harness.client.drive.permissionPublic.get.mockResolvedValueOnce({
      code: 99991663,
      msg: 'forbidden document title',
    });

    const result: SalesMaterialReadResult = await harness.gateway.readSource(
      integration,
      'ou_sales_a',
      docxSource,
    );

    expect(result).toEqual({
      sourceId: 'solution',
      status: 'unavailable',
      warning: '资料来源暂时不可用',
    });
  });

  it('contains only read operations and no document mutation path', (): void => {
    const sourceCode: string = readFileSync(join(
      process.cwd(),
      'server/modules/knowledge/feishu-sales-material.gateway.ts',
    ), 'utf8');

    expect(sourceCode).toContain('document.get');
    expect(sourceCode).toContain('document.rawContent');
    expect(sourceCode).toContain('permissionMember.list');
    expect(sourceCode).not.toContain('document.create');
    expect(sourceCode).not.toContain('documentBlock.patch');
    expect(sourceCode).not.toContain('permissionMember.create');
    expect(sourceCode).not.toContain('spaceNode.move');
    expect(sourceCode).not.toContain('.send(');
  });
});
