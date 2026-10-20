import { expect, it } from 'vitest';
import { MemoryControlStore } from '@server/modules/agent-core/memory-control.store';

it('rejects stale model results without overwriting the latest conditions', async () => {
  const store = new MemoryControlStore([]);
  const input = { tenantId: 'tenant', actorOpenId: 'actor', chatId: 'chat', sourceMessageId: 'message', rawText: '准备沟通', expiresAt: new Date(Date.now() + 60000), expectedRevision: 0 };
  await expect(store.savePreparationClarificationSession(input)).resolves.toMatchObject({ revision: 1 });
  await store.savePreparationClarificationSession({ ...input, rawText: '最新条件', expectedRevision: 1 });
  await expect(store.savePreparationClarificationSession({ ...input, rawText: '过期结果', expectedRevision: 1 })).rejects.toThrow('revision conflict');
  expect(await store.getOpenPreparationSession('tenant', 'actor', 'chat')).toMatchObject({ rawText: '最新条件', revision: 2 });
});

it('persists validated preparation conditions without sharing mutable values', async () => {
  const store = new MemoryControlStore([]);
  const input = { tenantId: 'tenant', actorOpenId: 'actor', chatId: 'chat', sourceMessageId: 'message', rawText: '准备沟通', expiresAt: new Date(Date.now() + 60000), preparationContext: { conditions: { customerName: '甲', communicationAt: null, purpose: '评审' }, turnCount: 2 } };
  await store.savePreparationClarificationSession(input);
  input.preparationContext.conditions.purpose = 'changed';
  expect(await store.getOpenPreparationSession('tenant', 'actor', 'chat')).toMatchObject({ preparationContext: { conditions: { purpose: '评审' }, turnCount: 2 } });
});

it('rejects an exceeded turn before overwriting the existing session', async () => {
  const store = new MemoryControlStore([]);
  const input = { tenantId: 'tenant', actorOpenId: 'actor', chatId: 'chat', sourceMessageId: 'message', rawText: '准备沟通', expiresAt: new Date(Date.now() + 60000), preparationContext: { conditions: { customerName: '甲', communicationAt: null, purpose: null }, turnCount: 1 } };
  await store.savePreparationClarificationSession(input);
  await expect(store.savePreparationClarificationSession({ ...input, preparationContext: { ...input.preparationContext, turnCount: 9 } })).rejects.toThrow();
  expect(await store.getOpenPreparationSession('tenant', 'actor', 'chat')).toMatchObject({ preparationContext: { turnCount: 1 } });
});
