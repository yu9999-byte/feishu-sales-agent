import { describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';
import {
  FollowupDraftController,
} from '@server/modules/sales-behavior/followup-draft.controller';
import type { FeishuWebAuthService } from '@server/modules/web-auth/feishu-web-auth.service';
import type { PlatformSessionService } from '@server/modules/platform-shell/platform-session.service';
import type { FollowupDraftWorkflowService } from '@server/modules/sales-behavior/followup-draft-workflow.service';
import type { FollowupConfirmationService } from '@server/modules/sales-behavior/followup-confirmation.service';
import { FollowupExtractionUnavailableError } from '@server/modules/agent-core/agent.errors';

const TENANT_ID = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID = '00000000-0000-4000-8000-00000000000b';

const request = (origin = 'https://agent.example.com'): Request => ({
  headers: {
    origin,
    cookie: 'sales-agent-session=opaque-session',
  },
}) as Request;

const setup = (): {
  controller: FollowupDraftController;
  workflow: FollowupDraftWorkflowService;
  confirmation: FollowupConfirmationService;
} => {
  const record = {
    id: 'draft-1',
    tenantId: TENANT_ID,
    ownerMemberId: MEMBER_ID,
    sourceType: 'text',
    status: 'pendingConfirmation',
    currentVersion: 1,
    version: {
      draftId: 'draft-1',
      tenantId: TENANT_ID,
      version: 1,
      creationKind: 'generated',
      sourceText: '来源',
      generatedBody: '生成的跟进正文，下一步发送实施计划。',
      draft: {
        customerName: '北辰制造', contactName: null,
        opportunityName: null, summary: '摘要', customerNeeds: [],
        objections: [], risks: [], progress: null,
        expectedAmount: null, nextAction: '发送实施计划',
        dueAt: '2026-09-20T18:00:00+08:00', evidenceQuotes: [],
      },
      quality: {
        score: 60, grade: 'C', confirmable: true,
        scoreVersion: 'followup-quality-v1',
        dimensions: { basics: 10, dealFacts: 10, nextStep: 20, evidence: 10, writing: 10 },
        missingItems: [], invalidEvidence: [], risks: [], suggestions: [],
      },
      progressAssessment: {
        state: 'needs_attention',
        headline: '商机可以继续推进，但还有信息缺口',
        facts: [],
        findings: [],
        recommendation: null,
        warnings: [],
        assessedAt: '2026-09-25T02:00:00.000Z',
      },
      createdAt: new Date(),
    },
  };
  const auth = {
    publicOrigin: 'https://agent.example.com',
    authenticateSession: vi.fn().mockResolvedValue({
      tenantId: TENANT_ID,
      member: {
        id: MEMBER_ID,
        tenantId: TENANT_ID,
        feishuOpenId: 'ou_current',
        displayName: '李胜彬',
        status: 'active',
      },
      tokenHash: 'hash',
    }),
  } as unknown as FeishuWebAuthService;
  const sessions = {
    getSessionByMembership: vi.fn().mockResolvedValue({
      permissions: ['followup:create-own', 'followup:confirm-own', 'followup:read'],
    }),
  } as unknown as PlatformSessionService;
  const workflow = {
    create: vi.fn().mockResolvedValue(record),
    edit: vi.fn().mockResolvedValue(record),
    getOwned: vi.fn().mockResolvedValue(record),
  } as unknown as FollowupDraftWorkflowService;
  const confirmation = {
    confirm: vi.fn().mockResolvedValue({
      pendingActionId: 'draft-1', status: 'succeeded',
      followupRecordId: 'rec-1', taskGuid: 'task-1',
    }),
  } as unknown as FollowupConfirmationService;
  return {
    controller: new FollowupDraftController(auth, sessions, workflow, confirmation),
    workflow,
    confirmation,
  };
};

describe('FollowupDraftController boundary', (): void => {
  it('returns the versioned progress assessment to the Web draft', async (): Promise<void> => {
    const { controller } = setup();

    const result = await controller.get(request(), 'draft-1');

    expect(result.version.progressAssessment).toMatchObject({
      state: 'needs_attention',
      headline: '商机可以继续推进，但还有信息缺口',
      recommendation: null,
    });
  });

  it('derives tenant and owner from the trusted session, ignoring forged body identifiers', async (): Promise<void> => {
    const { controller, workflow } = setup();
    await controller.create(request(), {
      tenantId: 'forged-tenant',
      ownerMemberId: 'forged-member',
      sourceType: 'text',
      text: '北辰制造客户认可方案，下一步明天发送实施计划。',
      idempotencyKey: 'input-001',
    });
    expect(workflow.create).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      sourceType: 'text',
      ownerOpenId: 'ou_current',
    }));
  });

  it('rejects a cross-site write before creating a draft', async (): Promise<void> => {
    const { controller, workflow } = setup();
    await expect(controller.create(request('https://evil.example'), {
      sourceType: 'text',
      text: '测试内容',
      idempotencyKey: 'input-002',
    })).rejects.toMatchObject({ status: 403 });
    expect(workflow.create).not.toHaveBeenCalled();
  });

  it('normalizes card form facts into the source while keeping the actor server-side', async (): Promise<void> => {
    const { controller, workflow } = setup();
    await controller.create(request(), {
      sourceType: 'card_form',
      text: '客户认可试点方案。',
      idempotencyKey: 'input-003',
      form: {
        customerName: '北辰制造',
        contactName: '张总',
        communicationMethod: '视频会议',
        nextAction: '发送实施计划',
        dueAt: '2026-09-20T18:00:00+08:00',
      },
    });
    expect(workflow.create).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('客户：北辰制造'),
    }));
    expect(workflow.create).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('下一步：发送实施计划'),
    }));
  });

  it('returns a retryable service error when the model remains busy', async (): Promise<void> => {
    const { controller, workflow } = setup();
    vi.mocked(workflow.create).mockRejectedValueOnce(
      new FollowupExtractionUnavailableError(),
    );

    await expect(controller.create(request(), {
      sourceType: 'text',
      text: 'UI 测试销售跟进内容',
      idempotencyKey: 'input-model-busy',
    })).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'DEPENDENCY_UNAVAILABLE',
        retryable: true,
      },
    });
  });

  it('confirms with server-side tenant, member and open ID, never forged body identities', async (): Promise<void> => {
    const { controller, confirmation } = setup();
    const result = await controller.confirm(request(), 'draft-1', {
      expectedVersion: 1,
      selectedTaskCandidateIds: ['draft-1:v1:task:0'],
      tenantId: 'forged-tenant',
      ownerOpenId: 'ou_forged',
    });
    expect(result.status).toBe('succeeded');
    expect(confirmation.confirm).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      ownerMemberId: MEMBER_ID,
      ownerOpenId: 'ou_current',
      draftId: 'draft-1',
      expectedVersion: 1,
      selectedTaskCandidateIds: ['draft-1:v1:task:0'],
    }));
  });

  it('requires an explicit task selection, including an empty selection', async (): Promise<void> => {
    const { controller, confirmation } = setup();

    await expect(controller.confirm(request(), 'draft-1', {
      expectedVersion: 1,
    })).rejects.toMatchObject({ name: 'ZodError' });
    expect(confirmation.confirm).not.toHaveBeenCalled();
  });

  it('blocks a cross-site confirm before invoking external writes', async (): Promise<void> => {
    const { controller, confirmation } = setup();
    await expect(controller.confirm(
      request('https://evil.example'), 'draft-1', {
        expectedVersion: 1,
        selectedTaskCandidateIds: [],
      },
    )).rejects.toMatchObject({ status: 403 });
    expect(confirmation.confirm).not.toHaveBeenCalled();
  });
});
