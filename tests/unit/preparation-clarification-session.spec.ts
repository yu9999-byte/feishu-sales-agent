import { describe, expect, it } from 'vitest';

import { MemoryControlStore } from '@server/modules/agent-core/memory-control.store';

describe('preparation clarification sessions', (): void => {
  it('preserves followup state and other chats when preparation is closed', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([]);
    const expiresAt: Date = new Date(Date.now() + 60_000);
    await store.saveIntentClarificationSession({ tenantId: 'tenant-a', actorOpenId: 'user-a', chatId: 'chat-a', sourceMessageId: 'followup', rawText: '跟进原文', expiresAt });
    for (const chatId of ['chat-a', 'chat-b']) {
      await store.savePreparationClarificationSession({ tenantId: 'tenant-a', actorOpenId: 'user-a', chatId, sourceMessageId: chatId, rawText: chatId, expiresAt });
    }
    expect(await store.getOpenSession('tenant-a', 'user-a')).toMatchObject({ rawText: '跟进原文' });
    expect(await store.getOpenPreparationSession('tenant-a', 'user-a', 'chat-a')).toMatchObject({ rawText: 'chat-a' });
    await store.closePreparationSession('tenant-a', 'user-a', 'chat-a');
    expect(await store.getOpenPreparationSession('tenant-a', 'user-a', 'chat-a')).toBeNull();
    expect(await store.getOpenPreparationSession('tenant-a', 'user-a', 'chat-b')).toMatchObject({ rawText: 'chat-b' });
    await store.closeSession('tenant-a', 'user-a');
    expect(await store.getOpenPreparationSession('tenant-a', 'user-a', 'chat-b')).not.toBeNull();
  });
  it('keeps preparation state separate from followup collecting state', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([]);
    const now: Date = new Date();
    await store.savePreparationClarificationSession({
      tenantId: 'tenant-a', actorOpenId: 'user-a', chatId: 'chat-a',
      sourceMessageId: 'message-a', rawText: '准备和华南科技沟通',
      expiresAt: new Date(now.getTime() + 60_000),
    });

    expect(await store.getOpenSession('tenant-a', 'user-a')).toBeNull();
    await expect(store.getOpenPreparationSession('tenant-a', 'user-a', 'chat-a'))
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

    expect(await store.getOpenPreparationSession('tenant-a', 'user-a', 'chat-a'))
      .toBeNull();
    expect(await store.getOpenPreparationSession('tenant-b', 'user-a', 'chat-a'))
      .toBeNull();
    expect(await store.getOpenPreparationSession('tenant-a', 'user-b', 'chat-a'))
      .toBeNull();
  });
});
