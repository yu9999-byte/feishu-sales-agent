import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Archive,
  BookCheck,
  BookOpen,
  CheckCircle2,
  Clock3,
  FilePenLine,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useOutletContext } from 'react-router-dom';

import type {
  PlaybookOptimizationCandidate,
  PlaybookOptimizationCandidateListResponse,
  PlaybookOptimizationCandidateStatus,
  PlaybookOptimizationReason,
  PlaybookOptimizationReviewDecision,
} from '@shared/api.interface';
import type { ProductLayoutContext } from '@/components/Layout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  getPlaybookCandidates,
  reviewPlaybookCandidate,
  type ProductApiError,
} from '../../api';

const statusLabel: Record<PlaybookOptimizationCandidateStatus, string> = {
  observing: '持续观察',
  pending_review: '待审核',
  accepted_for_authoring: '待编写',
  dismissed: '已忽略',
};

const reasonLabel: Record<PlaybookOptimizationReason, string> = {
  no_trusted_answer: '没有找到可信答案',
  frequent_question: '被重复询问',
  source_unavailable: '资料来源需要检查',
  source_revision_changed: '来源版本变化，建议复核',
};

const statusVariant = (
  status: PlaybookOptimizationCandidateStatus,
): 'default' | 'secondary' | 'outline' => {
  if (status === 'pending_review') return 'default';
  if (status === 'accepted_for_authoring') return 'secondary';
  return 'outline';
};

const formatDateTime = (value: string): string => {
  const timestamp: number = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

const LoadingState: React.FC = () => (
  <div className="mx-auto max-w-6xl space-y-6" aria-busy="true">
    <Skeleton className="h-28 rounded-xl" />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((item: number): React.ReactNode => (
        <Skeleton key={item} className="h-24 rounded-xl" />
      ))}
    </div>
    {[1, 2].map((item: number): React.ReactNode => (
      <Skeleton key={item} className="h-64 rounded-xl" />
    ))}
    <span className="sr-only">正在加载知识优化候选</span>
  </div>
);

interface ReviewDialogState {
  candidate: PlaybookOptimizationCandidate;
  decision: PlaybookOptimizationReviewDecision;
}

