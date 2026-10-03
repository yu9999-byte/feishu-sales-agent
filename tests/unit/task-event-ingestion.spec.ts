import { describe, expect, it, vi } from 'vitest';

import { MemoryControlStore } from
  '@server/modules/agent-core/memory-control.store';
import { TaskEventIngestionService } from
  '@server/modules/agent-core/task-event-ingestion.service';
import type {
  IncomingTaskUpdateEvent,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';

const createIntegration = (
  tenantId: string,
  feishuTenantKey: string,
  status: TenantIntegration['status'] = 'active',
): TenantIntegration => ({
  tenantId,
  feishuTenantKey,
  name: `测试企业 ${tenantId}`,
  status,
  appId: 'cli_test',
  appSecretEnv: 'FEISHU_APP_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base-test',
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
        customerLink: '客户',
      },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进摘要',
      fields: {
        sourceMessageId: '消息 ID',
        customerLink: '客户',
        opportunityLink: '商机',
        rawText: '原文',
        summary: '摘要',
      },
    },
  },
});

const createEvent = (
  feishuTenantKey: string,
  eventId: string,
): IncomingTaskUpdateEvent => ({
  feishuTenantKey,
  eventId,
  taskGuid: 'task-guid-1',
  eventTypes: ['task_status_changed'],
  occurredAt: new Date('2026-10-03T02:00:00.000Z'),
  receivedAt: new Date('2026-10-03T02:00:02.000Z'),
});

describe('TaskEventIngestionService', (): void => {
  it('records a receipt once and keeps the event payload minimal', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([
      createIntegration('tenant-a', 'tenant-key-a'),
    ]);
    const recordReceipt = vi.spyOn(store, 'recordTaskEventReceipt');
    const service: TaskEventIngestionService = new TaskEventIngestionService(store);

    await expect(service.ingest(createEvent('tenant-key-a', 'event-1')))
      .resolves.toBe('recorded');
    await expect(service.ingest(createEvent('tenant-key-a', 'event-1')))
      .resolves.toBe('duplicate');
    expect(recordReceipt).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      eventId: 'event-1',
      taskGuid: 'task-guid-1',
      eventTypes: ['task_status_changed'],
      receiptStatus: 'received',
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
  });

  it('isolates duplicate event identifiers by tenant', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([
      createIntegration('tenant-a', 'tenant-key-a'),
      createIntegration('tenant-b', 'tenant-key-b'),
    ]);
    const service: TaskEventIngestionService = new TaskEventIngestionService(store);

    await expect(service.ingest(createEvent('tenant-key-a', 'event-1')))
      .resolves.toBe('recorded');
    await expect(service.ingest(createEvent('tenant-key-b', 'event-1')))
      .resolves.toBe('recorded');
    await expect(service.ingest(createEvent('tenant-key-a', 'event-1')))
      .resolves.toBe('duplicate');
  });

  it('ignores unknown and disabled tenants without creating a receipt', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([
      createIntegration('tenant-disabled', 'tenant-key-disabled', 'disabled'),
    ]);
    const recordReceipt = vi.spyOn(store, 'recordTaskEventReceipt');
    const service: TaskEventIngestionService = new TaskEventIngestionService(store);

    await expect(service.ingest(createEvent('missing-tenant', 'event-1')))
      .resolves.toBe('ignored_unknown_tenant');
    await expect(service.ingest(createEvent('tenant-key-disabled', 'event-2')))
      .resolves.toBe('ignored_unknown_tenant');
    expect(recordReceipt).not.toHaveBeenCalled();
  });
});
