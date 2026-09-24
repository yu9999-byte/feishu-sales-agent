import React, { useRef, useState } from 'react';
import { ArrowRight, FileText, MessageSquareText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import type {
  CreateFollowupDraftRequest,
  FollowupDraftSourceType,
} from '@shared/api.interface';
import { createFollowupDraft, type ProductApiError } from '../../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const FollowupCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [sourceType, setSourceType] = useState<FollowupDraftSourceType>('card_form');
  const [form, setForm] = useState({
    customerName: '', contactName: '', communicationMethod: '',
    communicationAt: '', topic: '', text: '', nextAction: '', dueAt: '',
    nextActionChannel: '', nextActionParticipants: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ProductApiError | null>(null);

  const update = (key: keyof typeof form) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    idempotencyKey.current = crypto.randomUUID();
    const value = event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectSource = (value: FollowupDraftSourceType): void => {
    idempotencyKey.current = crypto.randomUUID();
    setSourceType(value);
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const input: CreateFollowupDraftRequest = {
      sourceType,
      text: form.text,
      idempotencyKey: idempotencyKey.current,
      form: sourceType === 'card_form' ? {
        customerName: form.customerName || undefined,
        contactName: form.contactName || undefined,
        communicationMethod: form.communicationMethod || undefined,
        communicationAt: form.communicationAt || undefined,
        topic: form.topic || undefined,
        nextAction: form.nextAction || undefined,
        dueAt: form.dueAt || undefined,
        nextActionChannel: form.nextActionChannel || undefined,
        nextActionParticipants: form.nextActionParticipants
          .split(/[,，、;；\n]+/u)
          .map((value: string): string => value.trim())
          .filter((value: string): boolean => value.length > 0),
      } : undefined,
    };
    void createFollowupDraft(input)
      .then((draft): void => {
        void navigate(`/followups/${draft.id}/edit`);
      })
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <p className="text-sm font-medium text-primary">新建跟进</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">把沟通变成可执行的销售记录</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          AI 先生成草案和质检结果；在你确认前，不会写入客户、商机或任务。
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="录入方式">
        {([
          ['card_form', FileText, '表单录入', '适合信息已整理好的沟通'],
          ['text', MessageSquareText, '粘贴原文', '适合聊天记录或手写纪要'],
        ] as const).map(([value, Icon, title, description]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={sourceType === value}
            onClick={(): void => selectSource(value)}
            className={`rounded-xl border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              sourceType === value ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50'
            }`}
          >
            <Icon aria-hidden="true" className="size-5 text-primary" />
            <span className="mt-4 block font-semibold">{title}</span>
            <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
          </button>
        ))}
      </div>

      <form className="space-y-6 rounded-xl border border-border bg-card p-6" onSubmit={submit}>
        {sourceType === 'card_form' && (
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium">客户名称
              <Input value={form.customerName} onChange={update('customerName')} placeholder="例如：北辰制造" />
            </label>
            <label className="space-y-2 text-sm font-medium">联系人
              <Input value={form.contactName} onChange={update('contactName')} placeholder="姓名或称呼" />
            </label>
            <label className="space-y-2 text-sm font-medium">沟通方式
              <Input value={form.communicationMethod} onChange={update('communicationMethod')} placeholder="拜访、电话、视频会议" />
            </label>
            <label className="space-y-2 text-sm font-medium">沟通时间
              <Input type="datetime-local" value={form.communicationAt} onChange={update('communicationAt')} />
            </label>
            <label className="space-y-2 text-sm font-medium sm:col-span-2">主题
              <Input value={form.topic} onChange={update('topic')} placeholder="这次沟通聚焦什么" />
            </label>
          </div>
        )}
        <label className="block space-y-2 text-sm font-medium">
          {sourceType === 'card_form' ? '沟通内容' : '沟通原文'}
          <Textarea
            required
            minLength={10}
            rows={8}
            value={form.text}
            onChange={update('text')}
            placeholder="写下客户说了什么、达成了什么、有哪些风险……"
          />
        </label>
        {sourceType === 'card_form' && (
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium">下一步
              <Input value={form.nextAction} onChange={update('nextAction')} placeholder="明确动作" />
            </label>
            <label className="space-y-2 text-sm font-medium">截止时间
              <Input type="datetime-local" value={form.dueAt} onChange={update('dueAt')} />
            </label>
            <label className="space-y-2 text-sm font-medium">下一步方式
              <Input value={form.nextActionChannel} onChange={update('nextActionChannel')} placeholder="客户现场、视频会议、邮件" />
            </label>
            <label className="space-y-2 text-sm font-medium">下一步参与人
              <Input value={form.nextActionParticipants} onChange={update('nextActionParticipants')} placeholder="多人请用顿号分隔" />
            </label>
          </div>
        )}
        {error && <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error.message}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={loading || form.text.trim().length < 10}>
            {loading ? '正在生成草案…' : '生成并质检'}<ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </form>
    </div>
  );
};

export default FollowupCreatePage;
