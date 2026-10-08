import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  PlaybookOptimizationCandidate,
  PlaybookOptimizationCandidateListResponse,
  PlaybookOptimizationReason,
  PlaybookOptimizationReviewDecision,
  PlaybookOptimizationReviewResponse,
  PlaybookOptimizationSourceRef,
  SalesKnowledgeQaStatus,
} from '@shared/api.interface';
import {
  PLAYBOOK_OPTIMIZATION_REPOSITORY,
  type PlaybookOptimizationObservationInput,
  type PlaybookOptimizationObserver,
  type PlaybookOptimizationRepository,
  type PlaybookOptimizationReviewResult,
} from './playbook-optimization.ports';

type PlaybookOptimizationErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DEPENDENCY_UNAVAILABLE';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MIN_NOTE_LENGTH = 2;
const MAX_NOTE_LENGTH = 500;
const OFFSET_DATE_TIME: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const TOPIC_RULES: Array<{ label: string; terms: string[] }> = [
  { label: '报价、折扣与商务边界', terms: ['报价', '价格', '折扣', '优惠', '付款'] },
  { label: '合同、法务与采购流程', terms: ['合同', '法务', '采购', '条款', '招投标'] },
  { label: '产品能力与解决方案', terms: ['能力', '功能', '产品', '方案', '支持'] },
  { label: '客户拜访与沟通准备', terms: ['拜访', '沟通', '演示', '会议', '准备'] },
  { label: '数据权限与安全边界', terms: ['权限', '安全', '隐私', '数据', '访问'] },
  { label: '交付、实施与售后服务', terms: ['交付', '实施', '上线', '售后', '服务'] },
  { label: '集成、接口与技术条件', terms: ['集成', '接口', 'api', '技术', '对接'] },
  { label: '客户案例与行业实践', terms: ['案例', '客户', '行业', '最佳实践'] },
  { label: '竞品与差异化说明', terms: ['竞品', '竞争', '对比', '差异', '替代'] },
];

class PlaybookOptimizationError extends Error {
  constructor(
    readonly code: PlaybookOptimizationErrorCode,
    message: string,
    readonly currentUpdatedAt?: string,
  ) {
    super(message);
    this.name = 'PlaybookOptimizationError';
  }
}

const normalizedQuestion = (question: string): string => question
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase('zh-CN')
  .replace(/\s+/gu, ' ');

const questionFingerprint = (question: string): string => createHash('sha256')
  .update(normalizedQuestion(question), 'utf8')
  .digest('hex');

const topicPreview = (question: string): string => {
  const normalized: string = normalizedQuestion(question);
  return TOPIC_RULES.find((rule): boolean =>
    rule.terms.some((term: string): boolean => normalized.includes(term)),
  )?.label ?? '其他销售知识问题';
};

const initialReasons = (
  status: SalesKnowledgeQaStatus,
): PlaybookOptimizationReason[] => {
  if (status === 'no_trusted_match') return ['no_trusted_answer'];
  if (status === 'partial' || status === 'unavailable') {
    return ['source_unavailable'];
  }
  return [];
};

@Injectable()
class PlaybookOptimizationService implements PlaybookOptimizationObserver {
  constructor(
    @Inject(PLAYBOOK_OPTIMIZATION_REPOSITORY)
    private readonly repository: PlaybookOptimizationRepository,
  ) {}

  async observe(
    input: PlaybookOptimizationObservationInput,
  ): Promise<PlaybookOptimizationCandidate | null> {
    if (input.result.status === 'not_configured') return null;
    const normalized: string = normalizedQuestion(input.question);
    if (!normalized) return null;
    const configuredIds: string[] =
      input.integration.base.knowledge?.sources.map((source) => source.id) ?? [];
    const versionBySource: Map<string, string> = new Map(
      input.result.citations.map((citation) => [
        citation.sourceId,
        citation.sourceVersion,
      ]),
    );
    const sourceIds: string[] = [
      ...new Set([...configuredIds, ...versionBySource.keys()]),
    ].sort((left: string, right: string): number =>
      left.localeCompare(right, 'zh-CN'),
    );
    const sources: PlaybookOptimizationSourceRef[] = sourceIds.map(
      (sourceId: string): PlaybookOptimizationSourceRef => ({
        sourceId,
        sourceVersion: versionBySource.get(sourceId) ?? null,
      }),
    );
    return this.repository.observe({
      tenantId: input.integration.tenantId,
      questionFingerprint: questionFingerprint(normalized),
      topicPreview: topicPreview(normalized),
      qaStatus: input.result.status,
      reasons: initialReasons(input.result.status),
      sources,
      observedAt: input.observedAt ?? new Date(),
    });
  }

