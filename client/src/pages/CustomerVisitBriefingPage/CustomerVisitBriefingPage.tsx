import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  FileQuestion,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import type { CustomerVisitBriefingResponse } from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getCustomerVisitBriefing,
  type ProductApiError,
} from '../../api';
import CustomerBriefingDetails from './CustomerBriefingDetails';
import CustomerBriefingOverview from './CustomerBriefingOverview';
import { customerBriefingStatusLabel } from
  './customer-visit-briefing-view';

const CustomerVisitBriefingPage: React.FC = () => {
  const { customerRecordId } = useParams<{ customerRecordId: string }>();
  const [report, setReport] =
    useState<CustomerVisitBriefingResponse | null>(null);
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
    void getCustomerVisitBriefing(customerRecordId)
      .then((result: CustomerVisitBriefingResponse): void => setReport(result))
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  }, [customerRecordId]);

  useEffect((): void => {
    refresh();
  }, [refresh]);

  const unavailable: boolean = report?.status === 'unavailable';
  const empty: boolean = report?.status === 'empty';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-primary">
            客户洞察与拜访准备 Agent
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            带着事实和问题进入本次沟通
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            汇总本人可见的客户、相关商机、历史跟进和已确认任务证据，
            给出会前待确认问题与议程。所有内容均未自动执行。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/customers">
              <ArrowLeft aria-hidden="true" />返回客户组合
            </Link>
          </Button>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw aria-hidden="true" />重新准备
          </Button>
        </div>
      </header>

      {loading && <BriefingLoading />}
      {!loading && error && <BriefingError error={error} onRetry={refresh} />}

      {!loading && !error && report && (empty || unavailable) && (
        <BriefingUnavailable report={report} onRetry={refresh} />
      )}

      {!loading && !error && report && report.customer && (
        <>
          {report.status === 'partial' && (
            <section
              className="rounded-xl border border-amber-300/70 bg-amber-50/70 px-5 py-4"
              role="status"
            >
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                <AlertCircle aria-hidden="true" className="size-4" />
                {customerBriefingStatusLabel(report.status)}
              </h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                {report.warnings.join('；') || '部分来源暂时无法完整读取。'}
              </p>
            </section>
          )}
          <CustomerBriefingOverview
            customer={report.customer}
            metrics={report.metrics}
            opportunities={report.opportunities}
          />
          <CustomerBriefingDetails
            questions={report.questions}
            agenda={report.agenda}
            followups={report.recentFollowups}
            coverage={report.coverage}
            generatedAt={report.generatedAt}
          />
        </>
      )}
    </div>
  );
};

const BriefingLoading: React.FC = () => (
  <section className="space-y-5" aria-busy="true">
    <Skeleton className="h-52 rounded-xl" />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((item: number) => (
        <Skeleton key={item} className="h-32 rounded-xl" />
      ))}
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
    <span className="sr-only">正在准备客户拜访资料</span>
  </section>
);

const BriefingError: React.FC<{
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
        ? '当前账号无权准备该客户资料'
        : '拜访准备暂时无法加载'}
    </h2>
    <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
    {error.retryable && (
      <Button className="mt-4" variant="outline" onClick={onRetry}>重试</Button>
    )}
  </section>
);

const BriefingUnavailable: React.FC<{
  report: CustomerVisitBriefingResponse;
  onRetry: () => void;
}> = ({ report, onRetry }) => {
  const unavailable: boolean = report.status === 'unavailable';
  const Icon = unavailable ? ShieldCheck : FileQuestion;
  return (
    <section className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
      <Icon aria-hidden="true" className="mx-auto size-7 text-primary" />
      <h2 className="mt-4 text-lg font-semibold">
        {unavailable ? '当前无法可靠准备资料' : '没有找到可见客户'}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {report.warnings.join('；') ||
          '该客户不存在或不在你本人可见范围内，系统不会透露其他范围的数据。'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {unavailable && (
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />重试
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link to="/customers">
            <Building2 aria-hidden="true" />返回客户组合
          </Link>
        </Button>
      </div>
    </section>
  );
};

export default CustomerVisitBriefingPage;
