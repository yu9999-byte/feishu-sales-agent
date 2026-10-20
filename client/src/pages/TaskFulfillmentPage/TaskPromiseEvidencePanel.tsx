import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, History, RefreshCw, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { RecordTaskPromiseEvidenceRequest, TaskPromiseEvidenceResponse,
  TaskPromiseEvidenceEvent, TaskPromiseEvidenceState } from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTaskPromiseEvidence, recordTaskPromiseEvidence, type ProductApiError } from '../../api';

const evidenceSchema = z.object({
  state: z.enum(['reported_fulfilled', 'reported_partial', 'retracted']),
  note: z.string().trim().min(2, '说明至少 2 字').max(500, '说明最多 500 字'),
  evidenceUrl: z.string().trim().max(2048, '链接过长'),
}).refine((value): boolean => value.state === 'retracted' || /^https:\/\//u.test(value.evidenceUrl), {
  path: ['evidenceUrl'], message: '请填写 HTTPS 飞书凭证链接',
});
type EvidenceForm = z.infer<typeof evidenceSchema>;
const evidenceLabel: Record<TaskPromiseEvidenceState, string> = {
  reported_fulfilled: '本人声明已兑现', reported_partial: '本人声明部分兑现', retracted: '已撤回声明',
};
interface TaskPromiseEvidencePanelProps {
  actionId: string;
  nextAction: string;
  canWrite: boolean;
  onAccessFailure?: (failure: ProductApiError) => void;
}

