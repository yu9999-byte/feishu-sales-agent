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
    if (resolution.status !== 'matched') {
      return {
        status: 'clarification_required',
        reason: resolution.status,
        candidates: resolution.candidates,
      };
    }
    const preparation = await this.preparations.generate({
      integration: input.integration,
      actorOpenId: input.actorOpenId,
      customerRecordId: resolution.candidates[0].recordId,
      referenceDate: request.communicationAt,
      timezone: input.timezone,
      now: input.now,
    });
    return { status: 'ready', preparation };
  }
}

export { CustomerPreparationOrchestratorService };
export type {
  CustomerPreparationOrchestrationInput,
  CustomerPreparationOrchestrationResult,
};
