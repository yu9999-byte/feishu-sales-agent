import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { TodayActionResponse, TodayActionViewItem, TodayActionTaskStatusResponse } from '@shared/api.interface';
import { confirmTodayTaskDraft, createTodayFollowupDraft, createTodayTaskDraft, getTodayTaskStatus, getTodayActions, operateTodayAction, type ProductApiError } from '../../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { startTodayTaskPolling } from './today-task-poll';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const TodayActionPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const actionId: string | null = searchParams.get('taskAction');
  const activeTaskId = useRef<string | null>(actionId);
  activeTaskId.current = actionId;
  useEffect(() => (): void => { activeTaskId.current = null; }, []);
  const [taskResult, setTaskResult] = useState<TodayActionTaskStatusResponse | null>(null);
  const [taskReadVersion, setTaskReadVersion] = useState<number>(0);
  useEffect(() => {
    if (!actionId) { setTaskResult(null); return; }
    setTaskResult((current) => current?.actionId === actionId ? current : null);
    return startTodayTaskPolling(actionId, getTodayTaskStatus, setTaskResult,
      (failure: Error): void => setError(failure.message));
  }, [actionId, taskReadVersion]);
  const [draftItem, setDraftItem] = useState<TodayActionViewItem | null>(null);
  const [communicationText, setCommunicationText] = useState<string>('');
  const [taskItem, setTaskItem] = useState<TodayActionViewItem | null>(null);
  const [taskTitle, setTaskTitle] = useState<string>('');
  const [taskDueAt, setTaskDueAt] = useState<string>('');
  const draftKey = useRef<string>('');
  const taskKey = useRef<string>('');
  const [data, setData] = useState<TodayActionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<string | null>(null);
  const pendingRequests = useRef(new Map<string, { key: string; remindAt?: string }>());
  const submitting = useRef(false);
  const refresh = useCallback((): void => {
    setLoading(true);
    setError(null);
    void getTodayActions().then(setData).catch((failure: ProductApiError): void => {
      setError(failure.message);
    }).finally((): void => setLoading(false));
  }, []);
  useEffect((): void => { refresh(); }, [refresh]);
  const generateFollowup = (): void => {
    if (!draftItem || !communicationText.trim() || submitting.current) return;
    submitting.current = true;
    setBusy(draftItem.id);
    setError(null);
    void createTodayFollowupDraft({ itemId: draftItem.id, itemVersion: draftItem.version,
      communicationText, idempotencyKey: draftKey.current,
    }).then((result): void => {
      navigate(`/followups/${encodeURIComponent(result.draftId)}/edit`);
    }).catch((failure: ProductApiError): void => {
      setError(failure.message);
    }).finally((): void => { submitting.current = false; setBusy(null); });
  };
  const operate = (item: TodayActionViewItem, operation: 'resolve' | 'snooze'): void => {
    if (submitting.current) return;
    submitting.current = true;
    const requestKey: string = `${item.id}:${item.version}:${item.state.revision}:${operation}`;
    let pending = pendingRequests.current.get(requestKey);
    if (!pending) {
      pending = { key: requestKey, remindAt: operation === 'snooze'
        ? new Date(Date.now() + 3_600_000).toISOString() : undefined };
      pendingRequests.current.set(requestKey, pending);
    }
    setBusy(item.id);
    setError(null);
    void operateTodayAction({ itemId: item.id, itemVersion: item.version, operation,
      expectedRevision: item.state.revision,
      idempotencyKey: pending.key,
      remindAt: pending.remindAt,
    }).then((): void => { pendingRequests.current.delete(requestKey); refresh(); }).catch((failure: ProductApiError): void => {
      setError(failure.message);
    }).finally((): void => { submitting.current = false; setBusy(null); });
  };
  const createTask = (): void => {
    if (!taskItem || !taskTitle.trim() || !taskDueAt || submitting.current) return;
    submitting.current = true;
    setBusy(taskItem.id);
    setError(null);
    let submittedActionId: string | null = actionId;
    void createTodayTaskDraft({ itemId: taskItem.id, itemVersion: taskItem.version,
      idempotencyKey: taskKey.current, title: taskTitle.trim(),
      dueAt: new Date(taskDueAt).toISOString(),
    }).then((draft) => {
      submittedActionId = draft.actionId;
      if (activeTaskId.current === actionId) {
        activeTaskId.current = draft.actionId;
        setSearchParams({ taskAction: draft.actionId });
      }
      return confirmTodayTaskDraft(draft.actionId);
    }).then((result) => getTodayTaskStatus(result.actionId))
      .then((result): void => {
        if (activeTaskId.current !== result.actionId) return;
        setTaskResult(result); setTaskReadVersion((version) => version + 1);
        setTaskItem(null); refresh();
      })
      .catch((failure: ProductApiError): void => {
        if (activeTaskId.current === submittedActionId) setError(failure.message);
      })
      .finally((): void => { submitting.current = false; setBusy(null); });
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-sm text-muted-foreground">本人工作台</p>
          <h1 className="mt-2 text-3xl font-semibold">今日行动中心</h1>
          <p className="mt-2 text-sm text-muted-foreground">根据客户承诺、任务截止和商机证据安排下一步。</p></div>
        <Button variant="outline" disabled={loading || busy !== null} onClick={refresh}>刷新</Button>
      </header>
      {error && <p role="alert" className="rounded-xl border border-destructive p-4">{error}</p>}
      {taskResult && <section role="status" className="rounded-xl border p-4">
        {taskResult.title && <p className="font-medium">{taskResult.title}</p>}
        {taskResult.dueAt && <p>截止时间：{taskResult.dueAt}</p>}
        <p>{taskResult.status === 'executing' ? '任务正在执行…' : taskResult.status === 'succeeded'
          ? '任务执行成功' : taskResult.status === 'pendingConfirmation' ? '任务等待确认' : '任务未完成'}</p>
        {taskResult.errorMessage && <p>{taskResult.errorMessage}</p>}
        {taskResult.taskUrl && <a href={taskResult.taskUrl} target="_blank" rel="noreferrer">打开飞书任务</a>}
        <Button variant="outline" disabled={busy !== null} onClick={() => {
          setError(null);
          setTaskReadVersion((version: number) => version + 1);
        }}>刷新任务状态</Button>
        {['failed', 'partialFailure', 'pendingConfirmation'].includes(taskResult.status) &&
          <Button disabled={busy !== null || !taskResult.title || !taskResult.dueAt} onClick={() => {
            if (submitting.current) return;
            submitting.current = true; setBusy(taskResult.actionId);
            const submittedActionId: string = taskResult.actionId;
            void confirmTodayTaskDraft(taskResult.actionId)
              .then((result) => getTodayTaskStatus(result.actionId)).then((result) => {
                if (activeTaskId.current !== result.actionId) return;
                setTaskResult(result); setTaskReadVersion((version) => version + 1);
              })
              .catch((failure: ProductApiError) => {
                if (activeTaskId.current === submittedActionId) setError(failure.message);
              })
              .finally(() => { submitting.current = false; setBusy(null); });
          }}>{taskResult.status === 'pendingConfirmation' ? '确认执行任务' : '重试此任务'}</Button>}
      </section>}
      {loading && <p role="status">正在汇总今日事项…</p>}
      {!loading && data && <>
        <p className="text-sm text-muted-foreground">{data.referenceDate} · {data.timezone} · 数据截止 {new Date(data.generatedAt).toLocaleString('zh-CN', { timeZone: data.timezone })}</p>
        {(data.status === 'partial' || data.status === 'unavailable') && <section role="status" className="rounded-xl border p-4">
          <p className="font-medium">{data.status === 'unavailable' ? '来源暂不可用' : '部分来源尚未覆盖'}</p>
          {data.warnings.map((warning: string, index: number) => <p key={index} className="mt-2 text-sm">{warning}</p>)}
        </section>}
        {data.status === 'empty' && <p className="rounded-xl border p-6">当前已覆盖来源中暂无待处理事项。</p>}
        <div className="space-y-4">{data.items.map((item: TodayActionViewItem) => (
          <article key={item.id} className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold">{item.title}</h2>
              <span className="text-sm text-muted-foreground">{item.state.status === 'resolved' ? '已处理' : item.state.status === 'snoozed' ? '已稍后提醒' : '待处理'}</span></div>
            <p className="mt-3 font-medium">{item.reason}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{item.evidence.map((evidence: string, index: number) => <li key={index}>{evidence}</li>)}</ul>
            <p className="mt-4">建议：{item.suggestedAction}</p>
            <p className="mt-1 text-sm text-muted-foreground">建议完成：{item.suggestedCompletionDate}</p>
            {item.state.remindAt && <p className="mt-1 text-sm">提醒时间：{new Date(item.state.remindAt).toLocaleString('zh-CN', { timeZone: data.timezone })}</p>}
            <div className="mt-4 flex flex-wrap gap-3">
              <Button variant="outline" disabled={busy !== null} onClick={() => {
                setDraftItem(item); setCommunicationText(''); draftKey.current = crypto.randomUUID();
              }}>生成跟进</Button>
              <Button variant="outline" disabled={busy !== null} onClick={() => {
                setTaskItem(item); setTaskTitle(item.suggestedAction); setTaskDueAt(`${item.suggestedCompletionDate}T17:00`);
                taskKey.current = crypto.randomUUID();
              }}>创建任务</Button>
              {item.sourceUrl && <Button variant="outline" asChild><a href={item.sourceUrl} target="_blank" rel="noreferrer">查看判断来源</a></Button>}
              <Button variant="outline" disabled={busy !== null || item.state.status === 'resolved'} onClick={() => operate(item, 'snooze')}>一小时后提醒</Button>
              <Button disabled={busy !== null || item.state.status === 'resolved'} onClick={() => operate(item, 'resolve')}>{busy === item.id ? '处理中…' : '标记已处理'}</Button>
            </div>
          </article>
        ))}</div>
      </>}
      <Dialog open={draftItem !== null} onOpenChange={(open: boolean): void => {
        if (!open && !submitting.current) setDraftItem(null);
      }}>
        <DialogContent>
          <DialogHeader><DialogTitle>根据真实沟通生成跟进</DialogTitle>
            <DialogDescription>填写已经发生的沟通。生成草案后进入完整表单，确认后才执行写入。</DialogDescription></DialogHeader>
          <label htmlFor="today-communication" className="text-sm font-medium">沟通内容</label>
          <Textarea id="today-communication" value={communicationText} maxLength={20000}
            disabled={busy !== null} onChange={(event): void => {
              setCommunicationText(event.target.value); draftKey.current = crypto.randomUUID();
            }} placeholder="例如：今天与客户沟通了什么、客户反馈及约定的下一步" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button disabled={busy !== null || !communicationText.trim()} onClick={generateFollowup}>
            {busy !== null ? '正在生成草案…' : '生成并检查草案'}
          </Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={taskItem !== null} onOpenChange={(open: boolean): void => {
        if (!open && !submitting.current) setTaskItem(null);
      }}>
        <DialogContent>
          <DialogHeader><DialogTitle>确认创建任务</DialogTitle>
            <DialogDescription>先检查任务标题和完成时间。提交后才会进入执行状态并调用任务网关。</DialogDescription></DialogHeader>
          <label className="space-y-2 text-sm font-medium">任务标题
            <Input value={taskTitle} maxLength={3000} disabled={busy !== null}
              onChange={(event): void => { setTaskTitle(event.target.value); taskKey.current = crypto.randomUUID(); }} />
          </label>
          <label className="space-y-2 text-sm font-medium">完成时间
            <Input type="datetime-local" value={taskDueAt} disabled={busy !== null}
              onChange={(event): void => { setTaskDueAt(event.target.value); taskKey.current = crypto.randomUUID(); }} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button disabled={busy !== null || !taskTitle.trim() || !taskDueAt} onClick={createTask}>
            {busy !== null ? '正在执行…' : '确认并创建任务'}
          </Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Link to="/" className="inline-block text-sm text-primary underline">返回工作台</Link>
    </div>
  );
};
export default TodayActionPage;

