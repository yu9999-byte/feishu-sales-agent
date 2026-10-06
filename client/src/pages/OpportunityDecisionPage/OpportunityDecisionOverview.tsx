import React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

interface DecisionMetricProps {
  label: string;
  value: number;
  detail: string;
  icon: React.ReactNode;
}

const DecisionMetric: React.FC<DecisionMetricProps> = ({
  label,
  value,
  detail,
  icon,
}) => (
  <article className="rounded-xl border border-border bg-card p-5">
    <div className="flex items-center justify-between gap-3 text-muted-foreground">
      <span className="text-sm font-medium">{label}</span>
      <span className="[&_svg]:size-4">{icon}</span>
    </div>
    <p className="mt-4 text-3xl font-semibold tracking-tight">{value}</p>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
  </article>
);

const DecisionLoading: React.FC = () => (
  <section aria-busy="true" className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((item: number) => (
        <Skeleton key={item} className="h-32 rounded-xl" />
      ))}
    </div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.45fr)]">
      <Skeleton className="h-[34rem] rounded-xl" />
      <Skeleton className="h-[34rem] rounded-xl" />
    </div>
    <span className="sr-only">正在读取商机决策</span>
  </section>
);

export { DecisionLoading, DecisionMetric };
