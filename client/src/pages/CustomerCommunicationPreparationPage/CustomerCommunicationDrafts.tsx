import React, { useState } from 'react';
import {
  Check,
  Clipboard,
  FilePenLine,
  Mail,
  MessageSquareText,
} from 'lucide-react';

import type {
  CustomerCommunicationDraft,
} from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  customerCommunicationDraftChannelLabel,
} from './customer-communication-preparation-view';

interface CustomerCommunicationDraftsProps {
  drafts: CustomerCommunicationDraft[];
  generatedAt: string;
}

const DraftEditor: React.FC<{ draft: CustomerCommunicationDraft }> = ({
  draft,
}) => {
  const [subject, setSubject] = useState<string>(draft.subject ?? '');
  const [body, setBody] = useState<string>(draft.body);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  );
  const Icon = draft.channel === 'feishu' ? MessageSquareText : Mail;

  const copyDraft = (): void => {
    if (!navigator.clipboard?.writeText) {
      setCopyState('failed');
      return;
    }
    const content: string = subject.trim()
      ? `${subject.trim()}\n\n${body}`
      : body;
    void navigator.clipboard.writeText(content)
      .then((): void => setCopyState('copied'))
      .catch((): void => setCopyState('failed'));
  };

  return (
    <article className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <Icon aria-hidden="true" className="size-4" />
            {customerCommunicationDraftChannelLabel(draft.channel)}
          </p>
          <h3 className="mt-2 text-lg font-semibold">{draft.title}</h3>
        </div>
        <Badge variant="secondary">仅预览，尚未发送</Badge>
      </div>

      <div className="mt-5 space-y-3">
        {draft.channel === 'email' && (
          <div>
            <label
              className="mb-2 block text-xs font-medium text-muted-foreground"
              htmlFor="communication-email-subject"
            >
              邮件主题
            </label>
            <Input
              id="communication-email-subject"
              value={subject}
              onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                setSubject(event.target.value)}
            />
          </div>
        )}
        <div>
          <label
            className="mb-2 block text-xs font-medium text-muted-foreground"
            htmlFor={`communication-${draft.channel}-body`}
          >
            草稿正文
          </label>
          <Textarea
            id={`communication-${draft.channel}-body`}
            className="min-h-64 resize-y leading-6"
            value={body}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void =>
              setBody(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FilePenLine aria-hidden="true" className="size-3.5" />
          修改只保留在当前页面，不会写回客户或商机记录
        </p>
        <Button variant="outline" size="sm" onClick={copyDraft}>
          {copyState === 'copied'
            ? <Check aria-hidden="true" />
            : <Clipboard aria-hidden="true" />}
          {copyState === 'copied'
            ? '已复制'
            : copyState === 'failed'
              ? '复制不可用'
              : '复制草稿'}
        </Button>
      </div>
    </article>
  );
};

const CustomerCommunicationDrafts: React.FC<
  CustomerCommunicationDraftsProps
> = ({ drafts, generatedAt }) => (
  <section className="space-y-4">
    <div>
      <h2 className="text-xl font-semibold">可编辑沟通草稿</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        你可以在页面内临时修改并复制。Agent 不会替你发送，也不会保存修改。
      </p>
    </div>
    <div className="grid gap-5 xl:grid-cols-2">
      {drafts.map((draft: CustomerCommunicationDraft) => (
        <DraftEditor
          key={`${generatedAt}-${draft.channel}`}
          draft={draft}
        />
      ))}
    </div>
  </section>
);

export default CustomerCommunicationDrafts;

