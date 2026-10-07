import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  CustomerCommunicationPreparationResponse,
  CustomerVisitBriefingResponse,
} from '@shared/api.interface';
import type {
  CustomerVisitBriefingInput,
} from './customer-visit-briefing.service';
import { CustomerVisitBriefingService } from
  './customer-visit-briefing.service';
import {
  buildCustomerCommunicationPreparation,
} from './customer-communication-preparation-content';

type CustomerCommunicationPreparationInput = CustomerVisitBriefingInput;

interface CustomerCommunicationBriefingReader {
  generate(
    input: CustomerVisitBriefingInput,
  ): Promise<CustomerVisitBriefingResponse>;
}

const unavailableCoverage = (): CustomerCommunicationPreparationResponse[
  'coverage'
] => ({
  scope: 'self',
  customers: 'unavailable',
  opportunities: 'unavailable',
  followups: 'unavailable',
  taskPromises: 'unavailable',
  associations: 'explicit_record_links_only',
});

@Injectable()
class CustomerCommunicationPreparationService {
  private readonly logger: Logger = new Logger(
    CustomerCommunicationPreparationService.name,
  );

  constructor(
    @Inject(CustomerVisitBriefingService)
    private readonly briefings: CustomerCommunicationBriefingReader,
  ) {}

  async generate(
    input: CustomerCommunicationPreparationInput,
  ): Promise<CustomerCommunicationPreparationResponse> {
    const now: Date = input.now ?? new Date();
    try {
      const briefing: CustomerVisitBriefingResponse =
        await this.briefings.generate(input);
      return buildCustomerCommunicationPreparation(
        briefing,
        now.toISOString(),
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Customer communication briefing read failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
      );
      return {
        referenceDate: input.referenceDate,
        timezone: input.timezone,
        status: 'unavailable',
        generatedAt: now.toISOString(),
        customer: null,
        objective: null,
        angles: [],
        questions: [],
        materials: [],
        drafts: [],
        evidence: [],
        coverage: unavailableCoverage(),
        warnings: ['客户拜访攻略暂时不可用'],
      };
    }
  }
}

export { CustomerCommunicationPreparationService };
export type {
  CustomerCommunicationBriefingReader,
  CustomerCommunicationPreparationInput,
};
