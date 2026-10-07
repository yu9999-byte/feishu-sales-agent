import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import type {
  CustomerCommunicationMaterial,
  CustomerCommunicationPreparationResponse,
  CustomerCommunicationPendingMaterial,
  CustomerVisitBriefingResponse,
} from '@shared/api.interface';
import type { SalesMaterialRetrievalResult } from
  '@server/modules/knowledge/sales-material.ports';
import { SalesMaterialRetrievalService } from
  '@server/modules/knowledge/sales-material-retrieval.service';
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

interface CustomerCommunicationMaterialRetriever {
  retrieve(input: {
    integration: CustomerCommunicationPreparationInput['integration'];
    actorOpenId: string;
    pendingMaterials: CustomerCommunicationPendingMaterial[];
    evidence: CustomerCommunicationPreparationResponse['evidence'];
  }): Promise<SalesMaterialRetrievalResult>;
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
    @Optional()
    @Inject(SalesMaterialRetrievalService)
    private readonly materialRetrieval?: CustomerCommunicationMaterialRetriever,
  ) {}

  async generate(
    input: CustomerCommunicationPreparationInput,
  ): Promise<CustomerCommunicationPreparationResponse> {
    const now: Date = input.now ?? new Date();
    let briefing: CustomerVisitBriefingResponse;
    try {
      briefing = await this.briefings.generate(input);
    } catch (error: unknown) {
      this.logger.warn(
        `Customer communication briefing read failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
      );
      return this.unavailableResponse(input, now);
    }

    const preparation: CustomerCommunicationPreparationResponse =
      buildCustomerCommunicationPreparation(briefing, now.toISOString());
    if (
      this.materialRetrieval === undefined ||
      preparation.status === 'empty' ||
      preparation.status === 'unavailable'
    ) {
      return preparation;
    }
    const pendingMaterials: CustomerCommunicationPendingMaterial[] =
      preparation.materials.filter(
        (
          material: CustomerCommunicationMaterial,
        ): material is CustomerCommunicationPendingMaterial =>
          material.status === 'material_pending',
      );
    try {
      const retrieval: SalesMaterialRetrievalResult =
        await this.materialRetrieval.retrieve({
          integration: input.integration,
          actorOpenId: input.actorOpenId,
          pendingMaterials,
          evidence: preparation.evidence,
        });
      return {
        ...preparation,
        materials: retrieval.materials,
        materialSearch: retrieval.search,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Sales material retrieval failed and was withheld (${error instanceof Error
          ? error.name
          : 'UnknownError'})`,
      );
      return {
        ...preparation,
        materialSearch: {
          status: 'unavailable',
          configuredSourceCount: input.integration.base.knowledge?.sources.length
            ?? 0,
          checkedSourceCount: 0,
          trustedResultCount: 0,
          warnings: ['销售资料库暂时不可用'],
        },
      };
    }
  }

  private unavailableResponse(
    input: CustomerCommunicationPreparationInput,
    now: Date,
  ): CustomerCommunicationPreparationResponse {
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
      materialSearch: {
        status: 'unavailable',
        configuredSourceCount: input.integration.base.knowledge?.sources.length
          ?? 0,
        checkedSourceCount: 0,
        trustedResultCount: 0,
        warnings: ['销售资料库暂时不可用'],
      },
      drafts: [],
      evidence: [],
      coverage: unavailableCoverage(),
      warnings: ['客户拜访攻略暂时不可用'],
    };
  }
}

export { CustomerCommunicationPreparationService };
export type {
  CustomerCommunicationBriefingReader,
  CustomerCommunicationMaterialRetriever,
  CustomerCommunicationPreparationInput,
};
