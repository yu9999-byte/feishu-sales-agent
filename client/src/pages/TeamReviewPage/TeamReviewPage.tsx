import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  ShieldAlert,
  UsersRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import type {
  TeamReviewAttention,
  TeamReviewMemberSummary,
  TeamReviewResponse,
  TeamReviewStatus,
} from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getTeamReview, type ProductApiError } from '../../api';

const statusLabel: Record<TeamReviewStatus, string> = {
  ready: '数据完整',
  partial: '部分数据可用',
  empty: '当天暂无记录',
  unavailable: '数据暂不可用',
};

const memberStatusLabel: Record<TeamReviewMemberSummary['status'], string> = {
  ready: '已形成日报',
  partial: '数据不完整',
  empty: '当天暂无记录',
  unavailable: '暂时无法读取',
};

const formatGeneratedAt = (value: string): string => {
  const timestamp: number = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '生成时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

const TeamReviewPage: React.FC = () => {
  const [review, setReview] = useState<TeamReviewResponse | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(null);
    void getTeamReview()
      .then((result: TeamReviewResponse): void => setReview(result))
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((item: number): React.ReactNode => (
            <Skeleton key={item} className="h-28 rounded-lg" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
        <span className="sr-only">正在加载团队复盘</span>
      </div>
    );
  }

  if (error !== null || review === null) {
    return (
      <section
        className="mx-auto max-w-2xl rounded-lg border border-destructive/40 bg-card p-6"
        role="alert"
      >
        <AlertCircle
          aria-hidden="true"
          className="mb-3 size-5 text-destructive"
        />
        <h1 className="text-xl font-semibold">团队复盘暂时无法加载</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {error?.message ?? '无法读取当前团队数据'}
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
            {review.reviewDate}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold">团队 Review</h1>
            <Badge variant={review.status === 'ready' ? 'secondary' : 'outline'}>
              {statusLabel[review.status]}
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            聚合当前管理范围内的跟进、商机和任务，只提供复盘判断与建议，不自动派任务或修改业务数据。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            最近生成：{formatGeneratedAt(review.generatedAt)} · {review.timezone}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/reviews/opportunities">
              <BriefcaseBusiness aria-hidden="true" />
              看团队商机决策
            </Link>
          </Button>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw aria-hidden="true" />
            刷新复盘
          </Button>
        </div>
      </header>

      {review.warnings.length > 0 && (
        <section
          className="flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50 px-5 py-4 text-amber-950"
          role="status"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0"
          />
          <div>
            <h2 className="text-sm font-semibold">当前复盘存在数据边界</h2>
            <ul className="mt-1 space-y-1 text-sm leading-6">
              {review.warnings.map((warning: string): React.ReactNode => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section
        data-ai-section-type="card-stat"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        aria-label="团队复盘统计"
      >
        <Metric label="团队成员" value={review.metrics.memberCount} />
        <Metric label="有当天数据" value={review.metrics.activeMemberCount} />
        <Metric label="当天跟进" value={review.metrics.followupCount} />
        <Metric label="涉及商机" value={review.metrics.opportunityCount} />
        <Metric label="未完成任务" value={review.metrics.openTaskCount} />
        <Metric
          label="需优先关注"
          value={review.metrics.attentionMemberCount}
          tone={review.metrics.attentionMemberCount > 0 ? 'warning' : 'default'}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldAlert aria-hidden="true" className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">主管今天先看</h2>
            <span className="ml-auto text-sm text-muted-foreground">
              {review.metrics.overdueTaskCount} 个逾期任务
            </span>
          </div>
          {review.attentions.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="当前没有需要优先介入的成员"
              description="系统未发现逾期任务、数据异常或明显的跟进缺口。"
            />
          ) : (
            <div data-ai-section-type="card-list" className="space-y-3">
              {review.attentions.map(
                (attention: TeamReviewAttention): React.ReactNode => (
                  <AttentionItem
                    key={attention.memberId}
                    attention={attention}
                  />
                ),
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <ClipboardCheck aria-hidden="true" className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">建议管理动作</h2>
          </div>
          {review.managerActions.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="暂无管理动作"
              description="当前数据没有形成需要主管确认的介入建议。"
            />
          ) : (
            <ol className="space-y-3">
              {review.managerActions.map(
                (action: string, index: number): React.ReactNode => (
                  <li
                    key={`${index}-${action}`}
                    className="flex gap-3 rounded-lg border border-border bg-card px-4 py-4 text-sm leading-6"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                      {index + 1}
                    </span>
                    <span>{action}</span>
                  </li>
                ),
              )}
            </ol>
          )}
        </div>
      </section>

      {review.highlights.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">团队摘要</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {review.highlights.map((highlight: string): React.ReactNode => (
              <p
                key={highlight}
                className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-6"
              >
                {highlight}
              </p>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <UsersRound aria-hidden="true" className="size-5 text-primary" />
          <h2 className="text-xl font-semibold">成员执行情况</h2>
          <span className="ml-auto text-sm text-muted-foreground">
            共 {review.members.length} 人
          </span>
        </div>
        {review.members.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="没有可读取的团队成员"
            description="请检查当前账号的团队权限和汇报关系。"
          />
        ) : (
          <div data-ai-section-type="card-list" className="grid gap-4 lg:grid-cols-2">
            {review.members.map(
              (member: TeamReviewMemberSummary): React.ReactNode => (
                <MemberItem key={member.memberId} member={member} />
              ),
            )}
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

const Metric: React.FC<MetricProps> = ({
  label,
  value,
  tone = 'default',
}) => (
  <div className="rounded-lg border border-border bg-card p-5">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p
      className={`mt-3 text-3xl font-semibold ${
        tone === 'warning' ? 'text-destructive' : ''
      }`}
    >
      {value}
    </p>
  </div>
);

interface AttentionItemProps {
  attention: TeamReviewAttention;
}

const AttentionItem: React.FC<AttentionItemProps> = ({ attention }) => (
  <article className="rounded-lg border border-border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold">{attention.displayName}</h3>
        <p className="mt-1 text-xs text-muted-foreground">需要主管核对</p>
      </div>
      <Badge variant={attention.severity === 'high' ? 'destructive' : 'secondary'}>
        {attention.severity === 'high' ? '高优先级' : '需关注'}
      </Badge>
    </div>
    <ul className="mt-4 space-y-2 text-sm leading-6">
      {attention.reasons.map((reason: string): React.ReactNode => (
        <li key={reason} className="flex gap-2">
          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive" />
          <span>{reason}</span>
        </li>
      ))}
    </ul>
  </article>
);

interface MemberItemProps {
  member: TeamReviewMemberSummary;
}

const MemberItem: React.FC<MemberItemProps> = ({ member }) => (
  <article className="rounded-lg border border-border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold">{member.displayName}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {memberStatusLabel[member.status]}
        </p>
      </div>
      <Badge
        variant={member.status === 'unavailable' ? 'destructive' : 'outline'}
      >
        {memberStatusLabel[member.status]}
      </Badge>
    </div>
    <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-y border-border py-4 text-sm sm:grid-cols-4">
      <MemberMetric label="跟进" value={member.metrics.followupCount} />
      <MemberMetric label="商机" value={member.metrics.opportunityCount} />
      <MemberMetric label="未完成" value={member.metrics.openTaskCount} />
      <MemberMetric
        label="逾期"
        value={member.metrics.overdueTaskCount}
        warning={member.metrics.overdueTaskCount > 0}
      />
    </dl>
    {member.nextActions.length > 0 && (
      <div className="mt-4">
        <p className="text-xs font-semibold text-muted-foreground">建议下一步</p>
        <p className="mt-2 text-sm leading-6">{member.nextActions[0]}</p>
      </div>
    )}
    {member.warnings.length > 0 && (
      <p className="mt-4 text-sm leading-6 text-amber-800">
        {member.warnings[0]}
      </p>
    )}
  </article>
);

interface MemberMetricProps {
  label: string;
  value: number;
  warning?: boolean;
}

const MemberMetric: React.FC<MemberMetricProps> = ({
  label,
  value,
  warning = false,
}) => (
  <div>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className={`mt-1 font-semibold ${warning ? 'text-destructive' : ''}`}>
      {value}
    </dd>
  </div>
);

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
}) => (
  <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center">
    <Icon aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
    <p className="mt-3 text-sm font-semibold">{title}</p>
    <p className="mt-1 text-sm leading-6 text-muted-foreground">
      {description}
    </p>
  </div>
);

export default TeamReviewPage;
