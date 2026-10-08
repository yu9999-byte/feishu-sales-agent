import { describe, expect, it, vi } from 'vitest';

import type {
  PlaybookOptimizationCandidate,
  PlaybookOptimizationReason,
  PlaybookOptimizationSourceRef,
  SalesKnowledgeQaResponse,
} from '@shared/api.interface';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import type {
  PlaybookOptimizationRecordInput,
  PlaybookOptimizationRepository,
  PlaybookOptimizationReviewInput,
} from '@server/modules/knowledge/playbook-optimization.ports';
import {
  PlaybookOptimizationError,
  PlaybookOptimizationService,
  questionFingerprint,
  topicPreview,
} from '@server/modules/knowledge/playbook-optimization.service';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-08T03:00:00.000Z');

const integration: TenantIntegration = {
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-key',
  name: '测试企业',
  status: 'active',
  appId: 'app',
  appSecretEnv: 'TEST_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base',
    customers: {
      tableId: 'customers',
      primaryField: '客户',
      fields: { customerName: '客户' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机',
      fields: { opportunityName: '商机', customerLink: '客户关联' },
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
      },
    },
    knowledge: {
      sources: [{
        id: 'capabilities',
        sourceType: 'docx',
        token: 'secret-doc-token',
        url: 'https://example.feishu.cn/docx/secret-doc-token',
        applicability: '内部资料',
        keywords: ['产品能力'],
        categories: ['solution_overview'],
      }],
    },
  },
};

const result = (
  status: SalesKnowledgeQaResponse['status'],
): SalesKnowledgeQaResponse => ({
  status,
  answer: status === 'answered' ? '机密答案正文' : '没有可信答案',
  configuredSourceCount: 1,
  checkedSourceCount: 1,
  trustedResultCount: status === 'answered' ? 1 : 0,
  citations: status === 'answered' ? [{
    sourceId: 'capabilities',
    sourceType: 'docx',
    title: '内部产品资料',
    url: 'https://example.feishu.cn/docx/secret-doc-token',
    matchedTerms: ['产品能力'],
    excerpt: '机密正文摘录',
    citation: '正文第 2 段',
    sourceVersion: 'revision:3',
    applicability: '内部资料',
    accessVerified: true,
  }] : [],
  warnings: [],
});

const candidate = (
  overrides: Partial<PlaybookOptimizationCandidate> = {},
): PlaybookOptimizationCandidate => ({
  id: '30000000-0000-4000-8000-000000000001',
  topicPreview: '产品能力与解决方案',
  lastQaStatus: 'no_trusted_match',
  occurrenceCount: 1,
  reasons: ['no_trusted_answer'],
  sources: [{ sourceId: 'capabilities', sourceVersion: null }],
  status: 'pending_review',
  firstObservedAt: NOW.toISOString(),
  lastObservedAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...overrides,
});

const setup = (overrides: {
  observe?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
  review?: ReturnType<typeof vi.fn>;
} = {}) => {
  const repository = {
    observe: overrides.observe ?? vi.fn(async (
      input: PlaybookOptimizationRecordInput,
    ) => candidate({
      topicPreview: input.topicPreview,
      lastQaStatus: input.qaStatus,
      reasons: input.reasons,
      sources: input.sources,
    })),
    list: overrides.list ?? vi.fn(async () => []),
    review: overrides.review ?? vi.fn(async (
      _input: PlaybookOptimizationReviewInput,
    ) => ({
      status: 'reviewed' as const,
      candidate: candidate({ status: 'accepted_for_authoring' }),
      reviewId: '40000000-0000-4000-8000-000000000001',
    })),
  };
  return {
    repository,
    service: new PlaybookOptimizationService(
      repository as unknown as PlaybookOptimizationRepository,
    ),
  };
};

