import React from 'react';
import {
  CheckCircle2,
  FileQuestion,
  PackageOpen,
  Sparkles,
  Target,
} from 'lucide-react';

import type {
  CustomerCommunicationAngle,
  CustomerCommunicationMaterial,
  CustomerCommunicationObjective,
  CustomerCommunicationQuestion,
} from '@shared/api.interface';
import { Badge } from '@/components/ui/badge';
import {
  customerCommunicationMaterialStatusLabel,
} from './customer-communication-preparation-view';

interface CustomerCommunicationPlanProps {
  objective: CustomerCommunicationObjective;
  angles: CustomerCommunicationAngle[];
  questions: CustomerCommunicationQuestion[];
  materials: CustomerCommunicationMaterial[];
}

const SourceCount: React.FC<{ sourceKeys: string[] }> = ({ sourceKeys }) => (
  <span className="text-xs text-muted-foreground">
    {sourceKeys.length} 条事实来源
  </span>
);

const CustomerCommunicationPlan: React.FC<
  CustomerCommunicationPlanProps
> = ({ objective, angles, questions, materials }) => (
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
          当前未接入经审核资料库，系统只列出所需材料，不生成虚构链接或附件。
        </p>
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

