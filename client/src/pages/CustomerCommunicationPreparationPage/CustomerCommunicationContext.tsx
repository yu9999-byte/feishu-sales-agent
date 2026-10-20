import React from 'react';
import { ArrowUpRight } from 'lucide-react';

import type {
  CustomerCommunicationPreparationResponse,
  CustomerVisitBriefingOpportunity,
  CustomerVisitBriefingSource,
  OpportunityDecisionEvidence,
} from '@shared/api.interface';
import {
  customerBriefingHealthLabel,
  formatCustomerBriefingAmount,
  formatCustomerBriefingDate,
} from '../CustomerVisitBriefingPage/customer-visit-briefing-view';

const PreparationSource: React.FC<{
  source: CustomerVisitBriefingSource | null;
  label: string;
}> = ({ source, label }) => (
  <span className="inline-flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
    {source?.recordUrl ? (
      <a href={source.recordUrl} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline">
        {label}<ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
      </a>
    ) : <span>来源链接不可用，需核实</span>}
    {source?.sourceVersion && <span>来源版本：{source.sourceVersion}</span>}
  </span>
);

const JudgmentEvidence: React.FC<{
  ids: string[];
  evidence: OpportunityDecisionEvidence[];
}> = ({ ids, evidence }) => {
  const uniqueIds: string[] = Array.from(new Set(ids));
  const resolved: OpportunityDecisionEvidence[] = uniqueIds.flatMap(
    (id: string): OpportunityDecisionEvidence[] => {
      const item: OpportunityDecisionEvidence | undefined = evidence.find(
        (candidate: OpportunityDecisionEvidence): boolean => candidate.id === id,
      );
      return item ? [item] : [];
    },
  );
  return (
    <div className="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">
      {resolved.map((item: OpportunityDecisionEvidence) => (
        <div key={item.id}>
          <p>判断依据：{item.label} · {item.value}</p>
          <PreparationSource source={item.source} label="核对依据原记录" />
        </div>
      ))}
      {(uniqueIds.length === 0 || resolved.length < uniqueIds.length) && (
        <p className="text-amber-800" role="status">
          部分判断依据未包含在此结果中，需核实
        </p>
      )}
    </div>
  );
};

const PreparationOpportunity: React.FC<{
  opportunity: CustomerVisitBriefingOpportunity;
}> = ({ opportunity }) => {
  const active: boolean = opportunity.lifecycleStatus === 'active' ||
    opportunity.lifecycleStatus === 'unknown';
  const healthLabel: string = opportunity.health === null
    ? '风险状态待核实'
    : customerBriefingHealthLabel(opportunity.health);
  const evidence: OpportunityDecisionEvidence[] = opportunity.evidence ?? [];
  return (
    <article className="min-w-0 space-y-4 rounded-lg border border-border p-5 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-base font-semibold">{opportunity.name}</h3>
        <span className="text-xs text-muted-foreground">
          {active ? healthLabel : '已结束商机 · 历史背景'}
        </span>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">当前进展</dt>
          <dd className="mt-1">{opportunity.progress ?? '进展待确认'}</dd></div>
        <div><dt className="text-muted-foreground">预计金额</dt>
          <dd className="mt-1">{formatCustomerBriefingAmount(opportunity.expectedAmount)}</dd></div>
        <div><dt className="text-muted-foreground">原定下一步</dt>
          <dd className="mt-1">{opportunity.nextAction ?? '下一步待确认'}</dd></div>
        <div><dt className="text-muted-foreground">计划时间</dt>
          <dd className="mt-1">{formatCustomerBriefingDate(opportunity.dueAt)}</dd></div>
      </dl>
      <PreparationSource source={opportunity.source} label="商机原记录" />
      {active && (
        <>
          {opportunity.risks.length === 0 && (
            <p className="text-sm text-muted-foreground">当前结果未提供风险判断，仍需核实。</p>
          )}
          {opportunity.risks.map((risk) => (
            <div key={risk.code} className="border-l-2 border-amber-500 pl-3">
              <h4 className="text-sm font-medium">风险判断：{risk.title}</h4>
              <p className="mt-1 text-sm leading-6">{risk.detail}</p>
              <JudgmentEvidence ids={risk.evidenceIds} evidence={evidence} />
            </div>
          ))}
          {opportunity.gaps.map((gap) => (
            <div key={gap.code} className="border-l-2 border-border pl-3">
              <h4 className="text-sm font-medium">信息缺口判断：{gap.title}</h4>
              <p className="mt-1 text-sm leading-6">{gap.detail}</p>
              <JudgmentEvidence ids={gap.evidenceIds} evidence={evidence} />
            </div>
          ))}
          {opportunity.recommendation && (
            <div className="border-t border-border pt-4">
              <h4 className="text-sm font-medium">建议动作（待确认）</h4>
              <p className="mt-1 text-sm leading-6">{opportunity.recommendation.action}</p>
              <p className="text-sm text-muted-foreground">{opportunity.recommendation.reason}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                建议时间：{formatCustomerBriefingDate(opportunity.recommendation.dueAt)}
              </p>
              <JudgmentEvidence ids={opportunity.recommendation.evidenceIds} evidence={evidence} />
            </div>
          )}
        </>
      )}
    </article>
  );
};