describe('PlaybookOptimizationService', (): void => {
  it('turns a no-match into a privacy-safe pending signal', async (): Promise<void> => {
    const { repository, service } = setup();
    const rawQuestion = '北辰制造 13800138000 的报价能力怎么说？';

    await service.observe({
      integration,
      question: rawQuestion,
      result: result('no_trusted_match'),
      observedAt: NOW,
    });

    expect(repository.observe).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      questionFingerprint: questionFingerprint(rawQuestion),
      topicPreview: '报价、折扣与商务边界',
      qaStatus: 'no_trusted_match',
      reasons: ['no_trusted_answer'],
      sources: [{ sourceId: 'capabilities', sourceVersion: null }],
      observedAt: NOW,
    });
    const persisted: string = JSON.stringify(
      repository.observe.mock.calls[0]?.[0],
    );
    expect(persisted).not.toContain('北辰制造');
    expect(persisted).not.toContain('13800138000');
    expect(persisted).not.toContain('机密答案正文');
    expect(persisted).not.toContain('机密正文摘录');
    expect(persisted).not.toContain('secret-doc-token');
  });

  it('does not create a candidate when the library is not configured', async (): Promise<void> => {
    const { repository, service } = setup();

    await expect(service.observe({
      integration,
      question: '产品能力是什么？',
      result: result('not_configured'),
      observedAt: NOW,
    })).resolves.toBeNull();
    expect(repository.observe).not.toHaveBeenCalled();
  });

  it.each([
    ['partial', ['source_unavailable']],
    ['unavailable', ['source_unavailable']],
    ['answered', []],
  ] as Array<[SalesKnowledgeQaResponse['status'], PlaybookOptimizationReason[]]>) (
    'maps %s to the expected initial reason',
    async (status, reasons): Promise<void> => {
      const { repository, service } = setup();
      await service.observe({
        integration,
        question: '产品能力是什么？',
        result: result(status),
        observedAt: NOW,
      });
      expect(repository.observe).toHaveBeenCalledWith(
        expect.objectContaining({ qaStatus: status, reasons }),
      );
    },
  );

  it('summarizes the review queue without cross-tenant input', async (): Promise<void> => {
    const items: PlaybookOptimizationCandidate[] = [
      candidate(),
      candidate({ id: '2', status: 'observing' }),
      candidate({ id: '3', status: 'accepted_for_authoring' }),
      candidate({ id: '4', status: 'dismissed' }),
    ];
    const list = vi.fn(async () => items);
    const { service } = setup({ list });

    const response = await service.list(TENANT_ID, 20);

    expect(list).toHaveBeenCalledWith({ tenantId: TENANT_ID, limit: 20 });
    expect(response.summary).toEqual({
      pendingReview: 1,
      observing: 1,
      acceptedForAuthoring: 1,
      dismissed: 1,
    });
  });

  it('maps a stale optimistic version to a conflict without retrying', async (): Promise<void> => {
    const review = vi.fn(async () => ({
      status: 'conflict' as const,
      currentUpdatedAt: new Date('2026-10-08T03:01:00.000Z'),
    }));
    const { service } = setup({ review });

    await expect(service.review({
      tenantId: TENANT_ID,
      candidateId: '30000000-0000-4000-8000-000000000001',
      reviewerMemberId: '20000000-0000-4000-8000-000000000001',
      decision: 'dismiss',
      expectedUpdatedAt: NOW.toISOString(),
      note: '当前不进入资料编写',
      now: new Date('2026-10-08T03:02:00.000Z'),
    })).rejects.toMatchObject<Partial<PlaybookOptimizationError>>({
      code: 'CONFLICT',
      currentUpdatedAt: '2026-10-08T03:01:00.000Z',
    });
    expect(review).toHaveBeenCalledTimes(1);
  });

  it('uses category labels instead of retaining free-form questions', (): void => {
    expect(topicPreview('华东某客户 API 对接有什么限制？'))
      .toBe('集成、接口与技术条件');
    expect(topicPreview('张总的特殊诉求是什么？'))
      .toBe('其他销售知识问题');
  });
});
