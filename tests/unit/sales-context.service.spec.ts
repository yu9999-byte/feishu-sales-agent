import { describe, expect, it, vi } from 'vitest';

import type {
  SalesContextBaseResult,
  SalesContextHints,
} from '@server/modules/agent-core/agent.types';
import type {
  SalesRecordsGateway,
  TaskGateway,
} from '@server/modules/agent-core/agent.ports';
import type { TenantIntegration } from '@server/modules/agent-core/agent.types';
import { SalesContextService } from '@server/modules/agent-core/sales-context.service';

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
      fields: { customerName: '客户', ownerOpenId: '负责人' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机',
      fields: {
        opportunityName: '商机',
        customerLink: '客户',
        ownerOpenId: '负责人',
      },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进',
      fields: {
        sourceMessageId: '消息',
        customerLink: '客户',
        opportunityLink: '商机',
        rawText: '原文',
        summary: '摘要',
        ownerOpenId: '负责人',
      },
    },
  },
};

const baseResult: SalesContextBaseResult = {
  customers: [{
    recordId: 'customer-1',
    name: '北辰制造',
    contactName: '张总',
    latestSummary: '客户认可方案',
    lastFollowupAt: '2026-09-24T10:00:00+08:00',
    sourceVersion: '2026-09-24T02:00:00.000Z',
    recordUrl: 'https://feishu.cn/base/customer-1',
  }],
  opportunities: [{
    recordId: 'opportunity-1',
    customerRecordId: 'customer-1',
    name: '北辰数字化项目',
    progress: '方案已确认',
    expectedAmount: 500000,
    nextAction: '提交实施方案',
    dueAt: '2026-09-29T10:00:00+08:00',
    sourceVersion: '2026-09-24T02:00:00.000Z',
    recordUrl: 'https://feishu.cn/base/opportunity-1',
  }],
  followups: [],
  warnings: [],
};

