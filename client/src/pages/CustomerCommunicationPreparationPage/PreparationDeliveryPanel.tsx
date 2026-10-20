import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { CustomerPreparationDeliveryStatus } from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { confirmCustomerPreparationDelivery, getCustomerPreparationDelivery, type ProductApiError } from '../../api';

const PREPARATION_DELIVERY_LABELS: Record<CustomerPreparationDeliveryStatus['status'], string> = {
  pending: '待投递', dispatching: '发送处理中', sent: '已记录发送',
  unknown: '发送结果待核查', not_recorded: '未记录投递状态',
};

const deliveryEvidenceSchema = z.object({
  messageId: z.string().trim().min(1, '请填写飞书消息 ID').max(255, '消息 ID 不能超过 255 字'),
  sentAt: z.string().refine((value: string): boolean =>
    /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/u.test(value) && Number.isFinite(Date.parse(value)),
  '请填写含时区的有效发送时间').refine((value: string): boolean =>
    !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now(), '发送时间不能晚于当前时间'),
  note: z.string().trim().min(5, '核查说明至少 5 字').max(2000, '核查说明不能超过 2000 字'),
});
type DeliveryEvidence = z.infer<typeof deliveryEvidenceSchema>;

const PreparationDeliveryPanel: React.FC<{
  resultId: string;
  onAccessFailure: (failure: ProductApiError) => void;
}> = ({ resultId, onAccessFailure }) => {
  const [status, setStatus] = useState<CustomerPreparationDeliveryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [needsRecheck, setNeedsRecheck] = useState<boolean>(false);
  const request = useRef<number>(0);
  const locked = useRef<boolean>(false);
  const form = useForm<DeliveryEvidence>({
    resolver: zodResolver(deliveryEvidenceSchema),
    defaultValues: { messageId: '', sentAt: '', note: '' },
  });

  const refresh = useCallback(async (): Promise<void> => {
    const requestId: number = ++request.current;
    setLoading(true);
    try {
      const latest = await getCustomerPreparationDelivery(resultId);
      if (request.current !== requestId) return;
      setStatus(latest);
      setNeedsRecheck(false);
      setError(null);
    } catch (failure: unknown) {
      if (request.current !== requestId) return;
      onAccessFailure(failure as ProductApiError);
      setNeedsRecheck(true);
      setError(`投递状态暂不可用：${(failure as ProductApiError).message || '读取失败'}`);
    } finally {
      if (request.current === requestId) setLoading(false);
    }
  }, [resultId, onAccessFailure]);

  useEffect((): (() => void) => {
    void refresh();
    return (): void => { request.current += 1; };
  }, [refresh]);

  const confirm = async (values: DeliveryEvidence): Promise<void> => {
    const version = status?.reconciliationVersion;
    if (locked.current || needsRecheck || loading || status?.status !== 'unknown' || !version) return;
    locked.current = true;
    const requestId: number = ++request.current;
    setSubmitting(true);
    setError(null);
    try {
      const confirmed = await confirmCustomerPreparationDelivery(resultId, { ...values, expectedVersion: version });
      if (request.current === requestId) setStatus(confirmed);
    } catch (failure: unknown) {
      if (request.current !== requestId) return;
      if ([401, 403, 404].includes((failure as ProductApiError).status)) {
        onAccessFailure(failure as ProductApiError);
        return;
      }
      setNeedsRecheck(true);
      // A failed response may follow a committed confirmation. Re-read before retry.
      await refresh();
      if (request.current === requestId + 1) {
        setError((previous: string | null): string => previous ||
          `确认响应失败：${(failure as ProductApiError).message || '提交失败'}；已重新读取投递状态`);
      }
    } finally {
      locked.current = false;
      if (request.current === requestId || request.current === requestId + 1) setSubmitting(false);
    }
  };

  const unknown: boolean = status?.status === 'unknown';
  const version: number = status?.reconciliationVersion ?? 0;
  return (
    <section className="border-y border-border py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">飞书结果通知</h2>
          {status && <p className="mt-1 text-sm font-medium" role="status">{PREPARATION_DELIVERY_LABELS[status.status]}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={(): void => { void refresh(); }}
          disabled={loading || submitting} aria-label="刷新投递状态">
          <RefreshCw aria-hidden="true" />刷新状态
        </Button>
      </div>
      {status?.updatedAt && <p className="mt-2 text-xs text-muted-foreground">最近更新：{status.updatedAt}</p>}
      {loading && !status && <p className="mt-2 text-sm text-muted-foreground" role="status">正在读取投递状态…</p>}
      {error && <div className="mt-3 flex flex-wrap items-center gap-3" role="alert">
        <p className="break-words text-sm text-destructive">{error}</p>
        {needsRecheck && <Button variant="outline" size="sm" disabled={loading || submitting}
          onClick={(): void => { void refresh(); }}>重试读取</Button>}
      </div>}
      {unknown && Number.isSafeInteger(version) && version > 0 && <Form {...form}>
        <form className="mt-5 max-w-2xl space-y-4" noValidate onSubmit={form.handleSubmit(confirm)}>
          <h3 className="text-sm font-semibold">已发送消息核查</h3>
          <FormField control={form.control} name="messageId" render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="preparation-delivery-message-id">飞书消息 ID</FormLabel>
              <FormControl><Input {...field} id="preparation-delivery-message-id" disabled={submitting} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="sentAt" render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="preparation-delivery-sent-at">发送时间（含时区）</FormLabel>
              <FormControl><Input {...field} id="preparation-delivery-sent-at"
                placeholder="2026-10-20T09:00:00+08:00" disabled={submitting} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="note" render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="preparation-delivery-note">核查说明</FormLabel>
              <FormControl><Textarea {...field} id="preparation-delivery-note" disabled={submitting} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <Button type="submit" disabled={submitting || loading || needsRecheck}>
            <Check aria-hidden="true" />{submitting ? '正在确认' : '确认已发送'}
          </Button>
        </form>
      </Form>}
    </section>
  );
};

export default PreparationDeliveryPanel;
