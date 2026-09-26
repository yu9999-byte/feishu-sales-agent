import { Injectable } from '@nestjs/common';

import type {
  FollowupDraft,
  FollowupProgressFact,
  FollowupProgressFinding,
  FollowupProgressRecommendation,
  FollowupProgressSnapshot,
  SalesContext,
  SalesContextOpportunity,
  SalesContextSource,
} from '@shared/api.interface';

interface FollowupProgressAssessmentInput {
  draft: FollowupDraft;
  salesContext: SalesContext | undefined;
  sourceText: string;
  now: Date;
}

const NO_ACTION_PATTERN = /^(暂无|没有|无)下一步/u;

const warningLabel = (warning: string): string => {
  const labels: Record<string, string> = {
    customer_match_ambiguous: '客户匹配不唯一',
    business_context_permission_denied: '部分业务资料无权读取',
    business_context_not_configured: '业务资料尚未配置',
    business_context_unavailable: '业务资料暂时不可用',
    task_context_unavailable: '部分本人任务暂时不可用',
    task_context_permission_denied: '本人任务读取权限未开通',
    task_query_scope_limited: '本人任务仅覆盖当前可见范围',
    customer_not_found: '未找到匹配的客户资料',
    owner_scope_mapping_not_configured: '负责人范围尚未配置',
    sales_context_source_conflict: '商机与历史跟进存在冲突',
  };
  return labels[warning] ?? '部分业务资料未读取完整';
};

const hasText = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const validDate = (value: string | null): boolean =>
  value !== null && !Number.isNaN(Date.parse(value));

const comparableText = (value: string): string => value
  .trim()
  .toLocaleLowerCase()
  .replace(/[\s。．.!！,，、;；:：]+/gu, '');

@Injectable()
class FollowupProgressService {
  assess(input: FollowupProgressAssessmentInput): FollowupProgressSnapshot {
    const context: SalesContext | undefined = input.salesContext;
    const facts: FollowupProgressFact[] = [];
    const findings: FollowupProgressFinding[] = [];
    const warnings: string[] = (context?.warnings ?? []).map(warningLabel);
    const messageFactIds: string[] = this.addMessageFacts(facts, input);

    if (context === undefined) {
      findings.push(this.finding(
        'context_unavailable', 'gap', 'context_unavailable',
        '业务上下文暂时不可用', '当前只能依据本次沟通，无法可靠判断商机状态。',
        messageFactIds,
      ));
      return this.snapshot(
        'insufficient', '暂时无法完整判断商机状态', facts, findings,
        null, ['尚未读取到客户、商机和任务上下文'], input.now,
      );
    }

    const contextFactIds: string[] = this.addContextFacts(facts, context);
    const allMessageAndContext: string[] = [
      ...messageFactIds,
      ...contextFactIds,
    ];
    this.addContextFindings(findings, facts, context);
    this.addDraftFindings(
      findings, facts, input.draft, context, messageFactIds,
    );
    this.addTaskFindings(findings, facts, context, input.now);
    this.addConflictFinding(findings, facts, context);

    const insufficient: boolean = context.status === 'needs_clarification' ||
      context.status === 'unavailable' ||
      context.customer === null;
    if (insufficient) {
      return this.snapshot(
        'insufficient', '需要先确认客户或补齐业务资料', facts, findings,
        null, warnings, input.now,
      );
    }

    const recommendation: FollowupProgressRecommendation | null =
      this.recommendation(input.draft, messageFactIds, allMessageAndContext);
    const hasRisk: boolean = findings.some(
      (finding: FollowupProgressFinding): boolean => finding.kind === 'risk',
    );
    const hasGap: boolean = findings.some(
      (finding: FollowupProgressFinding): boolean => finding.kind === 'gap',
    );
    const hasChange: boolean = findings.some(
      (finding: FollowupProgressFinding): boolean => finding.kind === 'change',
    );
    const state = hasRisk
      ? 'at_risk'
      : hasGap
        ? 'needs_attention'
        : hasChange
          ? 'advanced'
          : 'steady';
    const headline = state === 'at_risk'
      ? '商机存在需要优先处理的风险'
      : state === 'needs_attention'
        ? '商机可以继续推进，但还有信息缺口'
        : state === 'advanced'
          ? '本次沟通带来了新的商机进展'
          : '暂未发现明确的商机状态变化';
    return this.snapshot(
      state, headline, facts, findings, recommendation, warnings, input.now,
    );
  }

