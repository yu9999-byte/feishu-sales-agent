import type { TodayActionOperationRequest, TodayActionState } from '@shared/api.interface';

interface TodayActionOperationScope {
  tenantId: string;
  memberId: string;
  actorOpenId: string;
}

interface TodayActionStateStore {
  read(scope: TodayActionOperationScope, itemId: string, itemVersion: string): Promise<TodayActionState | null>;
  apply(scope: TodayActionOperationScope, request: TodayActionOperationRequest, now: Date): Promise<TodayActionState>;
}

export type { TodayActionOperationScope, TodayActionStateStore };