describe('SalesContextService', (): void => {
  it('combines authorized Base and own-task context without business writes', async (): Promise<void> => {
    const records: SalesRecordsGateway = {
      readSalesContext: vi.fn(async (): Promise<SalesContextBaseResult> =>
        structuredClone(baseResult)),
      upsertCustomer: vi.fn(),
      upsertOpportunity: vi.fn(),
      createFollowup: vi.fn(),
    } as unknown as SalesRecordsGateway;
    const tasks: TaskGateway = {
      searchOwnedTasks: vi.fn(async (): Promise<{
        items: Array<{
          guid: string;
          title: string;
          status: string;
          dueAt: string | null;
          url: string | null;
        }>;
        warning?: string;
      }> => ({
        items: [{
          guid: 'task-1',
          title: '发送实施计划',
          status: 'todo',
          dueAt: '2026-09-29T10:00:00+08:00',
          url: 'https://applink.feishu.cn/task/task-1',
        }],
      })),
      createTask: vi.fn(),
    } as unknown as TaskGateway;
    const service = new SalesContextService(records, tasks);
    const hints: SalesContextHints = {
      customerName: '北辰制造',
      opportunityName: '北辰数字化项目',
      contactName: '张总',
    };

    const result = await service.read(integration, 'ou_sales_a', hints);

    expect(result.status).toBe('ready');
    expect(result.customer?.name).toBe('北辰制造');
    expect(result.opportunities).toHaveLength(1);
    expect(result.tasks[0]?.guid).toBe('task-1');
    expect(records.readSalesContext).toHaveBeenCalledWith(
      integration,
      'ou_sales_a',
      hints,
    );
    expect(tasks.searchOwnedTasks).toHaveBeenCalledWith(
      integration,
      'ou_sales_a',
      '北辰制造',
    );
    expect(records.upsertCustomer).not.toHaveBeenCalled();
    expect(records.upsertOpportunity).not.toHaveBeenCalled();
    expect(records.createFollowup).not.toHaveBeenCalled();
    expect(tasks.createTask).not.toHaveBeenCalled();
  });

  it('does not silently choose when multiple customer matches exist', async (): Promise<void> => {
    const ambiguous: SalesContextBaseResult = {
      ...structuredClone(baseResult),
      customers: [
        ...baseResult.customers,
        { ...baseResult.customers[0], recordId: 'customer-2' },
      ],
      opportunities: [],
      followups: [],
      warnings: [],
    };
    const records: SalesRecordsGateway = {
      readSalesContext: vi.fn(async (): Promise<SalesContextBaseResult> =>
        ambiguous),
    } as unknown as SalesRecordsGateway;
    const tasks: TaskGateway = {
      searchOwnedTasks: vi.fn(async (): Promise<{ items: [] }> => ({
        items: [],
      })),
      createTask: vi.fn(),
    } as unknown as TaskGateway;

    const result = await new SalesContextService(records, tasks).read(
      integration,
      'ou_sales_a',
      { customerName: '北辰制造' },
    );

    expect(result.status).toBe('needs_clarification');
    expect(result.customer).toBeNull();
    expect(result.customerCandidates).toHaveLength(2);
    expect(tasks.searchOwnedTasks).not.toHaveBeenCalled();
  });

  it('does not silently choose when multiple opportunities exist for one customer', async (): Promise<void> => {
    const ambiguous: SalesContextBaseResult = {
      ...structuredClone(baseResult),
      opportunities: [
        ...baseResult.opportunities,
        { ...baseResult.opportunities[0], recordId: 'opportunity-2' },
      ],
    };
    const records: SalesRecordsGateway = {
      readSalesContext: vi.fn(async (): Promise<SalesContextBaseResult> =>
        ambiguous),
    } as unknown as SalesRecordsGateway;
    const tasks: TaskGateway = {
      searchOwnedTasks: vi.fn(),
    } as unknown as TaskGateway;

    const result = await new SalesContextService(records, tasks).read(
      integration,
      'ou_sales_a',
      { customerName: '北辰制造' },
    );

    expect(result.status).toBe('needs_clarification');
    expect(result.opportunities).toHaveLength(2);
    expect(result.warnings).toContain('opportunity_match_ambiguous');
    expect(tasks.searchOwnedTasks).not.toHaveBeenCalled();
  });

  it('returns an explicit unavailable context when a source fails', async (): Promise<void> => {
    const records: SalesRecordsGateway = {
      readSalesContext: vi.fn(async (): Promise<SalesContextBaseResult> => {
        throw new Error('permission denied');
      }),
    } as unknown as SalesRecordsGateway;
    const tasks: TaskGateway = {
      searchOwnedTasks: vi.fn(),
    } as unknown as TaskGateway;

    const result = await new SalesContextService(records, tasks).read(
      integration,
      'ou_sales_a',
      { customerName: '北辰制造' },
    );

    expect(result.status).toBe('unavailable');
    expect(result.warnings).toContain('business_context_unavailable');
    expect(tasks.searchOwnedTasks).not.toHaveBeenCalled();
  });

  it('keeps Base context when the task source is unavailable', async (): Promise<void> => {
    const records: SalesRecordsGateway = {
      readSalesContext: vi.fn(async (): Promise<SalesContextBaseResult> =>
        structuredClone(baseResult)),
    } as unknown as SalesRecordsGateway;
    const tasks: TaskGateway = {
      searchOwnedTasks: vi.fn(async (): Promise<never> => {
        throw new Error('task read denied');
      }),
    } as unknown as TaskGateway;

    const result = await new SalesContextService(records, tasks).read(
      integration,
      'ou_sales_a',
      { customerName: '北辰制造' },
    );

    expect(result.status).toBe('partial');
    expect(result.customer?.name).toBe('北辰制造');
    expect(result.warnings).toContain('task_context_unavailable');
  });

  it('identifies a missing Feishu task read scope without dropping Base context', async (): Promise<void> => {
    const records: SalesRecordsGateway = {
      readSalesContext: vi.fn(async (): Promise<SalesContextBaseResult> =>
        structuredClone(baseResult)),
    } as unknown as SalesRecordsGateway;
    const tasks: TaskGateway = {
      searchOwnedTasks: vi.fn(async (): Promise<never> => {
        throw Object.assign(new Error('request failed'), {
          response: { data: { code: 99991672 } },
        });
      }),
    } as unknown as TaskGateway;

    const result = await new SalesContextService(records, tasks).read(
      integration,
      'ou_sales_a',
      { customerName: '北辰制造' },
    );

    expect(result.status).toBe('partial');
    expect(result.customer?.name).toBe('北辰制造');
    expect(result.warnings).toContain('task_context_permission_denied');
  });

  it('preserves conflicting action facts and marks the newer source', async (): Promise<void> => {
    const conflictingResult: SalesContextBaseResult = {
      ...structuredClone(baseResult),
      followups: [{
        recordId: 'followup-1',
        summary: '客户要求先发送合同',
        opportunityRecordId: 'opportunity-1',
        nextAction: '发送合同',
        dueAt: '2026-10-01T02:00:00.000Z',
        sourceVersion: '2026-09-25T02:00:00.000Z',
        recordUrl: 'https://feishu.cn/base/followup-1',
      }],
    };
    const records: SalesRecordsGateway = {
      readSalesContext: vi.fn(async (): Promise<SalesContextBaseResult> =>
        conflictingResult),
    } as unknown as SalesRecordsGateway;
    const tasks: TaskGateway = {
      searchOwnedTasks: vi.fn(async (): Promise<{ items: [] }> => ({
        items: [],
      })),
      createTask: vi.fn(),
    } as unknown as TaskGateway;

    const result = await new SalesContextService(records, tasks).read(
      integration,
      'ou_sales_a',
      { customerName: '北辰制造', opportunityName: '北辰数字化项目' },
    );

    expect(result.status).toBe('partial');
    expect(result.warnings).toContain('sales_context_source_conflict');
    expect(result).toMatchObject({
      opportunities: [{ nextAction: '提交实施方案' }],
      recentFollowups: [{
        opportunityRecordId: 'opportunity-1',
        nextAction: '发送合同',
      }],
      conflicts: [
        {
          field: 'nextAction',
          opportunityValue: '提交实施方案',
          followupValue: '发送合同',
          newerSource: 'followup',
          opportunitySource: {
            recordId: 'opportunity-1',
            sourceVersion: '2026-09-24T02:00:00.000Z',
          },
          followupSource: {
            recordId: 'followup-1',
            sourceVersion: '2026-09-25T02:00:00.000Z',
          },
        },
        {
          field: 'dueAt',
          opportunityValue: '2026-09-29T10:00:00+08:00',
          followupValue: '2026-10-01T02:00:00.000Z',
          newerSource: 'followup',
        },
      ],
    });
    expect(records.readSalesContext).toHaveBeenCalledOnce();
    expect(tasks.createTask).not.toHaveBeenCalled();
  });
});
