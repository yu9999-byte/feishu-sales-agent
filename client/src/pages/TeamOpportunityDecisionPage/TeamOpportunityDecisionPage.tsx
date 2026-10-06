import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  RefreshCw,
  ShieldAlert,
  Target,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type {
  TeamOpportunityDecisionItem,
  TeamOpportunityDecisionMember,
  TeamOpportunityDecisionResponse,
} from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getTeamOpportunityDecisions,
  type ProductApiError,
} from '../../api';
import {
  formatTeamOpportunityAmount,
  teamOpportunityHealthLabel,
  validTeamOpportunitySelection,
} from './team-opportunity-decision-view';

const priorityKey = (item: TeamOpportunityDecisionItem): string =>
  `${item.ownerMemberId}:${item.opportunity.recordId}`;

const formatGeneratedAt = (value: string): string => {
  const timestamp: number = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '生成时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

const TeamOpportunityDecisionPage: React.FC = () => {
  const [report, setReport] =
    useState<TeamOpportunityDecisionResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(null);
    void getTeamOpportunityDecisions()
      .then((result: TeamOpportunityDecisionResponse): void => {
        setReport(result);
        setSelectedKey((current: string | null): string | null =>
          validTeamOpportunitySelection(
            current,
            result.priorities.map((item: TeamOpportunityDecisionItem) => ({
              key: priorityKey(item),
            })),
          )
        );
      })
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  }, []);

  useEffect((): void => {
    refresh();
  }, [refresh]);

  const selected: TeamOpportunityDecisionItem | null = useMemo(() => {
    if (report === null) return null;
    return report.priorities.find(
      (item: TeamOpportunityDecisionItem): boolean =>
        priorityKey(item) === selectedKey,
    ) ?? report.priorities[0] ?? null;
  }, [report, selectedKey]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-primary">主管团队商机决策 Agent</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            先看团队最需要介入的商机
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            按真实客户、商机、跟进和已确认任务证据跨销售排序，告诉主管该找谁、为什么、建议核对什么。
            所有建议均未自动执行。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/reviews/team">
              <ArrowLeft aria-hidden="true" />返回团队 Review
            </Link>
          </Button>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw aria-hidden="true" />刷新团队决策
          </Button>
        </div>
      </header>

      {loading && <LoadingState />}
      {!loading && (error !== null || report === null) && (
        <ErrorState error={error} onRetry={refresh} />
      )}
      {!loading && error === null && report !== null && (
        <>
          <StatusBanner report={report} />
          <Metrics report={report} />

          {report.priorities.length === 0 ? (
            <EmptyState status={report.status} />
          ) : (
            <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.45fr)]">
              <PriorityList
                items={report.priorities}
                selectedKey={selected ? priorityKey(selected) : null}
                onSelect={setSelectedKey}
              />
              {selected !== null && <PriorityDetail item={selected} />}
            </section>
          )}

          <ManagerActions report={report} />
          <MemberPortfolio members={report.members} />
          {report.taskAlerts.length > 0 && (
            <section className="rounded-xl border border-amber-300 bg-amber-50/70 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                <AlertTriangle aria-hidden="true" className="size-4" />
                未能精确关联到商机的任务提醒
              </h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {report.taskAlerts.map((alert, index: number) => (
                  <p
                    key={`${alert.ownerMemberId}-${alert.code}-${index}`}
                    className="text-sm leading-6 text-amber-900"
                  >
                    <span className="font-semibold">{alert.ownerDisplayName}：</span>
                    {alert.detail}
                  </p>
                ))}
              </div>
            </section>
          )}
          <footer className="border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
            团队范围：{report.scope === 'tenant' ? '当前租户全部在职成员' : '主管本人及递归下属'} ·
            生成时间：{formatGeneratedAt(report.generatedAt)} · {report.timezone}。
            不会按名称合并不同销售的同名商机，也不会按任务标题猜测关联。
          </footer>
        </>
      )}
    </div>
  );
};

const LoadingState: React.FC = () => (
  <section className="space-y-5" aria-busy="true">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((item: number) => (
        <Skeleton key={item} className="h-32 rounded-xl" />
      ))}
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <Skeleton className="h-[34rem] rounded-xl" />
      <Skeleton className="h-[34rem] rounded-xl" />
    </div>
    <span className="sr-only">正在读取团队商机决策</span>
  </section>
);

const ErrorState: React.FC<{
  error: ProductApiError | null;
  onRetry: () => void;
}> = ({ error, onRetry }) => (
  <section
    className="rounded-xl border border-destructive/40 bg-card p-6"
    role="alert"
  >
    <AlertCircle aria-hidden="true" className="size-5 text-destructive" />
    <h2 className="mt-3 text-lg font-semibold">
      {error?.status === 403 ? '当前账号没有团队决策权限' : '团队商机决策暂时无法加载'}
    </h2>
    <p className="mt-2 text-sm text-muted-foreground">
      {error?.message ?? '无法读取团队商机数据'}
    </p>
    {error?.retryable && (
      <Button className="mt-4" variant="outline" onClick={onRetry}>重试</Button>
    )}
  </section>
);

