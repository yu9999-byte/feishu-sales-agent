import React, { useEffect, useRef, useState } from 'react';
import { Check, Clipboard, Mail, MessageSquareText, Save } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { CustomerCommunicationDraft, CustomerPreparationDraftEdit } from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ProductApiError } from '../../api';
import { customerCommunicationDraftChannelLabel } from './customer-communication-preparation-view';

interface CustomerCommunicationDraftsProps {
  drafts: CustomerCommunicationDraft[];
  generatedAt: string;
  busy?: boolean;
  onSave?: (edit: CustomerPreparationDraftEdit) => Promise<void>;
  onReload?: () => Promise<CustomerPreparationDraftEdit[]>;
}

const draftSchema = z.object({
  subject: z.string().max(300, '邮件主题不能超过 300 字'),
  body: z.string().max(12000, '正文不能超过 12000 字')
    .refine((body: string): boolean => body.trim().length > 0, '请填写草稿正文'),
});
type DraftValues = z.infer<typeof draftSchema>;

const DraftEditor: React.FC<Omit<CustomerCommunicationDraftsProps, 'drafts' | 'generatedAt'> & {
  draft: CustomerCommunicationDraft;
}> = ({ draft, busy = false, onSave, onReload }) => {
  const form = useForm<DraftValues>({
    resolver: zodResolver(draftSchema),
    defaultValues: { subject: draft.subject ?? '', body: draft.body },
  });
  // Subscribe to dirty fields so refreshing server defaults preserves local edits.
  const { dirtyFields } = form.formState;
  void dirtyFields;
  const { reset } = form;
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [saved, setSaved] = useState<boolean>(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<boolean>(false);
  const [remote, setRemote] = useState<CustomerPreparationDraftEdit | null>(null);
  const saving = useRef<boolean>(false);
  const Icon = draft.channel === 'feishu' ? MessageSquareText : Mail;

  useEffect((): void => {
    reset({ subject: draft.subject ?? '', body: draft.body }, { keepDirtyValues: true });
  }, [draft.body, draft.subject, reset]);

  const copyDraft = (): void => {
    if (!navigator.clipboard?.writeText) { setCopyState('failed'); return; }
    const { subject, body } = form.getValues();
    const content: string = subject.trim() ? `${subject.trim()}\n\n${body}` : body;
    void navigator.clipboard.writeText(content)
      .then((): void => setCopyState('copied'))
      .catch((): void => setCopyState('failed'));
  };

  const save = async (values: DraftValues): Promise<void> => {
    if (!onSave || busy || blocked || saving.current) return;
    saving.current = true;
    setFailure(null);
    setSaved(false);
    try {
      await onSave({ channel: draft.channel, subject: draft.channel === 'email' ? values.subject : null, body: values.body });
      form.reset(values);
      setSaved(true);
      setRemote(null);
    } catch (error: unknown) {
      const problem = error as ProductApiError;
      setFailure(problem.message || '保存失败，请读取最新版本后重试');
      setBlocked(true);
    } finally {
      saving.current = false;
    }
  };

  const reload = async (): Promise<void> => {
    if (!onReload || busy) return;
    setBlocked(true);
    setSaved(false);
    try {
      const drafts: CustomerPreparationDraftEdit[] = await onReload();
      const latest = drafts.find((item): boolean => item.channel === draft.channel);
      if (!latest) throw new Error('最新结果中未找到此渠道草稿');
      setRemote(latest);
      setFailure(null);
    } catch (error: unknown) {
      setFailure((error as ProductApiError).message || '读取失败，请重试');
    }
  };

  return (
    <article className="rounded-lg border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <Icon aria-hidden="true" className="size-4" />
            {customerCommunicationDraftChannelLabel(draft.channel)}
          </p>
          <h3 className="mt-2 text-lg font-semibold">{draft.title}</h3>
        </div>
        <Badge variant="secondary">未发送</Badge>
      </div>
      <Form {...form}>
        <form className="mt-5 space-y-4" noValidate onSubmit={form.handleSubmit(save)}
          onChange={(): void => { setSaved(false); setCopyState('idle'); }}>
          {draft.channel === 'email' && <FormField control={form.control} name="subject" render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="communication-email-subject">邮件主题</FormLabel>
              <FormControl><Input {...field} id="communication-email-subject" disabled={busy} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />}
          <FormField control={form.control} name="body" render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor={`communication-${draft.channel}-body`}>草稿正文</FormLabel>
              <FormControl><Textarea {...field} id={`communication-${draft.channel}-body`}
                className="min-h-64 resize-y leading-6" disabled={busy} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          {failure && <p role="alert" className="break-words text-sm text-destructive">{failure}</p>}
          {blocked && onReload && <Button type="button" variant="outline" size="sm" disabled={busy}
            onClick={(): void => { void reload(); }}>读取最新版本</Button>}
          {remote && <div className="space-y-3 border-l-2 border-border pl-4">
            <h4 className="text-sm font-semibold">最新保存内容</h4>
            {remote.subject && <p className="break-words text-sm">{remote.subject}</p>}
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{remote.body}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={(): void => {
                form.reset({ subject: remote.subject ?? '', body: remote.body });
                setBlocked(false); setRemote(null); setSaved(false);
              }}>采用最新内容</Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={(): void => {
                setBlocked(false); setRemote(null); setSaved(false);
              }}>保留本地修改</Button>
            </div>
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground" role="status">
              {saved ? '已保存' : onSave ? (form.formState.isDirty ? '有未保存修改' : '已载入保存版本') : '当前页面草稿'}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={copyDraft}>
                {copyState === 'copied' ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
                {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制不可用' : '复制草稿'}
              </Button>
              {onSave && <Button type="submit" size="sm" disabled={busy || blocked}>
                <Save aria-hidden="true" />{busy ? '保存处理中' : '保存草稿'}
              </Button>}
            </div>
          </div>
        </form>
      </Form>
    </article>
  );
};

const CustomerCommunicationDrafts: React.FC<CustomerCommunicationDraftsProps> = ({ drafts, generatedAt, ...persistence }) => (
  <section className="space-y-4">
    <h2 className="text-xl font-semibold">沟通草稿</h2>
    <div className="grid gap-5 xl:grid-cols-2">
      {drafts.map((draft: CustomerCommunicationDraft) => (
        <DraftEditor key={`${generatedAt}-${draft.channel}`} draft={draft} {...persistence} />
      ))}
    </div>
  </section>
);

export default CustomerCommunicationDrafts;
