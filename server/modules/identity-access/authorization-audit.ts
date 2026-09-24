import { createHash } from 'node:crypto';

import type {
  AuthorizationAuditInput,
  CreateAuthorizationAuditInput,
} from './identity-access.types';

const hashResourceRef = (
  tenantId: string,
  resourceRef: string | undefined,
): string | null => {
  if (resourceRef === undefined) {
    return null;
  }
  return createHash('sha256')
    .update(`${tenantId}:${resourceRef}`, 'utf8')
    .digest('hex');
};

const createAuthorizationAuditInput = (
  input: CreateAuthorizationAuditInput,
): AuthorizationAuditInput => ({
  tenantId: input.request.tenantId,
  traceId: input.traceId,
  actorMemberId: input.request.actorMemberId,
  roleSnapshot: [...input.roleSnapshot],
  action: input.request.action,
  resourceType: input.request.resourceType,
  resourceRefHash: hashResourceRef(
    input.request.tenantId,
    input.request.resourceRef,
  ),
  outcome: input.decision.allowed ? 'allowed' : 'denied',
  reasonCode: input.decision.reasonCode,
  policyVersion: input.decision.policyVersion,
  occurredAt: input.request.occurredAt.toISOString(),
});

export { createAuthorizationAuditInput };
