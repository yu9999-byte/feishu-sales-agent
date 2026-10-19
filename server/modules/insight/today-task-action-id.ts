import { createHash } from 'node:crypto';

const todayTaskActionId = (tenantId: string, memberId: string,
  itemId: string, itemVersion: string, idempotencyKey: string): string => {
  const bytes: Buffer = createHash('sha256').update(JSON.stringify([
    'today-task', tenantId, memberId, itemId, itemVersion, idempotencyKey,
  ])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20)].join('-');
};

export { todayTaskActionId };
