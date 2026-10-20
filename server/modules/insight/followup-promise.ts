const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const followupPromiseNextAction = (payload: unknown): string | null => {
  if (!isObject(payload) || (payload.actionKind ?? 'followup') !== 'followup' || !isObject(payload.draft)) return null;
  const selected: unknown = Array.isArray(payload.selectedTaskCandidateIds) ? payload.selectedTaskCandidateIds[0] : undefined;
  const candidate: unknown = selected && Array.isArray(payload.taskCandidates)
    ? payload.taskCandidates.find((item: unknown): boolean => isObject(item) && item.id === selected) : undefined;
  const raw: unknown = (isObject(candidate) ? candidate.title : undefined) ?? payload.draft.nextAction;
  if (typeof raw !== 'string') return null;
  const nextAction: string = raw.trim();
  return nextAction && !/^(暂无|没有|无)下一步/u.test(nextAction) ? nextAction : null;
};
export { followupPromiseNextAction };
