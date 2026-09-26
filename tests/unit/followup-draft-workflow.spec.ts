import { describe, expect, it, vi } from 'vitest';

import type {
  FollowupDraft,
  SalesContext,
} from '@shared/api.interface';
import type {
  ControlStore,
  FollowupExtractor,
  SalesContextReader,
} from '@server/modules/agent-core/agent.ports';
import type {
  FollowupExtractionInput,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  FollowupDraftWorkflowService,
} from '@server/modules/sales-behavior/followup-draft-workflow.service';
import { FollowupQualityService } from '@server/modules/sales-behavior/followup-quality.service';
import type {
  CreateDraftRecordInput,
  FollowupDraftRecord,
  FollowupDraftRepository,
  FollowupDraftVersionRecord,
} from '@server/modules/sales-behavior/followup-draft.repository';

const TENANT_ID = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID = '00000000-0000-4000-8000-00000000000b';

const extractedDraft = (): FollowupDraft => ({
  customerName: '北辰制造',
  contactName: '张总',
  opportunityName: '数字化项目',
  summary: '客户认可试点方案。',
  customerNeeds: ['华东工厂先试点'],
  objections: [],
  risks: [],
  progress: '方案已认可',
  expectedAmount: 500000,
  nextAction: '发送实施计划',
  dueAt: '2026-09-20T18:00:00+08:00',
  evidenceQuotes: ['客户认可试点方案', '发送实施计划'],
});

const readySalesContext = (): SalesContext => ({
  status: 'ready',
  customer: {
    name: '北辰制造',
    contactName: '张总',
    latestSummary: '正在评估试点方案',
    lastFollowupAt: '2026-09-18T02:00:00.000Z',
    source: {
      recordId: 'customer-1',
      recordUrl: 'https://feishu.cn/customer-1',
      sourceVersion: '2026-09-18T02:00:00.000Z',
    },
  },
  customerCandidates: [],
  opportunities: [{
    name: '数字化项目',
    progress: '方案评估中',
    expectedAmount: 500000,
    nextAction: '等待客户反馈',
    dueAt: '2026-09-19T18:00:00+08:00',
    source: {
      recordId: 'opportunity-1',
      recordUrl: 'https://feishu.cn/opportunity-1',
      sourceVersion: '2026-09-18T03:00:00.000Z',
    },
  }],
  recentFollowups: [],
  conflicts: [],
  tasks: [],
  warnings: [],
  readAt: '2026-09-19T02:00:00.000Z',
});

class FixedExtractor implements FollowupExtractor {
  async extract(_input: FollowupExtractionInput): Promise<FollowupDraft> {
    return extractedDraft();
  }

  getMissingFields(): [] {
    return [];
  }
}

class RecordingExtractor extends FixedExtractor {
  readonly inputs: FollowupExtractionInput[] = [];

  override async extract(
    input: FollowupExtractionInput,
  ): Promise<FollowupDraft> {
    this.inputs.push(input);
    return extractedDraft();
  }
}

class MemoryDraftRepository implements FollowupDraftRepository {
  records = new Map<string, FollowupDraftRecord>();
  byIdempotency = new Map<string, string>();

  async createGeneratedDraft(
    input: CreateDraftRecordInput,
  ): Promise<FollowupDraftRecord> {
    const key = `${input.tenantId}:${input.ownerMemberId}:${input.idempotencyKey}`;
    const existingId = this.byIdempotency.get(key);
    if (existingId) return structuredClone(this.records.get(existingId)!);
    const id = `draft-${this.records.size + 1}`;
    const version: FollowupDraftVersionRecord = {
      draftId: id,
      tenantId: input.tenantId,
      version: 1,
      creationKind: 'generated',
      sourceText: input.sourceText,
      generatedBody: input.generatedBody,
      draft: structuredClone(input.draft),
      quality: structuredClone(input.quality),
      salesContext: structuredClone(input.salesContext),
      progressAssessment: structuredClone(input.progressAssessment),
      createdAt: input.createdAt,
    };
    const record: FollowupDraftRecord = {
      id,
      tenantId: input.tenantId,
      ownerMemberId: input.ownerMemberId,
      sourceType: input.sourceType,
      status: 'pendingConfirmation',
      currentVersion: 1,
      version,
    };
    this.records.set(id, structuredClone(record));
    this.byIdempotency.set(key, id);
    return record;
  }

