import { Injectable } from '@nestjs/common';

import type {
  FollowupCardFormInput,
  FollowupDraft,
  FollowupTaskCandidate,
  JsonObject,
  JsonValue,
  PendingActionPayload,
  PlatformSessionResponse,
  FollowupProgressSnapshot,
  SalesContext,
} from '@shared/api.interface';
import type { TenantIntegration } from '@server/modules/agent-core/agent.types';
import { PlatformSessionService } from '@server/modules/platform-shell/platform-session.service';
import {
  buildFollowupTaskCandidates,
  hasVerifiedTaskContext,
} from './followup-task-preview';
import { FollowupQualityService } from './followup-quality.service';
import { FollowupProgressService } from './followup-progress.service';
import type {
  FollowupEvidenceInput,
  FollowupQualityInput,
} from './sales-behavior.types';

interface CreateChatDraftPayloadInput {
  integration: TenantIntegration;
  actionId: string;
  actorOpenId: string;
  sourceMessageId: string;
  rawText: string;
  draft: FollowupDraft;
  now: Date;
  inputForm?: FollowupCardFormInput;
  salesContext?: SalesContext;
}

interface ReviewedChatDraft {
  payload: PendingActionPayload;
  contentChanged: boolean;
}

const PARTICIPANT_SEPARATOR = /[,，、;；\n]+/u;

@Injectable()
class FollowupChatDraftService {
  constructor(
    private readonly sessions: PlatformSessionService,
    private readonly quality: FollowupQualityService,
    private readonly progress?: FollowupProgressService,
  ) {}

  createInputPayload(sourceMessageId: string): PendingActionPayload {
    return {
      version: 1,
      interactionStage: 'input',
      sourceMessageId,
      rawText: '',
      draft: {
        customerName: null,
        contactName: null,
        opportunityName: null,
        summary: '等待填写跟进表单',
        customerNeeds: [],
        objections: [],
        risks: [],
        progress: null,
        expectedAmount: null,
        nextAction: null,
        dueAt: null,
        evidenceQuotes: [],
        nextActionChannel: null,
        nextActionParticipants: [],
      },
      draftVersion: 0,
      taskCandidates: [],
      selectedTaskCandidateIds: [],
      inputForm: {},
    };
  }

  async createPayload(
    input: CreateChatDraftPayloadInput,
  ): Promise<PendingActionPayload> {
    const session: PlatformSessionResponse = await this.sessions.getSession(
      {
        feishuTenantKey: input.integration.feishuTenantKey,
        feishuOpenId: input.actorOpenId,
      },
      input.now,
    );
    const communicationMethod: string | null =
      input.inputForm?.communicationMethod ??
      input.draft.communicationMethod ??
      null;
    const communicationAt: string | null =
      input.inputForm?.communicationAt ??
      input.draft.communicationAt ??
      null;
    const topic: string | null = input.inputForm?.topic ??
      input.draft.topic ??
      null;
    const draft: FollowupDraft = {
      ...input.draft,
      customerName: input.inputForm?.customerName ??
        input.draft.customerName,
      contactName: input.inputForm?.contactName ?? input.draft.contactName,
      communicationMethod,
      communicationAt,
      topic,
      nextAction: input.inputForm?.nextAction ?? input.draft.nextAction,
      dueAt: this.normalizeDueAt(
        input.inputForm?.dueAt ?? input.draft.dueAt,
      ),
      nextActionChannel: input.inputForm?.nextActionChannel ??
        input.draft.nextActionChannel,
      nextActionParticipants:
        input.inputForm?.nextActionParticipants ??
        input.draft.nextActionParticipants,
    };
    const hasCommunicationContext: boolean = Boolean(
      communicationMethod || communicationAt || topic,
    );
    const inputForm: FollowupCardFormInput | undefined =
      input.inputForm !== undefined || hasCommunicationContext
        ? {
            ...input.inputForm,
            communicationMethod: communicationMethod ?? undefined,
            communicationAt: communicationAt ?? undefined,
            topic: topic ?? undefined,
          }
        : undefined;
    const generatedBody: string = this.generateBody(draft);
    return this.buildPayload({
      actionId: input.actionId,
      sourceMessageId: input.sourceMessageId,
      rawText: input.rawText,
      draft,
      draftVersion: 1,
      ownerMemberId: session.member.id,
      generatedBody,
      now: input.now,
      inputForm,
      salesContext: input.salesContext,
    });
  }

