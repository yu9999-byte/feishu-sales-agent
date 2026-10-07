import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CalendarCheck2,
  CircleDollarSign,
  Clock3,
  RefreshCw,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type {
  OpportunityDecisionCustomer,
  OpportunityDecisionResponse,
} from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getOpportunityDecisions,
  type ProductApiError,
} from '../../api';
import {
  formatDecisionAmount,
  formatDecisionDateTime,
} from '../OpportunityDecisionPage/opportunity-decision-view';

const CustomerPortfolioPage: React.FC = () => {
  const [report, setReport] = useState<OpportunityDecisionResponse | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(null);
    void getOpportunityDecisions()
      .then((result: OpportunityDecisionResponse): void => setReport(result))
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  }, []);

  useEffect((): void => {
    refresh();
  }, [refresh]);

  const customers: OpportunityDecisionCustomer[] = report?.customers ?? [];
  const activeOpportunityCount: number = customers.reduce(
    (total: number, customer: OpportunityDecisionCustomer): number =>
      total + customer.activeOpportunityCount,
    0,
  );
  const riskCustomerCount: number = customers.filter(
    (customer: OpportunityDecisionCustomer): boolean =>
      customer.criticalOpportunityCount + customer.atRiskOpportunityCount > 0,
  ).length;
  const knownAmounts: number[] = customers
    .filter(
      (customer: OpportunityDecisionCustomer): boolean =>
        customer.totalExpectedAmount !== null,
    )
    .map(
      (customer: OpportunityDecisionCustomer): number =>
        customer.totalExpectedAmount ?? 0,
    );
  const knownPortfolioAmount: number | null = knownAmounts.length > 0
    ? knownAmounts.reduce(
        (total: number, amount: number): number => total + amount,
        0,
      )
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-primary">客户组合</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            客户与进行中商机摘要
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            查看你本人可见的客户、进行中商机、风险和最优先建议。
            这是客户组合摘要 v1，不代表完整 CRM 360。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/opportunities">
              <BriefcaseBusiness aria-hidden="true" />看商机排序
            </Link>
          </Button>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw aria-hidden="true" />刷新客户
          </Button>
        </div>
      </header>

      {loading && <CustomerLoading />}

      {!loading && error && (
        <section
          className="rounded-xl border border-destructive/40 bg-card p-6"
          role="alert"
        >
          <AlertCircle aria-hidden="true" className="size-5 text-destructive" />
          <h2 className="mt-3 text-lg font-semibold">
            {error.status === 403 ? '无权查看本人客户' : '客户组合暂时无法加载'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          {error.retryable && (
            <Button className="mt-4" variant="outline" onClick={refresh}>重试</Button>
          )}
        </section>
      )}

      {!loading && !error && report && (
        <>
          {report.status !== 'ready' && (
            <section
              className="rounded-xl border border-border bg-muted/50 px-5 py-4"
              role="status"
            >
              <h2 className="text-sm font-semibold">
                {report.status === 'unavailable'
                  ? '客户数据当前不可用'
                  : '本次客户摘要使用了部分数据'}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {report.warnings.join('；') || '当前范围内没有进行中商机。'}
              </p>
            </section>
          )}

          <section
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            data-ai-section-type="card-stat"
            aria-label="客户组合概览"
          >
            <PortfolioMetric
              label="可见客户"
              value={String(customers.length)}
              detail="包含当前无进行中商机的客户"
              icon={<Building2 aria-hidden="true" />}
            />
            <PortfolioMetric
              label="进行中商机"
              value={String(activeOpportunityCount)}
              detail="只统计明确关联到客户的商机"
              icon={<BriefcaseBusiness aria-hidden="true" />}
            />
            <PortfolioMetric
              label="需优先关注客户"
              value={String(riskCustomerCount)}
              detail="存在立即处理或风险商机"
              icon={<ShieldAlert aria-hidden="true" />}
            />
            <PortfolioMetric
              label="已知预计金额"
              value={formatDecisionAmount(knownPortfolioAmount)}
              detail="未填金额的商机不按 0 计算"
              icon={<CircleDollarSign aria-hidden="true" />}
            />
          </section>

          {customers.length === 0 ? (
            <section className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
              <Building2 aria-hidden="true" className="mx-auto size-6 text-primary" />
              <h2 className="mt-4 text-lg font-semibold">当前没有可展示的客户</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                系统不会为了填充页面而创造客户、联系人或商机数据。
              </p>
            </section>
          ) : (
            <section>
              <div className="mb-4">
                <h2 className="text-lg font-semibold">客户优先级</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  有高优先级商机的客户排在前面。
                </p>
              </div>
              <div
                className="grid gap-4 md:grid-cols-2"
                data-ai-section-type="card-list"
              >
                {customers.map((customer: OpportunityDecisionCustomer) => (
                  <CustomerCard key={customer.recordId} customer={customer} />
                ))}
              </div>
            </section>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
            <p>只读本人范围，不修改客户或商机。</p>
            <p>生成于 {formatDecisionDateTime(report.generatedAt)}</p>
          </footer>
        </>
      )}
    </div>
  );
};

interface PortfolioMetricProps {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}

const PortfolioMetric: React.FC<PortfolioMetricProps> = ({
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
    <p className="mt-4 break-words text-2xl font-semibold tracking-tight">{value}</p>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
  </article>
);

const CustomerCard: React.FC<{ customer: OpportunityDecisionCustomer }> = ({
  customer,
}) => {
  const riskCount: number = customer.criticalOpportunityCount +
    customer.atRiskOpportunityCount;
  return (
    <article className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-primary">
            {customer.topPriorityRank
              ? `最高商机第 ${customer.topPriorityRank} 优先`
              : '当前无进行中商机'}
          </p>
          <h3 className="mt-2 break-words text-lg font-semibold">{customer.name}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <UserRound aria-hidden="true" className="size-4" />
            {customer.contactName ?? '联系人未提供'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{customer.activeOpportunityCount} 个商机</Badge>
          {riskCount > 0 && <Badge variant="destructive">{riskCount} 个风险商机</Badge>}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-muted/60 p-4">
          <p className="text-xs text-muted-foreground">进行中预计金额</p>
          <p className="mt-1 font-semibold">
            {formatDecisionAmount(customer.totalExpectedAmount)}
          </p>
        </div>
        <div className="rounded-lg bg-muted/60 p-4">
          <p className="text-xs text-muted-foreground">最近跟进</p>
          <p className="mt-1 text-sm font-medium">
            {formatDecisionDateTime(customer.lastFollowupAt)}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">最新客户摘要</p>
          <p className="mt-1 break-words text-sm leading-6">
            {customer.latestSummary ?? '暂无可信客户摘要'}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">最优先建议</p>
          <p className="mt-1 break-words text-sm font-medium leading-6">
            {customer.topRecommendation ?? '当前没有需要执行的商机建议'}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <Link
            to={`/customers/${encodeURIComponent(customer.recordId)}/briefing`}
          >
            <CalendarCheck2 aria-hidden="true" />准备拜访
          </Link>
        </Button>
        {customer.recordUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={customer.recordUrl} target="_blank" rel="noreferrer">
              查看客户原记录<ArrowUpRight aria-hidden="true" />
            </a>
          </Button>
        )}
        {customer.activeOpportunityCount > 0 && (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/opportunities">查看商机证据<ArrowRight aria-hidden="true" /></Link>
          </Button>
        )}
      </div>
    </article>
  );
};

const CustomerLoading: React.FC = () => (
  <section aria-busy="true" className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((item: number) => (
        <Skeleton key={item} className="h-32 rounded-xl" />
      ))}
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
    <span className="sr-only">正在读取客户组合</span>
  </section>
);

export default CustomerPortfolioPage;
