import React, {
  useCallback,
  useEffect,
  useId,
  useState,
} from 'react';
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
  Snowflake,
} from 'lucide-react';

import type {
  ProactiveNotificationReconciliationDecision,
  ProactiveNotificationReconciliationItem,
  ProactiveNotificationReconciliationListResponse,
  ProactiveNotificationReconciliationResponse,
} from '@shared/api.interface';
import {
  getProactiveNotificationReconciliations,
  reconcileProactiveNotification,
  type ProductApiError,
} from '../../api';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  proactiveNotificationDecisionDescription,
  proactiveNotificationDecisionLabel,
  proactiveNotificationKindLabel,
  shouldAllowNotificationReconciliationDialogChange,
} from './proactive-notification-reconciliation-view';

const DECISIONS: ProactiveNotificationReconciliationDecision[] = [
  'confirm_sent',
  'authorize_retry',
  'keep_frozen',
];

type DialogEscapeKeyDownEvent = Parameters<NonNullable<
  React.ComponentProps<typeof DialogContent>['onEscapeKeyDown']
>>[0];

type DialogPointerDownOutsideEvent = Parameters<NonNullable<
  React.ComponentProps<typeof DialogContent>['onPointerDownOutside']
>>[0];

const formatDateTime = (value: string | null): string => {
  if (value === null) return '未记录';
  const timestamp: number = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '时间格式不可识别';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

const ProactiveNotificationReconciliationPage: React.FC = () => {
  const [report, setReport] =
    useState<ProactiveNotificationReconciliationListResponse | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(null);
    void getProactiveNotificationReconciliations()
      .then((result: ProactiveNotificationReconciliationListResponse): void => {
        setReport(result);
      })
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  }, []);

  useEffect((): void => {
    refresh();
  }, [refresh]);

  const handleSaved = useCallback((
    response: ProactiveNotificationReconciliationResponse,
  ): void => {
    setSuccess(
      `裁决已保存：${proactiveNotificationDecisionLabel(response.decision)}`,
    );
    refresh();
  }, [refresh]);

  if (loading && report === null) {
    return (
      <div className="mx-auto max-w-5xl space-y-6" aria-busy="true">
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
        <span className="sr-only">正在加载主动通知对账清单</span>
      </div>
    );
  }

  if (error !== null || report === null) {
    return (
      <section
        className="mx-auto max-w-2xl rounded-xl border border-destructive/40 bg-card p-6"
        role="alert"
      >
        <AlertCircle
          aria-hidden="true"
          className="mb-3 size-5 text-destructive"
        />
        <h1 className="text-xl font-semibold">通知对账清单暂时无法加载</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {error?.message ?? '无法读取当前企业的未知投递记录'}
        </p>
        {error?.retryable && (
          <Button className="mt-5" variant="outline" onClick={refresh}>
            <RefreshCw aria-hidden="true" />重试
          </Button>
        )}
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <BellRing aria-hidden="true" className="size-4" />
            通知运营
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            主动通知投递对账
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            只处理系统无法确认是否送达的通知。每次裁决都会校验最新版本并保留不可变审计。
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw aria-hidden="true" />
          {loading ? '正在刷新…' : '刷新清单'}
        </Button>
      </header>

      <Alert variant="warning">
        <ShieldAlert aria-hidden="true" />
        <AlertTitle>先核对真实飞书消息，再选择裁决</AlertTitle>
        <AlertDescription>
          <p>
            “释放一次重试”不会立即发送消息；只有后续调度启用并再次命中同一通知时才会尝试。
          </p>
        </AlertDescription>
      </Alert>

      {success !== null && (
        <Alert variant="success" aria-live="polite">
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>裁决已保存</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {report.status === 'unavailable' && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>对账数据源暂时不可用</AlertTitle>
          <AlertDescription>
            <p>账本没有被修改，请稍后刷新后再处理。</p>
          </AlertDescription>
        </Alert>
      )}

      {report.items.length === 0 ? (
        <Empty className="border border-border bg-card py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircle2 aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>当前没有需要人工核对的通知</EmptyTitle>
            <EmptyDescription>
              所有通知都处于明确状态，或主动通知尚未启用。这里不会创建测试记录。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <section
          className="space-y-3"
          aria-label="未知投递记录"
          data-ai-section-type="card-list"
        >
          {report.items.map(
            (item: ProactiveNotificationReconciliationItem): React.ReactNode => (
              <NotificationItem
                key={item.notificationId}
                item={item}
                onSaved={handleSaved}
              />
            ),
          )}
        </section>
      )}
    </div>
  );
};

interface NotificationItemProps {
  item: ProactiveNotificationReconciliationItem;
  onSaved: (response: ProactiveNotificationReconciliationResponse) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  item,
  onSaved,
}) => {
  const noteId: string = useId();
  const messageIdId: string = useId();
  const sentAtId: string = useId();
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [decision, setDecision] =
    useState<ProactiveNotificationReconciliationDecision | ''>('');
  const [note, setNote] = useState<string>('');
  const [messageId, setMessageId] = useState<string>('');
  const [sentAt, setSentAt] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<ProductApiError | null>(null);

  const noteValid: boolean = note.trim().length >= 5 &&
    note.trim().length <= 2_000;
  const evidenceValid: boolean = decision !== 'confirm_sent' || Boolean(
    messageId.trim() && sentAt.trim(),
  );
  const canSubmit: boolean = decision !== '' && noteValid && evidenceValid &&
    !saving;

  const handleDialogChange = (open: boolean): void => {
    if (!shouldAllowNotificationReconciliationDialogChange(open, saving)) {
      return;
    }
    setDialogOpen(open);
    if (open) {
      setError(null);
      return;
    }
    if (!saving) {
      setDecision('');
      setNote('');
      setMessageId('');
      setSentAt('');
    }
  };

  const submit = (): void => {
    if (!canSubmit || decision === '') return;
    setSaving(true);
    setError(null);
    void reconcileProactiveNotification(item.notificationId, {
      expectedUpdatedAt: item.updatedAt,
      decision,
      note: note.trim(),
      ...(decision === 'confirm_sent'
        ? { messageId: messageId.trim(), sentAt: sentAt.trim() }
        : {}),
    })
      .then((response: ProactiveNotificationReconciliationResponse): void => {
        setDialogOpen(false);
        onSaved(response);
      })
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setSaving(false));
  };

  const visibleError: string | null = error?.code === 'CONFLICT'
    ? '记录已被其他管理员处理，请刷新清单后重新核对。'
    : error?.message ?? null;

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">
              {proactiveNotificationKindLabel(item.kind)}
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
              <Snowflake aria-hidden="true" className="size-3.5" />
              投递结果未知
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            收件人：{item.recipientDisplayName} · 已尝试 {item.attemptCount} 次
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
          <DialogTrigger asChild>
            <Button data-ai-section-type="button">
              <ShieldAlert aria-hidden="true" />人工核对
            </Button>
          </DialogTrigger>
          <DialogContent
            className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
            showCloseButton={!saving}
            aria-busy={saving}
            onEscapeKeyDown={(event: DialogEscapeKeyDownEvent): void => {
              if (saving) event.preventDefault();
            }}
            onPointerDownOutside={(
              event: DialogPointerDownOutsideEvent,
            ): void => {
              if (saving) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>核对这条通知的实际投递结果</DialogTitle>
              <DialogDescription>
                请先在飞书消息记录中核对，再提交一次完整裁决。保存后不可直接撤销。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                <p>
                  <span className="text-muted-foreground">通知：</span>
                  {proactiveNotificationKindLabel(item.kind)}
                </p>
                <p className="mt-2">
                  <span className="text-muted-foreground">收件人：</span>
                  {item.recipientDisplayName}
                </p>
                <p className="mt-2">
                  <span className="text-muted-foreground">结果未知时间：</span>
                  {formatDateTime(item.updatedAt)}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${noteId}-decision`}>裁决</Label>
                <Select
                  value={decision}
                  disabled={saving}
                  onValueChange={(value: string): void => {
                    setDecision(
                      value as ProactiveNotificationReconciliationDecision,
                    );
                    setError(null);
                  }}
                >
                  <SelectTrigger
                    id={`${noteId}-decision`}
                    className="w-full"
                    aria-label="选择投递裁决"
                  >
                    <SelectValue placeholder="请选择一项裁决" />
                  </SelectTrigger>
                  <SelectContent>
                    {DECISIONS.map(
                      (value: ProactiveNotificationReconciliationDecision):
                      React.ReactNode => (
                        <SelectItem key={value} value={value}>
                          {proactiveNotificationDecisionLabel(value)}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                {decision !== '' && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {proactiveNotificationDecisionDescription(decision)}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor={noteId}>核对说明</Label>
                <Textarea
                  id={noteId}
                  value={note}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void =>
                    setNote(event.target.value)
                  }
                  rows={4}
                  maxLength={2_000}
                  disabled={saving}
                  aria-invalid={note.length > 0 && !noteValid}
                  placeholder="说明你核对了什么，以及为何选择该裁决（至少 5 个字）"
                />
                <p className="text-xs text-muted-foreground">
                  {note.trim().length}/2000，至少 5 个字
                </p>
              </div>

              {decision === 'confirm_sent' && (
                <div className="space-y-4 rounded-lg border border-border p-4">
                  <div className="space-y-2">
                    <Label htmlFor={messageIdId}>飞书消息 ID</Label>
                    <Input
                      id={messageIdId}
                      value={messageId}
                      disabled={saving}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                        setMessageId(event.target.value)
                      }
                      placeholder="例如 om_xxx"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={sentAtId}>实际发送时间</Label>
                    <Input
                      id={sentAtId}
                      value={sentAt}
                      disabled={saving}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                        setSentAt(event.target.value)
                      }
                      placeholder="例如 2026-10-12T18:05:00+08:00"
                    />
                    <p className="text-xs text-muted-foreground">
                      请填写带时区的 ISO 时间，不能晚于当前时间。
                    </p>
                  </div>
                </div>
              )}

              {visibleError !== null && (
                <Alert variant="destructive" aria-live="assertive">
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>裁决未保存</AlertTitle>
                  <AlertDescription>{visibleError}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={(): void => handleDialogChange(false)}
                disabled={saving}
              >
                取消
              </Button>
              <Button onClick={submit} disabled={!canSubmit}>
                {saving && (
                  <RefreshCw aria-hidden="true" className="animate-spin" />
                )}
                {saving ? '正在提交裁决…' : '确认并保存裁决'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <dl className="mt-5 grid gap-4 border-t border-border pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">业务发生键</dt>
          <dd className="mt-1 break-words font-medium">{item.notificationKey}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">业务对象</dt>
          <dd className="mt-1 break-words font-medium">{item.subjectKey}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">开始投递</dt>
          <dd className="mt-1 flex items-center gap-1.5">
            <Clock3 aria-hidden="true" className="size-4 text-muted-foreground" />
            {formatDateTime(item.dispatchStartedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">失败标识</dt>
          <dd className="mt-1 break-words font-medium">
            {item.failureCode ?? '未记录'}
          </dd>
        </div>
      </dl>

      {item.failureMessage !== null && (
        <p className="mt-4 break-words rounded-lg bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {item.failureMessage}
        </p>
      )}
    </article>
  );
};

export default ProactiveNotificationReconciliationPage;
