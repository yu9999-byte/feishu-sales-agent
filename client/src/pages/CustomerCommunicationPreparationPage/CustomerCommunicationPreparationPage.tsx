import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  FileQuestion,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import type {
  CustomerCommunicationPreparationResponse,
} from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getCustomerCommunicationPreparation,
  type ProductApiError,
} from '../../api';
import CustomerCommunicationDrafts from './CustomerCommunicationDrafts';
import CustomerCommunicationEvidencePanel from
  './CustomerCommunicationEvidence';
import CustomerCommunicationPlan from './CustomerCommunicationPlan';
import {
  customerCommunicationStatusLabel,
} from './customer-communication-preparation-view';

const CustomerCommunicationPreparationPage: React.FC = () => {
  const { customerRecordId } = useParams<{ customerRecordId: string }>();
  const [report, setReport] =
    useState<CustomerCommunicationPreparationResponse | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback((): void => {
    if (!customerRecordId) {
      setError({
        status: 0,
        message: '客户标识缺失，请从客户组合重新进入',
        retryable: false,
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void getCustomerCommunicationPreparation(customerRecordId)
      .then((result: CustomerCommunicationPreparationResponse): void =>
        setReport(result))
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  }, [customerRecordId]);

  useEffect((): void => {
    refresh();
  }, [refresh]);

  const unavailable: boolean = report?.status === 'unavailable';
  const empty: boolean = report?.status === 'empty';

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-primary">
            客户沟通内容准备 Agent
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            把客户攻略变成可用的沟通内容
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            基于本人可见的客户、商机和跟进事实，准备沟通角度、问题、材料清单和可编辑草稿。
            所有内容仅供预览，尚未发送或写回。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {customerRecordId && (
            <Button variant="outline" asChild>
              <Link to={`/customers/${encodeURIComponent(customerRecordId)}/briefing`}>
                <ArrowLeft aria-hidden="true" />返回拜访攻略
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw aria-hidden="true" />重新准备
          </Button>
        </div>
      </header>

      {loading && <CommunicationLoading />}
      {!loading && error && (
        <CommunicationError error={error} onRetry={refresh} />
      )}
      {!loading && !error && report && (empty || unavailable) && (
        <CommunicationUnavailable report={report} onRetry={refresh} />
      )}
      {!loading && !error && report && report.customer && report.objective && (
        <>
          {report.status === 'partial' && (
            <section
              className="rounded-xl border border-amber-300/70 bg-amber-50/70 px-5 py-4"
              role="status"
            >
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                <AlertCircle aria-hidden="true" className="size-4" />
                {customerCommunicationStatusLabel(report.status)}
              </h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                {report.warnings.join('；') || '部分来源暂时无法完整读取。'}
              </p>
            </section>
          )}
          <CustomerCommunicationPlan
            objective={report.objective}
            angles={report.angles}
            questions={report.questions}
            materials={report.materials}
            materialSearch={report.materialSearch}
          />
          <CustomerCommunicationDrafts
            drafts={report.drafts}
            generatedAt={report.generatedAt}
          />
          <CustomerCommunicationEvidencePanel
            evidence={report.evidence}
            coverage={report.coverage}
            materialSearch={report.materialSearch}
            generatedAt={report.generatedAt}
          />
        </>
      )}
    </div>
  );
};

const CommunicationLoading: React.FC = () => (
  <section className="space-y-5" aria-busy="true">
    <Skeleton className="h-52 rounded-xl" />
    <div className="grid gap-4 lg:grid-cols-3">
      {[0, 1, 2].map((item: number) => (
        <Skeleton key={item} className="h-48 rounded-xl" />
      ))}
    </div>
    <div className="grid gap-5 xl:grid-cols-2">
      <Skeleton className="h-96 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
    <span className="sr-only">正在准备客户沟通内容</span>
  </section>
);

const CommunicationError: React.FC<{
  error: ProductApiError;
  onRetry: () => void;
}> = ({ error, onRetry }) => (
  <section
    className="rounded-xl border border-destructive/40 bg-card p-6"
    role="alert"
  >
    <AlertCircle aria-hidden="true" className="size-5 text-destructive" />
    <h2 className="mt-3 text-lg font-semibold">
      {error.status === 403
        ? '当前账号无权准备该客户的沟通内容'
        : '沟通内容暂时无法准备'}
    </h2>
    <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
    {error.retryable && (
      <Button className="mt-4" variant="outline" onClick={onRetry}>重试</Button>
    )}
  </section>
);

const CommunicationUnavailable: React.FC<{
  report: CustomerCommunicationPreparationResponse;
  onRetry: () => void;
}> = ({ report, onRetry }) => {
  const unavailable: boolean = report.status === 'unavailable';
  const Icon = unavailable ? ShieldCheck : FileQuestion;
  return (
    <section className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
      <Icon aria-hidden="true" className="mx-auto size-7 text-primary" />
      <h2 className="mt-4 text-lg font-semibold">
        {unavailable ? '当前无法可靠准备内容' : '没有找到可见客户'}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {report.warnings.join('；') ||
          '该客户不存在或不在你本人可见范围内，系统不会生成或透露客户内容。'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {unavailable && (
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />重试
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link to="/customers">
            <MessageSquareText aria-hidden="true" />返回客户组合
          </Link>
        </Button>
      </div>
    </section>
  );
};

export default CustomerCommunicationPreparationPage;
