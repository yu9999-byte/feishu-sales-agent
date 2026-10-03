import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Radar,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

import type {
  StaleOpportunityGovernanceStatus,
  StaleOpportunityReadinessBlocker,
  StaleOpportunityReadinessItem,
  StaleOpportunityReadinessResponse,
  StaleOpportunityReadinessStatus,
} from '@shared/api.interface';
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
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getStaleOpportunityReadiness,
  submitStaleOpportunityGovernance,
  type ProductApiError,
} from '../../api';

const statusLabel: Record<StaleOpportunityReadinessStatus, string> = {
  ready: '数据完整',
  incomplete: '数据不完整',
  unavailable: '数据暂不可用',
};

const opportunityStatusLabel: Record<StaleOpportunityReadinessItem['status'], string> = {
  active: '进行中',
  won: '已赢单',
  lost: '已输单',
  closed: '已关闭',
  unknown: '待确认',
};

const blockerLabel: Record<StaleOpportunityReadinessBlocker, string> = {
  status_unconfirmed: '商机状态待确认',
  followup_time_missing: '可信跟进时间缺失',
};

const GOVERNANCE_STATUSES: StaleOpportunityGovernanceStatus[] = [
  'active',
  'won',
  'lost',
  'closed',
];

const formatDateTime = (value: string | null): string => {
  if (value === null) return '未读取到可信跟进时间';
  const timestamp: number = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '时间格式不可识别';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

const toDate = (value: string | null): Date | undefined => {
  if (value === null) return undefined;
  const timestamp: number = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
};

const StaleOpportunityReadinessPage: React.FC = () => {
  const [report, setReport] = useState<StaleOpportunityReadinessResponse | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(null);
    void getStaleOpportunityReadiness()
      .then((result: StaleOpportunityReadinessResponse): void => setReport(result))
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  }, []);

  useEffect((): void => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6" aria-busy="true">
        <div className="h-28 w-full animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((item: number): React.ReactNode => (
            <div key={item} className="h-28 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="h-72 w-full animate-pulse rounded-xl bg-muted" />
        <span className="sr-only">正在加载商机提醒准备度</span>
      </div>
    );
  }

  if (error !== null || report === null) {
    return (
      <section
        className="mx-auto max-w-2xl rounded-xl border border-destructive/40 bg-card p-6"
        role="alert"
      >
        <AlertCircle aria-hidden="true" className="mb-3 size-5 text-destructive" />
        <h1 className="text-xl font-semibold">商机提醒准备度暂时无法加载</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {error?.message ?? '无法读取当前商机准备度数据'}
        </p>
        {error?.retryable && (
          <Button className="mt-5" variant="outline" onClick={refresh}>
            <RefreshCw aria-hidden="true" />重试
          </Button>
        )}
      </section>
    );
  }

  const hasWarnings: boolean = report.warnings.length > 0;
  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-primary">
            <Radar aria-hidden="true" className="size-4" />
            商机提醒准备度
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">逐条确认历史商机</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            由你确认商机状态和已有跟进的可信时间。确认完成后，记录才具备进入未更新扫描的条件。
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw aria-hidden="true" />刷新数据
        </Button>
      </header>

      <section className="flex items-start gap-3 rounded-xl border border-sky-300/60 bg-sky-50 px-5 py-4 text-sky-950" role="note">
        <CircleHelp aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <div>
          <h2 className="text-sm font-semibold">每次只处理一条记录</h2>
          <p className="mt-1 text-sm leading-6">
            页面不会批量猜测、自动创建跟进、发送提醒或启动定时扫描。提交前会再次确认目标 Base 记录。
          </p>
        </div>
      </section>

      {hasWarnings && (
        <section className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-5 py-4 text-amber-950" role="status">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold">数据读取有边界</h2>
            <ul className="mt-1 space-y-1 text-sm leading-6">
              {report.warnings.map((warning: string): React.ReactNode => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="准备度统计">
        <Metric label="本人商机" value={report.summary.opportunityCount} />
        <Metric label="状态已确认" value={report.summary.statusConfirmedCount} />
        <Metric label="状态待确认" value={report.summary.statusNeedsConfirmationCount} tone="warning" />
        <Metric label="跟进时间已确认" value={report.summary.followupTimeConfirmedCount} />
        <Metric label="可进入扫描" value={report.summary.readyForScanCount} tone="success" />
      </section>

      {report.items.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
          {report.status === 'unavailable' ? (
            <AlertCircle aria-hidden="true" className="mx-auto size-6 text-destructive" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="mx-auto size-6 text-primary" />
          )}
          <h2 className="mt-4 text-lg font-semibold">
            {report.status === 'unavailable' ? '当前无法读取商机数据' : '当前没有需要治理的商机'}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            {report.status === 'unavailable'
              ? '请稍后刷新；在数据源恢复前，系统不会判断任何商机是否逾期。'
              : '没有记录就不会触发任何提醒扫描。'}
          </p>
        </section>
      ) : (
        <section className="space-y-3" aria-label="商机准备度明细">
          {report.items.map((item: StaleOpportunityReadinessItem): React.ReactNode => (
            <OpportunityItem key={item.recordId} item={item} onSaved={refresh} />
          ))}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        数据生成于 {formatDateTime(report.generatedAt)} · 当前状态：{statusLabel[report.status]}
      </p>
    </div>
  );
};

interface MetricProps {
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'success';
}

const Metric: React.FC<MetricProps> = ({ label, value, tone = 'default' }) => (
  <div className="rounded-xl border border-border bg-card p-5">
    <p className="text-sm text-muted-foreground">{label}</p>
    <p className={`mt-3 text-3xl font-semibold ${
      tone === 'warning'
        ? 'text-amber-600'
        : tone === 'success'
          ? 'text-emerald-600'
          : ''
    }`}>
      {value}
    </p>
  </div>
);

interface OpportunityItemProps {
  item: StaleOpportunityReadinessItem;
  onSaved: () => void;
}

const OpportunityItem: React.FC<OpportunityItemProps> = ({ item, onSaved }) => {
  const [status, setStatus] = useState<StaleOpportunityGovernanceStatus | ''>(
    item.status === 'unknown' ? '' : item.status,
  );
  const [communicationDate, setCommunicationDate] = useState<Date | undefined>(
    toDate(item.lastEffectiveFollowupAt),
  );
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<ProductApiError | null>(null);
  const ready: boolean = item.blockers.length === 0;
  const canGovernOpportunity: boolean = item.sourceVersion !== null;
  const canSetCommunicationDate: boolean = item.followupRecordId !== null &&
    item.followupSourceVersion !== null;
  const dateText: string = communicationDate
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(communicationDate)
    : '未选择';

  useEffect((): void => {
    setStatus(item.status === 'unknown' ? '' : item.status);
    setCommunicationDate(toDate(item.lastEffectiveFollowupAt));
  }, [
    item.recordId,
    item.sourceVersion,
    item.followupSourceVersion,
    item.status,
    item.lastEffectiveFollowupAt,
  ]);

  const submit = (): void => {
    if (status === '') return;
    setSaving(true);
    setError(null);
    const communicationAt: string | undefined = communicationDate
      ? new Date(
        communicationDate.getFullYear(),
        communicationDate.getMonth(),
        communicationDate.getDate(),
        12,
        0,
        0,
      ).toISOString()
      : undefined;
    void submitStaleOpportunityGovernance({
      recordId: item.recordId,
      status,
      expectedStatus: item.status,
      expectedSourceVersion: item.sourceVersion,
      followupRecordId: item.followupRecordId,
      expectedFollowupSourceVersion: item.followupSourceVersion,
      communicationAt,
    })
      .then((): void => {
        setDialogOpen(false);
        onSaved();
      })
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setSaving(false));
  };

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{item.name || '未命名商机'}</h2>
          <p className="mt-1 text-xs text-muted-foreground">记录 ID：{item.recordId}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
        }`}>
          {ready ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : <Clock3 aria-hidden="true" className="size-3.5" />}
          {ready ? '可以进入扫描' : '需要人工确认'}
        </span>
      </div>

      <div className="mt-5 grid gap-4 text-sm md:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">商机状态</p>
          <Select value={status} onValueChange={(value: string): void => setStatus(value as StaleOpportunityGovernanceStatus)}>
            <SelectTrigger className="mt-2 w-full max-w-xs" aria-label="选择商机状态">
              <SelectValue placeholder="请选择状态" />
            </SelectTrigger>
            <SelectContent>
              {GOVERNANCE_STATUSES.map((value: StaleOpportunityGovernanceStatus): React.ReactNode => (
                <SelectItem key={value} value={value}>{opportunityStatusLabel[value]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-muted-foreground">
            当前读取值：{opportunityStatusLabel[item.status]}
          </p>
          {!canGovernOpportunity && (
            <p className="mt-2 text-xs text-amber-700">
              当前商机版本不可验证，刷新数据后才能安全确认。
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">已有跟进的可信沟通日期</p>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                className="mt-2 w-full max-w-xs justify-start"
                variant="outline"
                disabled={!canSetCommunicationDate}
              >
                <CalendarDays aria-hidden="true" />{dateText}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={communicationDate}
                onSelect={setCommunicationDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          {!canSetCommunicationDate && (
            <p className="mt-2 text-xs text-amber-700">
              {item.followupRecordId === null
                ? '当前没有已有跟进记录，不能用日期伪造历史跟进。'
                : '当前跟进版本不可验证，不能安全修改沟通日期。'}
            </p>
          )}
          {canSetCommunicationDate && (
            <p className="mt-2 text-xs text-muted-foreground">
              读取值：{formatDateTime(item.lastEffectiveFollowupAt)}
            </p>
          )}
        </div>
      </div>

      {item.blockers.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs font-medium text-amber-700">阻断原因</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {item.blockers.map((blocker: StaleOpportunityReadinessBlocker): React.ReactNode => (
              <li key={blocker}>· {blockerLabel[blocker]}</li>
            ))}
          </ul>
        </div>
      )}

      {error !== null && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
          {error.code === 'CONFLICT' ? <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
          <div>
            <p>{error.message}</p>
            {error.traceId && <p className="mt-1 text-xs text-muted-foreground">追踪号：{error.traceId}</p>}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-border pt-4 text-sm">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={status === '' || saving || !canGovernOpportunity}>
              <CheckCircle2 aria-hidden="true" />确认这条记录
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认写入这条商机</DialogTitle>
              <DialogDescription>
                将只修改商机状态，以及你选择的已有跟进沟通日期。系统会先校验负责人和读取版本，再写入并回读验证。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
              <p><span className="text-muted-foreground">商机：</span>{item.name}</p>
              <p><span className="text-muted-foreground">状态：</span>{status === '' ? '未选择' : opportunityStatusLabel[status]}</p>
              <p><span className="text-muted-foreground">沟通日期：</span>{canSetCommunicationDate ? dateText : '不修改'}</p>
              <p className="text-xs text-muted-foreground">目标记录：{item.recordId}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={(): void => setDialogOpen(false)} disabled={saving}>取消</Button>
              <Button
                onClick={submit}
                disabled={saving || status === '' || !canGovernOpportunity}
              >
                {saving ? '正在校验并写入…' : '确认写入'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {item.followupRecordId && (
          <span className="text-muted-foreground">跟进记录：{item.followupRecordId}</span>
        )}
        {item.recordUrl && (
          <a
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            href={item.recordUrl}
            target="_blank"
            rel="noreferrer"
          >
            查看 Base 记录 <ArrowUpRight aria-hidden="true" className="size-4" />
          </a>
        )}
      </div>
    </article>
  );
};

export default StaleOpportunityReadinessPage;
