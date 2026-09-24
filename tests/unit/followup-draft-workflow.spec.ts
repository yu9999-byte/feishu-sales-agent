import { describe, expect, it } from 'vitest';

import type { FollowupDraft } from '@shared/api.interface';
import type {
  FollowupExtractor,
} from '@server/modules/agent-core/agent.ports';
import type {
  FollowupExtractionInput,
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

class FixedExtractor implements FollowupExtractor {
  async extract(_input: FollowupExtractionInput): Promise<FollowupDraft> {
    return extractedDraft();
  }

  getMissingFields(): [] {
    return [];
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

const service = (repository: MemoryDraftRepository): FollowupDraftWorkflowService =>
  new FollowupDraftWorkflowService(
    new FixedExtractor(),
    repository,
    new FollowupQualityService(),
  );

describe('FollowupDraftWorkflowService', (): void => {
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
    const workflow = service(repository);
    const created = await workflow.create({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
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
      version: { version: 2, creationKind: 'user_edit' },
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
