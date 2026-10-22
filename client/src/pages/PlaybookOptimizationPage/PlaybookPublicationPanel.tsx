import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, History, RefreshCw, Send, Undo2, X } from 'lucide-react';
import type {
  PlaybookAdoptionEvidenceKind, PlaybookAdoptionResponse, PlaybookPublicationResponse,
  RecordPlaybookAdoptionRequest, RecordPlaybookPublicationRequest, PublishedPlaybook,
} from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { getPlaybookAdoption, getPlaybookPublication, recordPlaybookAdoption,
  recordPlaybookPublication, type ProductApiError } from '../../api';

const PlaybookPublicationPanel: React.FC<{
  candidateId: string; canPublish: boolean; disabled: boolean;
  onAccessFailure: (failure: ProductApiError) => void;
  onOperationState: (locked: boolean) => void;
}> = ({ candidateId, canPublish, disabled, onAccessFailure, onOperationState }) => {
  const [data, setData] = useState<PlaybookPublicationResponse | null>(null);
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(true);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [pending, setPending] = useState<RecordPlaybookPublicationRequest | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'withdraw' | null>(null);
  const [revoked, setRevoked] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const generation = useRef<number>(0);
  const locked = useRef<boolean>(false);
  const access = useRef(onAccessFailure);
  access.current = onAccessFailure;
  const operationState = useRef(onOperationState);
  operationState.current = onOperationState;
  useEffect((): void => { operationState.current(pending !== null); }, [pending]);

  const fail = useCallback((failure: unknown): void => {
    const value = failure as ProductApiError;
    setData(null); setConfirm(null); setError(value);
    if ([401, 403, 404].includes(value.status)) {
      setNote(''); setPending(null); setRevoked(true); access.current(value);
    }
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (locked.current) return;
    locked.current = true;
    const currentGeneration: number = generation.current;
    setBusy(true); setError(null); setConfirm(null); setSaved(false);
    try {
      const result = await getPlaybookPublication(candidateId);
      if (generation.current === currentGeneration) { setData(result); setRevoked(false); }
    } catch (failure: unknown) { if (generation.current === currentGeneration) fail(failure); }
    finally { if (generation.current === currentGeneration) { locked.current = false; setBusy(false); } }
  }, [candidateId, fail]);

  useEffect((): (() => void) => {
    setData(null); setNote(''); setPending(null); setRevoked(false); setSaved(false);
    void load();
    return (): void => { generation.current += 1; locked.current = false; operationState.current(false); };
  }, [load]);

  const write = async (input: RecordPlaybookPublicationRequest): Promise<void> => {
    if (locked.current || revoked) return;
    locked.current = true;
    const currentGeneration: number = generation.current;
    let acknowledged: boolean = false;
    setBusy(true); setError(null); setPending(input); setConfirm(null); setSaved(false);
    try {
      await recordPlaybookPublication(candidateId, input);
      if (generation.current !== currentGeneration) return;
      acknowledged = true;
      setPending(null); setData(null); setNote('');
      const current = await getPlaybookPublication(candidateId);
      if (generation.current === currentGeneration) { setData(current); setSaved(true); }
    } catch (failure: unknown) {
      if (generation.current !== currentGeneration) return;
      const value = failure as ProductApiError;
      if (acknowledged || [400, 401, 403, 404, 409, 422].includes(value.status)) setPending(null);
      fail(failure);
    } finally {
      if (generation.current === currentGeneration) { locked.current = false; setBusy(false); }
    }
  };

  const submit = (): void => {
    if (!data || !confirm || !canPublish || disabled || pending || busy || !validNote) return;
    const base = { requestId: crypto.randomUUID(), expectedPublicationSequence: data.current?.sequence ?? 0,
      note: note.trim() };
    if (confirm === 'publish' && data.latestDraft && data.approvedVersion === data.latestDraft.version &&
      data.active?.version !== data.latestDraft.version) {
      void write({ ...base, action: 'publish', expectedVersion: data.latestDraft.version,
        expectedReviewSequence: data.reviewSequence });
    } else if (confirm === 'withdraw' && data.active) {
      void write({ ...base, action: 'withdraw', expectedVersion: data.active.version, expectedReviewSequence: null });
    }
  };
  const history = async (): Promise<void> => {
    if (locked.current || pending || !data?.nextBeforeSequence) return;
    locked.current = true;
    const currentGeneration: number = generation.current;
    setBusy(true); setError(null); setConfirm(null);
    try {
      const page = await getPlaybookPublication(candidateId, data.nextBeforeSequence);
      if (generation.current === currentGeneration) setData({ ...page, history: [
        ...data.history, ...page.history.filter((item) => !data.history.some((old) => old.sequence === item.sequence)),
      ] });
    } catch (failure: unknown) { if (generation.current === currentGeneration) fail(failure); }
    finally { if (generation.current === currentGeneration) { locked.current = false; setBusy(false); } }
  };
  const validNote: boolean = note.trim().length >= 2 && note.trim().length <= 500 && !note.includes('\0');
  const frozen: boolean = busy || pending !== null || disabled || !validNote;

  if (revoked) return <p role="status">访问权限已失效，发布内容和说明已清除。</p>;
  return <section className="min-w-0 space-y-4 [&_button]:min-h-11" aria-label="Playbook 发布管理" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <h3 className="font-medium">{data ? data.active ? `当前已发布 v${data.active.version}` :
        data.current ? '当前已撤回' : '尚未发布' : '发布状态待确认'}</h3>
      <Button variant="outline" disabled={busy || pending !== null} onClick={(): void => { void load(); }}>
        <RefreshCw aria-hidden="true" />刷新发布状态
      </Button>
    </div>
    {error && <Alert variant="destructive" role="alert">
      <AlertTitle>{pending ? '操作结果待确认' : '发布状态未更新'}</AlertTitle>
      <AlertDescription className="break-words">{error.message}</AlertDescription>
    </Alert>}
    {saved && <p role="status" className="text-sm text-muted-foreground">操作已记录，已读取当前发布状态。</p>}
    {pending && <Button variant="outline" disabled={busy} onClick={(): void => { void write(pending); }}>
      <RefreshCw aria-hidden="true" />重试原发布请求
    </Button>}
    {busy && !data && <p role="status" className="py-4 text-sm text-muted-foreground">正在读取发布状态…</p>}
    {data && <>
      {data.active && <PublishedPlaybookContent value={data.active} />}
      {data.latestDraft && <article className="min-w-0 space-y-2 border-b pb-4" aria-label="待发布快照">
        <h4 className="break-words font-medium">草稿 v{data.latestDraft.version} · {data.latestDraft.title}</h4>
        <p className="text-sm text-muted-foreground">{data.approvedVersion === data.latestDraft.version ? '发布前审核已通过' : '尚未通过当前版本审核'}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{data.latestDraft.applicability}</p>
        <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm leading-6">{data.latestDraft.body}</p>
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-xs text-muted-foreground">来源版本：{data.latestDraft.sources.length
          ? data.latestDraft.sources.map((source) => `${source.sourceId} · ${source.sourceVersion ?? '未知版本'}`).join('\n') : '无来源记录'}</p>
      </article>}
      {canPublish && <div className="space-y-3">
        <label htmlFor="playbook-publication-note" className="text-sm font-medium">发布或撤回说明</label>
        <Textarea id="playbook-publication-note" value={note} maxLength={500}
          disabled={busy || pending !== null || disabled} onChange={(event): void => { setNote(event.target.value); setConfirm(null); }} />
        {confirm ? <Alert>
          <AlertTitle>{confirm === 'publish' ? `发布 v${data.latestDraft?.version}？` : `撤回 v${data.active?.version}？`}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{confirm === 'publish' ? '此版本将作为企业当前销售资料，替换此前发布版本。' : '撤回后，销售资料列表将不再提供此版本。'}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant={confirm === 'withdraw' ? 'destructive' : 'default'} disabled={frozen} onClick={submit}>
                <Check aria-hidden="true" />{confirm === 'publish' ? '确认发布' : '确认撤回'}
              </Button>
              <Button variant="outline" disabled={busy} onClick={(): void => setConfirm(null)}><X aria-hidden="true" />取消</Button>
            </div>
          </AlertDescription>
        </Alert> : <div className="flex flex-wrap gap-2">
          {data.latestDraft && data.approvedVersion === data.latestDraft.version && data.active?.version !== data.latestDraft.version &&
            <Button disabled={frozen} onClick={(): void => setConfirm('publish')}><Send aria-hidden="true" />发布此版本</Button>}
          {data.active && <Button variant="outline" disabled={frozen} onClick={(): void => setConfirm('withdraw')}>
            <Undo2 aria-hidden="true" />撤回当前版本
          </Button>}
        </div>}
      </div>}
      <section aria-label="发布历史" className="space-y-3 border-t pt-4">
        <h4 className="flex items-center gap-2 text-sm font-medium"><History aria-hidden="true" className="size-4" />发布历史</h4>
        {data.history.length === 0 ? <p className="text-sm text-muted-foreground">暂无发布记录</p> : <ol className="divide-y">
          {data.history.map((event) => <li key={event.sequence} className="space-y-1 py-3 text-sm [overflow-wrap:anywhere]">
            <p>v{event.version} · {event.action === 'publish' ? '发布' : '撤回'} · {event.note}</p>
            <p className="text-xs text-muted-foreground">{event.actorMemberId} · {new Date(event.createdAt).toLocaleString('zh-CN')}</p>
          </li>)}
        </ol>}
        {data.nextBeforeSequence !== null && <Button variant="outline" disabled={busy || pending !== null}
          onClick={(): void => { void history(); }}>更早发布记录</Button>}
      </section>
    </>}
  </section>;
};