const StatusBanner: React.FC<{
  report: TeamOpportunityDecisionResponse;
}> = ({ report }) => {
  if (report.status === 'ready' || report.status === 'empty') return null;
  return (
    <section
      className="rounded-xl border border-amber-300/70 bg-amber-50/70 px-5 py-4"
      role="status"
    >
      <h2 className="text-sm font-semibold text-amber-950">
        {report.status === 'unavailable'
          ? '当前无法形成可信的团队排序'
          : '当前结果仅覆盖部分团队数据'}
      </h2>
      <p className="mt-1 text-sm leading-6 text-amber-900">
        {report.warnings.join('；') || '部分成员的数据暂时无法读取。'}
      </p>
    </section>
  );
};

const Metrics: React.FC<{ report: TeamOpportunityDecisionResponse }> = ({
  report,
}) => {
  const items = [
    { label: '团队成员', value: `${report.metrics.readableMemberCount}/${report.metrics.memberCount}`, icon: UsersRound },
    { label: '进行中商机', value: String(report.metrics.activeOpportunityCount), icon: BriefcaseBusiness },
    { label: '需立即介入', value: String(report.metrics.criticalCount), icon: ShieldAlert },
    { label: '存在风险', value: String(report.metrics.atRiskCount), icon: AlertTriangle },
    { label: '已知商机金额', value: formatTeamOpportunityAmount(report.metrics.knownExpectedAmount), icon: CircleDollarSign },
  ];
  return (
    <section
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      aria-label="团队商机指标"
      data-ai-section-type="card-stat"
    >
      {items.map(({ label, value, icon: Icon }) => (
        <article key={label} className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3 text-muted-foreground">
            <span className="text-sm font-medium">{label}</span>
            <Icon aria-hidden="true" className="size-4" />
          </div>
          <p className="mt-4 text-2xl font-semibold tracking-tight">{value}</p>
        </article>
      ))}
    </section>
  );
};

const EmptyState: React.FC<{
  status: TeamOpportunityDecisionResponse['status'];
}> = ({ status }) => (
  <section className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
    <CheckCircle2 aria-hidden="true" className="mx-auto size-6 text-primary" />
    <h2 className="mt-4 text-lg font-semibold">
      {status === 'unavailable' ? '没有足够数据形成判断' : '团队当前没有进行中商机'}
    </h2>
    <p className="mt-2 text-sm text-muted-foreground">
      已结束商机不会进入排序；数据未知时也不会伪造金额或推进结论。
    </p>
  </section>
);

