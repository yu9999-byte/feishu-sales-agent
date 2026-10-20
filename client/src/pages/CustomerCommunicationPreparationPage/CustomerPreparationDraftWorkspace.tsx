import React, { useEffect, useRef, useState } from 'react';

import type {
  CustomerPreparationDraftEdit,
  CustomerPreparationResultSnapshot,
} from '@shared/api.interface';
import { getCustomerPreparationResult, saveCustomerPreparationDraft, type ProductApiError } from '../../api';
import CustomerCommunicationDrafts from './CustomerCommunicationDrafts';
import { resolvePreparationDrafts } from './customer-communication-preparation-view';

const CustomerPreparationDraftWorkspace: React.FC<{
  snapshot: CustomerPreparationResultSnapshot;
  onAccessFailure: (failure: ProductApiError) => void;
}> = ({ snapshot, onAccessFailure }) => {
  const [current, setCurrent] = useState<CustomerPreparationResultSnapshot>(snapshot);
  const [busy, setBusy] = useState<boolean>(false);
  const latest = useRef<CustomerPreparationResultSnapshot>(snapshot);
  const locked = useRef<boolean>(false);
  const mounted = useRef<boolean>(true);

  useEffect((): (() => void) => {
    mounted.current = true;
    return (): void => { mounted.current = false; };
  }, []);

  useEffect((): void => {
    if (snapshot.revision >= latest.current.revision) {
      latest.current = snapshot;
      setCurrent(snapshot);
    }
  }, [snapshot]);

  const acceptSnapshot = (value: CustomerPreparationResultSnapshot): void => {
    if (!mounted.current || value.revision < latest.current.revision) return;
    latest.current = value;
    setCurrent(value);
  };

  const save = async (edit: CustomerPreparationDraftEdit): Promise<void> => {
    if (locked.current) throw new Error('另一个草稿操作正在进行');
    locked.current = true;
    setBusy(true);
    try {
      const saved = await saveCustomerPreparationDraft(snapshot.id, {
        ...edit, expectedRevision: latest.current.revision,
      });
      acceptSnapshot(saved);
    } catch (failure: unknown) {
      if (mounted.current) onAccessFailure(failure as ProductApiError);
      throw failure;
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const reload = async (): Promise<CustomerPreparationDraftEdit[]> => {
    if (locked.current) throw new Error('另一个草稿操作正在进行');
    locked.current = true;
    setBusy(true);
    try {
      const fresh = await getCustomerPreparationResult(snapshot.id);
      acceptSnapshot(fresh);
      return resolvePreparationDrafts(latest.current.report.drafts, latest.current.draftEdits);
    } catch (failure: unknown) {
      if (mounted.current) onAccessFailure(failure as ProductApiError);
      throw failure;
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return <CustomerCommunicationDrafts
    drafts={resolvePreparationDrafts(current.report.drafts, current.draftEdits)}
    generatedAt={current.report.generatedAt}
    busy={busy}
    onSave={save}
    onReload={reload}
  />;
};

export default CustomerPreparationDraftWorkspace;
