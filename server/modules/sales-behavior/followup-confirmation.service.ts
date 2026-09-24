import { Inject, Injectable } from '@nestjs/common';

import type {
  AgentExecutionResult,
  FollowupTaskCandidate,
} from '@shared/api.interface';
import { AgentActionExecutorService } from '@server/modules/agent-core/agent-action-executor.service';
import { CONTROL_STORE, type ControlStore } from '@server/modules/agent-core/agent.ports';
import type { PendingAction, TenantIntegration } from '@server/modules/agent-core/agent.types';
import {
  FOLLOWUP_DRAFT_REPOSITORY,
  type FollowupDraftRecord,
  type FollowupDraftRepository,
} from './followup-draft.repository';
import { buildFollowupTaskCandidates } from './followup-task-preview';

interface ConfirmFollowupDraftCommand {
  tenantId: string;
  ownerMemberId: string;
  ownerOpenId: string;
  draftId: string;
  expectedVersion: number;
  selectedTaskCandidateIds: string[];
  traceId: string;
  now: Date;
}

class FollowupConfirmationError extends Error {
  constructor(
    readonly code:
      | 'DRAFT_CONFLICT'
      | 'DRAFT_NOT_CONFIRMABLE'
      | 'INTEGRATION_UNAVAILABLE'
      | 'TASK_SELECTION_INVALID',
  ) {
    super(code);
    this.name = 'FollowupConfirmationError';
  }
}

@Injectable()
class FollowupConfirmationService {
  constructor(
    @Inject(CONTROL_STORE)
    private readonly store: ControlStore,
    @Inject(FOLLOWUP_DRAFT_REPOSITORY)
    private readonly drafts: FollowupDraftRepository,
    private readonly executor: AgentActionExecutorService,
  ) {}

  async getExecution(
    tenantId: string,
    ownerMemberId: string,
    ownerOpenId: string,
    draftId: string,
  ): Promise<AgentExecutionResult | null> {
    const draft: FollowupDraftRecord | null =
      await this.drafts.getDraft(tenantId, draftId);
    if (draft === null || draft.ownerMemberId !== ownerMemberId) {
      throw new FollowupConfirmationError('DRAFT_CONFLICT');
    }
    const action: PendingAction | null =
      await this.store.getPendingAction(tenantId, draftId);
    if (action === null) return null;
    if (action.actorOpenId !== ownerOpenId) {
      throw new FollowupConfirmationError('DRAFT_CONFLICT');
    }
    return action.result;
  }

  async confirm(command: ConfirmFollowupDraftCommand): Promise<AgentExecutionResult> {
    const current: FollowupDraftRecord | null = await this.drafts.getDraft(
      command.tenantId,
      command.draftId,
    );
    if (current === null || current.ownerMemberId !== command.ownerMemberId) {
      throw new FollowupConfirmationError('DRAFT_CONFLICT');
    }

    const alreadyConfirmed: boolean =
      current.status === 'confirmed' &&
      current.currentVersion === command.expectedVersion + 1 &&
      current.version.creationKind === 'confirmed';
    if (!alreadyConfirmed && (
      current.status !== 'pendingConfirmation' ||
      current.currentVersion !== command.expectedVersion
    )) {
      throw new FollowupConfirmationError('DRAFT_CONFLICT');
    }
    const draft = current.version.draft;
    if (
      !current.version.quality.confirmable ||
      !draft.customerName || !draft.nextAction ||
      !draft.dueAt || Number.isNaN(Date.parse(draft.dueAt))
    ) {
      throw new FollowupConfirmationError('DRAFT_NOT_CONFIRMABLE');
    }
    // A confirmed draft is retried with the predecessor version in the web
    // request for backward compatibility, but its task IDs belong to the
    // confirmed version (N+1). Always validate against the version that will
    // be persisted into the pending action.
    const candidateVersion: number = alreadyConfirmed
      ? current.currentVersion
      : command.expectedVersion;
    const taskCandidates: FollowupTaskCandidate[] =
      current.version.taskCandidates ?? buildFollowupTaskCandidates({
        draftId: current.id,
        version: candidateVersion,
        ownerMemberId: current.ownerMemberId,
        draft,
        now: command.now,
      });
    if (alreadyConfirmed) {
      const existing: PendingAction | null = await this.store.getPendingAction(
        command.tenantId,
        command.draftId,
      );
      if (existing !== null) {
        this.assertTaskSelectionAcrossVersions(
          existing.payload.taskCandidates ?? [],
          taskCandidates,
          command.selectedTaskCandidateIds,
          existing.payload.selectedTaskCandidateIds,
        );
        if (!['failed', 'partialFailure'].includes(existing.status)) {
          return existing.result;
        }
      }
    }
    this.assertTaskSelection(
      taskCandidates,
      command.selectedTaskCandidateIds,
    );

    const integration: TenantIntegration | null =
      await this.store.resolveTenantById(command.tenantId);
    if (integration === null || integration.status !== 'active') {
      throw new FollowupConfirmationError('INTEGRATION_UNAVAILABLE');
    }

    const marked: FollowupDraftRecord | null = alreadyConfirmed
      ? current
      : await this.drafts.markConfirmed({
        tenantId: command.tenantId,
        draftId: command.draftId,
        ownerMemberId: command.ownerMemberId,
        expectedVersion: command.expectedVersion,
        confirmedAt: command.now,
      });
    const confirmed: FollowupDraftRecord | null = marked ??
      await this.drafts.getDraft(command.tenantId, command.draftId);
    if (
      confirmed === null ||
      confirmed.ownerMemberId !== command.ownerMemberId ||
      confirmed.status !== 'confirmed' ||
      confirmed.currentVersion !== command.expectedVersion + 1 ||
      confirmed.version.creationKind !== 'confirmed'
    ) {
      throw new FollowupConfirmationError('DRAFT_CONFLICT');
    }

    // A deterministic action ID recovers a crash between confirming the draft
    // and creating the action. The control store grants execution only once.
    const action: PendingAction = await this.store.createPendingAction({
      id: command.draftId,
      tenantId: command.tenantId,
      actorOpenId: command.ownerOpenId,
      chatId: `web:${command.ownerMemberId}`,
      payload: {
        version: 1,
        sourceMessageId: `web:${command.draftId}:${confirmed.currentVersion}`,
        rawText: confirmed.version.sourceText,
        draft: confirmed.version.draft,
        generatedBody: confirmed.version.generatedBody,
        taskCandidates,
        selectedTaskCandidateIds: command.selectedTaskCandidateIds,
      },
      expiresAt: new Date(command.now.getTime() + 24 * 60 * 60 * 1000),
    });
    if (
      action.actorOpenId !== command.ownerOpenId ||
      action.payload.sourceMessageId !==
        `web:${command.draftId}:${confirmed.currentVersion}`
    ) {
      throw new FollowupConfirmationError('DRAFT_CONFLICT');
    }
    const existingConfirmedAction: boolean = alreadyConfirmed &&
      action.payload.selectedTaskCandidateIds !== undefined;
    if (!existingConfirmedAction && !this.sameTaskSelection(
      action.payload.selectedTaskCandidateIds,
      command.selectedTaskCandidateIds,
    )) {
      throw new FollowupConfirmationError('TASK_SELECTION_INVALID');
    }
    const acquired: PendingAction | null = await this.store.acquirePendingAction(
      command.tenantId,
      action.id,
      command.ownerOpenId,
      ['pendingConfirmation', 'failed', 'partialFailure'],
      command.now,
    );
    if (acquired === null) {
      const latest: PendingAction | null = await this.store.getPendingAction(
        command.tenantId,
        action.id,
      );
      if (latest === null) {
        throw new FollowupConfirmationError('DRAFT_CONFLICT');
      }
      return latest.result;
    }
    await this.store.appendAudit({
      tenantId: command.tenantId,
      traceId: command.traceId,
      eventType: 'followup.version.confirmed.v1',
      actorOpenId: command.ownerOpenId,
      entityId: command.draftId,
      outcome: 'accepted',
      details: { version: command.expectedVersion },
    });
    return this.executor.executeImmediately(integration, acquired, command.traceId);
  }