const PlaybookOptimizationPage: React.FC = () => {
  const { session } = useOutletContext<ProductLayoutContext>();
  const canReview: boolean = session.permissions.includes('playbook:review');
  const [data, setData] =
    useState<PlaybookOptimizationCandidateListResponse | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(canReview);
  const [dialog, setDialog] = useState<ReviewDialogState | null>(null);
  const [note, setNote] = useState<string>('');
  const [reviewError, setReviewError] = useState<ProductApiError | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const refresh = useCallback((): void => {
    if (!canReview) return;
    setLoading(true);
    setError(null);
    void getPlaybookCandidates()
      .then((response: PlaybookOptimizationCandidateListResponse): void => {
        setData(response);
      })
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  }, [canReview]);

  useEffect((): void => {
    refresh();
  }, [refresh]);

  const openReview = (
    candidate: PlaybookOptimizationCandidate,
    decision: PlaybookOptimizationReviewDecision,
  ): void => {
    setDialog({ candidate, decision });
    setNote(decision === 'accept_for_authoring'
      ? '证据充分，进入资料复核与编写。'
      : '当前无需进入资料编写。');
    setReviewError(null);
  };

  const closeReview = (): void => {
    if (saving) return;
    setDialog(null);
    setNote('');
    setReviewError(null);
  };

  const submitReview = (): void => {
    if (dialog === null || note.trim().length < 2) return;
    setSaving(true);
    setReviewError(null);
    void reviewPlaybookCandidate(dialog.candidate.id, {
      decision: dialog.decision,
      expectedUpdatedAt: dialog.candidate.updatedAt,
      note: note.trim(),
    })
      .then((response): void => {
        setData((current) => current === null ? current : {
          ...current,
          items: current.items.map((item) =>
            item.id === response.candidate.id ? response.candidate : item,
          ),
          summary: {
            ...current.summary,
            pendingReview: Math.max(0, current.summary.pendingReview - 1),
            acceptedForAuthoring: response.candidate.status === 'accepted_for_authoring'
              ? current.summary.acceptedForAuthoring + 1
              : current.summary.acceptedForAuthoring,
            dismissed: response.candidate.status === 'dismissed'
              ? current.summary.dismissed + 1
              : current.summary.dismissed,
          },
        });
        setDialog(null);
        setNote('');
        setReviewError(null);
      })
      .catch((failure: ProductApiError): void => setReviewError(failure))
      .finally((): void => setSaving(false));
  };

  if (loading) return <LoadingState />;

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles aria-hidden="true" className="size-4" />
            Playbook 优化 Agent
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">知识与打法优化</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Agent 从知识问答中发现资料缺口、重复问题和版本变化。所有候选都需要人工审核，系统不会自动修改或发布正式资料。
          </p>
        </div>
        {canReview && (
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw aria-hidden="true" />
            刷新候选
          </Button>
        )}
      </header>

      <Alert>
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>安全边界</AlertTitle>
        <AlertDescription>
          候选只保存问题指纹、安全主题标签、状态和来源版本；不保存问题全文、回答正文或资料摘录。接受候选仅表示进入待编写。
        </AlertDescription>
      </Alert>

      {!canReview ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookOpen aria-hidden="true" className="size-5 text-primary" />
              销售知识问答已启用
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted-foreground">
              你可以在飞书中直接向销售 Agent 提问。系统只引用你有权访问的企业资料；优化候选由经理或知识管理员统一审核。
            </p>
          </CardContent>
        </Card>
      ) : error !== null || data === null ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>知识优化候选暂时无法加载</AlertTitle>
          <AlertDescription>
            <p>{error?.message ?? '无法读取当前企业的候选队列'}</p>
            {error?.retryable && (
              <Button className="mt-3" variant="outline" onClick={refresh}>
                <RefreshCw aria-hidden="true" />重试
              </Button>
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="知识优化统计">
            <SummaryCard icon={Clock3} label="待审核" value={data.summary.pendingReview} />
            <SummaryCard icon={BookCheck} label="待编写" value={data.summary.acceptedForAuthoring} />
            <SummaryCard icon={FilePenLine} label="持续观察" value={data.summary.observing} />
            <SummaryCard icon={Archive} label="已忽略" value={data.summary.dismissed} />
          </section>

          {data.items.length === 0 ? (
            <Empty className="min-h-72 border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon"><CheckCircle2 aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>当前没有知识优化候选</EmptyTitle>
                <EmptyDescription>
                  Agent 会在问答缺少可信答案、问题被反复询问或来源需要复核时自动生成候选。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <section className="space-y-4" aria-label="知识优化候选列表">
              {data.items.map((item) => (
                <CandidateCard
                  key={item.id}
                  candidate={item}
                  onReview={openReview}
                />
              ))}
            </section>
          )}
        </>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open: boolean): void => {
        if (!open) closeReview();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.decision === 'accept_for_authoring'
                ? '确认进入资料编写'
                : '确认忽略这个候选'}
            </DialogTitle>
            <DialogDescription>
              {dialog?.candidate.topicPreview}。这次操作只更新候选状态并记录审核，不会修改或发布任何正式资料。
            </DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="playbook-review-note" className="text-sm font-medium">
              审核说明
            </label>
            <Textarea
              id="playbook-review-note"
              className="mt-2 min-h-24"
              value={note}
              onChange={(event): void => setNote(event.target.value)}
              maxLength={500}
              disabled={saving}
              aria-describedby="playbook-review-note-help"
            />
            <p id="playbook-review-note-help" className="mt-2 text-xs text-muted-foreground">
              说明会进入不可变审核记录，至少 2 个字符，最多 500 个字符。
            </p>
          </div>
          {reviewError !== null && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>审核未保存</AlertTitle>
              <AlertDescription>{reviewError.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeReview} disabled={saving}>取消</Button>
            <Button onClick={submitReview} disabled={saving || note.trim().length < 2}>
              {saving ? '正在保存审核…' : '确认并记录'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const SummaryCard: React.FC<{
  icon: React.ElementType;
  label: string;
  value: number;
}> = ({ icon: Icon, label, value }) => (
  <Card>
    <CardContent className="flex items-center gap-4 pt-6">
      <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-primary">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </CardContent>
  </Card>
);

const CandidateCard: React.FC<{
  candidate: PlaybookOptimizationCandidate;
  onReview: (
    candidate: PlaybookOptimizationCandidate,
    decision: PlaybookOptimizationReviewDecision,
  ) => void;
}> = ({ candidate, onReview }) => (
  <Card>
    <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">{candidate.topicPreview}</CardTitle>
          <Badge variant={statusVariant(candidate.status)}>
            {statusLabel[candidate.status]}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          累计出现 {candidate.occurrenceCount} 次 · 最近发现于 {formatDateTime(candidate.lastObservedAt)}
        </p>
      </div>
      <span className="text-xs text-muted-foreground">
        {candidate.sources.length} 个配置来源
      </span>
    </CardHeader>
    <CardContent className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">形成原因</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {candidate.reasons.map((reason) => (
            <Badge key={reason} variant="outline">{reasonLabel[reason]}</Badge>
          ))}
        </div>
      </div>
      {candidate.sources.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">来源版本</p>
          <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            {candidate.sources.map((source) => (
              <li key={source.sourceId} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                <span className="font-medium">{source.sourceId}</span>
                <span className="ml-2 text-muted-foreground">
                  {source.sourceVersion ?? '本次未能读取版本'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {candidate.status === 'pending_review' && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button onClick={(): void => onReview(candidate, 'accept_for_authoring')}>
            <CheckCircle2 aria-hidden="true" />进入待编写
          </Button>
          <Button variant="outline" onClick={(): void => onReview(candidate, 'dismiss')}>
            <XCircle aria-hidden="true" />忽略候选
          </Button>
        </div>
      )}
    </CardContent>
  </Card>
);

export default PlaybookOptimizationPage;
