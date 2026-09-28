import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  RefreshCw,
} from 'lucide-react';

import type {
  DailySalesReportResponse,
  DailySalesReportStatus,
} from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getDailySalesReport,
  type ProductApiError,
} from '../../api';

const statusLabel: Record<DailySalesReportStatus, string> = {
  ready: '数据完整',
  partial: '部分数据可用',
  empty: '当天暂无记录',
  unavailable: '数据暂不可用',
};

const formatDateTime = (value: string): string => {
  const timestamp: number = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '时间未提供';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

const DailyReportPage: React.FC = () => {
  const [report, setReport] = useState<DailySalesReportResponse | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(null);
    void getDailySalesReport()
      .then((result: DailySalesReportResponse): void => setReport(result))
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  }, []);

  useEffect((): void => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6" aria-busy="true">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item: number): React.ReactNode => (
            <Skeleton key={item} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
        <span className="sr-only">正在加载销售日报</span>
      </div>
    );
  }

  if (error !== null || report === null) {
    return (
      <section className="mx-auto max-w-2xl rounded-xl border border-destructive/40 bg-card p-6" role="alert">
        <AlertCircle aria-hidden="true" className="mb-3 size-5 text-destructive" />
        <h1 className="text-xl font-semibold">销售日报暂时无法加载</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {error?.message ?? '无法读取当前日报数据'}
        </p>
        {error?.retryable && (
          <Button className="mt-5" variant="outline" onClick={refresh}>
            <RefreshCw aria-hidden="true" />重试
          </Button>
        )}
      </section>
    );
  }

  const hasWarnings: boolean = report.warnings.length > 0;
  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <CalendarDays aria-hidden="true" className="size-4" />
            {report.reportDate}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">销售日报</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            只汇总当前销售范围内已读取到的跟进、商机和未完成任务。
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw aria-hidden="true" />刷新日报
        </Button>
      </header>

      {hasWarnings && (
        <section className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-5 py-4 text-amber-950" role="status">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold">这份日报有数据边界</h2>
            <ul className="mt-1 space-y-1 text-sm leading-6">
              {report.warnings.map((warning: string): React.ReactNode => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section
        data-ai-section-type="card-stat"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="日报统计"
      >
        <Metric label="当天跟进" value={report.metrics.followupCount} />
        <Metric label="涉及商机" value={report.metrics.opportunityCount} />
        <Metric label="未完成任务" value={report.metrics.openTaskCount} />
        <Metric label="逾期任务" value={report.metrics.overdueTaskCount} tone="warning" />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">今日重点</h2>
            <span className="ml-auto text-sm text-muted-foreground">{statusLabel[report.status]}</span>
          </div>
          <div className="space-y-3">
            {report.highlights.map((highlight: string): React.ReactNode => (
              <p key={highlight} className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-6">
                {highlight}
              </p>
            ))}
          </div>
          {report.nextActions.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold">下一步候选</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6">
                {report.nextActions.map((action: string): React.ReactNode => (
                  <li key={action} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Clock3 aria-hidden="true" className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">未完成任务</h2>
          </div>
          {report.tasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-5 py-8 text-sm text-muted-foreground">
              当前没有读取到未完成任务。
            </p>
          ) : (
            <div className="space-y-3">
              {report.tasks.map((task): React.ReactNode => (
                <article key={task.guid} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold leading-6">{task.title}</h3>
                    {task.overdue && (
                      <span className="shrink-0 text-xs font-medium text-destructive">已逾期</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {task.dueAt ? `截止 ${formatDateTime(task.dueAt)}` : '未设置截止时间'}
                  </p>
                  {task.url && (
                    <a
                      className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      href={task.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      查看任务 <ArrowUpRight aria-hidden="true" className="size-4" />
                    </a>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">当天跟进</h2>
        {report.followups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-5 py-8 text-sm text-muted-foreground">
            当天没有读取到已登记的跟进。
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {report.followups.map((followup): React.ReactNode => (
              <article key={followup.recordId} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {followup.customerName ?? '未关联客户'}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {followup.opportunityName ?? '未关联商机'} · {formatDateTime(followup.communicationAt)}
                    </p>
                  </div>
                  {followup.source.recordUrl && (
                    <a href={followup.source.recordUrl} target="_blank" rel="noreferrer" aria-label="查看跟进来源">
                      <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
                    </a>
                  )}
                </div>
                <p className="mt-4 text-sm leading-6 text-foreground">{followup.summary}</p>
                {followup.nextAction && (
                  <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
                    下一步：{followup.nextAction}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

interface MetricProps {
  label: string;
  value: number;
  tone?: 'default' | 'warning';
}

const Metric: React.FC<MetricProps> = ({ label, value, tone = 'default' }) => (
  <div className="rounded-xl border border-border bg-card p-5">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className={`mt-3 text-3xl font-semibold ${tone === 'warning' ? 'text-destructive' : ''}`}>
      {value}
    </p>
  </div>
);

export default DailyReportPage;
