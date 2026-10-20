import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, History, RefreshCw, X } from 'lucide-react';
import type {
  PlaybookDraftReviewAction, PlaybookDraftReviewEvent, PlaybookDraftReviewResponse,
  PlaybookDraftVersion, RecordPlaybookDraftReviewRequest,
} from '@shared/api.interface';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  getPlaybookDraftReview, getPlaybookDraftVersion, recordPlaybookDraftReview,
  type ProductApiError,
} from '../../api';

interface PlaybookDraftReviewPanelProps {
  candidateId: string;
  version: number;
  canApprove: boolean;
  disabled: boolean;
  onAccessFailure: (failure: ProductApiError) => void;
}

const actionLabel: Record<PlaybookDraftReviewAction, string> = {
  submit: '提交审核', approve: '批准', request_changes: '退回修改',
};
const statusLabel: Record<PlaybookDraftReviewResponse['status'], string> = {
  not_submitted: '尚未提交审核', pending_review: '待管理员审核', approved: '审核已通过',
  changes_requested: '管理员已退回修改', superseded: '已有更新草稿，当前审核已失效',
};
const accessFailure = (status: number): boolean => [401, 403, 404].includes(status);

const PlaybookDraftReviewPanel: React.FC<PlaybookDraftReviewPanelProps> = ({
  candidateId, version, canApprove, disabled, onAccessFailure,
}) => {
  const [review, setReview] = useState<PlaybookDraftReviewResponse | null>(null);
  const [snapshot, setSnapshot] = useState<PlaybookDraftVersion | null>(null);
  const [note, setNote] = useState<string>('');
  const [error, setError] = useState<ProductApiError | null>(null);
  const [busy, setBusy] = useState<boolean>(true);
  const [conflict, setConflict] = useState<boolean>(false);
  const [pending, setPending] = useState<RecordPlaybookDraftReviewRequest | null>(null);
  const [revoked, setRevoked] = useState<boolean>(false);
  const generation = useRef<number>(0);
  const locked = useRef<boolean>(false);
  const onAccessFailureRef = useRef<(failure: ProductApiError) => void>(onAccessFailure);
  onAccessFailureRef.current = onAccessFailure;

  const load = useCallback(async (): Promise<void> => {
    if (locked.current) return;
    locked.current = true;
    const currentGeneration: number = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result: PlaybookDraftReviewResponse = await getPlaybookDraftReview(candidateId);
      const saved: PlaybookDraftVersion | null = result.latestDraftVersion === null
        ? null : await getPlaybookDraftVersion(candidateId, version);
      if (generation.current !== currentGeneration) return;
      setReview(result);
      setSnapshot(saved);
      setConflict(false);
      setPending(null);
      setRevoked(false);
    } catch (failure: unknown) {
      if (generation.current !== currentGeneration) return;
      const value = failure as ProductApiError;
      if (accessFailure(value.status)) {
        setReview(null); setSnapshot(null); setPending(null); setNote(''); setRevoked(true);
        onAccessFailureRef.current(value);
      }
      setError(value);
    } finally {
      if (generation.current === currentGeneration) {
        locked.current = false;
        setBusy(false);
      }
    }
  }, [candidateId, version]);

  useEffect((): (() => void) => {
    setReview(null); setSnapshot(null); setNote(''); setError(null); setPending(null);
    setConflict(false); setRevoked(false);
    void load();
    return (): void => { generation.current += 1; locked.current = false; };
  }, [load]);

  const fail = (failure: unknown): void => {
    const value = failure as ProductApiError;
    if (value.status === 409) {
      setReview(null); setSnapshot(null); setConflict(true); setPending(null);
    } else if (accessFailure(value.status)) {
      setReview(null); setSnapshot(null); setPending(null); setNote(''); setRevoked(true);
      onAccessFailureRef.current(value);
    } else if ([400, 422].includes(value.status)) {
      setPending(null);
    } else {
      setPending((current) => current ?? pending);
    }
    setError(value);
  };

  const submit = async (action: PlaybookDraftReviewAction): Promise<void> => {
    if (locked.current || pending || conflict || revoked || disabled || !review || !snapshot) return;
    const current: PlaybookDraftReviewEvent | null = review.current;
    if (review.latestDraftVersion !== version) return;
    if (action === 'submit' && current?.version === version) return;
    if (action !== 'submit' && (!canApprove || current?.version !== version || current.action !== 'submit')) return;
    const input: RecordPlaybookDraftReviewRequest = {
      requestId: crypto.randomUUID(), expectedVersion: version,
      expectedReviewSequence: current?.sequence ?? 0, action, note: note.trim(),
    };
    if (input.note.length < 2 || input.note.length > 500) return;
    locked.current = true;
    const requestGeneration: number = generation.current;
    setBusy(true);
    setError(null);
    setPending(input);
    try {
      const event: PlaybookDraftReviewEvent = await recordPlaybookDraftReview(candidateId, input);
      if (generation.current !== requestGeneration) return;
      setReview((currentReview) => {
        if (currentReview === null) return currentReview;
        const history: PlaybookDraftReviewEvent[] = [event,
          ...currentReview.history.filter((item: PlaybookDraftReviewEvent) => item.sequence !== event.sequence)];
        const status: PlaybookDraftReviewResponse['status'] = event.action === 'submit' ? 'pending_review' :
          event.action === 'approve' ? 'approved' : 'changes_requested';
        return { ...currentReview, status, current: event, history,
          nextBeforeSequence: currentReview.nextBeforeSequence };
      });
      setPending(null);
      setNote('');
    } catch (failure: unknown) {
      if (generation.current === requestGeneration) fail(failure);
    } finally {
      if (generation.current === requestGeneration) {
        locked.current = false;
        setBusy(false);
      }
    }
  };

  const retry = async (): Promise<void> => {
    if (locked.current || !pending) return;
    locked.current = true;
    const requestGeneration: number = generation.current;
    setBusy(true);
    setError(null);
    try {
      const event: PlaybookDraftReviewEvent = await recordPlaybookDraftReview(candidateId, pending);
      if (generation.current !== requestGeneration) return;
      setReview((currentReview) => currentReview === null ? currentReview : {
        ...currentReview,
        status: event.action === 'submit' ? 'pending_review' :
          event.action === 'approve' ? 'approved' : 'changes_requested',
        current: event,
        history: [event, ...currentReview.history.filter((item: PlaybookDraftReviewEvent) => item.sequence !== event.sequence)],
      });
      setPending(null);
      setNote('');
    } catch (failure: unknown) {
      if (generation.current === requestGeneration) fail(failure);
    } finally {
      if (generation.current === requestGeneration) {
        locked.current = false;
        setBusy(false);
      }
    }
  };

  const loadHistory = async (): Promise<void> => {
    if (locked.current || busy || conflict || !review?.nextBeforeSequence) return;
    locked.current = true;
    const requestGeneration: number = generation.current;
    setBusy(true);
    setError(null);
    try {
      const page: PlaybookDraftReviewResponse = await getPlaybookDraftReview(candidateId, review.nextBeforeSequence);
      if (generation.current !== requestGeneration) return;
      setReview((current) => current === null ? current : {
        ...current,
        history: [...current.history, ...page.history.filter((item: PlaybookDraftReviewEvent) =>
          !current.history.some((existing: PlaybookDraftReviewEvent) => existing.sequence === item.sequence))],
        nextBeforeSequence: page.nextBeforeSequence,
      });
    } catch (failure: unknown) {
      if (generation.current !== requestGeneration) return;
      const value = failure as ProductApiError;
      if (accessFailure(value.status)) {
        setReview(null); setSnapshot(null); setPending(null); setNote(''); setRevoked(true);
        onAccessFailureRef.current(value);
      }
      setError(value);
    } finally {
      if (generation.current === requestGeneration) {
        locked.current = false;
        setBusy(false);
      }
    }
  };

  const current: PlaybookDraftReviewEvent | null = review?.current ?? null;
  const currentVersion: boolean = review?.latestDraftVersion === version;
  const actionDisabled: boolean = busy || disabled || pending !== null || conflict || revoked ||
    !currentVersion || snapshot === null || note.trim().length < 2 || note.trim().length > 500;
  const canSubmit: boolean = review?.latestDraftVersion !== null && current?.version !== version;
  const canDecide: boolean = canApprove && currentVersion && current?.version === version && current.action === 'submit';

  if (revoked) return <p role="status">访问权限已失效，审核快照和说明已清除。</p>;

  return <section className="min-w-0 space-y-4" aria-label="草稿发布前审核">
    {error && <Alert variant="destructive" role="alert">
      <AlertCircle aria-hidden="true" />
      <AlertTitle>{pending ? '审核结果待确认' : '审核状态未更新'}</AlertTitle>
      <AlertDescription className="break-words">{error.message}</AlertDescription>
    </Alert>}
    {conflict && <Alert>
      <AlertTitle>审核状态或草稿版本已变化</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>刷新后再决定，当前说明会保留。</span>
        <Button variant="outline" disabled={busy} onClick={(): void => { void load(); }}>
          <RefreshCw aria-hidden="true" />刷新审核状态
        </Button>
      </AlertDescription>
    </Alert>}
    {conflict && review === null && <div className="space-y-2">
      <label htmlFor="playbook-draft-review-note" className="text-sm font-medium">审核说明</label>
      <Textarea id="playbook-draft-review-note" value={note} disabled
        onChange={(event): void => setNote(event.target.value)} />
    </div>}
    {pending && <Button variant="outline" disabled={busy} onClick={(): void => { void retry(); }}>
      <RefreshCw aria-hidden="true" />重试原审核请求
    </Button>}
    {busy && review === null ? <p role="status" className="py-6 text-sm text-muted-foreground">正在读取审核记录和指定版本…</p> :
      review === null ? <Button variant="outline" disabled={busy} onClick={(): void => { void load(); }}>
        <RefreshCw aria-hidden="true" />重新读取审核记录
      </Button> : <>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div>
            <h3 className="font-medium">{review.latestDraftVersion === null ? '尚无已保存版本' : `版本 v${version} · ${statusLabel[review.status]}`}</h3>
            <p className="text-sm text-muted-foreground">{review.latestDraftVersion !== version && review.latestDraftVersion !== null
              ? `当前最新草稿为 v${review.latestDraftVersion}，请先读取该版本。`
              : '审核通过只代表发布前审核完成。'}</p>
          </div>
          <Button variant="outline" disabled={busy} onClick={(): void => { void load(); }}>
            <RefreshCw aria-hidden="true" />刷新
          </Button>
        </div>
        {snapshot && <article className="min-w-0 space-y-3 border-b pb-4" aria-label={`审核快照 v${version}`}>
          <h4 className="break-words font-semibold">{snapshot.title} · v{snapshot.version}</h4>
          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{snapshot.applicability}</p>
          <p className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm leading-6">{snapshot.body}</p>
          <p className="break-words text-xs text-muted-foreground">版本说明：{snapshot.changeNote}</p>
          <dl className="text-xs text-muted-foreground">
            <dt className="font-medium">来源版本</dt>
            <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{snapshot.sources.length === 0
              ? '无来源记录' : snapshot.sources.map((source) =>
                `${source.sourceId} · ${source.sourceVersion ?? '未知版本'}`).join('\n')}</dd>
          </dl>
        </article>}
        {review.latestDraftVersion === null && <p className="py-4 text-sm text-muted-foreground">先保存一个草稿版本，再提交审核。</p>}
        {review.latestDraftVersion !== null && <div className="space-y-3">
          <label htmlFor="playbook-draft-review-note" className="text-sm font-medium">审核说明</label>
          <Textarea id="playbook-draft-review-note" value={note} maxLength={500}
            disabled={busy || disabled || pending !== null || conflict}
            onChange={(event): void => setNote(event.target.value)}
            aria-describedby="playbook-draft-review-note-help" />
          <p id="playbook-draft-review-note-help" className="text-xs text-muted-foreground">说明至少 2 个字符，最多 500 个字符。</p>
          <div className="flex flex-wrap gap-2">
            {canSubmit && <Button disabled={actionDisabled} onClick={(): void => { void submit('submit'); }}>提交审核</Button>}
            {canDecide && <>
              <Button disabled={actionDisabled} onClick={(): void => { void submit('approve'); }}>
                <Check aria-hidden="true" />批准此版本
              </Button>
              <Button variant="outline" disabled={actionDisabled} onClick={(): void => { void submit('request_changes'); }}>
                <X aria-hidden="true" />退回修改
              </Button>
            </>}
          </div>
        </div>}
        {current && <p className="break-words text-sm text-muted-foreground">最近操作：{actionLabel[current.action]} · {current.note}</p>}
        <section className="space-y-3" aria-label="审核历史">
          <h4 className="flex items-center gap-2 text-sm font-medium"><History aria-hidden="true" className="size-4" />审核历史</h4>
          {review.history.length === 0 ? <p className="text-sm text-muted-foreground">暂无审核记录</p> :
            <ol className="divide-y">
              {review.history.map((event: PlaybookDraftReviewEvent) => <li key={event.sequence} className="space-y-1 py-3 text-sm">
                <p className="break-words font-medium">v{event.version} · {actionLabel[event.action]} · {event.note}</p>
                <p className="break-words text-xs text-muted-foreground">{event.actorMemberId} · {new Date(event.createdAt).toLocaleString('zh-CN')}</p>
              </li>)}
            </ol>}
          {review.nextBeforeSequence !== null && <Button variant="outline" disabled={busy} onClick={(): void => { void loadHistory(); }}>更早审核记录</Button>}
        </section>
      </>}
  </section>;
};

export { PlaybookDraftReviewPanel };
