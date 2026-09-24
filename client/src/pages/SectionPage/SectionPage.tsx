import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';

import type {
  PlatformSectionKey,
  PlatformSectionResponse,
} from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getPlatformSection, type ProductApiError } from '../../api';

interface SectionPageProps {
  sectionKey: PlatformSectionKey;
}

const SectionPage: React.FC<SectionPageProps> = ({ sectionKey }) => {
  const [section, setSection] =
    useState<PlatformSectionResponse | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [reloadKey, setReloadKey] = useState<number>(0);

  useEffect((): (() => void) => {
    let mounted: boolean = true;
    setLoading(true);
    setSection(null);
    setError(null);
    void getPlatformSection(sectionKey)
      .then((result: PlatformSectionResponse): void => {
        if (mounted) setSection(result);
      })
      .catch((failure: ProductApiError): void => {
        if (mounted) setError(failure);
      })
      .finally((): void => {
        if (mounted) setLoading(false);
      });
    return (): void => {
      mounted = false;
    };
  }, [sectionKey, reloadKey]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6" aria-busy="true">
        <Skeleton className="h-9 w-48 rounded-md" />
        <Skeleton className="h-72 w-full rounded-xl" />
        <span className="sr-only">正在验证页面权限</span>
      </div>
    );
  }

  if (error) {
    return (
      <section className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-8" role="alert">
        {error.status === 403
          ? <LockKeyhole aria-hidden="true" className="size-6 text-muted-foreground" />
          : <AlertCircle aria-hidden="true" className="size-6 text-destructive" />}
        <h1 className="mt-5 text-2xl font-semibold">
          {error.status === 403 ? '无权访问' : '页面暂时无法加载'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <Link to="/"><ArrowLeft aria-hidden="true" />返回工作台</Link>
          </Button>
          {error.retryable && (
            <Button onClick={(): void => setReloadKey((key: number): number => key + 1)}>
              重试
            </Button>
          )}
        </div>
      </section>
    );
  }

  if (section === null) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        当前没有可展示的页面内容。
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <p className="text-sm font-medium text-primary">产品模块</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {section.title}
      </h1>
      <section className="mt-8 rounded-xl border border-border bg-card p-8 md:p-12">
        <div className="flex size-12 items-center justify-center rounded-lg bg-muted text-primary">
          <LockKeyhole aria-hidden="true" className="size-6" />
        </div>
        <h2 className="mt-6 text-xl font-semibold">页面入口已建立</h2>
        <p className="mt-3 max-w-[60ch] text-sm leading-7 text-muted-foreground">
          {section.message}
        </p>
        <p className="mt-5 text-sm font-medium text-foreground">
          计划阶段：Phase {section.phase}。页面没有模拟客户或经营数据。
        </p>
        <Button variant="outline" className="mt-8" asChild>
          <Link to="/"><ArrowLeft aria-hidden="true" />返回工作台</Link>
        </Button>
      </section>
    </div>
  );
};

export default SectionPage;
