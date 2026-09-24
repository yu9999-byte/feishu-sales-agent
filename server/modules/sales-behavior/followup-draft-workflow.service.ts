import { Inject, Injectable } from '@nestjs/common';

import type {
  FollowupDraft,
  FollowupTaskCandidate,
} from '@shared/api.interface';
import {
  FOLLOWUP_EXTRACTOR,
  type FollowupExtractor,
} from '@server/modules/agent-core/agent.ports';
import {
  FOLLOWUP_DRAFT_REPOSITORY,
  type FollowupDraftRecord,
  type FollowupDraftRepository,
  type FollowupSourceType,
} from './followup-draft.repository';
import { FollowupQualityService } from './followup-quality.service';
import type {
  FollowupEvidenceInput,
  FollowupQualityInput,
  FollowupQualityResult,
} from './sales-behavior.types';
import {
  buildFollowupTaskCandidates,
} from './followup-task-preview';

interface CreateFollowupDraftCommand {
  tenantId: string;
  ownerMemberId: string;
  sourceType: FollowupSourceType;
  text: string;
  idempotencyKey: string;
  timezone: string;
  now: Date;
}

interface EditFollowupDraftCommand {
  tenantId: string;
  ownerMemberId: string;
  draftId: string;
  expectedVersion: number;
  generatedBody: string;
  draft: FollowupDraft;
  now: Date;
}

class FollowupDraftConflictError extends Error {
  readonly code = 'DRAFT_CONFLICT' as const;

  constructor() {
    super('草案已更新或无权访问，请刷新后重试');
    this.name = 'FollowupDraftConflictError';
  }
}

@Injectable()
class FollowupDraftWorkflowService {
  constructor(
    @Inject(FOLLOWUP_EXTRACTOR)
    private readonly extractor: FollowupExtractor,
    @Inject(FOLLOWUP_DRAFT_REPOSITORY)
    private readonly repository: FollowupDraftRepository,
    private readonly quality: FollowupQualityService,
  ) {}

  async create(
    command: CreateFollowupDraftCommand,
  ): Promise<FollowupDraftRecord> {
    const sourceText: string = command.text.trim();
    if (sourceText.length === 0) {
      throw new Error('EMPTY_SOURCE');
    }
    const draft: FollowupDraft = await this.extractor.extract({
      currentText: sourceText,
      combinedText: sourceText,
      previousDraft: null,
      timezone: command.timezone,
      now: command.now,
    });
    const generatedBody: string = this.generateBody(draft);
    const quality: FollowupQualityResult = this.quality.review(
      this.qualityInput(
        sourceText, generatedBody, draft, command.sourceType,
      ),
      command.now,
    );
    const record: FollowupDraftRecord =
      await this.repository.createGeneratedDraft({
      tenantId: command.tenantId,
      ownerMemberId: command.ownerMemberId,
      sourceType: command.sourceType,
      idempotencyKey: command.idempotencyKey,
      sourceText,
      generatedBody,
      draft,
      quality,
      createdAt: command.now,
    });
    if (
      record.sourceType !== command.sourceType ||
      record.version.sourceText !== sourceText
    ) {
      throw new FollowupDraftConflictError();
    }
    return this.withTaskCandidates(record, command.now);
  }

  async edit(
    command: EditFollowupDraftCommand,
  ): Promise<FollowupDraftRecord> {
    const current: FollowupDraftRecord | null =
      await this.repository.getDraft(command.tenantId, command.draftId);
    if (
      current === null ||
      current.ownerMemberId !== command.ownerMemberId ||
      current.status !== 'pendingConfirmation'
    ) {
      throw new FollowupDraftConflictError();
    }
    const generatedBody: string = command.generatedBody.trim();
    if (generatedBody.length === 0) {
      throw new Error('EMPTY_GENERATED_BODY');
    }
    const quality: FollowupQualityResult = this.quality.review(
      this.qualityInput(
        current.version.sourceText,
        generatedBody,
        command.draft,
        current.sourceType,
      ),
      command.now,
    );
    const updated: FollowupDraftRecord | null =
      await this.repository.appendUserEdit({
        tenantId: command.tenantId,
        draftId: command.draftId,
        ownerMemberId: command.ownerMemberId,
        expectedVersion: command.expectedVersion,
        generatedBody,
        draft: command.draft,
        quality,
        createdAt: command.now,
      });
    if (updated === null) {
      throw new FollowupDraftConflictError();
    }
    return this.withTaskCandidates(updated, command.now);
  }

  async getOwned(
    tenantId: string,
    ownerMemberId: string,
    draftId: string,
  ): Promise<FollowupDraftRecord> {
    const record: FollowupDraftRecord | null =
      await this.repository.getDraft(tenantId, draftId);
    if (record === null || record.ownerMemberId !== ownerMemberId) {
      throw new FollowupDraftConflictError();
    }
    return this.withTaskCandidates(record, new Date());
  }

  private generateBody(draft: FollowupDraft): string {
    const customer: string = draft.customerName ?? '本次客户';
    const progress: string = draft.progress ?? draft.summary;
    const nextAction: string = draft.nextAction ?? '待补充';
    const dueAt: string = draft.dueAt ?? '待补充';
    return `${customer}：${draft.summary}\n本次进展：${progress}\n下一步：${nextAction}；截止时间：${dueAt}`;
  }

  private withTaskCandidates(
    record: FollowupDraftRecord,
    now: Date,
  ): FollowupDraftRecord {
    const taskCandidates: FollowupTaskCandidate[] =
      buildFollowupTaskCandidates({
        draftId: record.id,
        version: record.currentVersion,
        ownerMemberId: record.ownerMemberId,
        draft: record.version.draft,
        now,
      });
    return {
      ...record,
      version: {
        ...record.version,
        taskCandidates,
      },
    };
  }

  private qualityInput(
    sourceText: string,
    generatedBody: string,
    draft: FollowupDraft,
    sourceType: FollowupSourceType,
  ): FollowupQualityInput {
    const formHeader: string = sourceType === 'card_form'
      ? sourceText.split('沟通内容：', 1)[0]
      : '';
    const formValue = (label: string): string | null => {
      const prefix: string = `${label}：`;
      const line: string | undefined = formHeader.split('\n').find(
        (candidate: string): boolean => candidate.startsWith(prefix),
      );
      return line?.slice(prefix.length).trim() || null;
    };
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
      communicationMethod: formValue('沟通方式'),
      communicationAt: formValue('沟通时间'),
      topic: formValue('主题') ?? draft.opportunityName,
      agreements: [],
      decisionChain: [],
      competitors: [],
      nextActionOwner: null,
      nextActionParticipants: draft.nextActionParticipants ?? [],
      evidence,
    };
  }
}

export {
  FollowupDraftConflictError,
  FollowupDraftWorkflowService,
};
export type {
  CreateFollowupDraftCommand,
  EditFollowupDraftCommand,
};
