import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleDotDashed,
  Clock3,
  RefreshCw,
} from 'lucide-react';

import type {
  TaskFulfillmentCategory,
  TaskFulfillmentItem,
  TaskFulfillmentResponse,
  TaskFulfillmentStatus,
  TaskPromiseFulfillmentItem,
  TaskPromiseStatus,
} from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getTaskFulfillment, type ProductApiError } from '../../api';

const statusLabel: Record<TaskFulfillmentStatus, string> = {
  ready: '数据完整',
  partial: '部分数据可用',
  empty: '暂无记录',
  unavailable: '数据暂不可用',
};

const categoryLabel: Record<TaskFulfillmentCategory, string> = {
  overdue: '已逾期',
  due_today: '今日到期',
  due_soon: '即将到期',
  unscheduled: '未设期限',
  scheduled: '正常排期',
};

const promiseStatusLabel: Record<TaskPromiseStatus, string> = {
  open_overdue: '关联任务已逾期',
  open_due_today: '关联任务今日到期',
  open_scheduled: '关联任务待完成',
  open_unscheduled: '关联任务未设期限',
  open_changed: '关联任务已变更',
  completed: '关联任务已完成',
  not_task_tracked: '未关联任务',
  task_not_visible: '关联任务当前不可见',
  task_lookup_incomplete: '任务读取不完整',
  task_lookup_unavailable: '任务详情暂不可用',
};

const completionStateLabel: Record<
  TaskPromiseFulfillmentItem['completionState'],
  string
> = {
  completed: '已完成',
  partially_completed: '部分完成',
  still_open: '仍未完成',
  unknown: '待核实',
};