const TaskPromiseEvidencePanel: React.FC<TaskPromiseEvidencePanelProps> = ({ actionId, nextAction, canWrite, onAccessFailure }) => {
  const [data, setData] = useState<TaskPromiseEvidenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(true);
  const [revoked, setRevoked] = useState<boolean>(false);
  const [conflict, setConflict] = useState<boolean>(false);
  const [pending, setPending] = useState<RecordTaskPromiseEvidenceRequest | null>(null);
  const alive = useRef<boolean>(true);
  const locked = useRef<boolean>(false);
  const form = useForm<EvidenceForm>({ resolver: zodResolver(evidenceSchema), mode: 'onChange',
    defaultValues: { state: 'reported_fulfilled', note: '', evidenceUrl: '' } });

  const fail = (failure: unknown): void => {
    const value = failure as ProductApiError;
    if ([401, 403, 404].includes(value.status)) {
      setData(null); setPending(null); setRevoked(true);
      form.reset({ state: 'reported_fulfilled', note: '', evidenceUrl: '' });
      onAccessFailure?.(value);
    } else if (value.status === 409) {
      setData(null); setPending(null); setConflict(true);
    } else if ([400, 422].includes(value.status)) setPending(null);
    setError(value.message || '请求未完成，请稍后重试');
  };
  const load = async (beforeRevision?: number): Promise<void> => {
    if (locked.current || pending || revoked) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      const result: TaskPromiseEvidenceResponse = await getTaskPromiseEvidence(actionId, beforeRevision);
      if (!alive.current) return;
      setData((current) => beforeRevision === undefined || !current ? result : { ...result,
        history: [...current.history, ...result.history.filter((item: TaskPromiseEvidenceEvent): boolean =>
          !current.history.some((existing: TaskPromiseEvidenceEvent): boolean => existing.revision === item.revision))] });
      setConflict(false);
    } catch (failure: unknown) { if (alive.current) fail(failure); }
    finally { if (alive.current) { locked.current = false; setBusy(false); } }
  };

  useEffect((): (() => void) => {
    alive.current = true; void load();
    return (): void => { alive.current = false; };
    // The parent keys this panel by action ID and unmounts it on close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (request: RecordTaskPromiseEvidenceRequest): Promise<void> => {
    if (locked.current || revoked || conflict || !data || !canWrite) return;
    locked.current = true; setBusy(true); setError(null); setPending(request);
    try {
      const saved: TaskPromiseEvidenceEvent = await recordTaskPromiseEvidence(actionId, request);
      if (!alive.current) return;
      // A delayed idempotent replay can be older than the state already read.
      setData(null); setPending(null);
      form.reset({ state: 'reported_fulfilled', note: '', evidenceUrl: '' });
      try {
        const latest: TaskPromiseEvidenceResponse = await getTaskPromiseEvidence(actionId);
        if (alive.current) setData(latest);
      } catch (failure: unknown) {
        if (alive.current) {
          setError(`修订 ${saved.revision} 已保存，最新状态读取失败，请刷新凭证`);
          const value = failure as ProductApiError;
          if ([401, 403, 404].includes(value.status)) fail(failure);
        }
      }
    } catch (failure: unknown) { if (alive.current) fail(failure); }
    finally { if (alive.current) { locked.current = false; setBusy(false); } }
  };
  const submit = (value: EvidenceForm): void => {
    if (pending || !data) return;
    void save({ requestId: crypto.randomUUID(), expectedRevision: data.revision,
      state: value.state, note: value.note, evidenceUrl: value.evidenceUrl || null });
  };
  const frozen: boolean = busy || pending !== null || conflict || !data;

  return <div className="min-w-0 space-y-5" aria-busy={busy}>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {!revoked && <>
      <div className="space-y-2 border-b pb-4">
        <p className="break-words font-medium leading-6">{nextAction}</p>
        <p className="text-sm">{data?.current ? evidenceLabel[data.current.state] : '尚无本人声明'}</p>
        <p className="text-xs text-muted-foreground">本人声明，凭证内容未自动核验；任务完成统计不变。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy || pending !== null} onClick={() => void load()}>
          <RefreshCw aria-hidden="true" />刷新凭证
        </Button>
        {pending && <Button size="sm" disabled={busy} onClick={() => void save(pending)}>
          <RefreshCw aria-hidden="true" />重试原请求
        </Button>}
      </div>
      {conflict && <p className="text-sm text-amber-700">凭证状态有变化，刷新后才能保存本地说明。</p>}
      {canWrite && <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
          <FormField control={form.control} name="state" render={({ field }) => <FormItem>
            <FormLabel>本人声明</FormLabel>
            <Select value={field.value} onValueChange={field.onChange} disabled={frozen}>
              <FormControl><SelectTrigger className="w-full"><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="reported_fulfilled">已兑现</SelectItem>
                <SelectItem value="reported_partial">部分兑现</SelectItem>
                <SelectItem value="retracted">撤回声明</SelectItem>
              </SelectContent>
            </Select><FormMessage />
          </FormItem>} />
          <FormField control={form.control} name="note" render={({ field }) => <FormItem>
            <FormLabel>事实说明</FormLabel><FormControl>
              <Textarea {...field} disabled={frozen} maxLength={500} className="min-h-24 resize-y" />
            </FormControl><FormMessage />
          </FormItem>} />
          <FormField control={form.control} name="evidenceUrl" render={({ field }) => <FormItem>
            <FormLabel>来源凭证{form.watch('state') === 'retracted' ? '（可空）' : ''}</FormLabel><FormControl>
              <Input {...field} type="url" disabled={frozen} maxLength={2048} />
            </FormControl><FormMessage />
          </FormItem>} />
          <Button type="submit" disabled={frozen || !form.formState.isValid}>
            <Save aria-hidden="true" />{form.watch('state') === 'retracted' ? '确认撤回声明' : '保存本人声明'}
          </Button>
        </form>
      </Form>}
      <section className="space-y-3 border-t pt-4" aria-label="凭证历史">
        <h3 className="flex items-center gap-2 text-sm font-medium"><History className="size-4" />凭证历史</h3>
        {data?.history.map((item: TaskPromiseEvidenceEvent) => <div key={item.revision}
          data-evidence-revision={item.revision} className="min-w-0 space-y-1 border-l-2 pl-3 text-sm">
          <p className="break-words font-medium">修订 {item.revision} · {evidenceLabel[item.state]}</p>
          <p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString('zh-CN')}</p>
          <p className="whitespace-pre-wrap break-words leading-6">{item.note}</p>
          {item.evidenceUrl && <a href={item.evidenceUrl} target="_blank" rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-primary hover:underline">
            <span className="break-all">查看来源凭证</span><ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
          </a>}
        </div>)}
        {data && !data.history.length && <p className="text-sm text-muted-foreground">暂无凭证记录</p>}
        {data?.nextBeforeRevision && <Button variant="outline" size="sm" disabled={busy || pending !== null}
          onClick={() => void load(data.nextBeforeRevision ?? undefined)}>更早记录</Button>}
      </section>
    </>}
  </div>;
};
export { TaskPromiseEvidencePanel };