  private addMessageFacts(
    facts: FollowupProgressFact[],
    input: FollowupProgressAssessmentInput,
  ): string[] {
    const quotes: string[] = input.draft.evidenceQuotes
      .filter((quote: string): boolean =>
        hasText(quote) && input.sourceText.includes(quote),
      );
    if (quotes.length === 0 && input.sourceText.trim().length > 0) {
      quotes.push(input.sourceText.trim());
    }
    return quotes.map((quote: string, index: number): string => {
      const id: string = `message-${index}`;
      facts.push({
        id,
        kind: 'message',
        label: '本次沟通',
        content: quote,
        quote,
        source: null,
      });
      return id;
    });
  }

  private addContextFacts(
    facts: FollowupProgressFact[],
    context: SalesContext,
  ): string[] {
    const ids: string[] = [];
    if (context.customer !== null) {
      ids.push(this.pushFact(facts, 'customer', '客户资料',
        context.customer.latestSummary ?? context.customer.name,
        context.customer.source));
    }
    context.opportunities.slice(0, 5).forEach((opportunity, index): void => {
      ids.push(this.pushFact(
        facts, 'opportunity', `商机记录 ${index + 1}`,
        opportunity.progress ?? opportunity.name, opportunity.source,
      ));
    });
    context.recentFollowups.slice(0, 5).forEach((followup, index): void => {
      ids.push(this.pushFact(
        facts, 'followup', `历史跟进 ${index + 1}`,
        followup.summary, followup.source,
      ));
    });
    context.tasks.slice(0, 10).forEach((task, index): void => {
      ids.push(this.pushFact(
        facts, 'task', `本人待办 ${index + 1}`,
        `${task.title}（${task.status}）`, {
          recordId: task.guid,
          recordUrl: task.url,
          sourceVersion: task.dueAt,
        },
      ));
    });
    return ids;
  }

  private addContextFindings(
    findings: FollowupProgressFinding[],
    facts: FollowupProgressFact[],
    context: SalesContext,
  ): void {
    if (context.customerCandidates.length > 0) {
      const candidateIds: string[] = context.customerCandidates.map(
        (candidate, index): string => this.pushFact(
          facts, 'customer', `候选客户 ${index + 1}`, candidate.name,
          candidate.source,
        ),
      );
      findings.push(this.finding(
        'customer_match_ambiguous', 'gap', 'customer_match_ambiguous',
        '客户匹配不唯一', '请先选择正确的客户，Agent 才能判断商机状态。',
        candidateIds,
      ));
    }
  }

  private addDraftFindings(
    findings: FollowupProgressFinding[],
    facts: FollowupProgressFact[],
    draft: FollowupDraft,
    context: SalesContext,
    messageFactIds: string[],
  ): void {
    const progress: string | null = draft.progress;
    const opportunity: SalesContextOpportunity | undefined =
      this.matchingOpportunity(draft, context);
    const previousProgress: string | null = opportunity?.progress ?? null;
    if (
      hasText(progress) &&
      hasText(previousProgress) &&
      comparableText(progress ?? '') !== comparableText(previousProgress ?? '')
    ) {
      const opportunityFactId: string | undefined = facts.find(
        (fact: FollowupProgressFact): boolean =>
          fact.kind === 'opportunity' &&
          fact.source?.recordId === opportunity?.source.recordId,
      )?.id;
      findings.push(this.finding(
        'progress_changed', 'change', 'progress_changed',
        '本次沟通有新的进展',
        `商机原进展为“${previousProgress}”，本次记录为“${progress}”。`,
        opportunityFactId === undefined
          ? messageFactIds
          : [...messageFactIds, opportunityFactId],
      ));
    }
    if (draft.expectedAmount === null) {
      findings.push(this.finding(
        'budget_unknown', 'gap', 'budget_unknown',
        '预算信息未确认', '当前沟通和业务资料中没有可确认的预算金额。',
        messageFactIds,
      ));
    }
    if ((draft.decisionChain ?? []).length === 0) {
      findings.push(this.finding(
        'decision_chain_unknown', 'gap', 'decision_chain_unknown',
        '决策链未确认', '还不知道谁参与决策或谁拥有最终审批权。',
        messageFactIds,
      ));
    }
    const noAction: boolean = !hasText(draft.nextAction) ||
      NO_ACTION_PATTERN.test(draft.nextAction ?? '');
    if (noAction) {
      findings.push(this.finding(
        'next_action_missing', 'gap', 'next_action_missing',
        '下一步未明确', '本次沟通没有形成可执行的下一步。', messageFactIds,
      ));
    }
    if (!validDate(draft.dueAt)) {
      findings.push(this.finding(
        'due_at_missing', 'gap', 'due_at_missing',
        '下一步时间未明确', '下一步还没有明确的执行时间。', messageFactIds,
      ));
    }
    const risks: string[] = draft.risks ?? [];
    if (risks.length > 0) {
      findings.push(this.finding(
        'message_risk', 'risk', 'message_risk',
        '本次沟通出现风险信号', risks.join('；'), messageFactIds,
      ));
    }
    const competitors: string[] = draft.competitors ?? [];
    if (competitors.length > 0) {
      findings.push(this.finding(
        'competitor_mentioned', 'risk', 'competitor_mentioned',
        '竞品进入比较', `涉及：${competitors.join('、')}`,
        messageFactIds,
      ));
    }
  }

