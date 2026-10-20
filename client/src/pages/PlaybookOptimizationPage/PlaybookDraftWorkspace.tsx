import React, { useEffect, useRef, useState } from 'react';
import { History, RefreshCw, Save } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type {
  PlaybookDraftContent, PlaybookDraftResponse, PlaybookDraftVersion,
  PlaybookOptimizationCandidate, SavePlaybookDraftRequest,
} from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  getPlaybookDraft, getPlaybookDraftVersion, savePlaybookDraft, type ProductApiError,
} from '../../api';
import { PlaybookDraftReviewPanel } from './PlaybookDraftReviewPanel';

const draftSchema = z.object({
  title: z.string().trim().min(2, '标题至少 2 字').max(120, '标题最多 120 字'),
  body: z.string().trim().min(10, '正文至少 10 字').max(20000, '正文最多 20000 字'),
  applicability: z.string().trim().min(2, '适用范围至少 2 字').max(1000, '适用范围最多 1000 字'),
  changeNote: z.string().trim().min(2, '版本说明至少 2 字').max(500, '版本说明最多 500 字'),
});
const contentOf = (value: PlaybookDraftVersion): PlaybookDraftContent => ({
  title: value.title, body: value.body, applicability: value.applicability, changeNote: value.changeNote,
});

const PlaybookDraftWorkspace: React.FC<{
  candidate: PlaybookOptimizationCandidate;
  canApprove: boolean;
  onClose: () => void;
  onAccessFailure: (failure: ProductApiError) => void;
}> = ({ candidate, canApprove, onClose, onAccessFailure }) => {
  const [data, setData] = useState<PlaybookDraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(true);
  const [revoked, setRevoked] = useState<boolean>(false);
  const [pending, setPending] = useState<SavePlaybookDraftRequest | null>(null);
  const [conflict, setConflict] = useState<boolean>(false);
  const [remote, setRemote] = useState<PlaybookDraftResponse | null>(null);
  const [selected, setSelected] = useState<PlaybookDraftVersion | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [closing, setClosing] = useState<boolean>(false);
  const alive = useRef<boolean>(true);
  const locked = useRef<boolean>(false);
  const form = useForm<PlaybookDraftContent>({
    resolver: zodResolver(draftSchema),
    defaultValues: { title: candidate.topicPreview, body: '', applicability: '', changeNote: '' },
  });

  const fail = (failure: unknown): void => {
    const value = failure as ProductApiError;
    if ([401, 403, 404].includes(value.status)) {
      form.reset({ title: '', body: '', applicability: '', changeNote: '' });
      setData(null); setRemote(null); setSelected(null); setPending(null); setRevoked(true);
      onAccessFailure(value);
    }
    setError(value.message || '请求未完成，请稍后重试');
  };

  useEffect((): (() => void) => {
    alive.current = true;
    let active: boolean = true;
    locked.current = true;
    void getPlaybookDraft(candidate.id).then((result): void => {
      if (!active) return;
      setData(result);
      if (result.latest) form.reset(contentOf(result.latest));
    }).catch((failure: unknown): void => { if (active) fail(failure); })
      .finally((): void => { if (active) { locked.current = false; setBusy(false); } });
    return (): void => { active = false; alive.current = false; };
    // The parent keys this workspace by candidate and authenticated session.
  }, [candidate.id]);

  const read = async (forConflict: boolean): Promise<void> => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      const result = await getPlaybookDraft(candidate.id);
      if (!alive.current) return;
      if (forConflict) setRemote(result);
      else { setData(result); if (result.latest) form.reset(contentOf(result.latest)); }
    } catch (failure: unknown) { if (alive.current) fail(failure); }
    finally { if (alive.current) { locked.current = false; setBusy(false); } }
  };

  const save = async (input: SavePlaybookDraftRequest): Promise<void> => {
    if (locked.current || conflict || revoked || data === null) return;
    locked.current = true; setBusy(true); setError(null); setSaved(null);
    try {
      const version = await savePlaybookDraft(candidate.id, input);
      if (!alive.current) return;
      setPending(null); setSaved(version.version); form.reset(contentOf(version));
      setData((current) => ({
        latest: version,
        history: [version, ...(current?.history ?? []).filter((item) => item.version !== version.version)],
        nextBeforeVersion: current?.nextBeforeVersion ?? null,
      }));
    } catch (failure: unknown) {
      if (!alive.current) return;
      const value = failure as ProductApiError;
      if (value.status === 409) {
        setPending(null); setConflict(true); setRemote(null);
        try {
          const result = await getPlaybookDraft(candidate.id);
          if (alive.current) setRemote(result);
        } catch (readFailure: unknown) { if (alive.current) fail(readFailure); }
      } else if (![401, 403, 404, 400, 422].includes(value.status)) {
        setPending(input);
      }
      if (alive.current) fail(value);
    } finally { if (alive.current) { locked.current = false; setBusy(false); } }
  };

  const submit = (values: PlaybookDraftContent): Promise<void> => save({
    ...values, expectedVersion: data?.latest?.version ?? 0, requestId: crypto.randomUUID(),
  });
  const resolveConflict = (useRemote: boolean): void => {
    if (!remote || busy) return;
    setData(remote); setSelected(null);
    if (useRemote) form.reset(remote.latest ? contentOf(remote.latest) : {
      title: candidate.topicPreview, body: '', applicability: '', changeNote: '',
    });
    setRemote(null); setConflict(false); setError(null); setSaved(null);
  };
  const history = async (version?: number): Promise<void> => {
    if (locked.current || revoked) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      if (version !== undefined) {
        const result = await getPlaybookDraftVersion(candidate.id, version);
        if (alive.current) setSelected(result);
      } else if (data?.nextBeforeVersion) {
        const page = await getPlaybookDraft(candidate.id, data.nextBeforeVersion);
        if (alive.current) setData((current) => current ? {
          ...current, history: [...current.history, ...page.history], nextBeforeVersion: page.nextBeforeVersion,
        } : current);
      }
    } catch (failure: unknown) { if (alive.current) fail(failure); }
    finally { if (alive.current) { locked.current = false; setBusy(false); } }
  };
  const requestClose = (): void => {
    if (busy) return;
    if (form.formState.isDirty || pending) setClosing(true);
    else onClose();
  };
  const frozen: boolean = busy || pending !== null || conflict;

  return <Dialog open onOpenChange={(open): void => { if (!open) requestClose(); }}>
    <DialogContent showCloseButton={false} className="max-h-[90dvh] max-w-4xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="break-words pr-4">{candidate.topicPreview} · 草稿</DialogTitle>
        <DialogDescription>未发布{data?.latest ? ` · 当前 v${data.latest.version}` : ' · 尚无保存版本'}</DialogDescription>
      </DialogHeader>
      {error && <Alert variant="destructive" role="alert">
        <AlertTitle>{pending ? '保存结果待确认' : '操作未完成'}</AlertTitle>
        <AlertDescription className="break-words">{error}</AlertDescription>
      </Alert>}
      {revoked ? <p role="status">当前内容已清除，请重新验证访问权限。</p> : <>
        {closing && <Alert>
          <AlertTitle>放弃未保存内容？</AlertTitle>
          <AlertDescription className="flex flex-wrap gap-2 pt-2">
            <Button variant="outline" onClick={(): void => setClosing(false)}>继续编辑</Button>
            <Button variant="destructive" onClick={onClose}>放弃并关闭</Button>
          </AlertDescription>
        </Alert>}
        {conflict && <Alert>
          <AlertTitle>草稿版本已变化</AlertTitle>
          <AlertDescription className="space-y-3">
            {remote ? <>
              <p>最新版本 {remote.latest ? `v${remote.latest.version} · ${remote.latest.title}` : '尚未创建'}</p>
              {remote.latest && <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{remote.latest.body}</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy} onClick={(): void => resolveConflict(true)}>使用远端内容</Button>
                <Button variant="outline" disabled={busy} onClick={(): void => resolveConflict(false)}>保留本地内容</Button>
              </div>
            </> : <Button variant="outline" disabled={busy} onClick={(): void => { void read(true); }}>
              <RefreshCw aria-hidden="true" />读取最新版本
            </Button>}
          </AlertDescription>
        </Alert>}
        {data === null ? <Button variant="outline" disabled={busy} onClick={(): void => { void read(false); }}>
          <RefreshCw aria-hidden="true" />{busy ? '正在读取草稿' : '重新读取草稿'}
        </Button> : <Tabs defaultValue="edit">
          <TabsList aria-label="草稿视图">
            <TabsTrigger value="edit">编辑</TabsTrigger>
            <TabsTrigger value="history"><History aria-hidden="true" className="mr-2 size-4" />版本历史</TabsTrigger>
            <TabsTrigger value="review">发布前审核</TabsTrigger>
          </TabsList>
          <TabsContent value="edit">
            <Form {...form}>
              <form className="space-y-4" onSubmit={form.handleSubmit(submit)}>
                <fieldset disabled={frozen} className="min-w-0 space-y-4">
                  <FormField control={form.control} name="title" render={({ field }) => <FormItem>
                    <FormLabel>标题</FormLabel><FormControl><Input {...field} maxLength={120} /></FormControl><FormMessage />
                  </FormItem>} />
                  <FormField control={form.control} name="applicability" render={({ field }) => <FormItem>
                    <FormLabel>适用范围</FormLabel><FormControl><Textarea {...field} maxLength={1000} /></FormControl><FormMessage />
                  </FormItem>} />
                  <FormField control={form.control} name="body" render={({ field }) => <FormItem>
                    <FormLabel>正文</FormLabel><FormControl><Textarea {...field} className="min-h-60" maxLength={20000} /></FormControl><FormMessage />
                  </FormItem>} />
                  <FormField control={form.control} name="changeNote" render={({ field }) => <FormItem>
                    <FormLabel>版本说明</FormLabel><FormControl><Textarea {...field} maxLength={500} /></FormControl><FormMessage />
                  </FormItem>} />
                </fieldset>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={frozen || !form.formState.isDirty}>
                    <Save aria-hidden="true" />{busy && !pending ? '正在处理' : '保存新版本'}
                  </Button>
                  {pending && <Button type="button" variant="outline" disabled={busy} onClick={(): void => { void save(pending); }}>
                    <RefreshCw aria-hidden="true" />重试原保存请求
                  </Button>}
                  {saved !== null && <p role="status" className="text-sm text-muted-foreground">已保存 v{saved}</p>}
                </div>
              </form>
            </Form>
          </TabsContent>
          <TabsContent value="history" className="space-y-4">
            {data.history.length === 0 ? <p className="py-6 text-sm text-muted-foreground">暂无保存版本</p> :
              <ol className="divide-y">
                {data.history.map((item) => <li key={item.version} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1 break-words text-sm">
                    <p className="font-medium">v{item.version} · {item.title}</p>
                    <p>{item.changeNote}</p>
                    <time className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString('zh-CN')}</time>
                  </div>
                  <Button variant="outline" disabled={busy} onClick={(): void => { void history(item.version); }}>查看 v{item.version}</Button>
                </li>)}
              </ol>}
            {data.nextBeforeVersion !== null && <Button variant="outline" disabled={busy} onClick={(): void => { void history(); }}>更早版本</Button>}
            {selected && <VersionDetail value={selected} />}
          </TabsContent>
          <TabsContent value="review">
            {data.latest ? <PlaybookDraftReviewPanel
              key={`${candidate.id}:${data.latest.version}`}
              candidateId={candidate.id}
              version={data.latest.version}
              canApprove={canApprove}
              disabled={frozen || form.formState.isDirty}
              onAccessFailure={onAccessFailure}
            /> : <p className="py-6 text-sm text-muted-foreground">先保存一个草稿版本，再提交审核。</p>}
          </TabsContent>
        </Tabs>}
      </>}
      <div className="flex justify-end border-t pt-3"><Button variant="outline" onClick={requestClose} disabled={busy}>关闭</Button></div>
    </DialogContent>
  </Dialog>;
};

const VersionDetail: React.FC<{ value: PlaybookDraftVersion }> = ({ value }) => <section
  aria-label={`版本 ${value.version} 正文`} className="min-w-0 space-y-3 border-t pt-4 text-sm">
  <h3 className="break-words font-semibold">v{value.version} · {value.title}</h3>
  <p className="whitespace-pre-wrap break-words">{value.applicability}</p>
  <p className="whitespace-pre-wrap break-words leading-6">{value.body}</p>
  <dl className="space-y-2 break-words text-xs text-muted-foreground">
    <div><dt>编写成员</dt><dd>{value.authorMemberId}</dd></div>
    <div><dt>版本说明</dt><dd>{value.changeNote}</dd></div>
    <div><dt>来源版本</dt><dd>{value.sources.length === 0 ? '无来源记录' : value.sources.map((source) =>
      `${source.sourceId} · ${source.sourceVersion ?? '未知版本'}`).join('\n')}</dd></div>
  </dl>
</section>;

export { PlaybookDraftWorkspace };
