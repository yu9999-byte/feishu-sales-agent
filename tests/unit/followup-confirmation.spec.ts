import { describe, expect, it, vi } from 'vitest';

import type { AgentExecutionResult } from '@shared/api.interface';
import { MemoryControlStore } from '@server/modules/agent-core/memory-control.store';
import type { AgentActionExecutorService } from '@server/modules/agent-core/agent-action-executor.service';
import type { PendingAction, TenantIntegration } from '@server/modules/agent-core/agent.types';
import {
  FollowupConfirmationService,
} from '@server/modules/sales-behavior/followup-confirmation.service';
import type {
  FollowupDraftRecord,
  FollowupDraftRepository,
} from '@server/modules/sales-behavior/followup-draft.repository';

const TENANT_ID = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID = '00000000-0000-4000-8000-00000000000b';
const DRAFT_ID = '00000000-0000-4000-8000-00000000000c';
const TASK_CANDIDATE_ID = `${DRAFT_ID}:v1:task:0`;

const integration: TenantIntegration = {
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-a',
  name: '企业 A',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_APP_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base',
    customers: { tableId: 'customers', primaryField: '客户', fields: { customerName: '客户' } },
    opportunities: { tableId: 'opportunities', primaryField: '商机', fields: { opportunityName: '商机', customerLink: '客户' } },
    followups: { tableId: 'followups', primaryField: '跟进', fields: { sourceMessageId: '来源', customerLink: '客户', opportunityLink: '商机', rawText: '原文', summary: '摘要' } },
  },
};

const draftRecord = (confirmable = true): FollowupDraftRecord => ({
  id: DRAFT_ID,
  tenantId: TENANT_ID,
  ownerMemberId: MEMBER_ID,
  sourceType: 'text',
  status: 'pendingConfirmation',
  currentVersion: 1,
  version: {
    tenantId: TENANT_ID,
    draftId: DRAFT_ID,
    version: 1,
    creationKind: 'generated',
    sourceText: '北辰制造客户认可方案，下一步发送实施计划。',
    generatedBody: '北辰制造客户认可方案。下一步发送实施计划。',
    draft: {
      customerName: '北辰制造', contactName: '张总', opportunityName: '项目',
      summary: '客户认可方案', customerNeeds: [], objections: [], risks: [],
      progress: '方案认可', expectedAmount: null, nextAction: '发送实施计划',
      dueAt: '2026-09-20T18:00:00+08:00', evidenceQuotes: ['客户认可方案'],
      nextActionChannel: '邮件', nextActionParticipants: ['张总'],
    },
    quality: {
      score: 76, grade: 'B', confirmable,
      scoreVersion: 'followup-quality-v1',
      dimensions: { basics: 20, dealFacts: 10, nextStep: 20, evidence: 16, writing: 10 },
      missingItems: [], invalidEvidence: confirmable ? [] : [{ field: 'summary', quote: '不存在' }],
      risks: [], suggestions: [],
    },
    createdAt: new Date(),
  },
});

