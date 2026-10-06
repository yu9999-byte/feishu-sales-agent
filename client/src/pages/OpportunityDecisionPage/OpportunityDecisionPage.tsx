import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ContactRound,
  FileWarning,
  RefreshCw,
  ShieldAlert,
  Target,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type {
  OpportunityDecisionEvidence,
  OpportunityDecisionGap,
  OpportunityDecisionGlobalTaskAlert,
  OpportunityDecisionItem,
  OpportunityDecisionResponse,
  OpportunityDecisionRisk,
  OpportunityDecisionTaskPromise,
  TaskPromiseStatus,
} from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  getOpportunityDecisions,
  type ProductApiError,
} from '../../api';
import {
  formatDecisionAmount,
  formatDecisionDateTime,
  healthView,
  resolveSelectedOpportunity,
} from './opportunity-decision-view';
import {
  DecisionLoading,
  DecisionMetric,
} from './OpportunityDecisionOverview';

const promiseStatusLabel: Record<TaskPromiseStatus, string> = {
  open_overdue: '已逾期',
  open_due_today: '今日到期',
  open_scheduled: '已排期',
  open_unscheduled: '未排期',
  open_changed: '任务已变更',
  completed: '已完成',
  not_task_tracked: '未建任务',
  task_not_visible: '任务不可见',
  task_lookup_incomplete: '任务读取不完整',
  task_lookup_unavailable: '任务源不可用',
};

const OpportunityDecisionPage: React.FC = () => {
  const [report, setReport] = useState<OpportunityDecisionResponse | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(null);
    void getOpportunityDecisions()
      .then((result: OpportunityDecisionResponse): void => {
        setReport(result);
        setSelectedRecordId((current: string | null): string | null =>
          resolveSelectedOpportunity(result.priorities, current)?.recordId ?? null,
        );
      })
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  }, []);

  useEffect((): void => {
    refresh();
  }, [refresh]);

  const selected: OpportunityDecisionItem | null = report
    ? resolveSelectedOpportunity(report.priorities, selectedRecordId)
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-primary">商机决策工作台</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            先看最该推进的商机
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            基于你本人可见的客户、商机、历史跟进和已确认任务证据排序。
            建议只供判断，不会自动修改数据或联系客户。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/customers"><ContactRound aria-hidden="true" />看客户组合</Link>
          </Button>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw aria-hidden="true" />刷新决策
          </Button>
        </div>
      </header>

      {loading && <DecisionLoading />}

      {!loading && error && (
        <section
          className="rounded-xl border border-destructive/40 bg-card p-6"
          role="alert"
        >
          <AlertCircle aria-hidden="true" className="size-5 text-destructive" />
          <h2 className="mt-3 text-lg font-semibold">
            {error.status === 403 ? '无权查看本人商机' : '商机决策暂时无法加载'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          {error.retryable && (
            <Button className="mt-4" variant="outline" onClick={refresh}>重试</Button>
          )}
        </section>
      )}

      {!loading && !error && report && (
        <>
          <DecisionStatus report={report} />
          <section
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            data-ai-section-type="card-stat"
            aria-label="商机组合概览"
          >
            <DecisionMetric
              label="进行中商机"
              value={report.summary.activeOpportunityCount}
              detail={`已排除 ${report.summary.excludedClosedOpportunityCount} 个已结束商机`}
              icon={<BriefcaseBusiness aria-hidden="true" />}
            />
            <DecisionMetric
              label="需立即处理"
              value={report.summary.criticalCount}
              detail="有明确逾期或高风险证据"
              icon={<ShieldAlert aria-hidden="true" />}
            />
            <DecisionMetric
              label="存在风险"
              value={report.summary.atRiskCount}
              detail="建议尽快核对并补齐"
              icon={<FileWarning aria-hidden="true" />}
            />
            <DecisionMetric
              label="正常推进"
              value={report.summary.onTrackCount}
              detail={`另有 ${report.summary.needsAttentionCount} 个需要关注`}
              icon={<CheckCircle2 aria-hidden="true" />}
            />
          </section>

          {report.globalTaskAlerts.length > 0 && (
            <section className="rounded-xl border border-amber-300 bg-amber-50/70 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                <CalendarClock aria-hidden="true" className="size-4" />
                与商机无法精确关联的任务提醒
              </h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {report.globalTaskAlerts.map(
                  (alert: OpportunityDecisionGlobalTaskAlert) => (
                    <div key={alert.code} className="text-sm leading-6 text-amber-900">
                      <span className="font-semibold">{alert.title}：</span>
                      {alert.detail}
                    </div>
                  ),
                )}
              </div>
            </section>
          )}

          {report.priorities.length === 0 ? (
            <section className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
              <CheckCircle2 aria-hidden="true" className="mx-auto size-6 text-primary" />
              <h2 className="mt-4 text-lg font-semibold">当前没有进行中商机</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                本页不会把已赢单、已输单或已关闭商机重新纳入排序。
              </p>
            </section>
          ) : (
            <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.45fr)]">
              <OpportunityList
                items={report.priorities}
                selectedRecordId={selected?.recordId ?? null}
                onSelect={setSelectedRecordId}
              />
              {selected && <OpportunityDetail item={selected} />}
            </section>
          )}

          <CoverageFooter report={report} />
        </>
      )}
    </div>
  );
};

