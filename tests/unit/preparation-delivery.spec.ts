import { expect, it } from 'vitest';
import { MemoryControlStore } from '@server/modules/agent-core/memory-control.store';
import type { CustomerCommunicationPreparationResponse } from '@shared/api.interface';

const report: CustomerCommunicationPreparationResponse = {
  referenceDate: '2026-10-20', timezone: 'Asia/Shanghai', status: 'empty',
  generatedAt: '2026-10-19T00:00:00Z', customer: null, objective: null,
  angles: [], questions: [], materials: [], drafts: [], evidence: [], warnings: [],
  materialSearch: { status: 'not_configured', configuredSourceCount: 0, checkedSourceCount: 0, trustedResultCount: 0, warnings: [] },
  coverage: { scope: 'self', customers: 'complete', opportunities: 'complete', followups: 'complete', taskPromises: 'agent_confirmed_only', associations: 'explicit_record_links_only' },
};

it('claims only one scoped delivery, freezes content, and never reclaims a sent result', async () => {
  const store = new MemoryControlStore([]);
  const session = await store.savePreparationClarificationSession({ tenantId: 't', actorOpenId: 'a', chatId: 'original', sourceMessageId: 'm', rawText: '准备', expectedRevision: 0, expiresAt: new Date(Date.now() + 60000) });
  const result = await store.completePreparationSession({ tenantId: 't', actorOpenId: 'a', chatId: 'original', expectedRevision: session.revision!, request: { customerName: '甲', communicationAt: null, purpose: null }, report });
  if (!result) throw new Error('Expected result');
  const input = { tenantId: 't', actorOpenId: 'a', resultId: result.id, text: 'first', now: new Date() };
  expect(await store.getPreparationDelivery(input)).toMatchObject({ status: 'pending' });
  expect(await store.getPreparationDelivery({ ...input, tenantId: 'other' })).toBeNull();
  expect(await store.getPreparationDelivery({ ...input, actorOpenId: 'other' })).toBeNull();
  expect(await store.claimPreparationDelivery({ ...input, actorOpenId: 'other' })).toBeNull();
  const claims = await Promise.all([store.claimPreparationDelivery(input), store.claimPreparationDelivery({ ...input, text: 'changed' })]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const lease = claims[0]!;
  expect(await store.getPreparationDelivery(input)).toMatchObject({ status: 'dispatching' });
  expect(lease).toMatchObject({ text: 'first', chatId: 'original' });
  expect(await store.finishPreparationDelivery({ ...input, token: 'wrong', messageId: 'msg' })).toBe(false);
  expect(await store.finishPreparationDelivery({ ...input, token: lease.token, messageId: 'msg' })).toBe(true);
  expect(await store.getPreparationDelivery(input)).toMatchObject({ status: 'sent' });
  expect(await store.claimPreparationDelivery({ ...input, now: new Date(Date.now() + 600000) })).toBeNull();
});

it('reconciles unknown as sent only with an exact current version and auditable evidence', async () => {
  const store = new MemoryControlStore([]);
  const session = await store.savePreparationClarificationSession({ tenantId: 't', actorOpenId: 'a', chatId: 'chat-r', sourceMessageId: 'm-r', rawText: '准备', expiresAt: new Date(Date.now() + 60000) });
  const result = await store.completePreparationSession({ tenantId: 't', actorOpenId: 'a', chatId: 'chat-r', expectedRevision: session.revision!, request: { customerName: '甲', communicationAt: null, purpose: null }, report });
  if (!result) throw new Error('Expected result');
  const scope = { tenantId: 't', actorOpenId: 'a', resultId: result.id };
  const lease = await store.claimPreparationDelivery({ ...scope, text: 'first', now: new Date() });
  if (!lease) throw new Error('Expected lease');
  expect(await store.finishPreparationDelivery({ ...scope, token: lease.token, messageId: null })).toBe(true);
  const current = await store.getPreparationDelivery(scope);
  if (current?.reconciliationVersion === undefined) throw new Error('Expected version');
  const input = { ...scope, operatorOpenId: 'a', expectedVersion: current.reconciliationVersion, messageId: 'verified-message', sentAt: new Date('2026-10-19T01:00:00Z'), note: '已从飞书会话核实消息发送成功', now: new Date('2026-10-19T02:00:00Z') };
  expect(await store.confirmPreparationDelivery({ ...input, expectedVersion: input.expectedVersion + 1 })).toBe(false);
  expect(await store.confirmPreparationDelivery(input)).toBe(true);
  expect(await store.getPreparationDelivery(scope)).toMatchObject({ status: 'sent', updatedAt: input.now.toISOString() });
  expect(await store.confirmPreparationDelivery(input)).toBe(false);
  expect(store.getAudits('t').filter((event) => event.eventType === 'preparation.delivery_reconciled')).toHaveLength(1);
});

it.each(['timeout', 'unknown'])('does not resend after %s', async (mode) => {
  const store = new MemoryControlStore([]);
  const session = await store.savePreparationClarificationSession({ tenantId: 't', actorOpenId: 'a', chatId: 'chat', sourceMessageId: 'm', rawText: '准备', expiresAt: new Date(Date.now() + 60000) });
  const result = await store.completePreparationSession({ tenantId: 't', actorOpenId: 'a', chatId: 'chat', expectedRevision: session.revision!, request: { customerName: '甲', communicationAt: null, purpose: null }, report });
  if (!result) throw new Error('Expected result');
  const input = { tenantId: 't', actorOpenId: 'a', resultId: result.id, text: 'first', now: new Date() };
  const lease = await store.claimPreparationDelivery(input);
  if (!lease) throw new Error('Expected lease');
  if (mode === 'unknown') expect(await store.finishPreparationDelivery({ ...input, token: lease.token, messageId: null })).toBe(true);
  expect(await store.claimPreparationDelivery({ ...input, now: new Date(input.now.getTime() + 300001) })).toBeNull();
  expect(await store.finishPreparationDelivery({ ...input, token: lease.token, messageId: 'late' })).toBe(false);
});
