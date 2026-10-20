import { Injectable } from '@nestjs/common';
import type { CustomerCommunicationPreparationResponse } from '@shared/api.interface';
import type { TenantIntegration } from '@server/modules/agent-core/agent.types';
import { parseCustomerPreparationRequest } from './customer-preparation-request';
import { CustomerPreparationAccessService } from './customer-preparation-access.service';
import { CustomerCommunicationPreparationService } from './customer-communication-preparation.service';

interface CustomerPreparationOrchestrationInput {
  integration: TenantIntegration;
  actorOpenId: string;
  request: unknown;
  selectedCustomerRecordId?: string;
  timezone: string;
  now: Date;
}

type CustomerPreparationOrchestrationResult =
  | { status: 'clarification_required'; reason: 'ambiguous' | 'not_found' | 'missing_fields'; candidates: Array<{ recordId: string; name: string }>; }
  | { status: 'unavailable'; reason: 'source_unavailable' | 'access_denied'; }
  | { status: 'ready'; preparation: CustomerCommunicationPreparationResponse };

@Injectable()
class CustomerPreparationOrchestratorService {
  constructor(
    private readonly access: CustomerPreparationAccessService,
    private readonly preparations: CustomerCommunicationPreparationService,
  ) {}

  async prepare(
    input: CustomerPreparationOrchestrationInput,
  ): Promise<CustomerPreparationOrchestrationResult> {
    const request = parseCustomerPreparationRequest(input.request);
    if (!request.communicationAt || !request.purpose) {
      return { status: 'clarification_required', reason: 'missing_fields', candidates: [] };
    }
    const dateParts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat('en-US', {
      timeZone: input.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(request.communicationAt));
    const datePart = (type: string): string =>
      dateParts.find((part: Intl.DateTimeFormatPart) => part.type === type)!.value;
    const referenceDate: string = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
    let resolution;
    try {
      resolution = await this.access.resolve(
        input.integration,
        input.actorOpenId,
        request.customerName,
      );
    } catch {
      return { status: 'unavailable', reason: 'access_denied' };
    }
    if (resolution.status === 'unavailable') {
      return { status: 'unavailable', reason: 'source_unavailable' };
    }
    const selected = input.selectedCustomerRecordId
      ? resolution.candidates.find((candidate) => candidate.recordId === input.selectedCustomerRecordId)
      : undefined;
    if ((input.selectedCustomerRecordId && !selected) ||
      (!input.selectedCustomerRecordId && resolution.status !== 'matched')) {
      return {
        status: 'clarification_required',
        reason: resolution.candidates.length > 0 ? 'ambiguous' : 'not_found',
        candidates: resolution.candidates,
      };
    }
    let preparation: CustomerCommunicationPreparationResponse;
    try {
      preparation = await this.preparations.generate({
      integration: input.integration,
      actorOpenId: input.actorOpenId,
      customerRecordId: selected?.recordId ?? resolution.candidates[0].recordId,
      purpose: request.purpose,
      referenceDate,
      timezone: input.timezone,
      now: input.now,
      });
    } catch {
      return { status: 'unavailable', reason: 'source_unavailable' };
    }
    if (preparation.status === 'unavailable') {
      return { status: 'unavailable', reason: 'source_unavailable' };
    }
    return { status: 'ready', preparation };
  }
}

export { CustomerPreparationOrchestratorService };
export type {
  CustomerPreparationOrchestrationInput,
  CustomerPreparationOrchestrationResult,
};