  reviewForm(
    actionId: string,
    current: PendingActionPayload,
    formValue: JsonObject,
    now: Date,
  ): ReviewedChatDraft {
    const currentVersion: number = current.draftVersion ?? 1;
    const generatedBody: string = this.readText(
      formValue,
      'generatedBody',
      current.generatedBody ?? this.generateBody(current.draft),
    ).trim();
    const nextDraft: FollowupDraft = {
      ...current.draft,
      customerName: this.readNullableText(
        formValue,
        'customerName',
        current.draft.customerName,
      ),
      contactName: this.readNullableText(
        formValue,
        'contactName',
        current.draft.contactName,
      ),
      nextAction: this.readNullableText(
        formValue,
        'nextAction',
        current.draft.nextAction,
      ),
      dueAt: this.readDueAt(formValue, current.draft.dueAt),
      nextActionChannel: this.readNullableText(
        formValue,
        'nextActionChannel',
        current.draft.nextActionChannel ?? null,
      ),
      nextActionParticipants: this.readParticipants(
        formValue,
        current.draft.nextActionParticipants ?? [],
      ),
    };
    const inputForm: FollowupCardFormInput = {
      ...current.inputForm,
      customerName: nextDraft.customerName ?? undefined,
      contactName: nextDraft.contactName ?? undefined,
      communicationMethod: this.readOptionalText(
        formValue,
        'communicationMethod',
        current.inputForm?.communicationMethod,
      ),
      communicationAt: this.readOptionalText(
        formValue,
        'communicationAt',
        current.inputForm?.communicationAt,
      ),
      topic: this.readOptionalText(
        formValue,
        'topic',
        current.inputForm?.topic,
      ),
      nextAction: nextDraft.nextAction ?? undefined,
      dueAt: nextDraft.dueAt ?? undefined,
      nextActionChannel: nextDraft.nextActionChannel ?? undefined,
      nextActionParticipants: nextDraft.nextActionParticipants ?? [],
    };
    const contentChanged: boolean = generatedBody !==
      (current.generatedBody ?? this.generateBody(current.draft)) ||
      JSON.stringify(nextDraft) !== JSON.stringify(current.draft) ||
      JSON.stringify(inputForm) !== JSON.stringify(current.inputForm ?? {});
    const draftVersion: number = contentChanged
      ? currentVersion + 1
      : currentVersion;
    const payload: PendingActionPayload = this.buildPayload({
      actionId,
      sourceMessageId: current.sourceMessageId,
      rawText: current.rawText,
      draft: nextDraft,
      draftVersion,
      ownerMemberId: current.ownerMemberId ?? '',
      generatedBody,
      now,
      inputForm,
      salesContext: current.salesContext,
    });
    payload.operationKind = current.operationKind;
    payload.revisionOfActionId = current.revisionOfActionId;
    payload.executionTarget = current.executionTarget;
    payload.selectedTaskCandidateIds = this.readTaskSelection(
      formValue,
      payload.taskCandidates ?? [],
    );
    return { payload, contentChanged };
  }

  isConfirmable(payload: PendingActionPayload): boolean {
    const draft: FollowupDraft = payload.draft;
    return Boolean(
      payload.quality?.confirmable &&
      draft.customerName &&
      draft.nextAction &&
      draft.dueAt &&
      !Number.isNaN(Date.parse(draft.dueAt)),
    );
  }

  private buildPayload(input: {
    actionId: string;
    sourceMessageId: string;
    rawText: string;
    draft: FollowupDraft;
    draftVersion: number;
    ownerMemberId: string;
    generatedBody: string;
    now: Date;
    inputForm?: FollowupCardFormInput;
    salesContext?: SalesContext;
  }): PendingActionPayload {
    const progressAssessment: FollowupProgressSnapshot = this.assessProgress(
      input.draft,
      input.salesContext,
      input.rawText,
      input.now,
    );
    const taskCandidates: FollowupTaskCandidate[] =
      progressAssessment.recommendation === null ||
      !hasVerifiedTaskContext(input.draft, input.salesContext)
        ? []
        : buildFollowupTaskCandidates({
          draftId: input.actionId,
          version: input.draftVersion,
          ownerMemberId: input.ownerMemberId,
          draft: input.draft,
          now: input.now,
        });
    const payload: PendingActionPayload = {
      version: 1,
      interactionStage: 'draft',
      sourceMessageId: input.sourceMessageId,
      rawText: input.rawText,
      draft: input.draft,
      draftVersion: input.draftVersion,
      ownerMemberId: input.ownerMemberId,
      generatedBody: input.generatedBody,
      inputForm: input.inputForm,
      salesContext: input.salesContext,
      quality: this.quality.review(
        this.qualityInput(
          input.rawText,
          input.generatedBody,
          input.draft,
          input.inputForm,
        ),
        input.now,
      ),
      progressAssessment,
      taskCandidates,
      selectedTaskCandidateIds: taskCandidates
        .filter((candidate: FollowupTaskCandidate): boolean =>
          candidate.status === 'ready',
        )
        .map((candidate: FollowupTaskCandidate): string => candidate.id),
    };
    return payload;
  }