  async list(
    tenantId: string,
    limit: number = DEFAULT_LIMIT,
  ): Promise<PlaybookOptimizationCandidateListResponse> {
    if (!tenantId.trim() || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new PlaybookOptimizationError(
        'VALIDATION_FAILED',
        '候选列表参数无效',
      );
    }
    try {
      const items: PlaybookOptimizationCandidate[] =
        await this.repository.list({ tenantId, limit });
      return {
        status: 'ready',
        items,
        summary: {
          pendingReview: items.filter((item) => item.status === 'pending_review').length,
          observing: items.filter((item) => item.status === 'observing').length,
          acceptedForAuthoring: items.filter(
            (item) => item.status === 'accepted_for_authoring',
          ).length,
          dismissed: items.filter((item) => item.status === 'dismissed').length,
        },
      };
    } catch (error: unknown) {
      if (error instanceof PlaybookOptimizationError) throw error;
      throw new PlaybookOptimizationError(
        'DEPENDENCY_UNAVAILABLE',
        '知识优化候选暂时无法读取',
      );
    }
  }

  async review(input: {
    tenantId: string;
    candidateId: string;
    reviewerMemberId: string;
    decision: PlaybookOptimizationReviewDecision;
    expectedUpdatedAt: string;
    note: string;
    now?: Date;
  }): Promise<PlaybookOptimizationReviewResponse> {
    const tenantId: string = input.tenantId.trim();
    const candidateId: string = input.candidateId.trim();
    const reviewerMemberId: string = input.reviewerMemberId.trim();
    const note: string = input.note.trim();
    const expectedUpdatedAt: Date = new Date(input.expectedUpdatedAt);
    const reviewedAt: Date = input.now ?? new Date();
    if (
      !tenantId || !candidateId || !reviewerMemberId ||
      !['accept_for_authoring', 'dismiss'].includes(input.decision) ||
      !OFFSET_DATE_TIME.test(input.expectedUpdatedAt) ||
      !Number.isFinite(expectedUpdatedAt.getTime()) ||
      !Number.isFinite(reviewedAt.getTime()) ||
      expectedUpdatedAt.getTime() > reviewedAt.getTime() ||
      note.length < MIN_NOTE_LENGTH || note.length > MAX_NOTE_LENGTH
    ) {
      throw new PlaybookOptimizationError(
        'VALIDATION_FAILED',
        '审核参数不完整或格式无效',
      );
    }
    let result: PlaybookOptimizationReviewResult;
    try {
      result = await this.repository.review({
        tenantId,
        candidateId,
        reviewerMemberId,
        decision: input.decision,
        expectedUpdatedAt,
        note,
        reviewedAt,
      });
    } catch (_error: unknown) {
      throw new PlaybookOptimizationError(
        'DEPENDENCY_UNAVAILABLE',
        '审核暂时无法保存，候选未修改',
      );
    }
    if (result.status === 'not_found') {
      throw new PlaybookOptimizationError('NOT_FOUND', '未找到当前企业内的候选');
    }
    if (result.status === 'conflict') {
      throw new PlaybookOptimizationError(
        'CONFLICT',
        '候选已发生变化，请刷新后重新审核',
        result.currentUpdatedAt?.toISOString(),
      );
    }
    return { candidate: result.candidate, reviewId: result.reviewId };
  }
}

export {
  PlaybookOptimizationError,
  PlaybookOptimizationService,
  initialReasons,
  normalizedQuestion,
  questionFingerprint,
  topicPreview,
};
export type { PlaybookOptimizationErrorCode };