const PublishedPlaybookContent: React.FC<{ value: PublishedPlaybook }> = ({ value }) => <article
  aria-label={`已发布版本 v${value.version}`} className="min-w-0 space-y-3 border-b pb-4 [overflow-wrap:anywhere]">
  <h4 className="font-semibold">{value.title} · v{value.version}</h4>
  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{value.applicability}</p>
  <p className="max-h-80 overflow-auto whitespace-pre-wrap text-sm leading-6">{value.body}</p>
  <p className="text-xs text-muted-foreground">发布于 {new Date(value.publishedAt).toLocaleString('zh-CN')}</p>
  <p className="whitespace-pre-wrap text-xs text-muted-foreground">来源版本：{value.sources.length ? value.sources.map((source) =>
    `${source.sourceId} · ${source.sourceVersion ?? '未知版本'}`).join('\n') : '无来源记录'}</p>
</article>;

const adoptionStatus: Record<string, string> = {
  not_adopted: '尚未记录采用', adopted: '已验证采用', retracted: '采用已撤回',
};

const PlaybookAdoptionPanel: React.FC<{
  candidateId: string; canAdopt: boolean; onAccessFailure: (failure: ProductApiError) => void;
}> = ({ candidateId, canAdopt, onAccessFailure }) => {
  const [data, setData] = useState<PlaybookAdoptionResponse | null>(null);
  const [kind, setKind] = useState<PlaybookAdoptionEvidenceKind>('followup');
  const [recordId, setRecordId] = useState<string>('');
  const [actionId, setActionId] = useState<string>('');
  const [evidenceNote, setEvidenceNote] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(true);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [pending, setPending] = useState<RecordPlaybookAdoptionRequest | null>(null);
  const [confirmRetract, setConfirmRetract] = useState<boolean>(false);
  const [revoked, setRevoked] = useState<boolean>(false);
  const locked = useRef<boolean>(false);

  const load = async (): Promise<void> => {
    if (locked.current || revoked) return;
    locked.current = true; setBusy(true); setError(null);
    try { setData(await getPlaybookAdoption(candidateId)); setRevoked(false); }
    catch (failure: unknown) {
      const value = failure as ProductApiError; setData(null); setError(value);
      if ([401, 403, 404].includes(value.status)) {
        setRecordId(''); setActionId(''); setEvidenceNote(''); setNote(''); setPending(null); setRevoked(true); onAccessFailure(value);
      }
    } finally { locked.current = false; setBusy(false); }
  };
  useEffect((): (() => void) => { void load(); return (): void => { locked.current = false; }; }, [candidateId]);

  const write = async (input: RecordPlaybookAdoptionRequest): Promise<void> => {
    if (locked.current || revoked) return;
    locked.current = true; setBusy(true); setError(null); setPending(input); setConfirmRetract(false);
    try { const event = await recordPlaybookAdoption(candidateId, input); setPending(null);
      setData((current) => current ? { ...current, adoptionSequence: event.sequence,
        status: event.action === 'record' ? 'adopted' : 'retracted', current: event,
        history: [event, ...current.history.filter((item) => item.sequence !== event.sequence)],
        verifiedAdoptionCount: current.verifiedAdoptionCount + (event.action === 'record' ? 1 : 0),
        retractionCount: current.retractionCount + (event.action === 'retract' ? 1 : 0) } : current); }
    catch (failure: unknown) {
      const value = failure as ProductApiError; setError(value);
      if ([400, 401, 403, 404].includes(value.status)) setPending(null);
      if ([401, 403, 404].includes(value.status)) { setRecordId(''); setActionId(''); setEvidenceNote(''); setNote(''); setPending(null); setData(null); setRevoked(true); onAccessFailure(value); }
      if (value.status === 409) {
        setPending(null);
        locked.current = false;
        setBusy(false);
        await load();
      }
    } finally { locked.current = false; setBusy(false); }
  };
  const validNote: boolean = note.trim().length >= 2 && note.trim().length <= 500;
  const validEvidence: boolean = recordId.trim().length > 0 && actionId.trim().length > 0 && evidenceNote.trim().length >= 2;
  const submit = (): void => {
    if (!data?.publication || !validNote || !validEvidence || busy || pending || !canAdopt) return;
    void write({ requestId: crypto.randomUUID(), expectedAdoptionSequence: data.adoptionSequence,
      publicationVersion: data.publication.version, publicationSequence: data.publication.publicationSequence,
      action: 'record', evidence: { kind, recordId: recordId.trim(), actionId: actionId.trim(), note: evidenceNote.trim() }, note: note.trim() });
  };
  const retract = (): void => {
    if (!data?.publication || !validNote || busy || pending || !canAdopt || !confirmRetract) return;
    void write({ requestId: crypto.randomUUID(), expectedAdoptionSequence: data.adoptionSequence,
      publicationVersion: data.publication.version, publicationSequence: data.publication.publicationSequence,
      action: 'retract', evidence: null, note: note.trim() });
  };
  if (revoked) return <p role="status">采用记录访问权限已失效，已清除证据输入。</p>;
  return <section aria-label="Playbook 采用记录" className="space-y-3 border-t pt-4" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-medium">可信采用记录</h4>
      <Button variant="outline" disabled={busy || pending !== null} onClick={(): void => { void load(); }}><RefreshCw aria-hidden="true" />刷新采用状态</Button>
    </div>
    {error && <Alert variant="destructive" role="alert"><AlertTitle>{pending ? '采用结果待确认' : '采用状态未更新'}</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>}
    {pending && <Button variant="outline" disabled={busy} onClick={(): void => { void write(pending); }}><RefreshCw aria-hidden="true" />重试原采用请求</Button>}
    {data && <>
      <p className="text-sm text-muted-foreground">{adoptionStatus[data.status]} · 已验证采用 {data.verifiedAdoptionCount} 次 · 撤回 {data.retractionCount} 次</p>
      {data.current && <p className="text-xs text-muted-foreground">最近操作：{data.current.note} · {new Date(data.current.createdAt).toLocaleString('zh-CN')}</p>}
      {canAdopt && data.publication && <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm"><span>证据类型</span><select className="h-10 w-full rounded-md border bg-background px-3" value={kind} disabled={busy || pending !== null} onChange={(event): void => setKind(event.target.value as PlaybookAdoptionEvidenceKind)}><option value="followup">跟进记录</option><option value="opportunity">商机记录</option><option value="task">任务</option></select></label>
          <label className="space-y-1 text-sm"><span>真实记录 ID</span><Input value={recordId} disabled={busy || pending !== null} onChange={(event): void => setRecordId(event.target.value)} maxLength={255} /></label>
          <label className="space-y-1 text-sm"><span>action ID</span><Input value={actionId} disabled={busy || pending !== null} onChange={(event): void => setActionId(event.target.value)} maxLength={36} /></label>
        </div>
        <label className="block space-y-1 text-sm"><span>业务证据说明</span><Textarea value={evidenceNote} disabled={busy || pending !== null} maxLength={500} onChange={(event): void => setEvidenceNote(event.target.value)} /></label>
        <label className="block space-y-1 text-sm"><span>采用说明</span><Textarea value={note} disabled={busy || pending !== null} maxLength={500} onChange={(event): void => { setNote(event.target.value); setConfirmRetract(false); }} /></label>
        {confirmRetract && <Alert><AlertTitle>撤回当前采用记录？</AlertTitle><AlertDescription className="flex flex-wrap gap-2 pt-2"><Button variant="destructive" disabled={busy || !validNote} onClick={retract}><Check aria-hidden="true" />确认撤回采用</Button><Button variant="outline" onClick={(): void => setConfirmRetract(false)}>取消</Button></AlertDescription></Alert>}
        {!confirmRetract && <div className="flex flex-wrap gap-2"><Button disabled={busy || pending !== null || !validNote || !validEvidence} onClick={submit}><Check aria-hidden="true" />记录已采用</Button>{data.status === 'adopted' && <Button variant="outline" disabled={busy || pending !== null || !validNote} onClick={(): void => setConfirmRetract(true)}><Undo2 aria-hidden="true" />撤回采用</Button>}</div>}
      </div>}
      {data.history.length > 0 && <ol className="divide-y text-sm">{data.history.map((event) => <li key={event.sequence} className="py-2">{event.action === 'record' ? '采用' : '撤回'} · {event.note} · {new Date(event.createdAt).toLocaleString('zh-CN')}</li>)}</ol>}
    </>}
  </section>;
};
export { PlaybookAdoptionPanel, PlaybookPublicationPanel, PublishedPlaybookContent };