  async getDraft(
    tenantId: string,
    draftId: string,
  ): Promise<FollowupDraftRecord | null> {
    const record = this.records.get(draftId);
    return record?.tenantId === tenantId ? structuredClone(record) : null;
  }

  async appendUserEdit(input: {
    tenantId: string;
    draftId: string;
    ownerMemberId: string;
    expectedVersion: number;
    generatedBody: string;
    draft: FollowupDraft;
    quality: FollowupDraftVersionRecord['quality'];
    progressAssessment?: FollowupDraftVersionRecord['progressAssessment'];
    createdAt: Date;
  }): Promise<FollowupDraftRecord | null> {
    const record = this.records.get(input.draftId);
    if (!record || record.tenantId !== input.tenantId ||
      record.ownerMemberId !== input.ownerMemberId ||
      record.currentVersion !== input.expectedVersion ||
      record.status !== 'pendingConfirmation') return null;
    const versionNumber = record.currentVersion + 1;
    record.currentVersion = versionNumber;
    record.version = {
      ...record.version,
      version: versionNumber,
      creationKind: 'user_edit',
      generatedBody: input.generatedBody,
      draft: structuredClone(input.draft),
      quality: structuredClone(input.quality),
      progressAssessment: structuredClone(input.progressAssessment),
      createdAt: input.createdAt,
    };
    return structuredClone(record);
  }

  async markConfirmed(input: {
    tenantId: string;
    draftId: string;
    ownerMemberId: string;
    expectedVersion: number;
    confirmedAt: Date;
  }): Promise<FollowupDraftRecord | null> {
    const record = this.records.get(input.draftId);
    if (!record || record.tenantId !== input.tenantId ||
      record.ownerMemberId !== input.ownerMemberId ||
      record.currentVersion !== input.expectedVersion ||
      record.status !== 'pendingConfirmation') return null;
    record.status = 'confirmed';
    record.currentVersion += 1;
    record.version = {
      ...record.version,
      version: record.currentVersion,
      creationKind: 'confirmed',
      createdAt: input.confirmedAt,
    };
    return structuredClone(record);
  }
}

const service = (
  repository: MemoryDraftRepository,
  salesContext?: SalesContext,
): FollowupDraftWorkflowService => {
  const controlStore: ControlStore | undefined = salesContext === undefined
    ? undefined
    : {
      resolveTenantById: async (): Promise<TenantIntegration> => ({
        tenantId: TENANT_ID,
        feishuTenantKey: 'tenant-a',
        name: '企业 A',
        status: 'active',
        appId: 'cli_test',
        appSecretEnv: 'TEST_SECRET',
        appType: 'selfBuild',
        base: {
          appToken: 'base-a',
          customers: {
            tableId: 'customers', primaryField: '客户',
            fields: { customerName: '客户' },
          },
          opportunities: {
            tableId: 'opportunities', primaryField: '商机',
            fields: { opportunityName: '商机', customerLink: '客户' },
          },
          followups: {
            tableId: 'followups', primaryField: '跟进',
            fields: {
              sourceMessageId: '消息', customerLink: '客户',
              opportunityLink: '商机', rawText: '原文', summary: '摘要',
            },
          },
        },
      }),
    } as ControlStore;
  const reader: SalesContextReader | undefined = salesContext === undefined
    ? undefined
    : {
      read: async (): Promise<SalesContext> => salesContext,
    } as SalesContextReader;
  return new FollowupDraftWorkflowService(
    new FixedExtractor(),
    repository,
    new FollowupQualityService(),
    controlStore,
    reader,
  );
};

