import React from 'react';
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CircleDollarSign,
  Clock3,
  ContactRound,
  ShieldAlert,
  Target,
} from 'lucide-react';

import type {
  CustomerVisitBriefingCustomer,
  CustomerVisitBriefingMetrics,
  CustomerVisitBriefingOpportunity,
} from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  customerBriefingHealthLabel,
  formatCustomerBriefingAmount,
  formatCustomerBriefingDate,
} from './customer-visit-briefing-view';

const lifecycleLabels: Record<
  CustomerVisitBriefingOpportunity['lifecycleStatus'],
  string
> = {
  active: '进行中',
  unknown: '状态待确认',
  won: '已赢单',
  lost: '已丢单',
  closed: '已关闭',
};

interface CustomerBriefingOverviewProps {
  customer: CustomerVisitBriefingCustomer;
  metrics: CustomerVisitBriefingMetrics;
  opportunities: CustomerVisitBriefingOpportunity[];
}

const CustomerBriefingOverview: React.FC<
  CustomerBriefingOverviewProps
> = ({ customer, metrics, opportunities }) => (
  <>
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <Building2 aria-hidden="true" className="size-4" />客户概况
          </p>
          <h2 className="mt-2 break-words text-2xl font-semibold">
            {customer.name}
          </h2>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <ContactRound aria-hidden="true" className="size-4" />
            {customer.contactName ?? '关键联系人待确认'}
            <span aria-hidden="true">·</span>
            最近跟进 {formatCustomerBriefingDate(customer.lastFollowupAt)}
          </p>
        </div>
        {customer.source.recordUrl && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={customer.source.recordUrl}
              target="_blank"
              rel="noreferrer"
            >
              核对客户原记录<ArrowUpRight aria-hidden="true" />
            </a>
          </Button>
        )}
      </div>
      <div className="mt-5 rounded-lg bg-muted/60 p-5">
        <p className="text-xs font-medium text-muted-foreground">最新客户摘要</p>
        <p className="mt-2 break-words text-sm leading-6">
          {customer.latestSummary ?? '暂无可核实的客户摘要，本次沟通需要先补齐。'}
        </p>
      </div>
    </section>

    <section
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="拜访准备指标"
      data-ai-section-type="card-stat"
    >
      <BriefingMetric
        label="相关商机"
        value={String(metrics.relatedOpportunityCount)}
        detail={`${metrics.activeOpportunityCount} 个仍需推进`}
        icon={<BriefcaseBusiness aria-hidden="true" />}
      />
      <BriefingMetric
        label="风险商机"
        value={String(metrics.riskOpportunityCount)}
        detail="仅统计进行中或状态待确认商机"
        icon={<ShieldAlert aria-hidden="true" />}
      />
      <BriefingMetric
        label="历史跟进"
        value={String(metrics.totalFollowupCount)}
        detail="页面最多展示最近 10 条"
        icon={<Clock3 aria-hidden="true" />}
      />
      <BriefingMetric
        label="进行中已知金额"
        value={formatCustomerBriefingAmount(
          metrics.knownActiveExpectedAmount,
        )}
        detail="未知金额不会按 0 计算"
        icon={<CircleDollarSign aria-hidden="true" />}
      />
    </section>

    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">相关商机与本次重点</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          进行中商机带风险与建议；已结束商机只作为客户历史背景。
        </p>
      </div>
      {opportunities.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
          当前客户没有明确关联的商机，本次先确认是否出现新的合作需求。
        </p>
      ) : (
        <div
          className="grid gap-4 lg:grid-cols-2"
          data-ai-section-type="card-list"
        >
          {opportunities.map(
            (opportunity: CustomerVisitBriefingOpportunity) => (
              <OpportunityCard
                key={opportunity.recordId}
                opportunity={opportunity}
              />
            ),
          )}
        </div>
      )}
    </section>
  </>
);

interface BriefingMetricProps {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}

const BriefingMetric: React.FC<BriefingMetricProps> = ({
  label,
  value,
  detail,
  icon,
}) => (
  <article className="rounded-xl border border-border bg-card p-5">
    <div className="flex items-center justify-between gap-3 text-muted-foreground">
      <span className="text-sm font-medium">{label}</span>
      <span className="[&_svg]:size-4">{icon}</span>
    </div>
    <p className="mt-4 break-words text-2xl font-semibold tracking-tight">
      {value}
    </p>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
  </article>
);

const OpportunityCard: React.FC<{
  opportunity: CustomerVisitBriefingOpportunity;
}> = ({ opportunity }) => {
  const active: boolean = opportunity.lifecycleStatus === 'active' ||
    opportunity.lifecycleStatus === 'unknown';
  return (
    <article className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-primary">
            {lifecycleLabels[opportunity.lifecycleStatus]}
          </p>
          <h3 className="mt-2 break-words text-lg font-semibold">
            {opportunity.name}
          </h3>
        </div>
        <Badge
          variant={opportunity.health === 'critical'
            ? 'destructive'
            : 'outline'}
        >
          {customerBriefingHealthLabel(opportunity.health)}
        </Badge>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        <OpportunityFact
          label="预计金额"
          value={formatCustomerBriefingAmount(opportunity.expectedAmount)}
        />
        <OpportunityFact
          label="计划时间"
          value={formatCustomerBriefingDate(opportunity.dueAt)}
        />
        <OpportunityFact
          label="当前进展"
          value={opportunity.progress ?? '进展待确认'}
        />
        <OpportunityFact
          label="原定下一步"
          value={opportunity.nextAction ?? '下一步待确认'}
        />
      </dl>

      {active && opportunity.recommendation && (
        <section className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Target aria-hidden="true" className="size-4" />本次建议核对
          </p>
          <p className="mt-2 text-sm font-semibold leading-6">
            {opportunity.recommendation.action}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {opportunity.recommendation.reason}
          </p>
        </section>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {active && (
          <Badge variant="secondary">
            {opportunity.risks.length} 项风险 · {opportunity.gaps.length} 项缺口
          </Badge>
        )}
        {opportunity.source.recordUrl && (
          <a
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            href={opportunity.source.recordUrl}
            target="_blank"
            rel="noreferrer"
          >
            商机原记录<ArrowUpRight aria-hidden="true" className="size-3.5" />
          </a>
        )}
      </div>
    </article>
  );
};

const OpportunityFact: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div className="rounded-lg bg-muted/60 p-4">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-1 break-words text-sm font-medium leading-6">{value}</dd>
  </div>
);

export default CustomerBriefingOverview;