const DecisionStatus: React.FC<{ report: OpportunityDecisionResponse }> = ({
  report,
}) => {
  if (report.status === 'ready') return null;
  const unavailable: boolean = report.status === 'unavailable';
  return (
    <section
      className="rounded-xl border border-border bg-muted/50 px-5 py-4"
      role="status"
    >
      <h2 className="text-sm font-semibold">
        {unavailable ? '当前无法形成可信排序' : '本次结果使用了部分数据'}
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {report.warnings.join('；') || '当前范围内没有可排序的商机。'}
      </p>
    </section>
  );
};

interface OpportunityListProps {
  items: OpportunityDecisionItem[];
  selectedRecordId: string | null;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
}

const OpportunityList: React.FC<OpportunityListProps> = ({
  items,
  selectedRecordId,
  onSelect,
}) => (
  <section className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="border-b border-border px-5 py-4">
      <h2 className="font-semibold">优先级排序</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        选择一个商机查看风险、缺口和证据。
      </p>
    </div>
    <div className="divide-y divide-border" data-ai-section-type="card-list">
      {items.map((item: OpportunityDecisionItem) => {
        const selected: boolean = item.recordId === selectedRecordId;
        const view = healthView[item.health];
        return (
          <button
            key={item.recordId}
            type="button"
            className={`w-full border-l-4 px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${view.accentClassName} ${selected ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
            aria-pressed={selected}
            onClick={(): void => onSelect(item.recordId)}
            data-ai-section-type="button"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-primary">第 {item.rank} 优先</p>
                <h3 className="mt-1 truncate font-semibold">{item.name}</h3>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {item.customerName ?? '未关联客户'}
                </p>
              </div>
              <Badge variant="outline" className={view.badgeClassName}>
                {view.label}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>优先分 {item.priorityScore}</span>
              <span>{formatDecisionAmount(item.expectedAmount)}</span>
              <span>{item.risks.length} 项风险</span>
              <span>{item.gaps.length} 项缺口</span>
            </div>
          </button>
        );
      })}
    </div>
  </section>
);

const OpportunityDetail: React.FC<{ item: OpportunityDecisionItem }> = ({
  item,
}) => {
  const view = healthView[item.health];
  return (
    <article className="rounded-xl border border-border bg-card">
      <div className="border-b border-border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-primary">第 {item.rank} 优先</p>
            <h2 className="mt-2 break-words text-2xl font-semibold">{item.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {item.customerName ?? '未关联客户'}
            </p>
          </div>
          <Badge variant="outline" className={view.badgeClassName}>
            {view.label}
          </Badge>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {item.recordUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={item.recordUrl} target="_blank" rel="noreferrer">
                查看商机原记录<ArrowUpRight aria-hidden="true" />
              </a>
            </Button>
          )}
          <Badge variant="secondary">优先分 {item.priorityScore}</Badge>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {item.recommendation && (
          <section className="rounded-lg border border-primary/20 bg-primary/5 p-5">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
              <Target aria-hidden="true" className="size-4" />建议的下一步
            </p>
            <h3 className="mt-3 text-lg font-semibold leading-7">
              {item.recommendation.action}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {item.recommendation.reason}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              这是待确认建议，系统尚未执行。
            </p>
          </section>
        )}

        <section>
          <h3 className="text-sm font-semibold">当前业务信息</h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Fact label="预计金额" value={formatDecisionAmount(item.expectedAmount)} />
            <Fact label="当前进展" value={item.progress ?? '进展未提供'} />
            <Fact label="原定下一步" value={item.nextAction ?? '下一步未提供'} />
            <Fact label="计划时间" value={formatDecisionDateTime(item.dueAt)} />
            <Fact label="最近跟进" value={formatDecisionDateTime(item.lastFollowupAt)} />
            <Fact label="最近跟进摘要" value={item.lastFollowupSummary ?? '暂无可信跟进摘要'} />
          </dl>
        </section>

        <div className="grid gap-5 md:grid-cols-2">
          <FindingList title="风险" items={item.risks} />
          <GapList items={item.gaps} />
        </div>

        <TaskPromises items={item.taskPromises} />
        <EvidenceList items={item.evidence} />
      </div>
    </article>
  );
};

const Fact: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg bg-muted/60 p-4">
    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
    <dd className="mt-1 break-words text-sm font-medium leading-6">{value}</dd>
  </div>
);

const FindingList: React.FC<{
  title: string;
  items: OpportunityDecisionRisk[];
}> = ({ title, items }) => (
  <section>
    <h3 className="text-sm font-semibold">{title}</h3>
    <div className="mt-3 space-y-3">
      {items.length === 0 && <QuietState text="暂无明确风险证据" />}
      {items.map((item: OpportunityDecisionRisk) => (
        <div key={item.code} className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{item.title}</p>
            <Badge variant={item.severity === 'high' ? 'destructive' : 'outline'}>
              {item.severity === 'high' ? '高风险' : '中风险'}
            </Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
        </div>
      ))}
    </div>
  </section>
);

const GapList: React.FC<{ items: OpportunityDecisionGap[] }> = ({ items }) => (
  <section>
    <h3 className="text-sm font-semibold">信息缺口</h3>
    <div className="mt-3 space-y-3">
      {items.length === 0 && <QuietState text="关键信息已基本齐全" />}
      {items.map((item: OpportunityDecisionGap) => (
        <div key={item.code} className="rounded-lg border border-border p-4">
          <p className="text-sm font-semibold">{item.title}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
        </div>
      ))}
    </div>
  </section>
);

const TaskPromises: React.FC<{ items: OpportunityDecisionTaskPromise[] }> = ({
  items,
}) => (
  <section>
    <h3 className="text-sm font-semibold">已确认的任务承诺</h3>
    <div className="mt-3 space-y-3">
      {items.length === 0 && (
        <QuietState text="暂无可精确关联到该商机的 Agent 确认任务" />
      )}
      {items.map((item: OpportunityDecisionTaskPromise) => (
        <div key={item.pendingActionId} className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.dueAt ? `截止 ${formatDecisionDateTime(item.dueAt)}` : '未设截止时间'}
              </p>
            </div>
            <Badge variant={item.status === 'open_overdue' ? 'destructive' : 'outline'}>
              {promiseStatusLabel[item.status]}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{item.suggestedAction}</p>
        </div>
      ))}
    </div>
  </section>
);

const EvidenceList: React.FC<{ items: OpportunityDecisionEvidence[] }> = ({
  items,
}) => (
  <section>
    <h3 className="text-sm font-semibold">决策证据</h3>
    <div className="mt-3 divide-y divide-border rounded-lg border border-border">
      {items.map((item: OpportunityDecisionEvidence) => (
        <div key={item.id} className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
              <p className="mt-1 break-words text-sm leading-6">{item.value}</p>
            </div>
            {item.source?.recordUrl && (
              <a
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                href={item.source.recordUrl}
                target="_blank"
                rel="noreferrer"
              >
                原记录<ArrowUpRight aria-hidden="true" className="size-3.5" />
              </a>
            )}
          </div>
          {item.occurredAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDecisionDateTime(item.occurredAt)}
            </p>
          )}
        </div>
      ))}
    </div>
  </section>
);

const QuietState: React.FC<{ text: string }> = ({ text }) => (
  <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
    {text}
  </p>
);

const CoverageFooter: React.FC<{ report: OpportunityDecisionResponse }> = ({
  report,
}) => {
  const labels: string[] = [
    `客户数据：${report.coverage.customers}`,
    `商机数据：${report.coverage.opportunities}`,
    `跟进数据：${report.coverage.followups}`,
    `任务承诺：${report.coverage.taskPromises}`,
  ];
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
      <p>只读本人范围数据，任务只按 Agent 明确确认关联。</p>
      <p>{labels.join(' · ')}</p>
    </footer>
  );
};

export default OpportunityDecisionPage;