describe('FollowupDraftWorkflowService', (): void => {
  it('keeps Web advice but withholds task preview when owned tasks cannot be read', async (): Promise<void> => {
    const repository = new MemoryDraftRepository();
    const workflow = service(repository, {
      ...readySalesContext(),
      status: 'partial',
      warnings: ['task_context_permission_denied'],
    });

    const created = await workflow.create({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      ownerOpenId: 'ou_owner',
      sourceType: 'text',
      text: '北辰制造客户认可试点方案，下一步发送实施计划。',
      idempotencyKey: 'task-permission-denied',
      timezone: 'Asia/Shanghai',
      now: new Date('2026-09-19T10:00:00+08:00'),
    });

    expect(created.version.progressAssessment?.recommendation?.action)
      .toBe('发送实施计划');
    expect(created.version.taskCandidates).toEqual([]);
  });

  it('reads owner-scoped context before the visible Web draft and persists it', async (): Promise<void> => {
    const repository = new MemoryDraftRepository();
    const extractor = new RecordingExtractor();
    const integration: TenantIntegration = {
      tenantId: TENANT_ID,
      feishuTenantKey: 'tenant-a',
      name: '企业 A',
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
    const context: SalesContext = {
      status: 'ready',
      customer: {
        name: '北辰制造',
        contactName: '张总',
        latestSummary: '认可方案',
        lastFollowupAt: null,
        source: {
          recordId: 'customer-1',
          recordUrl: 'https://feishu.cn/customer-1',
          sourceVersion: '2026-09-25T01:00:00.000Z',
        },
      },
      customerCandidates: [],
      opportunities: [],
      recentFollowups: [],
      conflicts: [],
      tasks: [],
      warnings: [],
      readAt: '2026-09-25T02:00:00.000Z',
    };
    const controlStore = {
      resolveTenantById: vi.fn(
        async (): Promise<TenantIntegration> => integration,
      ),
    } as unknown as ControlStore;
    const reader = {
      read: async (): Promise<SalesContext> => context,
    } as unknown as SalesContextReader;
    const workflow = new FollowupDraftWorkflowService(
      extractor,
      repository,
      new FollowupQualityService(),
      controlStore,
      reader,
    );

    const created = await workflow.create({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      ownerOpenId: 'ou_owner',
      sourceType: 'text',
      text: '北辰制造客户认可方案，下一步发送实施计划。',
      idempotencyKey: 'input-context-web',
      timezone: 'Asia/Shanghai',
      now: new Date('2026-09-25T10:00:00+08:00'),
    });

    expect(extractor.inputs).toHaveLength(2);
    expect(extractor.inputs[1]?.salesContext).toEqual(context);
    expect(controlStore.resolveTenantById).toHaveBeenCalledWith(TENANT_ID);
    expect(created.version.salesContext).toEqual(context);
    expect(created.version.progressAssessment).toMatchObject({
      recommendation: {
        action: '发送实施计划',
        requiresConfirmation: true,
      },
    });
    expect(repository.records.get(created.id)?.version.salesContext)
      .toEqual(context);
  });

  it('creates one persisted preview for an idempotent text input without business writes', async (): Promise<void> => {
    const repository = new MemoryDraftRepository();
    const workflow = service(repository);
    const command = {
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      sourceType: 'text' as const,
      text: '客户认可试点方案，下一步发送实施计划。',
      idempotencyKey: 'input-001',
      timezone: 'Asia/Shanghai',
      now: new Date('2026-09-19T10:00:00+08:00'),
    };
    const first = await workflow.create(command);
    const repeated = await workflow.create(command);
    expect(first.id).toBe(repeated.id);
    expect(repository.records).toHaveLength(1);
    expect(first).toMatchObject({
      status: 'pendingConfirmation',
      currentVersion: 1,
      version: {
        creationKind: 'generated',
        draft: { customerName: '北辰制造' },
      },
    });
  });

  it('rejects reuse of an idempotency key with different source content', async (): Promise<void> => {
    const repository = new MemoryDraftRepository();
    const workflow = service(repository);
    const command = {
      tenantId: TENANT_ID, ownerMemberId: MEMBER_ID,
      sourceType: 'text' as const, text: '客户认可试点方案。',
      idempotencyKey: 'same-key', timezone: 'Asia/Shanghai', now: new Date(),
    };
    await workflow.create(command);
    await expect(workflow.create({
      ...command, text: '完全不同的客户沟通。',
    })).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
  });

  it('retains submitted form context in quality checks after an edit', async (): Promise<void> => {
    const repository = new MemoryDraftRepository();
    const workflow = service(repository);
    const created = await workflow.create({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      sourceType: 'card_form',
      text: [
        '沟通方式：电话',
        '沟通时间：2026-09-19T10:00',
        '主题：数字化项目',
        '沟通内容：客户认可试点方案，下一步发送实施计划。',
      ].join('\n'),
      idempotencyKey: 'input-form-quality',
      timezone: 'Asia/Shanghai',
      now: new Date('2026-09-19T11:00:00+08:00'),
    });
    expect(created.version.quality.missingItems).not.toContain(
      'communicationMethod',
    );
    expect(created.version.quality.missingItems).not.toContain(
      'communicationAt',
    );

    const edited = await workflow.edit({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      draftId: created.id,
      expectedVersion: 1,
      generatedBody: `${created.version.generatedBody}\n人工补充：确认决策人。`,
      draft: created.version.draft,
      now: new Date('2026-09-19T11:05:00+08:00'),
    });
    expect(edited.version.quality.missingItems).not.toContain(
      'communicationMethod',
    );
    expect(edited.version.quality.missingItems).not.toContain(
      'communicationAt',
    );
  });

  it('creates an immutable new version when the owner edits the generated body', async (): Promise<void> => {
    const repository = new MemoryDraftRepository();
    const workflow = service(repository, readySalesContext());
    const created = await workflow.create({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      ownerOpenId: 'ou_owner',
      sourceType: 'text',
      text: '客户认可试点方案，下一步发送实施计划。',
      idempotencyKey: 'input-002',
      timezone: 'Asia/Shanghai',
      now: new Date('2026-09-19T10:00:00+08:00'),
    });
    const edited = await workflow.edit({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      draftId: created.id,
      expectedVersion: 1,
      generatedBody: '客户认可试点方案。下一步由李胜彬发送实施计划并约张总复盘。',
      draft: {
        ...created.version.draft,
        nextAction: '发送实施计划并约张总复盘',
      },
      now: new Date('2026-09-19T10:05:00+08:00'),
    });
    expect(edited).toMatchObject({
      currentVersion: 2,
      version: {
        version: 2,
        creationKind: 'user_edit',
        progressAssessment: {
          recommendation: {
            action: '发送实施计划并约张总复盘',
          },
        },
      },
    });
  });

  it('rejects a stale edit and an edit by a different member with the same safe conflict', async (): Promise<void> => {
    const repository = new MemoryDraftRepository();
    const workflow = service(repository);
    const created = await workflow.create({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      sourceType: 'text',
      text: '客户认可试点方案，下一步发送实施计划。',
      idempotencyKey: 'input-003',
      timezone: 'Asia/Shanghai',
      now: new Date(),
    });
    const edit = {
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      draftId: created.id,
      expectedVersion: 0,
      generatedBody: created.version.generatedBody,
      draft: created.version.draft,
      now: new Date(),
    };
    await expect(workflow.edit(edit)).rejects.toMatchObject({
      code: 'DRAFT_CONFLICT',
    });
    await expect(workflow.edit({
      ...edit,
      expectedVersion: 1,
      ownerMemberId: '00000000-0000-4000-8000-00000000000c',
    })).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
  });
});
