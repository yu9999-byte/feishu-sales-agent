import React from 'react';
import {
  ArrowUpRight,
  Database,
  LockKeyhole,
} from 'lucide-react';

import type {
  CustomerCommunicationEvidence,
  CustomerCommunicationMaterialSearch,
  CustomerVisitBriefingCoverage,
} from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  customerCommunicationEvidenceKindLabel,
  customerCommunicationMaterialSearchNotice,
} from './customer-communication-preparation-view';

interface CustomerCommunicationEvidenceProps {
  evidence: CustomerCommunicationEvidence[];
  coverage: CustomerVisitBriefingCoverage;
  materialSearch: CustomerCommunicationMaterialSearch;
  generatedAt: string;
}

const coverageLabel = (
  value: 'complete' | 'partial' | 'unavailable',
): string => {
  const labels: Record<typeof value, string> = {
    complete: '完整',
    partial: '部分可用',
    unavailable: '不可用',
  };
  return labels[value];
};

const formatGeneratedAt = (value: string): string => {
  const timestamp: number = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

const CustomerCommunicationEvidencePanel: React.FC<
  CustomerCommunicationEvidenceProps
> = ({ evidence, coverage, materialSearch, generatedAt }) => (
  <>
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Database aria-hidden="true" className="size-5 text-primary" />
          内容依据
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          沟通目标和建议均可回到本人可见的原始客户、商机或跟进记录。
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {evidence.map((item: CustomerCommunicationEvidence) => (
          <article
            key={item.key}
            className="rounded-xl border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Badge variant="outline">
                  {customerCommunicationEvidenceKindLabel(item.kind)}
                </Badge>
                <h3 className="mt-2 break-words text-sm font-semibold">
                  {item.label}
                </h3>
              </div>
              {item.source.recordUrl && (
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={item.source.recordUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    核对原记录<ArrowUpRight aria-hidden="true" />
                  </a>
                </Button>
              )}
            </div>
            <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">
              {item.value}
            </p>
          </article>
        ))}
      </div>
    </section>

    <footer className="rounded-xl border border-border bg-muted/40 p-5">
      <div className="flex items-start gap-3">
        <LockKeyhole aria-hidden="true" className="mt-0.5 size-5 text-primary" />
        <div>
          <h2 className="text-sm font-semibold">本页只准备，不执行</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Agent 不会发送飞书或邮件，不会创建任务，也不会修改客户、商机和跟进记录。
            {customerCommunicationMaterialSearchNotice(materialSearch.status)}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            客户 {coverageLabel(coverage.customers)} · 商机
            {coverageLabel(coverage.opportunities)} · 跟进
            {coverageLabel(coverage.followups)} · 生成于
            {' '}{formatGeneratedAt(generatedAt)}
          </p>
        </div>
      </div>
    </footer>
  </>
);

export default CustomerCommunicationEvidencePanel;