  private qualityInput(
    sourceText: string,
    generatedBody: string,
    draft: FollowupDraft,
    inputForm?: FollowupCardFormInput,
  ): FollowupQualityInput {
    const evidence: FollowupEvidenceInput[] = draft.evidenceQuotes.map(
      (quote: string): FollowupEvidenceInput => ({
        field: 'summary',
        assertionKind: 'fact',
        quote,
      }),
    );
    return {
      sourceText,
      generatedBody,
      draft,
      communicationMethod: inputForm?.communicationMethod ?? null,
      communicationAt: inputForm?.communicationAt ?? null,
      topic: inputForm?.topic ?? draft.opportunityName,
      agreements: draft.agreements ?? [],
      decisionChain: draft.decisionChain ?? [],
      competitors: draft.competitors ?? [],
      nextActionOwner: '销售本人',
      nextActionParticipants: draft.nextActionParticipants ?? [],
      evidence,
    };
  }

  private assessProgress(
    draft: FollowupDraft,
    salesContext: SalesContext | undefined,
    sourceText: string,
    now: Date,
  ): FollowupProgressSnapshot {
    const service: FollowupProgressService =
      this.progress ?? new FollowupProgressService();
    return service.assess({ draft, salesContext, sourceText, now });
  }

  private generateBody(draft: FollowupDraft): string {
    const customer: string = draft.customerName ?? '本次客户';
    const progress: string = draft.progress ?? draft.summary;
    const nextAction: string = draft.nextAction ?? '待补充';
    const dueAt: string = draft.dueAt ?? '待补充';
    return `${customer}：${draft.summary}\n本次进展：${progress}` +
      `\n下一步：${nextAction}；截止时间：${dueAt}`;
  }

  private readText(
    values: JsonObject,
    key: string,
    fallback: string,
  ): string {
    const value: JsonValue | undefined = values[key];
    return typeof value === 'string' ? value : fallback;
  }

  private readNullableText(
    values: JsonObject,
    key: string,
    fallback: string | null,
  ): string | null {
    const value: JsonValue | undefined = values[key];
    if (typeof value !== 'string') return fallback;
    return value.trim().length > 0 ? value.trim() : null;
  }

  private readOptionalText(
    values: JsonObject,
    key: string,
    fallback: string | undefined,
  ): string | undefined {
    const value: JsonValue | undefined = values[key];
    if (typeof value !== 'string') return fallback;
    const normalized: string = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private readDueAt(
    values: JsonObject,
    fallback: string | null,
  ): string | null {
    const value: JsonValue | undefined = values.dueAt;
    if (typeof value !== 'string') return fallback;
    const normalized: string = value.trim();
    if (normalized.length === 0) return null;
    const withOffset: string = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u
      .test(normalized)
      ? `${normalized.replace(' ', 'T')}:00+08:00`
      : normalized;
    return this.normalizeDueAt(withOffset);
  }

  private normalizeDueAt(value: string | null | undefined): string | null {
    if (value === null) return null;
    if (value === undefined) return null;
    const normalized: string = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u
      .test(value)
      ? `${value.replace(' ', 'T')}:00+08:00`
      : value;
    const timestamp: number = Date.parse(normalized);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }

  private readParticipants(
    values: JsonObject,
    fallback: string[],
  ): string[] {
    const value: JsonValue | undefined = values.nextActionParticipants;
    if (typeof value !== 'string') return fallback;
    return value.split(PARTICIPANT_SEPARATOR)
      .map((participant: string): string => participant.trim())
      .filter((participant: string): boolean => participant.length > 0);
  }

  private readTaskSelection(
    values: JsonObject,
    candidates: FollowupTaskCandidate[],
  ): string[] {
    return candidates
      .filter((candidate: FollowupTaskCandidate, index: number): boolean =>
        candidate.status === 'ready' &&
        this.readBoolean(values[`task_${index}`]),
      )
      .map((candidate: FollowupTaskCandidate): string => candidate.id);
  }

  private readBoolean(value: JsonValue | undefined): boolean {
    return value === true || value === 'true' || value === 'on' ||
      value === '1';
  }
}

export { FollowupChatDraftService };
export type {
  CreateChatDraftPayloadInput,
  ReviewedChatDraft,
};