const PriorityList: React.FC<{
  items: TeamOpportunityDecisionItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}> = ({ items, selectedKey, onSelect }) => (
  <section className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="border-b border-border px-5 py-4">
      <h2 className="font-semibold">团队商机优先级</h2>
      <p className="mt-1 text-xs text-muted-foreground">跨销售排序，但不合并不同负责人的记录。</p>
    </div>
    <div className="divide-y divide-border" data-ai-section-type="card-list">
      {items.map((item: TeamOpportunityDecisionItem) => {
        const key: string = priorityKey(item);
        const selected: boolean = key === selectedKey;
        return (
          <button
            key={key}
            type="button"
            className={`w-full border-l-4 px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${item.opportunity.health === 'critical' ? 'border-l-destructive' : 'border-l-primary/50'} ${selected ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
            aria-pressed={selected}
            onClick={(): void => onSelect(key)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-primary">团队第 {item.teamRank} 优先</p>
                <h3 className="mt-1 truncate font-semibold">{item.opportunity.name}</h3>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  负责人：{item.ownerDisplayName} · 个人第 {item.memberRank} 优先
                </p>
              </div>
              <Badge variant={item.opportunity.health === 'critical' ? 'destructive' : 'outline'}>
                {teamOpportunityHealthLabel(item.opportunity.health)}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{formatTeamOpportunityAmount(item.opportunity.expectedAmount)}</span>
              <span>{item.opportunity.risks.length} 项风险</span>
              <span>{item.opportunity.gaps.length} 项缺口</span>
            </div>
          </button>
        );
      })}
    </div>
  </section>
);

const PriorityDetail: React.FC<{
  item: TeamOpportunityDecisionItem;
}> = ({ item }) => (
  <article className="rounded-xl border border-border bg-card">
    <div className="border-b border-border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">
            团队第 {item.teamRank} 优先 · {item.ownerDisplayName} 负责
          </p>
          <h2 className="mt-2 text-2xl font-semibold">{item.opportunity.name}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {item.opportunity.customerName ?? '未关联客户'}
          </p>
        </div>
        <Badge variant={item.opportunity.health === 'critical' ? 'destructive' : 'outline'}>
          {teamOpportunityHealthLabel(item.opportunity.health)}
        </Badge>
      </div>
      {item.opportunity.recordUrl && (
        <Button className="mt-4" variant="outline" size="sm" asChild>
          <a href={item.opportunity.recordUrl} target="_blank" rel="noreferrer">
            查看商机原记录<ArrowUpRight aria-hidden="true" />
          </a>
        </Button>
      )}
    </div>
    <div className="space-y-6 p-6">
      {item.opportunity.recommendation && (
        <section className="rounded-lg border border-primary/20 bg-primary/5 p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Target aria-hidden="true" className="size-4" />建议主管核对的动作
          </p>
          <h3 className="mt-3 text-lg font-semibold leading-7">
            {item.opportunity.recommendation.action}
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {item.opportunity.recommendation.reason}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">待主管确认，Agent 尚未执行。</p>
        </section>
      )}
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label="负责人" value={item.ownerDisplayName} />
        <Fact label="预计金额" value={formatTeamOpportunityAmount(item.opportunity.expectedAmount)} />
        <Fact label="当前进展" value={item.opportunity.progress ?? '进展待补充'} />
        <Fact label="原定下一步" value={item.opportunity.nextAction ?? '下一步待补充'} />
      </dl>
      <div className="grid gap-5 md:grid-cols-2">
        <FindingList
          title="风险证据"
          empty="暂无明确风险证据"
          items={item.opportunity.risks.map((risk) => ({
            key: risk.code,
            title: risk.title,
            detail: risk.detail,
          }))}
        />
        <FindingList
          title="信息缺口"
          empty="关键信息已基本齐全"
          items={item.opportunity.gaps.map((gap) => ({
            key: gap.code,
            title: gap.title,
            detail: gap.detail,
          }))}
        />
      </div>
    </div>
  </article>
);

const Fact: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg bg-muted/60 p-4">
    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
    <dd className="mt-1 break-words text-sm font-medium leading-6">{value}</dd>
  </div>
);

const FindingList: React.FC<{
  title: string;
  empty: string;
  items: Array<{ key: string; title: string; detail: string }>;
}> = ({ title, empty, items }) => (
  <section>
    <h3 className="text-sm font-semibold">{title}</h3>
    <div className="mt-3 space-y-3">
      {items.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
          {empty}
        </p>
      )}
      {items.map((item) => (
        <div key={item.key} className="rounded-lg border border-border p-4">
          <p className="text-sm font-semibold">{item.title}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>
        </div>
      ))}
    </div>
  </section>
);

const ManagerActions: React.FC<{
  report: TeamOpportunityDecisionResponse;
}> = ({ report }) => (
  <section className="space-y-4">
    <div className="flex items-center gap-2">
      <UserRoundCheck aria-hidden="true" className="size-5 text-primary" />
      <h2 className="text-xl font-semibold">建议主管今天核对</h2>
    </div>
    {report.managerActions.length === 0 ? (
      <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
        当前没有形成需要主管介入的建议。
      </p>
    ) : (
      <div className="grid gap-3 md:grid-cols-2" data-ai-section-type="card-list">
        {report.managerActions.map((action) => (
          <article
            key={`${action.ownerMemberId}-${action.opportunityRecordId}`}
            className="rounded-xl border border-border bg-card p-5"
          >
            <p className="text-xs font-medium text-primary">
              {action.ownerDisplayName} · {action.opportunityName}
            </p>
            <h3 className="mt-2 font-semibold leading-6">{action.action}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{action.reason}</p>
            <p className="mt-3 text-xs text-muted-foreground">仅建议，尚未执行或派发。</p>
          </article>
        ))}
      </div>
    )}
  </section>
);

const MemberPortfolio: React.FC<{
  members: TeamOpportunityDecisionMember[];
}> = ({ members }) => (
  <section className="space-y-4">
    <div className="flex items-center gap-2">
      <UsersRound aria-hidden="true" className="size-5 text-primary" />
      <h2 className="text-xl font-semibold">成员商机组合</h2>
    </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {members.map((member: TeamOpportunityDecisionMember) => (
        <article key={member.memberId} className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{member.displayName}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {member.topTeamRank ? `团队最高第 ${member.topTeamRank} 优先` : '暂无进行中商机'}
              </p>
            </div>
            <Badge variant={member.status === 'unavailable' ? 'destructive' : 'outline'}>
              {member.status === 'ready' ? '数据完整' : member.status === 'empty' ? '暂无商机' : member.status === 'partial' ? '部分数据' : '不可读取'}
            </Badge>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 border-y border-border py-4 text-sm">
            <MemberMetric label="商机" value={member.activeOpportunityCount} />
            <MemberMetric label="立即介入" value={member.criticalCount} />
            <MemberMetric label="有风险" value={member.atRiskCount} />
          </div>
          <p className="mt-4 text-sm font-medium">
            {member.topOpportunityName ?? '暂无首要商机'}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {member.topRecommendation ?? member.warnings[0] ?? '暂时无需主管介入'}
          </p>
        </article>
      ))}
    </div>
  </section>
);

const MemberMetric: React.FC<{ label: string; value: number }> = ({
  label,
  value,
}) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 font-semibold">{value}</p>
  </div>
);

export default TeamOpportunityDecisionPage;