describe('FollowupConfirmationService', (): void => {
  it('executes an exact confirmable version once and returns the existing result on retry', async (): Promise<void> => {
    const control = new MemoryControlStore([integration]);
    let record = draftRecord();
    const repository = {
      getDraft: vi.fn().mockImplementation(async (): Promise<FollowupDraftRecord> => structuredClone(record)),
      markConfirmed: vi.fn().mockImplementation(async (): Promise<FollowupDraftRecord> => {
        record = { ...record, status: 'confirmed', currentVersion: 2, version: { ...record.version, version: 2, creationKind: 'confirmed' } };
        return structuredClone(record);
      }),
    } as unknown as FollowupDraftRepository;
    const executor = {
      executeImmediately: vi.fn().mockImplementation(async (
        _integration: TenantIntegration,
        action: PendingAction,
      ): Promise<AgentExecutionResult> => {
        const result: AgentExecutionResult = {
          pendingActionId: action.id,
          status: 'succeeded',
          followupRecordId: 'rec_followup',
          taskGuid: 'task-guid',
        };
        await control.saveExecutionResult(TENANT_ID, action.id, 'succeeded', result);
        return result;
      }),
    } as unknown as AgentActionExecutorService;
    const service = new FollowupConfirmationService(control, repository, executor);
    const command = {
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      ownerOpenId: 'ou_owner',
      draftId: DRAFT_ID,
      expectedVersion: 1,
      selectedTaskCandidateIds: [TASK_CANDIDATE_ID],
      traceId: 'trace-confirm',
      now: new Date('2026-09-19T10:00:00+08:00'),
    };
    const first = await service.confirm(command);
    const retried = await service.confirm(command);
    expect(first).toMatchObject({ status: 'succeeded', taskGuid: 'task-guid' });
    expect(retried).toEqual(first);
    expect(executor.executeImmediately).toHaveBeenCalledTimes(1);
    expect(repository.markConfirmed).toHaveBeenCalledTimes(1);
    expect(executor.executeImmediately).toHaveBeenCalledWith(
      integration,
      expect.objectContaining({
        payload: expect.objectContaining({
          selectedTaskCandidateIds: [TASK_CANDIDATE_ID],
          taskCandidates: [
            expect.objectContaining({
              id: TASK_CANDIDATE_ID,
              draftVersion: 1,
              status: 'ready',
            }),
          ],
        }),
      }),
      'trace-confirm',
    );
  });

  it('does not create or execute an action when evidence blocks confirmation', async (): Promise<void> => {
    const control = new MemoryControlStore([integration]);
    const repository = {
      getDraft: vi.fn().mockResolvedValue(draftRecord(false)),
      markConfirmed: vi.fn(),
    } as unknown as FollowupDraftRepository;
    const executor = { executeImmediately: vi.fn() } as unknown as AgentActionExecutorService;
    const service = new FollowupConfirmationService(control, repository, executor);
    await expect(service.confirm({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      ownerOpenId: 'ou_owner',
      draftId: DRAFT_ID,
      expectedVersion: 1,
      selectedTaskCandidateIds: [TASK_CANDIDATE_ID],
      traceId: 'trace-blocked',
      now: new Date(),
    })).rejects.toMatchObject({ code: 'DRAFT_NOT_CONFIRMABLE' });
    await expect(control.getPendingAction(TENANT_ID, DRAFT_ID)).resolves.toBeNull();
    expect(executor.executeImmediately).not.toHaveBeenCalled();
  });

  it('rejects a stale version and a different owner before writing anything', async (): Promise<void> => {
    const control = new MemoryControlStore([integration]);
    const repository = {
      getDraft: vi.fn().mockResolvedValue(draftRecord()),
      markConfirmed: vi.fn(),
    } as unknown as FollowupDraftRepository;
    const executor = { executeImmediately: vi.fn() } as unknown as AgentActionExecutorService;
    const service = new FollowupConfirmationService(control, repository, executor);
    const command = {
      tenantId: TENANT_ID, ownerMemberId: MEMBER_ID,
      ownerOpenId: 'ou_owner', draftId: DRAFT_ID,
      expectedVersion: 2, traceId: 'trace-stale', now: new Date(),
      selectedTaskCandidateIds: [TASK_CANDIDATE_ID],
    };
    await expect(service.confirm(command)).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    await expect(service.confirm({
      ...command, ownerMemberId: '00000000-0000-4000-8000-00000000000d',
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(repository.markConfirmed).not.toHaveBeenCalled();
    expect(executor.executeImmediately).not.toHaveBeenCalled();
  });

  it('grants only one execution lease across concurrent confirmations', async (): Promise<void> => {
    const control = new MemoryControlStore([integration]);
    let record = draftRecord();
    const repository = {
      getDraft: vi.fn().mockImplementation(async (): Promise<FollowupDraftRecord> => structuredClone(record)),
      markConfirmed: vi.fn().mockImplementation(async (): Promise<FollowupDraftRecord> => {
        record = { ...record, status: 'confirmed', currentVersion: 2,
          version: { ...record.version, version: 2, creationKind: 'confirmed' } };
        return structuredClone(record);
      }),
    } as unknown as FollowupDraftRepository;
    const executor = {
      executeImmediately: vi.fn().mockImplementation(async (
        _integration: TenantIntegration, action: PendingAction,
      ): Promise<AgentExecutionResult> => {
        await control.saveExecutionResult(TENANT_ID, action.id, 'succeeded', {
          pendingActionId: action.id, status: 'succeeded', taskGuid: 'one-task',
        });
        return { pendingActionId: action.id, status: 'succeeded', taskGuid: 'one-task' };
      }),
    } as unknown as AgentActionExecutorService;
    const service = new FollowupConfirmationService(control, repository, executor);
    const command = { tenantId: TENANT_ID, ownerMemberId: MEMBER_ID,
      ownerOpenId: 'ou_owner', draftId: DRAFT_ID, expectedVersion: 1,
      selectedTaskCandidateIds: [TASK_CANDIDATE_ID],
      traceId: 'trace-concurrent',
      now: new Date('2026-09-19T10:00:00+08:00') };
    await Promise.all([service.confirm(command), service.confirm(command)]);
    expect(executor.executeImmediately).toHaveBeenCalledTimes(1);
  });

  it('recovers when another request wins the version compare-and-swap', async (): Promise<void> => {
    const control = new MemoryControlStore([integration]);
    let record = draftRecord();
    const repository = {
      getDraft: vi.fn().mockImplementation(async (): Promise<FollowupDraftRecord> => structuredClone(record)),
      markConfirmed: vi.fn().mockImplementation(async (): Promise<null> => {
        record = { ...record, status: 'confirmed', currentVersion: 2,
          version: { ...record.version, version: 2, creationKind: 'confirmed' } };
        return null;
      }),
    } as unknown as FollowupDraftRepository;
    const executor = {
      executeImmediately: vi.fn().mockResolvedValue({
        pendingActionId: DRAFT_ID, status: 'succeeded', taskGuid: 'one-task',
      }),
    } as unknown as AgentActionExecutorService;
    const service = new FollowupConfirmationService(control, repository, executor);
    await expect(service.confirm({
      tenantId: TENANT_ID, ownerMemberId: MEMBER_ID, ownerOpenId: 'ou_owner',
      draftId: DRAFT_ID, expectedVersion: 1, traceId: 'trace-race',
      now: new Date('2026-09-19T10:00:00+08:00'),
      selectedTaskCandidateIds: [TASK_CANDIDATE_ID],
    })).resolves.toMatchObject({ status: 'succeeded' });
    expect(executor.executeImmediately).toHaveBeenCalledTimes(1);
  });

  it('rejects a task candidate that was not derived from the confirmed version', async (): Promise<void> => {
    const control = new MemoryControlStore([integration]);
    const repository = {
      getDraft: vi.fn().mockResolvedValue(draftRecord()),
      markConfirmed: vi.fn(),
    } as unknown as FollowupDraftRepository;
    const executor = {
      executeImmediately: vi.fn(),
    } as unknown as AgentActionExecutorService;
    const service = new FollowupConfirmationService(
      control,
      repository,
      executor,
    );

    await expect(service.confirm({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      ownerOpenId: 'ou_owner',
      draftId: DRAFT_ID,
      expectedVersion: 1,
      selectedTaskCandidateIds: [`${DRAFT_ID}:v0:task:0`],
      traceId: 'trace-forged-task',
      now: new Date(),
    })).rejects.toMatchObject({ code: 'TASK_SELECTION_INVALID' });
    expect(repository.markConfirmed).not.toHaveBeenCalled();
    expect(executor.executeImmediately).not.toHaveBeenCalled();
  });

  it('rejects changing the task selection after the version was confirmed', async (): Promise<void> => {
    const control = new MemoryControlStore([integration]);
    let record = draftRecord();
    const repository = {
      getDraft: vi.fn().mockImplementation(
        async (): Promise<FollowupDraftRecord> => structuredClone(record),
      ),
      markConfirmed: vi.fn().mockImplementation(
        async (): Promise<FollowupDraftRecord> => {
          record = {
            ...record,
            status: 'confirmed',
            currentVersion: 2,
            version: {
              ...record.version,
              version: 2,
              creationKind: 'confirmed',
            },
          };
          return structuredClone(record);
        },
      ),
    } as unknown as FollowupDraftRepository;
    const executor = {
      executeImmediately: vi.fn().mockImplementation(async (
        _integration: TenantIntegration,
        action: PendingAction,
      ): Promise<AgentExecutionResult> => {
        const result: AgentExecutionResult = {
          pendingActionId: action.id,
          status: 'succeeded',
          taskGuid: 'task-guid',
        };
        await control.saveExecutionResult(
          TENANT_ID,
          action.id,
          'succeeded',
          result,
        );
        return result;
      }),
    } as unknown as AgentActionExecutorService;
    const service = new FollowupConfirmationService(
      control,
      repository,
      executor,
    );
    const command = {
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      ownerOpenId: 'ou_owner',
      draftId: DRAFT_ID,
      expectedVersion: 1,
      selectedTaskCandidateIds: [TASK_CANDIDATE_ID],
      traceId: 'trace-selection-locked',
      now: new Date('2026-09-19T10:00:00+08:00'),
    };

    await service.confirm(command);
    await expect(service.confirm({
      ...command,
      selectedTaskCandidateIds: [],
    })).rejects.toMatchObject({ code: 'TASK_SELECTION_INVALID' });
    expect(executor.executeImmediately).toHaveBeenCalledTimes(1);
  });
});
