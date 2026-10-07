import type { SalesKnowledgeQaResponse } from '@shared/api.interface';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';

interface SalesKnowledgeQaInput {
  integration: TenantIntegration;
  actorOpenId: string;
  question: string;
}

type SalesKnowledgeQaResult = SalesKnowledgeQaResponse;

interface SalesKnowledgeQaReader {
  answer(input: SalesKnowledgeQaInput): Promise<SalesKnowledgeQaResult>;
}

const SALES_KNOWLEDGE_QA = Symbol('SALES_KNOWLEDGE_QA');

export { SALES_KNOWLEDGE_QA };
export type {
  SalesKnowledgeQaInput,
  SalesKnowledgeQaReader,
  SalesKnowledgeQaResult,
};
