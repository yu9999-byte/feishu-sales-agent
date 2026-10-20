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

it('atomically saves a preparation result once and isolates reads', async () => {
  const store = new MemoryControlStore([]);
  const session = await store.savePreparationClarificationSession({ tenantId: 'tenant', actorOpenId: 'actor', chatId: 'chat', sourceMessageId: 'source', rawText: '准备', expectedRevision: 0, expiresAt: new Date(Date.now() + 60000) });
  const input = { tenantId: 'tenant', actorOpenId: 'actor', chatId: 'chat', expectedRevision: session.revision!, request: { customerName: '甲', communicationAt: '2026-10-20T10:00:00+08:00', purpose: '评审' }, report };
  const result = await store.completePreparationSession(input);
  expect(result).not.toBeNull();
  if (!result) throw new Error('Expected snapshot');
  expect(await store.getOpenPreparationSession('tenant', 'actor', 'chat')).toBeNull();
  expect(await store.completePreparationSession(input)).toBeNull();
  expect(await store.getPreparationResult('other', 'actor', result.id)).toBeNull();
  expect(await store.getPreparationResult('tenant', 'other', result.id)).toBeNull();
  result.request.purpose = 'mutated';
  expect(await store.getPreparationResult('tenant', 'actor', result.id)).toMatchObject({ request: { purpose: '评审' }, revision: 1 });
  const duplicate = await store.savePreparationClarificationSession({ tenantId: 'tenant', actorOpenId: 'actor', chatId: 'other-chat', sourceMessageId: 'source', rawText: '重复', expectedRevision: 0, expiresAt: new Date(Date.now() + 60000) });
  await expect(store.completePreparationSession({ ...input, chatId: 'other-chat', expectedRevision: duplicate.revision! }))
    .rejects.toThrow('Duplicate preparation result source');
  expect(await store.getOpenPreparationSession('tenant', 'actor', 'other-chat'))
    .toMatchObject({ revision: duplicate.revision, state: 'preparation_clarifying' });
});

it.each(['cancel', 'expired', 'stale'])('rejects %s completion without creating a result', async (mode) => {
  const store = new MemoryControlStore([]);
  await store.savePreparationClarificationSession({ tenantId: 'tenant', actorOpenId: 'actor', chatId: 'chat', sourceMessageId: 'source', rawText: '准备', expectedRevision: 0, expiresAt: new Date(Date.now() + (mode === 'expired' ? -60000 : 60000)) });
  if (mode === 'cancel') await store.closePreparationSession('tenant', 'actor', 'chat');
  expect(await store.completePreparationSession({ tenantId: 'tenant', actorOpenId: 'actor', chatId: 'chat', expectedRevision: mode === 'stale' ? 0 : 1, request: { customerName: '甲', communicationAt: null, purpose: null }, report })).toBeNull();
});

it('saves only allowed draft edits with CAS, isolated ownership and immutable facts', async () => {
  const store = new MemoryControlStore([]);
  const session = await store.savePreparationClarificationSession({ tenantId: 'tenant', actorOpenId: 'actor', chatId: 'edit-chat', sourceMessageId: 'edit-source', rawText: '准备', expectedRevision: 0, expiresAt: new Date(Date.now() + 60000) });
  const original: CustomerCommunicationPreparationResponse = { ...report, drafts: [{ channel: 'email', title: '邮件', subject: '原主题', body: '原正文', editable: true, execution: 'preview_only', sourceKeys: [] }] };
  const result = await store.completePreparationSession({ tenantId: 'tenant', actorOpenId: 'actor', chatId: 'edit-chat', expectedRevision: session.revision!, request: { customerName: '甲', communicationAt: null, purpose: null }, report: original });
  if (!result) throw new Error('Expected result');
  const input = { tenantId: 'tenant', actorOpenId: 'actor', id: result.id, edit: { channel: 'email' as const, subject: '新主题', body: '新正文', expectedRevision: 1 } };
  expect(await store.savePreparationDraft({ ...input, tenantId: 'other' })).toBeNull();
  expect(await store.savePreparationDraft({ ...input, actorOpenId: 'other' })).toBeNull();
  expect(await store.savePreparationDraft({ ...input, edit: { ...input.edit, channel: 'feishu', subject: null } })).toBeNull();
  expect(store.getAudits()).toHaveLength(0);
  const results = await Promise.all([store.savePreparationDraft(input), store.savePreparationDraft(input)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(store.getAudits()).toHaveLength(1);
  expect(store.getAudits()[0]).toMatchObject({ eventType: 'preparation.draft_saved',
    tenantId: 'tenant', actorOpenId: 'actor', entityId: result.id,
    details: { channel: 'email', revision: 2 } });
  expect(await store.getPreparationResult('tenant', 'actor', result.id)).toMatchObject({
    revision: 2, report: original,
    draftEdits: [{ channel: 'email', subject: '新主题', body: '新正文' }],
  });
  expect(await store.savePreparationDraft({ ...input, edit: { ...input.edit, body: '第三版', expectedRevision: 2 } }))
    .toMatchObject({ revision: 3, draftEdits: [{ channel: 'email', body: '第三版' }] });
});