const formatDateTime = (value: string): string => {
  const timestamp: number = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

const TaskFulfillmentPage: React.FC = () => {
  const [report, setReport] = useState<TaskFulfillmentResponse | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(null);
    void getTaskFulfillment()
      .then((result: TaskFulfillmentResponse): void => setReport(result))
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  }, []);

  useEffect((): void => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6" aria-busy="true">
        <Skeleton className="h-28 w-full rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((item: number): React.ReactNode => (
            <Skeleton key={item} className="h-28 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-lg" />
        <span className="sr-only">正在加载任务履约情况</span>
      </div>
    );
  }

  if (error !== null || report === null) {
    return (
      <section
        className="mx-auto max-w-2xl rounded-lg border border-destructive/40 bg-card p-6"
        role="alert"
      >
        <AlertCircle
          aria-hidden="true"
          className="mb-3 size-5 text-destructive"
        />
        <h1 className="text-xl font-semibold">任务履约情况暂时无法加载</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {error?.message ?? '无法读取当前销售的任务数据'}
        </p>
        {error?.retryable && (
          <Button className="mt-5" variant="outline" onClick={refresh}>
            <RefreshCw aria-hidden="true" />
            重试
          </Button>
        )}
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <CalendarDays aria-hidden="true" className="size-4" />
            {report.referenceDate}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold">任务履约</h1>
            <Badge variant={report.status === 'ready' ? 'secondary' : 'outline'}>
              {statusLabel[report.status]}
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            检查本人未完成任务，并核对已确认跟进承诺的任务承接情况。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            最近检查：{formatDateTime(report.generatedAt)} · {report.timezone}
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw aria-hidden="true" />
          刷新任务
        </Button>
      </header>

      <section
        className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-5 py-4 text-blue-950"
        role="status"
      >
        <CircleDotDashed
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0"
        />
        <div>
          <h2 className="text-sm font-semibold">当前检查范围</h2>
          <p className="mt-1 text-sm leading-6">
            已覆盖本人未完成任务和最近 {report.coverage.promiseHistoryDays} 天的 Agent 已确认跟进承诺。
            当前页面只保存最近一次观察到的任务状态；已完成任务历史尚未完整接入，
            关联任务当前不可见不代表承诺已兑现，需人工核实。
          </p>
        </div>
      </section>

      {report.warnings.length > 0 && (
        <section
          className="flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50 px-5 py-4 text-amber-950"
          role="status"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0"
          />
          <div>
            <h2 className="text-sm font-semibold">检查结果可能不完整</h2>
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
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
        aria-label="任务履约统计"
      >
        <Metric label="未完成任务" value={report.metrics.openTaskCount} />
        <Metric
          label="已逾期"
          value={report.metrics.overdueCount}
          tone="danger"
        />
        <Metric
          label="今日到期"
          value={report.metrics.dueTodayCount}
          tone="warning"
        />
        <Metric label="3 天内到期" value={report.metrics.dueSoonCount} />
        <Metric label="未设期限" value={report.metrics.unscheduledCount} />
      </section>

      <section className="space-y-4" aria-label="跟进承诺履约">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-xl font-semibold">跟进承诺</h2>
          <span className="text-sm text-muted-foreground">
            {report.metrics.promiseCount} 条已确认 · {report.metrics.linkedOpenPromiseCount} 条关联未完成任务
            · {report.metrics.completedPromiseCount} 条任务已完成
            · {report.metrics.partiallyCompletedPromiseCount} 条部分完成
            · {report.metrics.stillOpenPromiseCount} 条仍未完成
            · {report.metrics.changedPromiseCount} 条任务已变更
            · {report.metrics.untrackedPromiseCount} 条未关联任务
            · {report.metrics.unverifiablePromiseCount} 条待核实
          </span>
        </div>
        {report.promises.length === 0 ? (
          <EmptyState
            title="读取范围内暂无跟进承诺"
            description="仅统计本销售通过 Agent 确认且有明确下一步的跟进；其他来源未纳入。"
          />
        ) : (
          <div data-ai-section-type="card-list" className="grid gap-3 md:grid-cols-2">
            {report.promises.map((promise: TaskPromiseFulfillmentItem): React.ReactNode => (
              <PromiseItem key={promise.pendingActionId} item={promise} />
            ))}
          </div>
        )}
      </section>

      {report.changes.length > 0 && (
        <section className="space-y-4" aria-label="任务状态变化">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-xl font-semibold">任务状态变化</h2>
            <span className="text-sm text-muted-foreground">
              来自连续检查的状态快照，不代表自动完成确认
            </span>
          </div>
          <div className="space-y-3">
            {report.changes.map((change): React.ReactNode => (
              <article
                key={`${change.guid}:${change.observedAt}`}
                className="rounded-lg border border-border bg-card px-4 py-4 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="break-words font-semibold">{change.title}</h3>
                  <Badge variant={change.kind === 'completed' ? 'secondary' : 'outline'}>
                    {change.kind === 'completed'
                      ? '已完成变化'
                      : change.kind === 'reopened'
                        ? '重新开放'
                        : '任务已变更'}
                  </Badge>
                </div>
                <p className="mt-2 leading-6 text-muted-foreground">
                  {change.previousStatus ?? '首次观察'} → {change.currentStatus}
                  {change.previousDueAt !== change.currentDueAt &&
                    ` · 截止时间 ${change.previousDueAt ?? '无'} → ${change.currentDueAt ?? '无'}`}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-7 lg:grid-cols-[0.75fr_1.25fr]">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">建议处理顺序</h2>
          </div>
          {report.recommendations.length === 0 ? (
            <EmptyState
              title="当前没有需要处理的未完成任务"
              description="任务读取范围内没有发现待执行事项。"
            />
          ) : (
            <ol className="space-y-3">
              {report.recommendations.map(
                (recommendation: string, index: number): React.ReactNode => (
                  <li
                    key={recommendation}
                    className="flex gap-3 rounded-lg border border-border bg-card px-4 py-4 text-sm leading-6"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                      {index + 1}
                    </span>
                    <span>{recommendation}</span>
                  </li>
                ),
              )}
            </ol>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CalendarClock aria-hidden="true" className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">任务明细</h2>
            <span className="ml-auto text-sm text-muted-foreground">
              按风险排序
            </span>
          </div>
          {report.items.length === 0 ? (
            <EmptyState
              title="暂无未完成任务"
              description="飞书任务读取范围内没有待执行事项。"
            />
          ) : (
            <div data-ai-section-type="card-list" className="space-y-3">
              {report.items.map((item: TaskFulfillmentItem): React.ReactNode => (
                <TaskItem key={item.guid} item={item} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

interface MetricProps {
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'danger';
}

const Metric: React.FC<MetricProps> = ({
  label,
  value,
  tone = 'default',
}) => (
  <div className="rounded-lg border border-border bg-card p-5">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p
      className={`mt-3 text-3xl font-semibold ${
        tone === 'danger'
          ? 'text-destructive'
          : tone === 'warning'
            ? 'text-amber-700'
            : ''
      }`}
    >
      {value}
    </p>
  </div>
);

const TaskItem: React.FC<{ item: TaskFulfillmentItem }> = ({ item }) => (
  <article className="rounded-lg border border-border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-semibold leading-6">{item.title}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock3 aria-hidden="true" className="size-3.5" />
          {item.dueAt ? `截止 ${formatDateTime(item.dueAt)}` : '未设置截止时间'}
        </p>
      </div>
      <Badge
        variant={item.category === 'overdue' ? 'destructive' : 'outline'}
      >
        {categoryLabel[item.category]}
      </Badge>
    </div>
    <p className="mt-4 text-sm leading-6 text-muted-foreground">
      {item.suggestedAction}
    </p>
    {item.url && (
      <a
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        href={item.url}
        target="_blank"
        rel="noreferrer"
      >
        查看飞书任务
        <ArrowUpRight aria-hidden="true" className="size-4" />
      </a>
    )}
  </article>
);

const PromiseItem: React.FC<{ item: TaskPromiseFulfillmentItem }> = ({ item }) => (
  <article className="min-w-0 rounded-lg border border-border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="break-words font-semibold leading-6">{item.nextAction}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {[item.customerName, item.opportunityName].filter(Boolean).join(' · ') || '未关联客户或商机'}
        </p>
      </div>
      <Badge
        className="max-w-full whitespace-normal text-center"
        variant={item.status === 'open_overdue' ? 'destructive' : 'outline'}
      >
        {promiseStatusLabel[item.status]}
      </Badge>
    </div>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">
      {item.suggestedAction}
    </p>
    <p className="mt-2 text-xs text-muted-foreground">
      确定性履约判断：{completionStateLabel[item.completionState]}
    </p>
    {item.change && (
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        状态证据：{item.change.previousStatus ?? '首次观察'} → {item.change.currentStatus}
        {item.change.currentCompletedAt &&
          ` · 完成于 ${formatDateTime(item.change.currentCompletedAt)}`}
        ，于 {formatDateTime(item.change.observedAt)} 读取
      </p>
    )}
    {item.taskCompletedAt && (
      <p className="mt-2 text-xs text-muted-foreground">
        飞书任务完成时间：{formatDateTime(item.taskCompletedAt)}
      </p>
    )}
    <p className="mt-2 text-xs text-muted-foreground">
      确认于 {formatDateTime(item.confirmedAt)}
      {item.promisedDueAt && ` · 承诺截止 ${formatDateTime(item.promisedDueAt)}`}
    </p>
    {item.taskUrl && (
      <a
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        href={item.taskUrl}
        target="_blank"
        rel="noreferrer"
      >
        查看关联任务
        <ArrowUpRight aria-hidden="true" className="size-4" />
      </a>
    )}
  </article>
);

interface EmptyStateProps {
  title: string;
  description: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ title, description }) => (
  <div className="rounded-lg border border-dashed border-border px-5 py-8">
    <CheckCircle2 aria-hidden="true" className="size-5 text-primary" />
    <h3 className="mt-3 text-sm font-semibold">{title}</h3>
    <p className="mt-1 text-sm leading-6 text-muted-foreground">
      {description}
    </p>
  </div>
);

export default TaskFulfillmentPage;
