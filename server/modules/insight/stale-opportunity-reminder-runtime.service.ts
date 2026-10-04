import { Inject, Injectable } from '@nestjs/common';

import type {
  StaleOpportunityReminderPreflightResponse,
  StaleOpportunityReminderRuntimeBlockReason,
} from '@shared/api.interface';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import type {
  StaleOpportunityReminderUncertainReader,
} from './stale-opportunity-reminder.service';

const STALE_OPPORTUNITY_REMINDER_UNCERTAIN_READER = Symbol(
  'STALE_OPPORTUNITY_REMINDER_UNCERTAIN_READER',
);

interface StaleOpportunityReminderRuntimePreparationInput {
  now?: Date;
}

type StaleOpportunityReminderRuntimePreparationResult =
  StaleOpportunityReminderPreflightResponse;

@Injectable()
class StaleOpportunityReminderRuntimeService {
  constructor(
    @Inject(AGENT_CONFIG)
    private readonly config: AgentRuntimeConfig,
    @Inject(STALE_OPPORTUNITY_REMINDER_UNCERTAIN_READER)
    private readonly uncertainReader: StaleOpportunityReminderUncertainReader,
  ) {}

  async prepare(
    input: StaleOpportunityReminderRuntimePreparationInput = {},
  ): Promise<StaleOpportunityReminderRuntimePreparationResult> {
    const checkedAt: string = (input.now ?? new Date()).toISOString();
    const reminder = this.config.staleOpportunityReminder;
    if (reminder?.enabled !== true) {
      return {
        status: 'disabled',
        checkedAt,
        reasons: [],
        uncertainDeliveryFound: false,
      };
    }

    const staticReasons: StaleOpportunityReminderRuntimeBlockReason[] =
      this.staticBlockReasons();
    if (staticReasons.length > 0) {
      return {
        status: 'blocked',
        checkedAt,
        reasons: staticReasons,
        uncertainDeliveryFound: false,
      };
    }

    let uncertainDeliveryFound: boolean;
    try {
      const records = await this.uncertainReader.listUncertain({ limit: 1 });
      uncertainDeliveryFound = records.length > 0;
    } catch (_error: unknown) {
      return {
        status: 'blocked',
        checkedAt,
        reasons: ['reconciliation_unavailable'],
        uncertainDeliveryFound: false,
      };
    }
    if (uncertainDeliveryFound) {
      return {
        status: 'blocked',
        checkedAt,
        reasons: ['uncertain_delivery_present'],
        uncertainDeliveryFound: true,
      };
    }
    return {
      status: 'ready',
      checkedAt,
      reasons: [],
      uncertainDeliveryFound: false,
    };
  }

  private staticBlockReasons(): StaleOpportunityReminderRuntimeBlockReason[] {
    const reasons: StaleOpportunityReminderRuntimeBlockReason[] = [];
    const scan = this.config.staleOpportunityScan;
    const reminder = this.config.staleOpportunityReminder;
    if (scan?.enabled !== true) {
      reasons.push('scan_disabled');
    }
    if (!scan?.triggerToken?.trim()) {
      reasons.push('trigger_token_missing');
    }
    if (reminder?.historyGovernanceReady !== true) {
      reasons.push('history_governance_incomplete');
    }
    if (reminder?.senderConfigured !== true) {
      reasons.push('sender_unconfigured');
    }
    return reasons;
  }
}

export {
  STALE_OPPORTUNITY_REMINDER_UNCERTAIN_READER,
  StaleOpportunityReminderRuntimeService,
};
export type {
  StaleOpportunityReminderRuntimeBlockReason,
  StaleOpportunityReminderRuntimePreparationInput,
  StaleOpportunityReminderRuntimePreparationResult,
};
