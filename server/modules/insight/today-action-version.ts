import { createHash } from 'node:crypto';
import type { TodayActionItem } from '@shared/api.interface';

const todayActionVersion = (item: TodayActionItem): string => createHash('sha256')
  .update(JSON.stringify({ id: item.id, sourceId: item.sourceId, customerRecordId: item.customerRecordId, reason: item.reason,
    title: item.title, kind: item.kind,
    evidence: item.evidence, suggestedAction: item.suggestedAction,
    suggestedCompletionDate: item.suggestedCompletionDate }))
  .digest('hex');

export { todayActionVersion };

