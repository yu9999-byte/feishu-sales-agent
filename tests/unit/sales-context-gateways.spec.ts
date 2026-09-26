import { describe, expect, it, vi } from 'vitest';

import type {
  PendingAction,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import { FeishuBaseGateway } from '@server/modules/integrations/base/feishu-base.gateway';
import { StaleOpportunityContextService } from
  '@server/modules/insight/stale-opportunity-context.service';
import { FeishuTaskGateway } from '@server/modules/integrations/task/feishu-task.gateway';
import type { FeishuClientFactory } from '@server/modules/feishu/feishu-client.factory';

const integration: TenantIntegration = {
  tenantId: 'tenant-a',
  feishuTenantKey: 'tenant-key-a',
  name: 'Tenant A',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base-a',
    customers: {
      tableId: 'customers',
      primaryField: '客户',
      fields: {
        customerName: '客户',
        contactName: '联系人',
        ownerOpenId: '负责人',
        latestSummary: '最近摘要',
      },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机',
      fields: {
        opportunityName: '商机',
        customerLink: '客户关联',
        status: '商机状态',
        ownerOpenId: '负责人',
        progress: '进展',
        expectedAmount: '金额',
        nextAction: '下一步',
        dueAt: '截止',
      },
      statusValues: {
        active: ['进行中'],
        won: ['已赢单'],
        lost: ['已丢单'],
        closed: ['已关闭'],
      },
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
        ownerOpenId: '负责人',
        nextAction: '下一步',
        dueAt: '截止',
        communicationAt: '本次沟通发生时间',
      },
    },
  },
};

