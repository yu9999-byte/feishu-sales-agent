import { describe, expect, it, vi } from 'vitest';

import type { TenantIntegration } from '@server/modules/agent-core/agent.types';
import { FeishuBaseGateway } from '@server/modules/integrations/base/feishu-base.gateway';
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
        ownerOpenId: '负责人',
        progress: '进展',
        expectedAmount: '金额',
        nextAction: '下一步',
        dueAt: '截止',
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
            fields: { 客户: '北辰制造', 联系人: '张总', 最近摘要: '认可方案' },
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
              商机: '北辰数字化项目',
              进展: '方案已确认',
              金额: 500000,
              下一步: '提交实施方案',
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
          摘要: '认可方案',
          下一步: '提交实施方案',
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
      }),
      undefined,
    );
    expect(create).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
