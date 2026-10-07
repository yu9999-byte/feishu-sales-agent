import type {
  CustomerVisitBriefingAgendaItem,
  CustomerVisitBriefingOpportunity,
  CustomerVisitBriefingQuestion,
  CustomerVisitBriefingQuestionCode,
  OpportunityDecisionGap,
  OpportunityDecisionRisk,
} from '@shared/api.interface';
import type {
  OpportunityPortfolioCustomerRecord,
} from '@server/modules/agent-core/agent.types';
import { isActiveVisitOpportunity } from
  './customer-visit-briefing-data';

const riskQuestion = (
  risk: OpportunityDecisionRisk,
  opportunityName: string,
): string | null => {
  const questions: Partial<Record<
    OpportunityDecisionRisk['code'],
    string
  >> = {
    next_action_overdue:
      `${opportunityName} 原定下一步为什么逾期？新的承诺时间是什么？`,
    followup_stale:
      `${opportunityName} 长期没有可信跟进，客户当前状态是否发生变化？`,
    followup_time_missing:
      `${opportunityName} 最近一次有效沟通发生在什么时候？`,
    no_followup_evidence:
      `${opportunityName} 此前与客户沟通过什么，当前依据是什么？`,
    lifecycle_unknown:
      `${opportunityName} 是否仍在推进？当前商机状态是什么？`,
    confirmed_task_overdue:
      `${opportunityName} 已确认任务为何逾期，如何重新承诺？`,
    confirmed_task_changed:
      `${opportunityName} 已确认任务发生了什么变化，是否影响本次沟通？`,
  };
  return questions[risk.code] ?? null;
};

const gapQuestion = (
  gap: OpportunityDecisionGap,
  opportunityName: string,
): string | null => {
  const questions: Partial<Record<
    OpportunityDecisionGap['code'],
    string
  >> = {
    progress_missing: `${opportunityName} 当前实际推进到什么阶段？`,
    amount_missing: `${opportunityName} 的预算范围或采购额度是否已经确认？`,
    next_action_missing:
      `${opportunityName} 本次沟通后双方要承诺的下一步是什么？`,
    due_at_missing: `${opportunityName} 的下一步应在什么时间前完成？`,
  };
  return questions[gap.code] ?? null;
};

const buildCustomerVisitQuestions = (
  customer: OpportunityPortfolioCustomerRecord,
  opportunities: CustomerVisitBriefingOpportunity[],
): CustomerVisitBriefingQuestion[] => {
  const questions: CustomerVisitBriefingQuestion[] = [];
  const add = (
    code: CustomerVisitBriefingQuestionCode,
    question: string,
    reason: string,
    opportunityRecordId: string | null,
  ): void => {
    const exists: boolean = questions.some(
      (item: CustomerVisitBriefingQuestion): boolean =>
        item.code === code &&
        item.opportunityRecordId === opportunityRecordId,
    );
    if (!exists) {
      questions.push({ code, question, reason, opportunityRecordId });
    }
  };
  if (!customer.contactName?.trim()) {
    add(
      'contact_missing',
      '本次有哪些参会人？谁是关键联系人和决策相关角色？',
      '客户记录没有可核实联系人',
      null,
    );
  }
  if (!customer.latestSummary?.trim()) {
    add(
      'customer_summary_missing',
      '客户当前最关注的目标、问题或变化是什么？',
      '客户记录没有可核实的最新摘要',
      null,
    );
  }
  opportunities.forEach(
    (opportunity: CustomerVisitBriefingOpportunity): void => {
      if (!opportunity.progress?.trim()) {
        add(
          'progress_missing',
          `${opportunity.name} 当前实际推进到什么阶段？`,
          '商机进展尚未明确',
          opportunity.recordId,
        );
      }
      if (opportunity.expectedAmount === null) {
        add(
          'amount_missing',
          `${opportunity.name} 的预算范围或采购额度是否已经确认？`,
          '商机预计金额尚未明确',
          opportunity.recordId,
        );
      }
      if (!opportunity.nextAction?.trim()) {
        add(
          'next_action_missing',
          `${opportunity.name} 本次沟通后双方要承诺的下一步是什么？`,
          '商机下一步尚未明确',
          opportunity.recordId,
        );
      }
      if (!opportunity.dueAt?.trim()) {
        add(
          'due_at_missing',
          `${opportunity.name} 的下一步应在什么时间前完成？`,
          '商机下一步时间尚未明确',
          opportunity.recordId,
        );
      }
      opportunity.risks.forEach((risk: OpportunityDecisionRisk): void => {
        const question: string | null = riskQuestion(risk, opportunity.name);
        if (question !== null) {
          add(risk.code, question, risk.detail, opportunity.recordId);
        }
      });
      opportunity.gaps.forEach((gap: OpportunityDecisionGap): void => {
        if (gap.code === 'customer_missing') return;
        const question: string | null = gapQuestion(gap, opportunity.name);
        if (question !== null) {
          add(gap.code, question, gap.detail, opportunity.recordId);
        }
      });
    },
  );
  return questions;
};

const buildCustomerVisitAgenda = (
  opportunities: CustomerVisitBriefingOpportunity[],
  followupCount: number,
): CustomerVisitBriefingAgendaItem[] => {
  const hasActive: boolean = opportunities.some(
    (opportunity: CustomerVisitBriefingOpportunity): boolean =>
      isActiveVisitOpportunity(opportunity.lifecycleStatus),
  );
  return [{
    sequence: 1,
    title: '对齐客户当前目标与变化',
    purpose: followupCount > 0
      ? '从最近沟通事实开始，确认需求、参与人和优先级是否变化'
      : '当前没有明确历史跟进，先补齐客户背景、目标和本次沟通缘由',
  }, {
    sequence: 2,
    title: hasActive ? '核对相关商机与阻塞' : '确认是否存在新的合作机会',
    purpose: hasActive
      ? '逐项核对进行中商机的进展、风险、预算和决策条件'
      : '当前没有进行中商机，确认客户是否产生新需求或后续机会',
  }, {
    sequence: 3,
    title: '形成双方明确下一步',
    purpose: '确认动作、责任人和完成时间，会后再由销售决定是否更新记录或创建任务',
  }];
};

export { buildCustomerVisitAgenda, buildCustomerVisitQuestions };
