import type {
  CustomerCommunicationEvidence,
  CustomerCommunicationMaterial,
  CustomerCommunicationMaterialCategory,
  CustomerCommunicationMaterialSearch,
  CustomerCommunicationPendingMaterial,
  SalesMaterialSourceType,
} from '@shared/api.interface';
import type {
  SalesMaterialSourceConfig,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';

interface SalesMaterialDocument {
  sourceId: string;
  sourceType: SalesMaterialSourceType;
  title: string;
  url: string;
  content: string;
  sourceVersion: string;
  applicability: string;
  keywords: string[];
  categories: CustomerCommunicationMaterialCategory[];
  accessVerified: true;
}

type SalesMaterialReadStatus =
  | 'ready'
  | 'access_denied'
  | 'unsupported'
  | 'unavailable';

interface SalesMaterialReadResult {
  sourceId: string;
  status: SalesMaterialReadStatus;
  document?: SalesMaterialDocument;
  warning?: string;
}

interface SalesMaterialGateway {
  readSource(
    integration: TenantIntegration,
    actorOpenId: string,
    source: SalesMaterialSourceConfig,
  ): Promise<SalesMaterialReadResult>;
}

interface SalesMaterialRetrievalInput {
  integration: TenantIntegration;
  actorOpenId: string;
  pendingMaterials: CustomerCommunicationPendingMaterial[];
  evidence: CustomerCommunicationEvidence[];
}

interface SalesMaterialRetrievalResult {
  materials: CustomerCommunicationMaterial[];
  search: CustomerCommunicationMaterialSearch;
}

const SALES_MATERIAL_GATEWAY = Symbol('SALES_MATERIAL_GATEWAY');

export { SALES_MATERIAL_GATEWAY };
export type {
  SalesMaterialDocument,
  SalesMaterialGateway,
  SalesMaterialReadResult,
  SalesMaterialReadStatus,
  SalesMaterialRetrievalInput,
  SalesMaterialRetrievalResult,
};