describe('sales context gateways', (): void => {
  it('scopes all Base reads to the current owner and maps records to domain facts', async (): Promise<void> => {
    const search = vi.fn()
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{
            record_id: 'customer-1',
            record_url: 'https://feishu.cn/customer-1',
            last_modified_time: 1790215200000,
            fields: {
              客户: [{ text: '北辰制造', type: 'text' }],
              联系人: [{ text: '张总', type: 'text' }],
              最近摘要: [{ text: '认可方案', type: 'text' }],
            },
          }],
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{
            record_id: 'opportunity-1',
            record_url: 'https://feishu.cn/opportunity-1',
            last_modified_time: 1790215200000,
            fields: {
              商机: [{ text: '北辰数字化项目', type: 'text' }],
              进展: [{ text: '方案已确认', type: 'text' }],
              金额: 500000,
              下一步: [{ text: '提交实施方案', type: 'text' }],
            },
          }],
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{
            record_id: 'followup-1',
            record_url: 'https://feishu.cn/followup-1',
            last_modified_time: 1790215200000,
        fields: {
          摘要: [{ text: '认可方案', type: 'text' }],
          下一步: [{ text: '提交实施方案', type: 'text' }],
          本次沟通发生时间: 1790215200000,
          商机关联: [{ record_id: 'opportunity-1' }],
        },
          }],
        },
      });
    const client = { bitable: { appTableRecord: { search } } };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;
    const gateway = new FeishuBaseGateway(factory);

    const result = await gateway.readSalesContext(
      integration,
      'ou_sales_a',
      { customerName: '北辰制造', opportunityName: '北辰数字化项目' },
    );

    expect(result.customers[0]?.name).toBe('北辰制造');
    expect(result.opportunities[0]?.expectedAmount).toBe(500000);
    expect(result.followups[0]?.summary).toBe('认可方案');
    expect(result.followups[0]?.opportunityRecordId).toBe('opportunity-1');
    expect(result.followups[0]?.communicationAt).toBe(
      new Date(1790215200000).toISOString(),
    );
    for (const call of search.mock.calls) {
      const request = call[0] as {
        data: { filter: { conditions: Array<{ field_name: string; value?: string[] }> } };
      };
      expect(request.data.filter.conditions).toContainEqual({
        field_name: '负责人',
        operator: 'is',
        value: ['ou_sales_a'],
      });
    }
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('does not read Base tables when owner-scope mappings are incomplete', async (): Promise<void> => {
    const search = vi.fn();
    const client = { bitable: { appTableRecord: { search } } };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;
    const unscoped: TenantIntegration = {
      ...integration,
      base: {
        ...integration.base,
        customers: {
          ...integration.base.customers,
          fields: { customerName: '客户' },
        },
      },
    };

    const result = await new FeishuBaseGateway(factory).readSalesContext(
      unscoped,
      'ou_sales_a',
      { customerName: '北辰制造' },
    );

    expect(result.warnings).toContain('owner_scope_mapping_not_configured');
    expect(search).not.toHaveBeenCalled();
  });

  it('falls back to the owner customer opportunities when a model hint does not match', async (): Promise<void> => {
    const search = vi.fn()
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{
            record_id: 'customer-1',
            fields: { 客户: [{ text: '华南科技', type: 'text' }] },
          }],
        },
      })
      .mockResolvedValueOnce({ code: 0, data: { items: [] } })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{
            record_id: 'opportunity-1',
            fields: {
              商机: [{ text: '华南科技 - 销售机会', type: 'text' }],
            },
          }],
        },
      })
      .mockResolvedValueOnce({ code: 0, data: { items: [] } });
    const client = { bitable: { appTableRecord: { search } } };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;

    const result = await new FeishuBaseGateway(factory).readSalesContext(
      integration,
      'ou_sales_a',
      { customerName: '华南科技', opportunityName: '报价方案' },
    );

    expect(result.opportunities[0]?.name).toBe('华南科技 - 销售机会');
    const exactConditions = search.mock.calls[1]?.[0].data.filter.conditions;
    const fallbackConditions = search.mock.calls[2]?.[0].data.filter.conditions;
    expect(exactConditions).toContainEqual(expect.objectContaining({
      field_name: '商机',
      value: ['报价方案'],
    }));
    expect(fallbackConditions).not.toContainEqual(expect.objectContaining({
      field_name: '商机',
    }));
  });

  it('returns the first stale-followup page and its continuation token', async (): Promise<void> => {
    const search = vi.fn(async (): Promise<{
      code: number;
      data: {
        items: Array<Record<string, unknown>>;
        has_more: boolean;
        page_token: string;
      };
    }> => ({
      code: 0,
      data: {
        items: [{
          record_id: 'followup-page-1',
          last_modified_time: 1790215200000,
          fields: {
            商机关联: [{ record_id: 'opportunity-1' }],
            本次沟通发生时间: 1790128800000,
          },
        }],
        has_more: true,
        page_token: 'page-2',
      },
    }));
    const client = { bitable: { appTableRecord: { search } } };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;

    const result = await new FeishuBaseGateway(factory)
      .readStaleOpportunityFollowupPage(integration, 'ou_sales_a');

    expect(result).toEqual({
      items: [{
        recordId: 'followup-page-1',
        opportunityRecordId: 'opportunity-1',
        communicationAt: new Date(1790128800000).toISOString(),
        sourceVersion: new Date(1790215200000).toISOString(),
      }],
      nextPageToken: 'page-2',
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          page_size: 500,
          user_id_type: 'open_id',
        },
      }),
      undefined,
    );
    expect(search.mock.calls[0]?.[0].data.filter.conditions).toEqual([{
      field_name: '负责人',
      operator: 'is',
      value: ['ou_sales_a'],
    }]);
  });

  it('reads owner-scoped opportunities only with explicit status semantics', async (): Promise<void> => {
    const search = vi.fn(async () => ({
      code: 0,
      data: {
        items: [{
          record_id: 'opportunity-1',
          last_modified_time: 1790215200000,
          fields: {
            商机: [{ text: '北辰数字化项目' }],
            商机状态: '进行中',
          },
        }],
        has_more: false,
      },
    }));
    const client = { bitable: { appTableRecord: { search } } };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;

    const result = await new FeishuBaseGateway(factory)
      .readStaleOpportunityPage(integration, 'ou_sales_a');

    expect(result).toEqual({
      items: [{
        recordId: 'opportunity-1',
        name: '北辰数字化项目',
        status: 'active',
        ownerOpenId: 'ou_sales_a',
        sourceVersion: new Date(1790215200000).toISOString(),
      }],
      nextPageToken: null,
    });
    expect(search.mock.calls[0]?.[0].data.filter.conditions).toEqual([{
      field_name: '负责人',
      operator: 'is',
      value: ['ou_sales_a'],
    }]);
  });

  it('refuses opportunity scans without a lifecycle field and active values', async (): Promise<void> => {
    const search = vi.fn();
    const client = { bitable: { appTableRecord: { search } } };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;
    const gateway = new FeishuBaseGateway(factory);
    const statusMissing: TenantIntegration = {
      ...integration,
      base: {
        ...integration.base,
        opportunities: {
          ...integration.base.opportunities,
          fields: {
            ...integration.base.opportunities.fields,
            status: undefined,
          },
        },
      },
    };
    const valuesMissing: TenantIntegration = {
      ...integration,
      base: {
        ...integration.base,
        opportunities: {
          ...integration.base.opportunities,
          statusValues: undefined,
        },
      },
    };

    expect((await gateway.readStaleOpportunityPage(
      statusMissing,
      'ou_sales_a',
    )).warning).toBe('opportunity_status_mapping_not_configured');
    expect((await gateway.readStaleOpportunityPage(
      valuesMissing,
      'ou_sales_a',
    )).warning).toBe('opportunity_status_values_not_configured');
    expect(search).not.toHaveBeenCalled();
  });

  it('passes a continuation token and can summarize records across pages', async (): Promise<void> => {
    const search = vi.fn()
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{
            record_id: 'followup-page-1',
            last_modified_time: 1790128800000,
            fields: {
              商机关联: [{ record_id: 'opportunity-1' }],
              本次沟通发生时间: 1790042400000,
            },
          }],
          has_more: true,
          page_token: 'page-2',
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{
            record_id: 'followup-page-2',
            last_modified_time: 1790215200000,
            fields: {
              商机关联: [{ record_id: 'opportunity-1' }],
              本次沟通发生时间: 1790128800000,
            },
          }],
          has_more: false,
        },
      });
    const client = { bitable: { appTableRecord: { search } } };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;
    const gateway = new FeishuBaseGateway(factory);

    const firstPage = await gateway.readStaleOpportunityFollowupPage(
      integration,
      'ou_sales_a',
    );
    const secondPage = await gateway.readStaleOpportunityFollowupPage(
      integration,
      'ou_sales_a',
      firstPage.nextPageToken ?? undefined,
    );
    const summary = new StaleOpportunityContextService().summarize([
      ...firstPage.items,
      ...secondPage.items,
    ]);

    expect(search.mock.calls[1]?.[0].params).toEqual({
      page_size: 500,
      user_id_type: 'open_id',
      page_token: 'page-2',
    });
    expect(secondPage.nextPageToken).toBeNull();
    expect(summary).toEqual([{
      opportunityRecordId: 'opportunity-1',
      followupRecordId: 'followup-page-2',
      lastEffectiveFollowupAt: new Date(1790128800000).toISOString(),
      followupVersion: new Date(1790215200000).toISOString(),
    }]);
  });

  it('fails closed when stale-followup owner or required field mappings are missing', async (): Promise<void> => {
    const search = vi.fn();
    const client = { bitable: { appTableRecord: { search } } };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;
    const gateway = new FeishuBaseGateway(factory);

    const ownerMissing = await gateway.readStaleOpportunityFollowupPage(
      {
        ...integration,
        base: {
          ...integration.base,
          followups: {
            ...integration.base.followups,
            fields: { ...integration.base.followups.fields, ownerOpenId: undefined },
          },
        },
      },
      'ou_sales_a',
    );
    const opportunityMissing = await gateway.readStaleOpportunityFollowupPage(
      {
        ...integration,
        base: {
          ...integration.base,
          followups: {
            ...integration.base.followups,
            fields: { ...integration.base.followups.fields, opportunityLink: '' },
          },
        },
      },
      'ou_sales_a',
    );
    const communicationTimeMissing = await gateway.readStaleOpportunityFollowupPage(
      {
        ...integration,
        base: {
          ...integration.base,
          followups: {
            ...integration.base.followups,
            fields: { ...integration.base.followups.fields, communicationAt: undefined },
          },
        },
      },
      'ou_sales_a',
    );

    expect(ownerMissing.warning).toBe('owner_scope_mapping_not_configured');
    expect(opportunityMissing.warning).toBe(
      'stale_followup_opportunity_mapping_not_configured',
    );
    expect(communicationTimeMissing.warning).toBe(
      'stale_followup_communication_time_mapping_not_configured',
    );
    expect(search).not.toHaveBeenCalled();
  });

  it('reports an incomplete page when the API omits the continuation token', async (): Promise<void> => {
    const search = vi.fn(async () => ({
      code: 0,
      data: { items: [], has_more: true },
    }));
    const client = { bitable: { appTableRecord: { search } } };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;

    const result = await new FeishuBaseGateway(factory)
      .readStaleOpportunityFollowupPage(integration, 'ou_sales_a');

    expect(result.nextPageToken).toBeNull();
    expect(result.warning).toBe('stale_followup_pagination_incomplete');
  });

  it('searches only open tasks assigned to the current actor and performs no writes', async (): Promise<void> => {
    const search = vi.fn(async () => ({
      code: 0,
      data: { items: [{ id: 'task-1', meta_data: { app_link: 'https://task/1' } }] },
    }));
    const get = vi.fn(async () => ({
      code: 0,
      data: {
        task: {
          guid: 'task-1',
          summary: '提交实施方案',
          completed_at: undefined,
          due: { timestamp: '1790647200000' },
          url: 'https://task/1',
        },
      },
    }));
    const create = vi.fn();
    const patch = vi.fn();
    const client = {
      task: { v2: { task: { search, get, create, patch } } },
    };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;
    const gateway = new FeishuTaskGateway(factory);

    const result = await gateway.searchOwnedTasks(
      integration,
      'ou_sales_a',
      '北辰制造',
    );

    expect(result.items[0]).toMatchObject({
      guid: 'task-1',
      title: '提交实施方案',
      status: 'todo',
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          query: '北辰制造',
          filter: { assignee_ids: ['ou_sales_a'], is_completed: false },
        },
        params: {
          page_size: 30,
          user_id_type: 'open_id',
        },
      }),
      undefined,
    );
    expect(create).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('consumes every Task search page before returning complete visibility', async (): Promise<void> => {
    const search = vi.fn()
      .mockResolvedValueOnce({
        code: 0,
        data: {
          items: [{ id: 'task-1' }],
          has_more: true,
          page_token: 'task-page-2',
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: { items: [{ id: 'task-2' }], has_more: false },
      });
    const get = vi.fn(async (request: {
      path: { task_guid: string };
    }) => ({
      code: 0,
      data: {
        task: {
          guid: request.path.task_guid,
          summary: request.path.task_guid,
        },
      },
    }));
    const client = { task: { v2: { task: { search, get } } } };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;

    const result = await new FeishuTaskGateway(factory).searchOwnedTasks(
      integration,
      'ou_sales_a',
      '北辰数字化项目',
    );

    expect(result.warning).toBeUndefined();
    expect(result.items.map((item) => item.guid)).toEqual(['task-1', 'task-2']);
    expect(search.mock.calls[1]?.[0].params).toEqual({
      page_size: 30,
      user_id_type: 'open_id',
      page_token: 'task-page-2',
    });
  });

  it('marks Task visibility incomplete when continuation is missing', async (): Promise<void> => {
    const search = vi.fn(async () => ({
      code: 0,
      data: { items: [], has_more: true },
    }));
    const get = vi.fn();
    const client = { task: { v2: { task: { search, get } } } };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;

    const result = await new FeishuTaskGateway(factory).searchOwnedTasks(
      integration,
      'ou_sales_a',
      '北辰数字化项目',
    );

    expect(result).toEqual({
      items: [],
      warning: 'task_query_pagination_incomplete',
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('writes an explicit communication time when creating a followup', async (): Promise<void> => {
    const search = vi.fn(async (): Promise<{
      code: number;
      data: { items: [] };
    }> => ({ code: 0, data: { items: [] } }));
    const request = vi.fn(async (): Promise<{
      code: number;
      data: { record: { record_id: string; record_url: string } };
    }> => ({
      code: 0,
      data: {
        record: {
          record_id: 'followup-created',
          record_url: 'https://feishu.cn/base/followup-created',
        },
      },
    }));
    const client = {
      bitable: { appTableRecord: { search } },
      request,
    };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;
    const action: PendingAction = createPendingAction({
      communicationAt: '2026-09-24T02:00:00.000Z',
    });

    const result = await new FeishuBaseGateway(factory).createFollowup(
      integration,
      action,
      'customer-1',
      'opportunity-1',
    );

    expect(result.recordId).toBe('followup-created');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          fields: expect.objectContaining({
            本次沟通发生时间: Date.parse('2026-09-24T02:00:00.000Z'),
          }),
        },
      }),
      undefined,
    );
  });

  it('does not invent a communication time when the draft has none', async (): Promise<void> => {
    const search = vi.fn(async (): Promise<{
      code: number;
      data: { items: [] };
    }> => ({ code: 0, data: { items: [] } }));
    const request = vi.fn(async (): Promise<{
      code: number;
      data: { record: { record_id: string } };
    }> => ({
      code: 0,
      data: { record: { record_id: 'followup-created' } },
    }));
    const client = {
      bitable: { appTableRecord: { search } },
      request,
    };
    const factory = {
      getClient: vi.fn(() => client),
      getRequestOptions: vi.fn(),
    } as unknown as FeishuClientFactory;
    const action: PendingAction = createPendingAction({});

    await new FeishuBaseGateway(factory).createFollowup(
      integration,
      action,
      'customer-1',
      'opportunity-1',
    );

    const requestConfig = request.mock.calls[0]?.[0] as {
      data: { fields: Record<string, unknown> };
    };
    expect(requestConfig.data.fields).not.toHaveProperty('本次沟通发生时间');
  });
});

interface CommunicationTimeOverride {
  communicationAt?: string;
}

function createPendingAction(
  override: CommunicationTimeOverride,
): PendingAction {
  return {
    id: 'action-followup-time',
    tenantId: integration.tenantId,
    actorOpenId: 'ou_sales_a',
    chatId: 'oc_chat',
    cardMessageId: null,
    status: 'pendingConfirmation',
    payload: {
      version: 1,
      sourceMessageId: 'message-followup-time',
      rawText: '北辰制造客户认可方案。',
      draft: {
        customerName: '北辰制造',
        contactName: '张总',
        opportunityName: '北辰数字化项目',
        communicationAt: override.communicationAt,
        summary: '客户认可方案',
        customerNeeds: [],
        objections: [],
        risks: [],
        progress: '方案已确认',
        expectedAmount: null,
        nextAction: '提交实施方案',
        dueAt: null,
        evidenceQuotes: ['客户认可方案'],
      },
    },
    result: {
      pendingActionId: 'action-followup-time',
      status: 'pendingConfirmation',
    },
    expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-24T03:00:00.000Z'),
    updatedAt: new Date('2026-09-24T03:00:00.000Z'),
  };
}
