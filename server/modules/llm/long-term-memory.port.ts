import type { JsonObject } from '@shared/api.interface';

export const LONG_TERM_MEMORY = Symbol('LONG_TERM_MEMORY');

export type LongTermMemoryCategory =
  | 'user_preference'
  | 'sales_workflow_preference'
  | 'communication_preference';

export interface LongTermMemoryScope {
  tenantId: string;
  actorOpenId: string;
  customerRef?: string;
}

export interface ApprovedLongTermMemoryInput {
  text: string;
  category: LongTermMemoryCategory;
  sourceRef: string;
  policyVersion: string;
  approved: boolean;
  approvedBy: string;
  expiresAt?: Date;
}

export interface LongTermMemoryWriteResult {
  status: 'disabled' | 'written';
  memoryIds: string[];
}

export interface LongTermMemoryItem {
  memoryId: string;
  text: string;
  score?: number;
  metadata: JsonObject;
}

export interface LongTermMemoryHealth {
  enabled: boolean;
  ready: boolean;
  reason?: string;
}

export interface LongTermMemoryPort {
  isEnabled(): boolean;
  addApprovedMemory(
    scope: LongTermMemoryScope,
    input: ApprovedLongTermMemoryInput,
  ): Promise<LongTermMemoryWriteResult>;
  search(
    scope: LongTermMemoryScope,
    query: string,
    limit?: number,
  ): Promise<LongTermMemoryItem[]>;
  delete(scope: LongTermMemoryScope, memoryId: string): Promise<boolean>;
  history(scope: LongTermMemoryScope, memoryId: string): Promise<JsonObject[]>;
  health(): Promise<LongTermMemoryHealth>;
}
