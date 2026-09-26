import type {
  FollowupDraft,
  FollowupTaskCandidate,
  FollowupTaskMissingField,
  SalesContext,
} from '@shared/api.interface';

interface BuildFollowupTaskCandidatesInput {
  draftId: string;
  version: number;
  ownerMemberId: string;
  draft: FollowupDraft;
  now: Date;
}

const NO_NEXT_STEP_PATTERN = /^(暂无|没有|无)下一步/u;

const normalizedText = (value: string | null | undefined): string | null => {
  const normalized: string = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
};

const validDueAt = (value: string | null): boolean =>
  value !== null && !Number.isNaN(Date.parse(value));

const hasVerifiedTaskContext = (
  draft: FollowupDraft,
  context: SalesContext | undefined,
): boolean => {
  if (
    context?.status !== 'ready' ||
    context.customer === null ||
    context.opportunities.length !== 1
  ) {
    return false;
  }
  const opportunityName: string | null = normalizedText(draft.opportunityName);
  return opportunityName === null ||
    context.opportunities[0].name === opportunityName;
};

const buildFollowupTaskCandidates = (
  input: BuildFollowupTaskCandidatesInput,
): FollowupTaskCandidate[] => {
  const title: string | null = normalizedText(input.draft.nextAction);
  if (title === null || NO_NEXT_STEP_PATTERN.test(title)) {
    return [];
  }

  const dueAt: string | null = normalizedText(input.draft.dueAt);
  const channel: string | null = normalizedText(
    input.draft.nextActionChannel,
  );
  const participants: string[] = (input.draft.nextActionParticipants ?? [])
    .map((participant: string): string => participant.trim())
    .filter((participant: string): boolean => participant.length > 0);
  const missingFields: FollowupTaskMissingField[] = [];
  if (!validDueAt(dueAt)) {
    missingFields.push('dueAt');
  } else if (dueAt !== null && Date.parse(dueAt) < input.now.getTime()) {
    missingFields.push('pastDueAt');
  }
  return [{
    id: `${input.draftId}:v${input.version}:task:0`,
    draftId: input.draftId,
    draftVersion: input.version,
    ownerMemberId: input.ownerMemberId,
    title,
    dueAt,
    channel,
    participants,
    customerName: input.draft.customerName,
    opportunityName: input.draft.opportunityName,
    status: missingFields.length === 0 ? 'ready' : 'needs_input',
    missingFields,
  }];
};

export {
  buildFollowupTaskCandidates,
  hasVerifiedTaskContext,
};
export type {
  BuildFollowupTaskCandidatesInput,
};
