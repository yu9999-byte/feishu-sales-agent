import React from 'react';
import {
  ArrowUpRight,
  CalendarCheck2,
  CircleHelp,
  History,
  LockKeyhole,
} from 'lucide-react';

import type {
  CustomerVisitBriefingAgendaItem,
  CustomerVisitBriefingCoverage,
  CustomerVisitBriefingFollowup,
  CustomerVisitBriefingQuestion,
} from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import { formatCustomerBriefingDate } from
  './customer-visit-briefing-view';

interface CustomerBriefingDetailsProps {
  questions: CustomerVisitBriefingQuestion[];
  agenda: CustomerVisitBriefingAgendaItem[];
  followups: CustomerVisitBriefingFollowup[];
  coverage: CustomerVisitBriefingCoverage;
  generatedAt: string;
}

const coverageLabel = (
  value: 'complete' | 'partial' | 'unavailable',
): string => ({
  complete: '完整',
  partial: '部分可用',
  unavailable: '不可用',
})[value];

const CustomerBriefingDetails: React.FC<CustomerBriefingDetailsProps> = ({
  questions,
  agenda,
  followups,
  coverage,
  generatedAt,
}) => (
  <>
    <section className="grid items-start gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CircleHelp aria-hidden="true" className="size-5 text-primary" />
          会前待确认问题
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          这些问题只来自缺失资料或真实风险，不代表已经确认的事实。
        </p>
        <div className="mt-5 space-y-3">
          {questions.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              当前没有从已知资料中识别出额外待确认问题。
            </p>
          )}
          {questions.map(
            (question: CustomerVisitBriefingQuestion, index: number) => (
              <article
                key={`${question.code}-${question.opportunityRecordId ?? 'customer'}`}
                className="rounded-lg border border-border p-4"
              >
                <p className="text-xs font-semibold text-primary">
                  问题 {index + 1}
                </p>
                <h3 className="mt-1 break-words text-sm font-semibold leading-6">
                  {question.question}
                </h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  提问依据：{question.reason}
                </p>
              </article>
            ),
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CalendarCheck2 aria-hidden="true" className="size-5 text-primary" />
          建议沟通议程
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          按事实核对顺序推进，最后形成双方明确下一步。
        </p>
        <ol className="mt-5 space-y-4">
          {agenda.map((item: CustomerVisitBriefingAgendaItem) => (
            <li key={item.sequence} className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {item.sequence}
              </span>
              <div className="pt-1">
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {item.purpose}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>

    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <History aria-hidden="true" className="size-5 text-primary" />
        最近跟进事实
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        有可信沟通时间的记录按最近优先；无时间记录不会伪造日期。
      </p>
      <div className="mt-5 divide-y divide-border">
        {followups.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            当前没有明确关联到该客户的跟进记录。
          </p>
        )}
        {followups.map((followup: CustomerVisitBriefingFollowup) => (
          <article key={followup.recordId} className="py-5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-primary">
                  {formatCustomerBriefingDate(followup.communicationAt)}
                </p>
                <h3 className="mt-1 break-words text-sm font-semibold leading-6">
                  {followup.summary}
                </h3>
              </div>
              {followup.opportunityName && (
                <Badge variant="outline">{followup.opportunityName}</Badge>
              )}
            </div>
            {(followup.nextAction || followup.dueAt) && (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                下一步：{followup.nextAction ?? '动作待确认'} ·
                {formatCustomerBriefingDate(followup.dueAt)}
              </p>
            )}
            {followup.source.recordUrl && (
              <a
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                href={followup.source.recordUrl}
                target="_blank"
                rel="noreferrer"
              >
                跟进原记录<ArrowUpRight aria-hidden="true" className="size-3.5" />
              </a>
            )}
          </article>
        ))}
      </div>
    </section>

    <footer className="rounded-xl border border-primary/20 bg-primary/5 p-5">
      <div className="flex items-start gap-3">
        <LockKeyhole aria-hidden="true" className="mt-0.5 size-5 text-primary" />
        <div>
          <h2 className="text-sm font-semibold">本页完全只读</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Agent 不会联系客户、创建任务或修改客户、商机和跟进记录。
            如需执行任何动作，必须另行预览并由你确认。
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            客户 {coverageLabel(coverage.customers)} · 商机
            {coverageLabel(coverage.opportunities)} · 跟进
            {coverageLabel(coverage.followups)} · 任务承诺
            {coverage.taskPromises === 'agent_confirmed_only'
              ? '仅 Agent 已确认关联'
              : '不可用'} · 生成于 {formatCustomerBriefingDate(generatedAt)}
          </p>
        </div>
      </div>
    </footer>
  </>
);

export default CustomerBriefingDetails;
