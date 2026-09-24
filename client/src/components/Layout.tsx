import React, { useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  BriefcaseBusiness,
  ClipboardList,
  House,
  Menu,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import type {
  PlatformNavigationItem,
  PlatformNavigationKey,
  PlatformSessionResponse,
} from '@shared/api.interface';
import { getPlatformSession, type ProductApiError } from '../api';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

interface ProductLayoutContext {
  session: PlatformSessionResponse;
}

const iconByKey: Record<PlatformNavigationKey, React.ElementType> = {
  workspace: House,
  customers: UsersRound,
  opportunities: BriefcaseBusiness,
  followups: ClipboardList,
  tasks: Activity,
  reviews: Activity,
  analytics: Activity,
  playbooks: BookOpen,
  admin: ShieldCheck,
};

const LoadingShell: React.FC = () => (
  <div className="min-h-[100dvh] bg-background p-6" aria-busy="true">
    <div className="mx-auto flex max-w-[1440px] gap-8">
      <Skeleton className="hidden h-[88vh] w-56 rounded-xl md:block" />
      <div className="flex-1 space-y-6">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-8 w-56 rounded-md" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
    <span className="sr-only">正在加载工作区</span>
  </div>
);

const LoginGate: React.FC<{ error: ProductApiError }> = ({ error }) => {
  const location = useLocation();
  const tenantKey: string | null = new URLSearchParams(
    location.search,
  ).get('tenantKey');
  const loginUrl: string | null = tenantKey
    ? `/api/auth/feishu/start?${new URLSearchParams({
        tenantKey,
        returnTo: location.pathname,
      }).toString()}`
    : null;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <section className="w-full max-w-lg rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 inline-flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BriefcaseBusiness aria-hidden="true" className="size-5" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">销策 Agent</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {error.status === 403
            ? '当前飞书账号尚未获得此企业工作区的访问权限。'
            : error.status === 401
              ? '请从飞书中的销策 Agent 入口打开工作台并完成身份验证。'
              : error.message}
        </p>
        {loginUrl && error.status !== 403 ? (
          <Button className="mt-6" asChild>
            <a href={loginUrl}>使用飞书登录</a>
          </Button>
        ) : (
          <p className="mt-6 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
            如需访问，请联系当前企业管理员获取飞书应用入口。
          </p>
        )}
      </section>
    </main>
  );
};

const Layout: React.FC = () => {
  const [session, setSession] =
    useState<PlatformSessionResponse | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);
  const location = useLocation();

  useEffect((): (() => void) => {
    let mounted: boolean = true;
    void getPlatformSession()
      .then((result: PlatformSessionResponse): void => {
        if (mounted) {
          setSession(result);
        }
      })
      .catch((failure: ProductApiError): void => {
        if (mounted) {
          setError(failure);
        }
      })
      .finally((): void => {
        if (mounted) {
          setLoading(false);
        }
      });
    return (): void => {
      mounted = false;
    };
  }, []);

  useEffect((): void => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (loading) {
    return <LoadingShell />;
  }
  if (error !== null || session === null) {
    return <LoginGate error={error ?? {
      status: 0,
      message: '无法验证当前工作区',
      retryable: true,
    }} />;
  }

  const navigation = (
    <nav aria-label="主导航" className="space-y-1">
      {session.navigation.map(
        (item: PlatformNavigationItem): React.ReactNode => {
          const Icon: React.ElementType = iconByKey[item.key];
          return (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }): string =>
                `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-muted'
                }`
              }
            >
              <Icon aria-hidden="true" className="size-4" />
              {item.label}
            </NavLink>
          );
        },
      )}
    </nav>
  );

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-card px-4 md:px-8">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={(): void => setMobileOpen((open: boolean): boolean => !open)}
            aria-label={mobileOpen ? '关闭导航' : '打开导航'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BriefcaseBusiness aria-hidden="true" className="size-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">销策 Agent</span>
          <span className="hidden border-l border-border pl-3 text-sm text-muted-foreground sm:inline">
            {session.tenant.name}
          </span>
        </div>
        <span className="max-w-32 truncate text-sm text-muted-foreground" aria-label={`当前用户：${session.member.displayName}`}>
          {session.member.displayName}
        </span>
      </header>

      <div className="mx-auto flex max-w-[1440px]">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 border-r border-border bg-sidebar px-4 py-6 md:block">
          {navigation}
        </aside>
        {mobileOpen && (
          <aside className="fixed inset-x-0 top-16 z-30 border-b border-border bg-sidebar p-4 shadow-md md:hidden">
            {navigation}
          </aside>
        )}
        <main className="min-w-0 flex-1 px-4 py-7 md:px-8 md:py-9">
          <Outlet context={{ session } satisfies ProductLayoutContext} />
        </main>
      </div>
    </div>
  );
};

export default Layout;
export type { ProductLayoutContext };