  private addTaskFindings(
    findings: FollowupProgressFinding[],
    facts: FollowupProgressFact[],
    context: SalesContext,
    now: Date,
  ): void {
    context.tasks.forEach((task): void => {
      if (task.dueAt === null || Date.parse(task.dueAt) >= now.getTime()) {
        return;
      }
      const fact = facts.find((item): boolean => item.content.startsWith(task.title));
      findings.push(this.finding(
        'task_overdue', 'risk', 'task_overdue',
        '本人待办已逾期', `“${task.title}”尚未完成，截止时间已过。`,
        fact ? [fact.id] : [],
      ));
    });
  }

  private addConflictFinding(
    findings: FollowupProgressFinding[],
    facts: FollowupProgressFact[],
    context: SalesContext,
  ): void {
    context.conflicts.forEach((conflict): void => {
      const opportunityId: string = this.pushFact(
        facts, 'opportunity', '商机冲突记录', conflict.opportunityValue,
        conflict.opportunitySource,
      );
      const followupId: string = this.pushFact(
        facts, 'followup', '跟进冲突记录', conflict.followupValue,
        conflict.followupSource,
      );
      findings.push(this.finding(
        `source_conflict_${conflict.field}`, 'risk', 'source_conflict',
        '业务来源存在冲突', '商机和历史跟进的下一步或时间不一致，请确认后再执行。',
        [opportunityId, followupId],
      ));
    });
  }

  private recommendation(
    draft: FollowupDraft,
    messageFactIds: string[],
    evidenceIds: string[],
  ): FollowupProgressRecommendation | null {
    if (!hasText(draft.nextAction) ||
      NO_ACTION_PATTERN.test(draft.nextAction ?? '')) {
      return null;
    }
    return {
      action: draft.nextAction,
      dueAt: validDate(draft.dueAt) ? draft.dueAt : null,
      reason: '根据本次沟通和当前业务上下文整理，确认后才会执行。',
      evidenceIds: messageFactIds.length > 0 ? messageFactIds : evidenceIds.slice(0, 2),
      requiresConfirmation: true,
      editableFields: ['nextAction', 'dueAt'],
    };
  }

  private matchingOpportunity(
    draft: FollowupDraft,
    context: SalesContext,
  ): SalesContextOpportunity | undefined {
    if (context.opportunities.length === 1) {
      return context.opportunities[0];
    }
    if (!hasText(draft.opportunityName)) {
      return undefined;
    }
    const expectedName: string = comparableText(draft.opportunityName ?? '');
    return context.opportunities.find(
      (opportunity: SalesContextOpportunity): boolean =>
        comparableText(opportunity.name) === expectedName,
    );
  }

  private pushFact(
    facts: FollowupProgressFact[],
    kind: FollowupProgressFact['kind'],
    label: string,
    content: string,
    source: SalesContextSource,
  ): string {
    const id: string = `${kind}-${facts.length}`;
    facts.push({ id, kind, label, content, quote: null, source });
    return id;
  }

  private finding(
    id: string,
    kind: FollowupProgressFinding['kind'],
    code: string,
    title: string,
    detail: string,
    evidenceIds: string[],
  ): FollowupProgressFinding {
    return { id, kind, code, title, detail, evidenceIds };
  }

  private snapshot(
    state: FollowupProgressSnapshot['state'],
    headline: string,
    facts: FollowupProgressFact[],
    findings: FollowupProgressFinding[],
    recommendation: FollowupProgressRecommendation | null,
    warnings: string[],
    now: Date,
  ): FollowupProgressSnapshot {
    return {
      state,
      headline,
      facts,
      findings,
      recommendation,
      warnings: Array.from(new Set(warnings)),
      assessedAt: now.toISOString(),
    };
  }
}

export { FollowupProgressService };
export type { FollowupProgressAssessmentInput };
