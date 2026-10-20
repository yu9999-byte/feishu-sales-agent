import * as lark from '@larksuiteoapi/node-sdk';
import { describe, expect, it, vi } from 'vitest';

import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import type { FeishuClientFactory } from
  '@server/modules/feishu/feishu-client.factory';
import { FeishuDocumentGateway } from
  '@server/modules/feishu/feishu-document.gateway';
import { DocumentContentGatewayError } from
  '@server/modules/sales-behavior/document-ingestion.service';

const integration: TenantIntegration = {
  tenantId: '00000000-0000-4000-8000-00000000000a',
  feishuTenantKey: 'tenant-a',
  name: '华东示范企业',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_APP_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base_test',
    customers: {
      tableId: 'customers',
      primaryField: '客户名称',
      fields: { customerName: '客户名称' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机名称',
      fields: {
        opportunityName: '商机名称',
        customerLink: '关联客户',
      },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进标题',
      fields: {
        sourceMessageId: '来源消息ID',
        customerLink: '关联客户',
        opportunityLink: '关联商机',
        rawText: '原文',
        summary: '摘要',
      },
    },
  },
};

describe('FeishuDocumentGateway', (): void => {
  it('reads Docx metadata and raw content with the user token', async (): Promise<void> => {
    const getDocument = vi.fn(async (): Promise<unknown> => ({
      code: 0,
      data: {
        document: {
          title: '北辰项目沟通纪要',
          revision_id: 9,
        },
      },
    }));
    const rawContent = vi.fn(async (): Promise<unknown> => ({
      code: 0,
      data: { content: '客户确认试点范围。' },
    }));
    const getNode = vi.fn();
    const client = {
      docx: { v1: { document: { get: getDocument, rawContent } } },
      wiki: { v2: { space: { getNode } } },
    } as unknown as lark.Client;
    const gateway = new FeishuDocumentGateway({
      getClient: (): lark.Client => client,
    } as unknown as FeishuClientFactory);

    await expect(gateway.readDocument({
      integration,
      reference: {
        referenceType: 'docx',
        token: 'NDlodAhO5ouaYqxQskPcJCpjnoh',
        canonicalUrl: 'https://example.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
      },
      accessToken: 'uat-current',
    })).resolves.toEqual({
      title: '北辰项目沟通纪要',
      revisionId: 9,
      rawContent: '客户确认试点范围。',
    });
    expect(getNode).not.toHaveBeenCalled();
    expect(getDocument).toHaveBeenCalledWith(
      { path: { document_id: 'NDlodAhO5ouaYqxQskPcJCpjnoh' } },
      expect.anything(),
    );
    expect(rawContent).toHaveBeenCalledWith(
      { path: { document_id: 'NDlodAhO5ouaYqxQskPcJCpjnoh' } },
      expect.anything(),
    );
  });

  it('returns an empty title for the ingestion fallback when content exists', async (): Promise<void> => {
    const client = {
      docx: {
        v1: {
          document: {
            get: vi.fn(async (): Promise<unknown> => ({
              code: 0,
              data: { document: { title: '   ', revision_id: 1 } },
            })),
            rawContent: vi.fn(async (): Promise<unknown> => ({
              code: 0,
              data: { content: '有正文的无标题文档。' },
            })),
          },
        },
      },
      wiki: { v2: { space: { getNode: vi.fn() } } },
    } as unknown as lark.Client;
    const gateway = new FeishuDocumentGateway({
      getClient: (): lark.Client => client,
    } as unknown as FeishuClientFactory);

    await expect(gateway.readDocument({
      integration,
      reference: {
        referenceType: 'docx',
        token: 'NDlodAhO5ouaYqxQskPcJCpjnoh',
        canonicalUrl: 'https://example.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
      },
      accessToken: 'uat-current',
    })).resolves.toEqual({
      title: '',
      revisionId: 1,
      rawContent: '有正文的无标题文档。',
    });
  });

  it('resolves a Wiki node to Docx with the same user token', async (): Promise<void> => {
    const getNode = vi.fn(async (): Promise<unknown> => ({
      code: 0,
      data: {
        node: {
          obj_type: 'docx',
          obj_token: 'DocxResolvedToken1234',
        },
      },
    }));
    const getDocument = vi.fn(async (): Promise<unknown> => ({
      code: 0,
      data: { document: { title: 'Wiki 纪要', revision_id: 3 } },
    }));
    const rawContent = vi.fn(async (): Promise<unknown> => ({
      code: 0,
      data: { content: 'Wiki 中的 Docx 正文。' },
    }));
    const client = {
      docx: { v1: { document: { get: getDocument, rawContent } } },
      wiki: { v2: { space: { getNode } } },
    } as unknown as lark.Client;
    const gateway = new FeishuDocumentGateway({
      getClient: (): lark.Client => client,
    } as unknown as FeishuClientFactory);

    await expect(gateway.readDocument({
      integration,
      reference: {
        referenceType: 'wiki',
        token: 'WikcnToken12345678',
        canonicalUrl: 'https://example.feishu.cn/wiki/WikcnToken12345678',
      },
      accessToken: 'uat-current',
    })).resolves.toMatchObject({
      title: 'Wiki 纪要',
      revisionId: 3,
    });
    expect(getNode).toHaveBeenCalledWith(
      { params: { token: 'WikcnToken12345678' } },
      expect.anything(),
    );
    expect(getDocument).toHaveBeenCalledWith(
      { path: { document_id: 'DocxResolvedToken1234' } },
      expect.anything(),
    );
  });

  it('does not call Docx APIs for a non-Docx Wiki node', async (): Promise<void> => {
    const getDocument = vi.fn();
    const rawContent = vi.fn();
    const client = {
      docx: { v1: { document: { get: getDocument, rawContent } } },
      wiki: {
        v2: {
          space: {
            getNode: vi.fn(async (): Promise<unknown> => ({
              code: 0,
              data: {
                node: { obj_type: 'sheet', obj_token: 'SheetToken1234' },
              },
            })),
          },
        },
      },
    } as unknown as lark.Client;
    const gateway = new FeishuDocumentGateway({
      getClient: (): lark.Client => client,
    } as unknown as FeishuClientFactory);

    await expect(gateway.readDocument({
      integration,
      reference: {
        referenceType: 'wiki',
        token: 'WikcnToken12345678',
        canonicalUrl: 'https://example.feishu.cn/wiki/WikcnToken12345678',
      },
      accessToken: 'uat-current',
    })).rejects.toEqual(new DocumentContentGatewayError('UNSUPPORTED_TYPE'));
    expect(getDocument).not.toHaveBeenCalled();
    expect(rawContent).not.toHaveBeenCalled();
  });

  it('maps upstream permission denial without exposing details', async (): Promise<void> => {
    const denied: Error & { response?: unknown } = new Error('secret detail');
    denied.response = {
      status: 403,
      data: { code: 99991679, msg: 'permission denied' },
    };
    const client = {
      docx: {
        v1: {
          document: {
            get: vi.fn(async (): Promise<never> => {
              throw denied;
            }),
            rawContent: vi.fn(),
          },
        },
      },
      wiki: { v2: { space: { getNode: vi.fn() } } },
    } as unknown as lark.Client;
    const gateway = new FeishuDocumentGateway({
      getClient: (): lark.Client => client,
    } as unknown as FeishuClientFactory);

    await expect(gateway.readDocument({
      integration,
      reference: {
        referenceType: 'docx',
        token: 'NDlodAhO5ouaYqxQskPcJCpjnoh',
        canonicalUrl: 'https://example.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
      },
      accessToken: 'uat-current',
    })).rejects.toEqual(new DocumentContentGatewayError('ACCESS_DENIED'));
  });
});
