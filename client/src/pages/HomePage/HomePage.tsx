import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  RefreshCw,
} from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';

import type { WorkspaceResponse } from '@shared/api.interface';
import type { ProductLayoutContext } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getWorkspace, type ProductApiError } from '../../api';

const HomePage: React.FC = () => {
  const { session } = useOutletContext<ProductLayoutContext>();
  const [workspace, setWorkspace] =
    useState<WorkspaceResponse | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(null);
    void getWorkspace()
      .then((result: WorkspaceResponse): void => setWorkspace(result))
      .catch((failure: ProductApiError): void => setError(failure))
      .finally((): void => setLoading(false));
  }, []);

  useEffect((): void => {
    refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">工作台</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            你好，{session.member.displayName}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            从销售跟进开始，逐步连接客户、任务与团队决策。
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw aria-hidden="true" />刷新状态
        </Button>
      </div>

      {loading && (
        <section aria-busy="true" className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
          </div>
          <span className="sr-only">正在加载工作台数据</span>
        </section>
      )}

      {!loading && error && (
        <section className="rounded-xl border border-destructive/40 bg-card p-6" role="alert">
          <AlertCircle aria-hidden="true" className="mb-3 size-5 text-destructive" />
          <h2 className="text-lg font-semibold">
            {error.status === 403 ? '无权访问' : '工作台暂时无法加载'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          {error.retryable && (
            <Button className="mt-4" variant="outline" onClick={refresh}>
              重试
            </Button>
          )}
        </section>
      )}

      {!loading && !error && workspace && (
        <>
          {workspace.status === 'partial' && (
            <section className="flex items-start gap-3 rounded-xl border border-border bg-card px-5 py-4" role="status">
              <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 className="text-sm font-semibold">业务统计正在接入</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  跟进、任务和风险汇总尚未接入工作台。现有飞书机器人 P0 跟进闭环仍可使用；此处不展示未经核实的数字。
                </p>
              </div>
            </section>
          )}
          {workspace.status === 'stale' && (
            <p className="rounded-lg bg-muted px-4 py-3 text-sm" role="status">
              数据可能已过期，请刷新后再作判断。
            </p>
          )}
          {workspace.status === 'empty' && (
            <p className="rounded-lg bg-muted px-4 py-3 text-sm" role="status">
              当前范围还没有可展示的工作记录。可先在飞书机器人中提交一条跟进。
            </p>
          )}

          <section aria-labelledby="start-title">
            <div className="mb-4">
              <h2 id="start-title" className="text-xl font-semibold">现在可以做什么</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                已可用能力与规划能力分开展示。
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center gap-2 text-primary">
                  <CheckCircle2 aria-hidden="true" className="size-5" />
                  <span className="text-sm font-semibold">已可使用</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold">飞书对话录入跟进</h3>
                <p className="mt-2 max-w-[60ch] text-sm leading-6 text-muted-foreground">
                  私聊“销售agent”机器人，描述客户沟通和下一步。核对确认卡片后，记录写入多维表格并创建飞书任务。
                </p>
                <p className="mt-5 text-sm font-medium">
                  在飞书中搜索“销售agent”并打开私聊即可开始。
                </p>
                <Button className="mt-5" asChild>
                  <Link to="/followups/new">在页面中写跟进<ArrowRight aria-hidden="true" /></Link>
                </Button>
              </div>
              <div className="rounded-xl border border-border bg-muted/50 p-6">
                <p className="text-sm font-semibold text-muted-foreground">后续阶段</p>
                <h3 className="mt-5 text-lg font-semibold">客户与商机全景</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  页面已建立权限入口，客户时间线、项目质检和建议将在后续阶段接入真实数据。
                </p>
                <Button variant="outline" className="mt-5" asChild>
                  <Link to="/customers">查看页面状态<ArrowRight aria-hidden="true" /></Link>
                </Button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default HomePage;