  private assertTaskSelection(
    candidates: FollowupTaskCandidate[],
    selectedIds: string[],
  ): void {
    const uniqueSelectedIds: Set<string> = new Set(selectedIds);
    const readyIds: Set<string> = new Set(
      candidates
        .filter((candidate: FollowupTaskCandidate): boolean =>
          candidate.status === 'ready',
        )
        .map((candidate: FollowupTaskCandidate): string => candidate.id),
    );
    if (
      uniqueSelectedIds.size !== selectedIds.length ||
      selectedIds.some((id: string): boolean => !readyIds.has(id))
    ) {
      throw new FollowupConfirmationError('TASK_SELECTION_INVALID');
    }
  }

  private sameTaskSelection(
    storedIds: string[] | undefined,
    requestedIds: string[],
  ): boolean {
    if (storedIds === undefined || storedIds.length !== requestedIds.length) {
      return false;
    }
    const requested: Set<string> = new Set(requestedIds);
    return storedIds.every((id: string): boolean => requested.has(id));
  }

  private assertTaskSelectionAcrossVersions(
    previous: FollowupTaskCandidate[],
    current: FollowupTaskCandidate[],
    selectedIds: string[],
    previousSelectedIds: string[] | undefined,
  ): void {
    const readyIds: Set<string> = new Set([
      ...previous,
      ...current,
    ].filter((candidate: FollowupTaskCandidate): boolean =>
      candidate.status === 'ready',
    ).map((candidate: FollowupTaskCandidate): string => candidate.id));
    if (new Set(selectedIds).size !== selectedIds.length ||
      selectedIds.some((id: string): boolean => !readyIds.has(id))) {
      throw new FollowupConfirmationError('TASK_SELECTION_INVALID');
    }
    if (previousSelectedIds !== undefined &&
      !this.sameLogicalTaskSelection(previousSelectedIds, selectedIds)) {
      throw new FollowupConfirmationError('TASK_SELECTION_INVALID');
    }
  }

  private sameLogicalTaskSelection(
    left: string[],
    right: string[],
  ): boolean {
    const logical = (id: string): string => {
      const marker: string = ':task:';
      const index: number = id.lastIndexOf(marker);
      return index >= 0 ? id.slice(index) : id;
    };
    const leftSet: Set<string> = new Set(left.map(logical));
    const rightSet: Set<string> = new Set(right.map(logical));
    return leftSet.size === rightSet.size &&
      Array.from(leftSet).every((id: string): boolean => rightSet.has(id));
  }
}

export { FollowupConfirmationError, FollowupConfirmationService };
export type { ConfirmFollowupDraftCommand };
