import { describe, expect, it } from 'vitest';

import { MemoryControlStore } from '@server/modules/agent-core/memory-control.store';

describe('preparation clarification sessions', (): void => {
  it('keeps preparation state separate from followup collecting state', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([]);
    const now: Date = new Date();
    await store.savePreparationClarificationSession({
      tenantId: 'tenant-a', actorOpenId: 'user-a', chatId: 'chat-a',
      sourceMessageId: 'message-a', rawText: '准备和华南科技沟通',
      expiresAt: new Date(now.getTime() + 60_000),
    });

    expect(await store.getOpenSession('tenant-a', 'user-a')).toBeNull();
    await expect(store.getOpenPreparationSession('tenant-a', 'user-a'))
      .resolves.toMatchObject({
        state: 'preparation_clarifying',
        chatId: 'chat-a',
        draft: null,
      });
  });

  it('expires preparation state and isolates tenant and actor', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([]);
    await store.savePreparationClarificationSession({
      tenantId: 'tenant-a', actorOpenId: 'user-a', chatId: 'chat-a',
      sourceMessageId: 'message-a', rawText: '准备沟通',
      expiresAt: new Date(Date.now() - 1),
    });

    expect(await store.getOpenPreparationSession('tenant-a', 'user-a'))
      .toBeNull();
    expect(await store.getOpenPreparationSession('tenant-b', 'user-a'))
      .toBeNull();
    expect(await store.getOpenPreparationSession('tenant-a', 'user-b'))
      .toBeNull();
  });
});
