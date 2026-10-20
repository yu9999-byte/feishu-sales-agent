import React, { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TaskPromiseEvidencePanel } from './TaskPromiseEvidencePanel';
import type { ProductApiError } from '../../api';

const TaskPromiseEvidence: React.FC<{ actionId: string; nextAction: string; canWrite: boolean;
  onAccessFailure: (failure: ProductApiError) => void }> =
({ actionId, nextAction, canWrite, onAccessFailure }) => {
  const [open, setOpen] = useState<boolean>(false);
  return <>
    <Button className="mt-3" size="sm" variant="outline" onClick={() => setOpen(true)}>
      <ClipboardCheck aria-hidden="true" />核查凭证
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>承诺凭证</DialogTitle>
          <DialogDescription>本人确认记录</DialogDescription></DialogHeader>
        {open && <TaskPromiseEvidencePanel key={actionId} actionId={actionId} nextAction={nextAction}
          canWrite={canWrite} onAccessFailure={onAccessFailure} />}
      </DialogContent>
    </Dialog>
  </>;
};
export { TaskPromiseEvidence };