const CustomerCommunicationContext: React.FC<{
  report: CustomerCommunicationPreparationResponse;
}> = ({ report }) => {
  const { customer, briefing, coverage } = report;
  if (!customer) return null;
  return (
    <div className="min-w-0 space-y-7 [overflow-wrap:anywhere]">
      <section className="space-y-3 border-b border-border pb-5" aria-label="客户近况">
        <h2 className="text-lg font-semibold">客户近况 · {customer.name}</h2>
        <p className="max-w-prose text-sm leading-6">
          {customer.latestSummary ?? '当前客户摘要缺失，需核实。'}
        </p>
        <p className="text-sm text-muted-foreground">
          联系人：{customer.contactName ?? '待确认'} · 最近跟进：
          {formatCustomerBriefingDate(customer.lastFollowupAt)}
        </p>
        <PreparationSource source={customer.source} label="客户原记录" />
      </section>
      {!briefing ? (
        <p role="status" className="text-sm text-muted-foreground">
          历史结果未保存商机、跟进和议程；当前仅展示已保存内容。
        </p>
      ) : (
        <>
          <section className="space-y-4" aria-label="相关商机与风险">
            <h2 className="text-lg font-semibold">相关商机与风险</h2>
            <p className="text-sm text-muted-foreground">
              相关商机 {briefing.metrics.relatedOpportunityCount} ·
              进行中 {briefing.metrics.activeOpportunityCount} ·
              风险商机 {briefing.metrics.riskOpportunityCount}
            </p>
            {coverage.opportunities !== 'complete' && (
              <p role="status" className="text-sm text-amber-800">
                {coverage.opportunities === 'unavailable' ? '商机来源不可用' : '商机来源不完整'}
              </p>
            )}
            {briefing.opportunities.length === 0 && (
              <p className="text-sm text-muted-foreground">当前结果没有明确关联的商机。</p>
            )}
            <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
              {briefing.opportunities.map((opportunity: CustomerVisitBriefingOpportunity) => (
                <PreparationOpportunity key={opportunity.recordId} opportunity={opportunity} />
              ))}
            </div>
          </section>
          <section className="space-y-4" aria-label="最近跟进事实">
            <h2 className="text-lg font-semibold">最近跟进事实</h2>
            {coverage.followups !== 'complete' && (
              <p role="status" className="text-sm text-amber-800">
                {coverage.followups === 'unavailable' ? '跟进来源不可用' : '跟进来源不完整'}
              </p>
            )}
            {briefing.recentFollowups.length === 0 && (
              <p className="text-sm text-muted-foreground">当前结果没有关联跟进记录。</p>
            )}
            <div className="divide-y divide-border">
              {briefing.recentFollowups.map((followup) => (
                <article key={followup.recordId} className="min-w-0 space-y-2 py-4 first:pt-0">
                  <h3 className="text-sm font-medium">{followup.summary}</h3>
                  <p className="text-xs text-muted-foreground">
                    {formatCustomerBriefingDate(followup.communicationAt)}
                    {followup.opportunityName && ` · ${followup.opportunityName}`}
                  </p>
                  {(followup.nextAction || followup.dueAt) && (
                    <p className="text-sm">原定下一步：{followup.nextAction ?? '待确认'} ·
                      {formatCustomerBriefingDate(followup.dueAt)}</p>
                  )}
                  <PreparationSource source={followup.source} label="跟进原记录" />
                </article>
              ))}
            </div>
          </section>
          <section className="space-y-4" aria-label="建议沟通议程">
            <h2 className="text-lg font-semibold">建议沟通议程</h2>
            {briefing.agenda.length === 0 && (
              <p className="text-sm text-muted-foreground">暂无建议议程。</p>
            )}
            <ol className="space-y-4">
              {briefing.agenda.map((item) => (
                <li key={item.sequence} className="flex min-w-0 gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center bg-muted text-sm">
                    {item.sequence}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium">{item.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.purpose}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
};

export default CustomerCommunicationContext;
