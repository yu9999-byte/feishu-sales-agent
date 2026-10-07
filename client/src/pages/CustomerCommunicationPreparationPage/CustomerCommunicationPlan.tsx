import React from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileQuestion,
  PackageOpen,
  Sparkles,
  Target,
} from 'lucide-react';

import type {
  CustomerCommunicationAngle,
  CustomerCommunicationMaterial,
  CustomerCommunicationMaterialSearch,
  CustomerCommunicationObjective,
  CustomerCommunicationQuestion,
} from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  customerCommunicationMaterialSearchStatusLabel,
  customerCommunicationMaterialSourceTypeLabel,
  customerCommunicationMaterialStatusLabel,
} from './customer-communication-preparation-view';

interface CustomerCommunicationPlanProps {
  objective: CustomerCommunicationObjective;
  angles: CustomerCommunicationAngle[];
  questions: CustomerCommunicationQuestion[];
  materials: CustomerCommunicationMaterial[];
  materialSearch: CustomerCommunicationMaterialSearch;
}

const SourceCount: React.FC<{ sourceKeys: string[] }> = ({ sourceKeys }) => (
  <span className="text-xs text-muted-foreground">
    {sourceKeys.length} 条事实来源
  </span>
);

const CustomerCommunicationPlan: React.FC<
  CustomerCommunicationPlanProps
> = ({ objective, angles, questions, materials, materialSearch }) => (
  <div className="space-y-6">
    <section className="rounded-xl border border-border bg-card p-6">
      <p className="flex items-center gap-2 text-sm font-medium text-primary">
        <Target aria-hidden="true" className="size-4" />本次沟通目标
      </p>
      <h2 className="mt-3 break-words text-2xl font-semibold">
        {objective.title}
      </h2>
      <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">
        {objective.detail}
      </p>
      <div className="mt-4">
        <SourceCount sourceKeys={objective.sourceKeys} />
      </div>
    </section>

    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Sparkles aria-hidden="true" className="size-5 text-primary" />
          推荐沟通角度
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          每个角度都来自当前客户攻略，不把待确认信息写成事实。
        </p>
      </div>
      <div
        className="grid gap-4 lg:grid-cols-3"
        data-ai-section-type="card-list"
      >
        {angles.map((angle: CustomerCommunicationAngle) => (
          <article
            key={angle.id}
            className="rounded-xl border border-border bg-card p-5"
          >
            <h3 className="break-words text-base font-semibold">
              {angle.title}
            </h3>
            <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
              {angle.guidance}
            </p>
            <div className="mt-4">
              <SourceCount sourceKeys={angle.sourceKeys} />
            </div>
          </article>
        ))}
      </div>
    </section>

    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <FileQuestion aria-hidden="true" className="size-5 text-primary" />
          建议重点确认的问题
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          这些仍然是问题，需要在沟通中确认，不代表客户已经认可。
        </p>
      </div>
      {questions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
          当前没有额外缺口问题，仍建议在收口时确认双方下一步、责任人和时间。
        </p>
      ) : (
        <ol className="space-y-3">
          {questions.map(
            (question: CustomerCommunicationQuestion, index: number) => (
              <li
                key={`${question.code}-${question.opportunityRecordId ?? 'customer'}`}
                className="flex gap-4 rounded-xl border border-border bg-card p-5"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">
                    {question.question}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                    依据：{question.reason}
                  </p>
                </div>
              </li>
            ),
          )}
        </ol>
      )}
    </section>

    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <PackageOpen aria-hidden="true" className="size-5 text-primary" />
          建议准备的材料
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          只检索管理员白名单且已证明当前账号可读的资料，不生成虚构链接或附件。
        </p>
      </div>
      <div
        className="rounded-xl border border-border bg-muted/40 px-5 py-4"
        role="status"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">
            {customerCommunicationMaterialSearchStatusLabel(
              materialSearch.status,
            )}
          </p>
          <span className="text-xs text-muted-foreground">
            已核验 {materialSearch.checkedSourceCount}/
            {materialSearch.configuredSourceCount} 个白名单来源
          </span>
        </div>
        {materialSearch.warnings.length > 0 && (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {materialSearch.warnings.join('；')}
          </p>
        )}
      </div>
      <div
        className="grid gap-4 md:grid-cols-2"
        data-ai-section-type="card-list"
      >
        {materials.map((material: CustomerCommunicationMaterial) => (
          <article
            key={material.id}
            className="rounded-xl border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="break-words text-base font-semibold">
                {material.title}
              </h3>
              <Badge variant="outline">
                {customerCommunicationMaterialStatusLabel(material.status)}
              </Badge>
            </div>
            <p className="mt-3 break-words text-sm leading-6">
              {material.purpose}
            </p>
            <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
              推荐原因：{material.reason}
            </p>
            {material.status === 'recommended' && (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {customerCommunicationMaterialSourceTypeLabel(
                      material.sourceType,
                    )}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {material.sourceVersion} · {material.citation}
                  </span>
                </div>
                <p className="break-words text-xs leading-5 text-muted-foreground">
                  匹配依据：{material.matchReason}
                </p>
                <blockquote className="break-words border-l-2 border-primary/50 pl-3 text-sm leading-6">
                  {material.excerpt}
                </blockquote>
                <p className="break-words text-xs leading-5 text-muted-foreground">
                  适用边界：{material.applicability}
                </p>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={material.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开原资料<ExternalLink aria-hidden="true" />
                  </a>
                </Button>
              </div>
            )}
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              {material.sourceKeys.length} 条事实来源
            </p>
          </article>
        ))}
      </div>
    </section>
  </div>
);

export default CustomerCommunicationPlan;
