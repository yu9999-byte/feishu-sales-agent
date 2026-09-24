import { describe, expect, it, vi } from 'vitest';

import type { FollowupDraft, JsonObject } from '@shared/api.interface';
import type { PlatformSessionService } from '@server/modules/platform-shell/platform-session.service';
import { FollowupChatDraftService } from '@server/modules/sales-behavior/followup-chat-draft.service';
import { FollowupQualityService } from '@server/modules/sales-behavior/followup-quality.service';
import type { TenantIntegration } from '@server/modules/agent-core/agent.types';

const integration: TenantIntegration = {
  tenantId: '00000000-0000-4000-8000-00000000000a',
  feishuTenantKey: 'tenant-a',
  name: '企业 A',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_APP_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base',
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
        sourceMessageId: '来源', customerLink: '客户',
        opportunityLink: '商机', rawText: '原文', summary: '摘要',
      },
    },
  },
};

const draft: FollowupDraft = {
  customerName: '北辰制造',
  contactName: '张总',
  opportunityName: '试点项目',
  summary: '客户认可方案',
  customerNeeds: ['实施计划'],
  objections: [],
  risks: [],
  progress: '方案认可',
  expectedAmount: null,
  nextAction: '发送实施计划',
  dueAt: '2026-09-20T18:00:00+08:00',
  nextActionChannel: '邮件',
  nextActionParticipants: ['张总'],
  evidenceQuotes: ['客户认可方案'],
};

const createService = (): FollowupChatDraftService => {
  const sessions = {
    getSession: vi.fn().mockResolvedValue({
      tenant: {
        id: integration.tenantId,
        name: integration.name,
        timezone: 'Asia/Shanghai',
      },
      member: {
        id: '00000000-0000-4000-8000-00000000000b',
        feishuOpenId: 'ou_owner',
        displayName: '李胜彬',
      },
      roles: ['sales'],
      permissions: ['followup:create-own'],
      navigation: [],
      policyVersion: 'test',
    }),
  } as unknown as PlatformSessionService;
  return new FollowupChatDraftService(
    sessions,
    new FollowupQualityService(),
  );
};

describe('FollowupChatDraftService', (): void => {
  it('maps model-extracted communication context into a text draft', async (): Promise<void> => {
    const service = createService();
    const payload = await service.createPayload({
      integration,
      actionId: '00000000-0000-4000-8000-000000000009',
      actorOpenId: 'ou_owner',
      sourceMessageId: 'om_context',
      rawText: '今天上午通过飞书与北辰制造张总沟通试点方案。',
      draft: {
        ...draft,
        communicationMethod: '飞书',
        communicationAt: '2026-09-20T10:00:00+08:00',
        topic: '试点方案',
      },
      now: new Date('2026-09-20T12:00:00+08:00'),
    });

    expect(payload.inputForm).toMatchObject({
      communicationMethod: '飞书',
      communicationAt: '2026-09-20T10:00:00+08:00',
      topic: '试点方案',
    });
    expect(payload.quality?.missingItems).not.toContain(
      'communicationMethod',
    );
    expect(payload.quality?.missingItems).not.toContain('communicationAt');
  });

  it('creates a quality snapshot and version-bound ready task preview', async (): Promise<void> => {
    const service = createService();
    const payload = await service.createPayload({
      integration,
      actionId: '00000000-0000-4000-8000-000000000001',
      actorOpenId: 'ou_owner',
      sourceMessageId: 'om_source',
      rawText: '北辰制造客户认可方案，下一步邮件发送实施计划给张总。',
      draft,
      now: new Date('2026-09-20T10:00:00+08:00'),
    });

    expect(payload.draftVersion).toBe(1);
    expect(payload.ownerMemberId).toBe(
      '00000000-0000-4000-8000-00000000000b',
    );
    expect(payload.quality).toMatchObject({ confirmable: true });
    expect(payload.taskCandidates).toEqual([
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001:v1:task:0',
        status: 'ready',
      }),
    ]);
    expect(payload.selectedTaskCandidateIds).toEqual([
      '00000000-0000-4000-8000-000000000001:v1:task:0',
    ]);
  });

  it('turns card edits into a new reviewed version and recomputes tasks', async (): Promise<void> => {
    const service = createService();
    const payload = await service.createPayload({
      integration,
      actionId: '00000000-0000-4000-8000-000000000001',
      actorOpenId: 'ou_owner',
      sourceMessageId: 'om_source',
      rawText: '北辰制造客户认可方案，下一步邮件发送实施计划给张总。',
      draft,
      now: new Date('2026-09-20T10:00:00+08:00'),
    });
    const formValue: JsonObject = {
      generatedBody: payload.generatedBody ?? '',
      customerName: '北辰制造',
      contactName: '张总',
      nextAction: '安排现场技术交流',
      dueAt: '2026-09-22 14:00 +0800',
      nextActionChannel: '客户现场',
      nextActionParticipants: '张总、售前王工',
      task_0: true,
    };

    const reviewed = service.reviewForm(
      '00000000-0000-4000-8000-000000000001',
      payload,
      formValue,
      new Date('2026-09-20T10:05:00+08:00'),
    );

    expect(reviewed.contentChanged).toBe(true);
    expect(reviewed.payload.draftVersion).toBe(2);
    expect(reviewed.payload.draft.nextActionChannel).toBe('客户现场');
    expect(reviewed.payload.draft.nextActionParticipants)
      .toEqual(['张总', '售前王工']);
    expect(reviewed.payload.taskCandidates?.[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001:v2:task:0',
      status: 'ready',
    });
  });
});
