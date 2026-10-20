import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, RefreshCw, X } from 'lucide-react';
import type { PublishedPlaybook, PublishedPlaybookListResponse } from '@shared/api.interface';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getPublishedPlaybook, getPublishedPlaybooks, type ProductApiError } from '../../api';
import { PublishedPlaybookContent } from './PlaybookPublicationPanel';

const PublishedPlaybookCatalog: React.FC = () => {
  const [data, setData] = useState<PublishedPlaybookListResponse | null>(null);
  const [selected, setSelected] = useState<PublishedPlaybook | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [revoked, setRevoked] = useState<boolean>(false);
  const generation = useRef<number>(0);
  const locked = useRef<boolean>(false);
  const load = async (candidateId?: string, more = false): Promise<void> => {
    if (locked.current || revoked) return;
    locked.current = true;
    const currentGeneration: number = generation.current;
    setBusy(true); setError(null); setSelected(null);
    try {
      if (candidateId) {
        const result = await getPublishedPlaybook(candidateId);
        if (generation.current === currentGeneration) setSelected(result);
      } else {
        const result = await getPublishedPlaybooks(more ? data?.nextAfterCandidateId ?? undefined : undefined);
        if (generation.current === currentGeneration) setData({ ...result,
          items: more ? [...(data?.items ?? []), ...result.items.filter((item) =>
            !data?.items.some((old) => old.candidateId === item.candidateId))] : result.items });
      }
    } catch (failure: unknown) {
      if (generation.current !== currentGeneration) return;
      const value = failure as ProductApiError;
      setSelected(null); setError(value);
      if ([401, 403].includes(value.status)) { setData(null); setRevoked(true); }
      if (value.status === 404) setData(null);
    } finally { if (generation.current === currentGeneration) { locked.current = false; setBusy(false); } }
  };
  useEffect((): (() => void) => {
    void load();
    return (): void => { generation.current += 1; locked.current = false; };
  }, []);
  return <section aria-label="已发布销售资料" className="min-w-0 space-y-4 border-y py-5 [&_button]:min-h-11" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><BookOpen aria-hidden="true" className="size-5" />已发布销售资料</h2>
      {!revoked && <Button variant="outline" disabled={busy} onClick={(): void => { void load(); }}>
        <RefreshCw aria-hidden="true" />刷新资料
      </Button>}
    </div>
    {error && <Alert variant="destructive" role="alert"><AlertTitle>资料未能读取</AlertTitle>
      <AlertDescription className="break-words">{error.message}</AlertDescription></Alert>}
    {busy && !data && <p role="status" className="text-sm text-muted-foreground">正在读取已发布资料…</p>}
    {data && <>
      {data.items.length === 0 ? <p className="text-sm text-muted-foreground">暂无已发布销售资料</p> : <ul className="divide-y">
        {data.items.map((item) => <li key={item.candidateId} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <p className="text-sm font-medium">{item.title} · v{item.version}</p>
            <p className="text-sm text-muted-foreground">{item.applicability}</p>
          </div>
          <Button variant="outline" disabled={busy} onClick={(): void => { void load(item.candidateId); }}>查看资料</Button>
        </li>)}
      </ul>}
      {data.nextAfterCandidateId && <Button variant="outline" disabled={busy} onClick={(): void => { void load(undefined, true); }}>更多资料</Button>}
    </>}
    {selected && <div className="min-w-0 space-y-3 border-t pt-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={(): void => { void load(selected.candidateId); }}><RefreshCw aria-hidden="true" />刷新正文</Button>
        <Button variant="outline" onClick={(): void => setSelected(null)}><X aria-hidden="true" />关闭正文</Button>
      </div>
      <PublishedPlaybookContent value={selected} />
    </div>}
  </section>;
};
export { PublishedPlaybookCatalog };
