import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  ShieldAlert,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import type {
  AgentExecutionResult,
  FollowupDraftResponse,
  FollowupTaskCandidate,
} from '@shared/api.interface';
import {
  confirmFollowupDraft,
  getFollowupDraft,
  getFollowupExecution,
  type ProductApiError,
  updateFollowupDraft,
} from '../../api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  defaultSelectedTaskIds,
  missingTaskFieldLabels,
  taskConfirmationLabel,
} from './followup-task-selection';

const FollowupDraftPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [draft, setDraft] = useState<FollowupDraftResponse | null>(null);
  const [loadError, setLoadError] = useState<ProductApiError | null>(null);
  const [actionError, setActionError] = useState<ProductApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [execution, setExecution] = useState<AgentExecutionResult | null>(null);
  const [generatedBody, setGeneratedBody] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [nextActionChannel, setNextActionChannel] = useState('');
  const [nextActionParticipants, setNextActionParticipants] = useState('');
  const [evidenceQuotes, setEvidenceQuotes] = useState('');
  const [selectedTaskCandidateIds, setSelectedTaskCandidateIds] = useState<
    string[]
  >([]);

  const localDateTime = (value: string | null): string => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString().slice(0, 16);
  };

  useEffect((): void => {
    if (!id) return;
    void getFollowupDraft(id).then(async (result): Promise<void> => {
      setDraft(result);
      setGeneratedBody(result.version.generatedBody);
      setCustomerName(result.version.draft.customerName ?? '');
      setNextAction(result.version.draft.nextAction ?? '');
      setDueAt(localDateTime(result.version.draft.dueAt));
      setNextActionChannel(result.version.draft.nextActionChannel ?? '');
      setNextActionParticipants(
        (result.version.draft.nextActionParticipants ?? []).join('、'),
      );
      setEvidenceQuotes(result.version.draft.evidenceQuotes.join('\n'));
      setSelectedTaskCandidateIds(defaultSelectedTaskIds(
        result.version.taskCandidates ?? [],
      ));
      if (result.status === 'confirmed') {
        setExecution(await getFollowupExecution(id));
      }
    }).catch(setLoadError);
  }, [id]);

  useEffect((): (() => void) | undefined => {
    if (!id || execution?.status !== 'executing') return undefined;
    let active = true;
    const timer = window.setInterval((): void => {
      void getFollowupExecution(id).then((result): void => {
        if (!active || result === null) return;
        setExecution(result);
      }).catch((failure: ProductApiError): void => {
        if (active) setActionError(failure);
      });
    }, 1_500);
    return (): void => {
      active = false;
      window.clearInterval(timer);
    };
  }, [execution?.status, id]);

  const save = (): void => {
    if (!id || !draft) return;
    setSaving(true);
    setActionError(null);
    void updateFollowupDraft(id, {
      expectedVersion: draft.currentVersion,
      generatedBody,
      draft: {
        ...draft.version.draft,
        customerName: customerName.trim() || null,
        nextAction: nextAction.trim() || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        nextActionChannel: nextActionChannel.trim() || null,
        nextActionParticipants: nextActionParticipants
          .split(/[,，、;；\n]+/u)
          .map((participant: string): string => participant.trim())
          .filter((participant: string): boolean => participant.length > 0),
        evidenceQuotes: evidenceQuotes.split('\n').map((quote) => quote.trim())
          .filter((quote) => quote.length > 0),
      },
    }).then((result): void => {
      setDraft(result);
      setGeneratedBody(result.version.generatedBody);
      setCustomerName(result.version.draft.customerName ?? '');
      setNextAction(result.version.draft.nextAction ?? '');
      setDueAt(localDateTime(result.version.draft.dueAt));
      setNextActionChannel(result.version.draft.nextActionChannel ?? '');
      setNextActionParticipants(
        (result.version.draft.nextActionParticipants ?? []).join('、'),
      );
      setEvidenceQuotes(result.version.draft.evidenceQuotes.join('\n'));
      setSelectedTaskCandidateIds(defaultSelectedTaskIds(
        result.version.taskCandidates ?? [],
      ));
    }).catch((failure: ProductApiError): void => setActionError(failure))
      .finally((): void => setSaving(false));
  };

  const confirm = (): void => {
    if (!id || !draft) return;
    setConfirming(true);
    setActionError(null);
    const expectedVersion = draft.status === 'confirmed'
      ? draft.currentVersion - 1 : draft.currentVersion;
    void confirmFollowupDraft(id, {
      expectedVersion,
      selectedTaskCandidateIds,
    })
      .then(async (result): Promise<void> => {
        setExecution(result);
        setDraft(await getFollowupDraft(id));
      })
      .catch((failure: ProductApiError): void => setActionError(failure))
      .finally((): void => setConfirming(false));
  };

  const setTaskSelected = (candidateId: string, selected: boolean): void => {
    setSelectedTaskCandidateIds((current: string[]): string[] => {
      if (selected) {
        return current.includes(candidateId)
          ? current
          : [...current, candidateId];
      }
      return current.filter((idValue: string): boolean =>
        idValue !== candidateId,
      );
    });
  };

  if (loadError) return <div role="alert" className="rounded-xl border border-destructive/40 bg-card p-6"><AlertCircle className="text-destructive" /><h1 className="mt-4 text-xl font-semibold">草案暂时无法打开</h1><p className="mt-2 text-sm text-muted-foreground">{loadError.message}</p></div>;
  if (!draft) return <div aria-busy="true" className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-72" /></div>;

  const quality = draft.version.quality;
  const taskCandidates: FollowupTaskCandidate[] =
    draft.version.taskCandidates ?? [];
  const dirty = generatedBody !== draft.version.generatedBody ||
    customerName.trim() !== (draft.version.draft.customerName ?? '') ||
    nextAction.trim() !== (draft.version.draft.nextAction ?? '') ||
    dueAt !== localDateTime(draft.version.draft.dueAt) ||
    nextActionChannel.trim() !==
      (draft.version.draft.nextActionChannel ?? '') ||
    nextActionParticipants.trim() !==
      (draft.version.draft.nextActionParticipants ?? []).join('、') ||
    evidenceQuotes !== draft.version.draft.evidenceQuotes.join('\n');
  const requiredReady = Boolean(
    draft.version.draft.customerName && nextAction.trim() && dueAt,
  );
  const mayConfirm = draft.status === 'pendingConfirmation' &&
    quality.confirmable && requiredReady && !dirty && !saving && !confirming;
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm font-medium text-primary">跟进草案 · v{draft.currentVersion}</p><h1 className="mt-2 text-3xl font-semibold">{draft.status === 'confirmed' ? '跟进执行结果' : '确认前检查'}</h1><p className="mt-2 text-sm text-muted-foreground">{draft.status === 'confirmed' ? '已确认版本不可再编辑；写入状态见下方。' : '在你确认前，不会写入客户、商机或任务。'}</p></div>
        <Button variant="outline" asChild><Link to="/followups/new">重新录入</Link></Button>
      </header>
      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">AI 生成正文</h2>
          <label className="mt-4 block space-y-2 text-sm font-medium">
            跟进正文
            <Textarea rows={8} value={generatedBody} disabled={draft.status !== 'pendingConfirmation'} onChange={(event): void => setGeneratedBody(event.target.value)} />
          </label>
          <dl className="mt-7 grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium">客户<Input value={customerName} disabled={draft.status !== 'pendingConfirmation'} onChange={(event): void => setCustomerName(event.target.value)} /></label>
            <div><dt className="text-xs text-muted-foreground">联系人</dt><dd className="mt-1 font-medium">{draft.version.draft.contactName ?? '待补充'}</dd></div>
            <label className="space-y-2 text-sm font-medium">下一步<Input value={nextAction} disabled={draft.status !== 'pendingConfirmation'} onChange={(event): void => setNextAction(event.target.value)} /></label>
            <label className="space-y-2 text-sm font-medium">截止时间<Input type="datetime-local" value={dueAt} disabled={draft.status !== 'pendingConfirmation'} onChange={(event): void => setDueAt(event.target.value)} /></label>
            <label className="space-y-2 text-sm font-medium">下一步方式<Input value={nextActionChannel} disabled={draft.status !== 'pendingConfirmation'} onChange={(event): void => setNextActionChannel(event.target.value)} placeholder="客户现场、视频会议、邮件" /></label>
            <label className="space-y-2 text-sm font-medium">下一步参与人<Input value={nextActionParticipants} disabled={draft.status !== 'pendingConfirmation'} onChange={(event): void => setNextActionParticipants(event.target.value)} placeholder="多人请用顿号分隔" /></label>
          </dl>
          <label className="mt-6 block space-y-2 text-sm font-medium">来源证据引用（每行一条，须能在原文找到）
            <Textarea rows={3} value={evidenceQuotes} disabled={draft.status !== 'pendingConfirmation'} onChange={(event): void => setEvidenceQuotes(event.target.value)} />
          </label>
          {quality.invalidEvidence.length > 0 && <p className="mt-2 text-sm text-destructive">无法定位：{quality.invalidEvidence.map((item) => item.quote).join('、')}</p>}
          <section className="mt-7 border-t border-border pt-6">
            <h2 className="text-lg font-semibold">待办预览</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              只会创建你勾选的本人待办；缺少三要素的候选不能勾选。
            </p>
            {taskCandidates.length === 0 ? (
              <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                当前跟进没有可抽取的下一步待办。
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {taskCandidates.map((candidate: FollowupTaskCandidate) => {
                  const ready: boolean = candidate.status === 'ready';
                  const selected: boolean = selectedTaskCandidateIds.includes(
                    candidate.id,
                  );
                  const missingLabels: string[] = missingTaskFieldLabels(
                    candidate.missingFields,
                  );
                  return (
                    <label
                      key={candidate.id}
                      className="flex items-start gap-3 rounded-lg border border-border p-4"
                    >
                      <Checkbox
                        checked={selected}
                        disabled={!ready || draft.status !== 'pendingConfirmation'}
                        onCheckedChange={(checked: boolean | 'indeterminate'): void =>
                          setTaskSelected(candidate.id, checked === true)
                        }
                        aria-label={`选择待办：${candidate.title}`}
                      />
                      <span className="min-w-0 text-sm">
                        <span className="block break-words font-medium">
                          {candidate.title}
                        </span>
                        {ready ? (
                          <span className="mt-1 block break-words text-muted-foreground">
                            {candidate.dueAt} · {candidate.channel} ·
                            {' '}{candidate.participants.join('、')}
                          </span>
                        ) : (
                          <span className="mt-1 block text-destructive">
                            待补充：{missingLabels.join('、')}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </section>
          {actionError && <p role="alert" className="mt-5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{actionError.message}</p>}
          {dirty && <p className="mt-5 text-sm text-amber-700">有未保存的修改。请先保存并重新质检，再确认写入。</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            {draft.status === 'pendingConfirmation' && <Button variant="outline" onClick={save} disabled={!dirty || saving || generatedBody.trim().length === 0}>{saving ? '正在重新质检…' : '保存修改并重新质检'}</Button>}
            {draft.status === 'pendingConfirmation' && <Button onClick={confirm} disabled={!mayConfirm}>{confirming ? '正在写入…' : taskConfirmationLabel(selectedTaskCandidateIds.length)}</Button>}
            {draft.status === 'confirmed' && execution && ['failed', 'partialFailure'].includes(execution.status) && <Button onClick={confirm} disabled={confirming}>{confirming ? '正在重试…' : '重试未完成的写入'}</Button>}
          </div>
        </section>
        <aside className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between"><h2 className="font-semibold">质量检查</h2><span className="text-3xl font-semibold text-primary">{quality.score}</span></div>
            <p className="mt-2 text-sm text-muted-foreground">等级 {quality.grade} · 评分仅用于改进建议</p>
            <div className="mt-5 flex items-start gap-2 rounded-lg bg-muted p-3 text-sm">
              {quality.confirmable ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : <ShieldAlert className="size-4 shrink-0 text-destructive" />}
              {quality.confirmable ? '证据检查通过，可以继续编辑或确认。' : '存在无法定位的事实证据，当前版本不能确认。'}
            </div>
          </section>
          <section className="rounded-xl border border-border bg-card p-6"><h2 className="font-semibold">待改进</h2>{quality.suggestions.length ? <ul className="mt-3 space-y-2 text-sm text-muted-foreground">{quality.suggestions.map((item) => <li key={item}>· {item}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">暂无强制改进项。</p>}</section>
          {draft.status === 'confirmed' && <section className="rounded-xl border border-border bg-card p-6" aria-live="polite">
            <h2 className="font-semibold">写入结果</h2>
            {execution?.status === 'executing' ? (
              <div className="mt-3 flex items-center gap-2 text-sm" role="status">
                <LoaderCircle className="size-4 animate-spin text-primary" />
                <span>执行中，请等待。完成后会自动更新结果。</span>
              </div>
            ) : (
              <p className="mt-3 text-sm">
                {execution ? `状态：${execution.status}` : '执行记录尚未生成，请刷新页面。'}
              </p>
            )}
            {execution?.followupRecordId && <p className="mt-2 break-all text-sm">Base 跟进记录：{execution.followupRecordId}</p>}
            {execution?.taskGuid && <p className="mt-2 break-all text-sm">飞书任务：{execution.taskGuid}</p>}
            {execution?.taskUrl && <a className="mt-2 block break-all text-sm text-primary underline" href={execution.taskUrl} target="_blank" rel="noreferrer">打开飞书任务</a>}
            {execution?.errorMessage && <p role="alert" className="mt-3 text-sm text-destructive">{execution.errorMessage}</p>}
            {execution?.status === 'executing' && <Button className="mt-4" variant="outline" onClick={(): void => { if (id) void getFollowupExecution(id).then(setExecution).catch(setActionError); }}>刷新状态</Button>}
          </section>}
        </aside>
      </div>
    </div>
  );
};

export default FollowupDraftPage;
