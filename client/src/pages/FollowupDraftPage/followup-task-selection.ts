import type {
  FollowupTaskCandidate,
  FollowupTaskMissingField,
} from '@shared/api.interface';

const TASK_FIELD_LABELS: Record<FollowupTaskMissingField, string> = {
  dueAt: '时间',
  pastDueAt: '执行时间已过期，请修改',
  channel: '地点/方式',
  participants: '参与人',
};

const defaultSelectedTaskIds = (
  candidates: FollowupTaskCandidate[],
): string[] => candidates
  .filter((candidate: FollowupTaskCandidate): boolean =>
    candidate.status === 'ready',
  )
  .map((candidate: FollowupTaskCandidate): string => candidate.id);

const missingTaskFieldLabels = (
  fields: FollowupTaskMissingField[],
): string[] => fields.map(
  (field: FollowupTaskMissingField): string => TASK_FIELD_LABELS[field],
);

const taskConfirmationLabel = (selectedCount: number): string =>
  selectedCount > 0
    ? '确认保存并创建所示待办'
    : '确认保存（不创建待办）';

export {
  defaultSelectedTaskIds,
  missingTaskFieldLabels,
  taskConfirmationLabel,
};
