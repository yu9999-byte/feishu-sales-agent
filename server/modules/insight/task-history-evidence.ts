import type { TaskHistorySourceResult, TaskStatusEvent } from '@server/modules/agent-core/agent.types';

interface TaskHistoryScope {
  tenantId: string;
  actorOpenId: string;
  taskGuids: string[];
  since: Date;
  until: Date;
}

const timestamp = (raw: string | null): number => {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(raw)) return NaN;
  const value: number = Date.parse(raw);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 19) === raw.slice(0, 19) ? value : NaN;
};

const hasCompleteTaskHistory = (result: TaskHistorySourceResult, scope: TaskHistoryScope): boolean => {
  const proof = result.continuity;
  if (result.coverage !== 'full' || result.warning || !proof || !proof.sourceId?.trim() ||
    proof.tenantId !== scope.tenantId || proof.actorOpenId !== scope.actorOpenId ||
    proof.hasMore !== false || !Array.isArray(proof.gaps) || proof.gaps.length !== 0 ||
    timestamp(proof.from) !== scope.since.getTime() || timestamp(proof.through) !== scope.until.getTime() ||
    !Array.isArray(proof.taskGuids) || proof.taskGuids.length !== scope.taskGuids.length ||
    new Set(proof.taskGuids).size !== proof.taskGuids.length ||
    scope.taskGuids.some((guid: string): boolean => !proof.taskGuids.includes(guid))) return false;
  return hasValidTaskHistoryEvents(result.items, scope);
};

const hasValidTaskHistoryEvents = (
  items: TaskStatusEvent[],
  scope: Pick<TaskHistoryScope, 'taskGuids' | 'since' | 'until'>,
): boolean => {
  const ids: Set<string> = new Set();
  const terminal: Map<string, string> = new Map();
  return items.every((event: TaskStatusEvent): boolean => {
    const at: number = timestamp(event.occurredAt);
    const completed: number = timestamp(event.completedAt);
    if (typeof event.eventId !== 'string' || !event.eventId.trim() || ids.has(event.eventId) ||
      !scope.taskGuids.includes(event.guid) ||
      !Number.isFinite(at) || at < scope.since.getTime() || at > scope.until.getTime() ||
      !['observed', 'changed', 'completed', 'reopened'].includes(event.kind)) return false;
    ids.add(event.eventId);
    if (event.completedAt !== null && (!Number.isFinite(completed) || completed <= 0 || completed > at)) return false;
    if (event.kind === 'completed' && event.completedAt === null) return false;
    if (event.kind === 'reopened' && event.completedAt !== null) return false;
    const key: string = `${event.guid}:${at}`;
    const state: string = JSON.stringify([event.kind, event.status, event.completedAt, event.title, event.dueAt,
      event.relatedTaskGuid, event.relation]);
    if (terminal.has(key) && terminal.get(key) !== state) return false;
    terminal.set(key, state);
    return true;
  });
};

export { hasCompleteTaskHistory, hasValidTaskHistoryEvents };
