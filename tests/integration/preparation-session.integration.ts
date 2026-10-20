import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresControlStore } from '@server/modules/control-store/postgres-control.store';
import type { CustomerCommunicationPreparationResponse } from '@shared/api.interface';

loadEnvironment({ path: ['.env.local', '.env'], quiet: true });
const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const sql: Sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, onnotice: (): void => undefined });
const workerASql: Sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, onnotice: (): void => undefined });
const workerBSql: Sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, onnotice: (): void => undefined });
const tenantId: string = '10000000-0000-4000-8000-000000000025';
const isolatedTenantId: string = '10000000-0000-4000-8000-000000000026';
const store: PostgresControlStore = new PostgresControlStore(sql);
const workerA: PostgresControlStore = new PostgresControlStore(workerASql);
const workerB: PostgresControlStore = new PostgresControlStore(workerBSql);

describe('independent PostgreSQL preparation sessions', (): void => {
  beforeAll(async (): Promise<void> => {
    await sql.unsafe(await readFile('migrations/025_preparation_sessions.sql', 'utf8'));
    await sql.unsafe(await readFile('migrations/026_preparation_context.sql', 'utf8'));
    await sql.unsafe(await readFile('migrations/027_preparation_revision.sql', 'utf8'));
    await sql.unsafe(await readFile('migrations/028_preparation_results.sql', 'utf8'));
    await sql.unsafe(await readFile('migrations/029_preparation_draft_edits.sql', 'utf8'));
    await sql.unsafe(await readFile('migrations/030_preparation_result_deliveries.sql', 'utf8'));
    await sql.unsafe(await readFile('migrations/031_preparation_delivery_reconciliation.sql', 'utf8'));
    await sql`INSERT INTO agent_tenants (id, feishu_tenant_key, name)
      VALUES (${tenantId}, 'preparation-session-integration', 'Preparation integration')`;
    await sql`INSERT INTO agent_tenants (id, feishu_tenant_key, name)
      VALUES (${isolatedTenantId}, 'preparation-idempotency-integration', 'Preparation idempotency integration')`;
  });
  afterAll(async (): Promise<void> => {
    try { await sql`DELETE FROM agent_tenants WHERE id = ${tenantId}`; }
    finally {
      try { await sql`DELETE FROM agent_tenants WHERE id = ${isolatedTenantId}`; }
      finally { await Promise.all([sql.end(), workerASql.end(), workerBSql.end()]); }
    }
  });
  it('claims a duplicate inbound message once across independent PostgreSQL stores', async (): Promise<void> => {
    const messageId: string = `preparation-concurrent-${randomUUID()}`;
    const [backendA, backendB]: Array<{ pid: number }[]> = await Promise.all([
      workerASql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`,
      workerBSql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`,
    ]);
    expect(backendA[0]?.pid).not.toBe(backendB[0]?.pid);

    const claims: boolean[] = await Promise.all([
      workerA.claimMessage(tenantId, messageId),
      workerB.claimMessage(tenantId, messageId),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const rows: Array<{ count: string }> = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM processed_messages
      WHERE tenant_id = ${tenantId} AND message_id = ${messageId}
    `;
    expect(rows[0]?.count).toBe('1');

    expect(await workerB.claimMessage(isolatedTenantId, messageId)).toBe(true);
    expect(await workerA.claimMessage(isolatedTenantId, messageId)).toBe(false);
  });
  it('preserves followup and isolates chat, actor, cancellation and expiry', async (): Promise<void> => {
    const expiresAt: Date = new Date(Date.now() + 60_000);
    await store.saveIntentClarificationSession({ tenantId, actorOpenId: 'actor-a', chatId: 'chat-a', sourceMessageId: 'followup', rawText: 'followup', expiresAt });
    for (const chatId of ['chat-a', 'chat-b']) {
      await store.savePreparationClarificationSession({ tenantId, actorOpenId: 'actor-a', chatId, sourceMessageId: chatId, rawText: chatId, expiresAt });
    }
    expect(await store.getOpenSession(tenantId, 'actor-a')).toMatchObject({ rawText: 'followup' });
    expect(await store.getOpenPreparationSession(tenantId, 'actor-b', 'chat-a')).toBeNull();
    expect(await store.getOpenPreparationSession(tenantId, 'actor-a', 'chat-a')).toMatchObject({ rawText: 'chat-a' });
    await store.closePreparationSession(tenantId, 'actor-a', 'chat-a');
    expect(await store.getOpenPreparationSession(tenantId, 'actor-a', 'chat-a')).toBeNull();
    await store.closeSession(tenantId, 'actor-a');
    expect(await store.getOpenPreparationSession(tenantId, 'actor-a', 'chat-b')).toMatchObject({ rawText: 'chat-b' });
    await store.savePreparationClarificationSession({ tenantId, actorOpenId: 'actor-a', chatId: 'chat-b', sourceMessageId: 'expired', rawText: 'expired', expiresAt: new Date(Date.now() - 1) });
    expect(await store.getOpenPreparationSession(tenantId, 'actor-a', 'chat-b')).toBeNull();
  });
  it('round trips validated conditions and rejects an invalid update', async () => {
    const input = { tenantId, actorOpenId: 'context-actor', chatId: 'context-chat', sourceMessageId: 'context-message', rawText: '准备评审', expiresAt: new Date(Date.now() + 60000), preparationContext: { conditions: { customerName: '甲', communicationAt: null, purpose: '评审' }, turnCount: 2 } };
    Object.assign(input.preparationContext, { candidates: [{ recordId: 'c1', name: '甲' }] });
    await store.savePreparationClarificationSession(input);
    expect(await store.getOpenPreparationSession(tenantId, 'context-actor', 'context-chat')).toMatchObject({ preparationContext: input.preparationContext });
    await expect(store.savePreparationClarificationSession({ ...input, preparationContext: { ...input.preparationContext, turnCount: 9 } })).rejects.toThrow();
    expect(await store.getOpenPreparationSession(tenantId, 'context-actor', 'context-chat')).toMatchObject({ preparationContext: { turnCount: 2 } });
  });
  it('completes one revision atomically and scopes the stored result', async () => {
    const session = await store.savePreparationClarificationSession({ tenantId, actorOpenId: 'result-actor', chatId: 'result-chat', sourceMessageId: 'result-source', rawText: '准备', expectedRevision: 0, expiresAt: new Date(Date.now() + 60000) });
    const report = { referenceDate: '2026-10-20', timezone: 'Asia/Shanghai', status: 'empty' as const, generatedAt: new Date().toISOString(), customer: null, objective: null, angles: [], questions: [], materials: [], drafts: [], evidence: [], warnings: [], materialSearch: { status: 'not_configured' as const, configuredSourceCount: 0, checkedSourceCount: 0, trustedResultCount: 0, warnings: [] }, coverage: { scope: 'self' as const, customers: 'complete' as const, opportunities: 'complete' as const, followups: 'complete' as const, taskPromises: 'agent_confirmed_only' as const, associations: 'explicit_record_links_only' as const } };
    const input = { tenantId, actorOpenId: 'result-actor', chatId: 'result-chat', expectedRevision: session.revision!, request: { customerName: '甲', communicationAt: null, purpose: null }, report };
    const results = await Promise.all([store.completePreparationSession(input), store.completePreparationSession(input)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const result = results.find(Boolean);
    if (!result) throw new Error('Expected result');
    expect(await store.getOpenPreparationSession(tenantId, input.actorOpenId, input.chatId)).toBeNull();
    expect(await store.getPreparationResult(tenantId, 'other-actor', result.id)).toBeNull();
    expect(await store.getPreparationResult('10000000-0000-4000-8000-000000000099', input.actorOpenId, result.id)).toBeNull();
    expect(await store.getPreparationResult(tenantId, input.actorOpenId, result.id)).toEqual(result);
    const deliveryInput = { tenantId, actorOpenId: input.actorOpenId, resultId: result.id, text: 'frozen', now: new Date() };
    expect(await store.getPreparationDelivery(deliveryInput)).toMatchObject({ status: 'pending' });
    expect(await store.getPreparationDelivery({ ...deliveryInput, actorOpenId: 'other' })).toBeNull();
    expect(await store.claimPreparationDelivery({ ...deliveryInput, actorOpenId: 'other' })).toBeNull();
    const claims = await Promise.all([store.claimPreparationDelivery(deliveryInput), store.claimPreparationDelivery({ ...deliveryInput, text: 'changed' })]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const lease = claims.find(Boolean);
    if (!lease) throw new Error('Expected lease');
    expect(lease).toMatchObject({ text: 'frozen', chatId: input.chatId });
    expect(await store.finishPreparationDelivery({ ...deliveryInput, token: '10000000-0000-4000-8000-000000000099', messageId: 'bad' })).toBe(false);
    expect(await store.finishPreparationDelivery({ ...deliveryInput, token: lease.token, messageId: 'sent-message' })).toBe(true);
    expect(await store.getPreparationDelivery(deliveryInput)).toMatchObject({ status: 'sent' });
    expect(await store.claimPreparationDelivery({ ...deliveryInput, now: new Date(Date.now() + 600000) })).toBeNull();
    const duplicateSession = await store.savePreparationClarificationSession({
      tenantId, actorOpenId: input.actorOpenId, chatId: 'duplicate-result-chat',
      sourceMessageId: 'result-source', rawText: '重复来源', expectedRevision: 0,
      expiresAt: new Date(Date.now() + 60000),
    });
    await expect(store.completePreparationSession({
      ...input, chatId: 'duplicate-result-chat', expectedRevision: duplicateSession.revision!,
    })).rejects.toThrow();
    expect(await store.getOpenPreparationSession(tenantId, input.actorOpenId, 'duplicate-result-chat'))
      .toMatchObject({ revision: duplicateSession.revision, state: 'preparation_clarifying' });
    expect(await store.getPreparationResult(tenantId, input.actorOpenId, result.id)).toEqual(result);
  });
  it('preserves complete briefing and decision evidence across connections and draft edits', async () => {
    const actorOpenId: string = 'content-actor';
    const session = await workerA.savePreparationClarificationSession({
      tenantId, actorOpenId, chatId: 'content-chat', sourceMessageId: 'content-source',
      rawText: '准备采购评审', expectedRevision: 0,
      expiresAt: new Date(Date.now() + 60000),
    });
    const customerSource = {
      recordId: 'customer-content', recordUrl: 'https://example.test/customer/content', sourceVersion: 'c-v1',
    };
    const opportunitySource = {
      recordId: 'opportunity-content', recordUrl: 'https://example.test/opportunity/content', sourceVersion: 'o-v1',
    };
    const report: CustomerCommunicationPreparationResponse = {
      referenceDate: '2026-10-20', timezone: 'Asia/Shanghai', status: 'partial',
      generatedAt: '2026-10-20T01:00:00.000Z',
      customer: { recordId: customerSource.recordId, name: '采购评审客户', contactName: null,
        latestSummary: '待确认采购范围', lastFollowupAt: null, source: customerSource },
      briefing: {
        metrics: { relatedOpportunityCount: 1, activeOpportunityCount: 1,
          riskOpportunityCount: 1, totalFollowupCount: 11, knownActiveExpectedAmount: 200000 },
        opportunities: [{
          recordId: opportunitySource.recordId, name: '年度采购', lifecycleStatus: 'active',
          expectedAmount: 200000, progress: '等待评审', nextAction: null, dueAt: null,
          health: 'at_risk', source: opportunitySource,
          risks: [{ code: 'confirmed_task_overdue', severity: 'high', title: '承诺已逾期',
            detail: '待核实履约情况', evidenceIds: ['task-promise:old'] }],
          gaps: [], recommendation: { action: '核实履约情况', reason: '承诺已逾期',
            dueAt: null, evidenceIds: ['task-promise:old'], requiresConfirmation: true },
          evidence: [{ id: 'task-promise:old', kind: 'task_promise', label: '已确认任务',
            value: '提交接口清单', occurredAt: '2026-10-01T01:00:00.000Z', source: null }],
        }],
        recentFollowups: [{ recordId: 'followup-content', opportunityRecordId: opportunitySource.recordId,
          opportunityName: '年度采购', summary: '客户要求核实验收范围',
          communicationAt: '2026-10-19T01:00:00.000Z', nextAction: '准备验收清单', dueAt: null,
          source: { recordId: 'followup-content', recordUrl: null, sourceVersion: 'f-v2' } }],
        agenda: [{ sequence: 1, title: '对齐验收范围', purpose: '确认待核实事项' }],
      },
      objective: null, angles: [], questions: [], materials: [], evidence: [],
      drafts: [{ channel: 'feishu', title: '开场话术', subject: null, body: '原始话术',
        editable: true, execution: 'preview_only', sourceKeys: [] }],
      warnings: ['跟进来源不完整'],
      materialSearch: { status: 'not_configured', configuredSourceCount: 0,
        checkedSourceCount: 0, trustedResultCount: 0, warnings: [] },
      coverage: { scope: 'self', customers: 'complete', opportunities: 'complete',
        followups: 'partial', taskPromises: 'agent_confirmed_only', associations: 'explicit_record_links_only' },
    };
    const result = await workerA.completePreparationSession({ tenantId, actorOpenId,
      chatId: 'content-chat', expectedRevision: session.revision!,
      request: { customerName: '采购评审客户', communicationAt: null, purpose: '采购评审' }, report });
    if (!result) throw new Error('Expected persisted preparation');
    const expectedReport: CustomerCommunicationPreparationResponse = structuredClone(report);
    expect((await workerB.getPreparationResult(tenantId, actorOpenId, result.id))?.report)
      .toEqual(expectedReport);
    report.briefing!.opportunities[0].evidence = [];
    report.briefing!.agenda = [];
    expect(await workerB.savePreparationDraft({ tenantId, actorOpenId, id: result.id,
      edit: { channel: 'feishu', subject: null, body: '销售修改的话术', expectedRevision: 1 } }))
      .toMatchObject({ revision: 2, report: expectedReport });
    expect((await workerA.getPreparationResult(tenantId, actorOpenId, result.id))?.report)
      .toEqual(expectedReport);
    expect(await workerB.getPreparationResult(tenantId, 'other', result.id)).toBeNull();
    expect(await workerB.getPreparationResult(isolatedTenantId, actorOpenId, result.id)).toBeNull();
  });

  it('saves one concurrent edit, preserves facts and audits only committed writes', async () => {
    const actorOpenId = 'edit-actor';
    const session = await store.savePreparationClarificationSession({ tenantId, actorOpenId,
      chatId: 'edit-chat', sourceMessageId: 'edit-source', rawText: '准备', expectedRevision: 0,
      expiresAt: new Date(Date.now() + 60000) });
    const report: CustomerCommunicationPreparationResponse = {
      referenceDate: '2026-10-20', timezone: 'Asia/Shanghai', status: 'empty',
      generatedAt: new Date().toISOString(), customer: null, objective: null,
      angles: [], questions: [], materials: [], evidence: [], warnings: [],
      drafts: [
        { channel: 'email', title: '邮件', subject: '原主题', body: '原正文', editable: true, execution: 'preview_only', sourceKeys: [] },
        { channel: 'feishu', title: '飞书', subject: null, body: '原飞书正文', editable: true, execution: 'preview_only', sourceKeys: [] },
      ],
      materialSearch: { status: 'not_configured', configuredSourceCount: 0, checkedSourceCount: 0, trustedResultCount: 0, warnings: [] },
      coverage: { scope: 'self', customers: 'complete', opportunities: 'complete', followups: 'complete', taskPromises: 'agent_confirmed_only', associations: 'explicit_record_links_only' },
    };
    const result = await store.completePreparationSession({ tenantId, actorOpenId,
      chatId: 'edit-chat', expectedRevision: session.revision!,
      request: { customerName: '甲', communicationAt: null, purpose: null }, report });
    if (!result) throw new Error('Expected result');
    const input = { tenantId, actorOpenId, id: result.id,
      edit: { channel: 'email' as const, subject: '新主题', body: '新正文', expectedRevision: 1 } };
    expect(await store.savePreparationDraft({ ...input, actorOpenId: 'other' })).toBeNull();
    expect(await store.savePreparationDraft({ ...input, tenantId: '10000000-0000-4000-8000-000000000099' })).toBeNull();
    const results = await Promise.all([store.savePreparationDraft(input), store.savePreparationDraft(input)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.getPreparationResult(tenantId, actorOpenId, result.id)).toMatchObject({
      revision: 2, report, draftEdits: [{ channel: 'email', subject: '新主题', body: '新正文' }],
    });
    await store.savePreparationDraft({ ...input,
      edit: { channel: 'feishu', subject: null, body: '新飞书正文', expectedRevision: 2 } });
    const saved = await store.getPreparationResult(tenantId, actorOpenId, result.id);
    expect(saved).toMatchObject({ revision: 3, report });
    expect(saved?.draftEdits).toHaveLength(2);
    const audits = await sql`SELECT details FROM audit_events
      WHERE tenant_id = ${tenantId} AND entity_id = ${result.id} AND event_type = 'preparation.draft_saved'
      ORDER BY id`;
    expect(audits.map((row) => row.details)).toEqual([
      { channel: 'email', revision: 2 }, { channel: 'feishu', revision: 3 },
    ]);
    await expect(store.savePreparationDraft({ ...input, edit: { ...input.edit, body: ' ', expectedRevision: 3 } }))
      .rejects.toThrow();
    expect((await store.getPreparationResult(tenantId, actorOpenId, result.id))?.revision).toBe(3);
  });

  it.each(['timeout', 'unknown'])('keeps %s delivery blocked after reconnect', async (mode) => {
    const actorOpenId: string = `delivery-${mode}`;
    const session = await store.savePreparationClarificationSession({ tenantId, actorOpenId,
      chatId: 'original-chat', sourceMessageId: mode, rawText: '准备',
      expiresAt: new Date(Date.now() + 60000) });
    const report: CustomerCommunicationPreparationResponse = {
      referenceDate: '2026-10-20', timezone: 'Asia/Shanghai', status: 'empty',
      generatedAt: new Date().toISOString(), customer: null, objective: null,
      angles: [], questions: [], materials: [], drafts: [], evidence: [], warnings: [],
      materialSearch: { status: 'not_configured', configuredSourceCount: 0, checkedSourceCount: 0, trustedResultCount: 0, warnings: [] },
      coverage: { scope: 'self', customers: 'complete', opportunities: 'complete', followups: 'complete', taskPromises: 'agent_confirmed_only', associations: 'explicit_record_links_only' },
    };
    const result = await store.completePreparationSession({ tenantId, actorOpenId, chatId: 'original-chat',
      expectedRevision: session.revision!, request: { customerName: '甲', communicationAt: null, purpose: null }, report });
    if (!result) throw new Error('Expected result');
    const scope = { tenantId, actorOpenId, resultId: result.id };
    const now: Date = new Date();
    const lease = await store.claimPreparationDelivery({ ...scope, text: 'frozen', now });
    if (!lease) throw new Error('Expected lease');
    if (mode === 'unknown') {
      await expect(store.finishPreparationDelivery({ ...scope, token: lease.token, messageId: 'x'.repeat(256) })).rejects.toThrow();
      expect(await store.finishPreparationDelivery({ ...scope, token: lease.token, messageId: null })).toBe(true);
      await sql`INSERT INTO tenant_members (tenant_id, feishu_open_id, display_name)
        VALUES (${tenantId}, ${actorOpenId}, 'Integration seller')
        ON CONFLICT (tenant_id, feishu_open_id) DO NOTHING`;
      const before = await store.getPreparationDelivery(scope);
      if (!before?.updatedAt) throw new Error('Expected delivery timestamp');
      const reconciliation = { ...scope, operatorOpenId: actorOpenId,
        expectedVersion: before.reconciliationVersion!, messageId: 'verified-message',
        sentAt: new Date(now.getTime() + 1000), note: '从飞书会话记录核实已发送',
        now: new Date(now.getTime() + 2000) };
      expect(await store.confirmPreparationDelivery({ ...reconciliation,
        expectedVersion: reconciliation.expectedVersion + 1 })).toBe(false);
      expect(await store.confirmPreparationDelivery(reconciliation)).toBe(true);
      expect(await store.confirmPreparationDelivery(reconciliation)).toBe(false);
      expect(await store.getPreparationDelivery(scope)).toMatchObject({ status: 'sent' });
      const reconciliationRows = await sql`SELECT decision, evidence_message_id
        FROM preparation_result_delivery_reconciliations WHERE result_id = ${result.id}`;
      expect(reconciliationRows).toEqual([{ decision: 'confirm_sent', evidence_message_id: 'verified-message' }]);
    }
    const restarted = new PostgresControlStore(sql);
    expect(await restarted.claimPreparationDelivery({ ...scope, text: 'changed', now: new Date(now.getTime() + 300001) })).toBeNull();
    expect(await restarted.finishPreparationDelivery({ ...scope, token: lease.token, messageId: 'late' })).toBe(false);
    const rows = await sql`SELECT status, frozen_text, message_id FROM preparation_result_deliveries WHERE result_id = ${result.id}`;
    expect(rows[0]).toMatchObject({ status: mode === 'unknown' ? 'sent' : 'unknown', frozen_text: 'frozen', message_id: mode === 'unknown' ? 'verified-message' : null });
  });

  it('allows only one writer for the same revision and blocks revival after cancel', async () => {
    const input = { tenantId, actorOpenId: 'revision-actor', chatId: 'revision-chat', sourceMessageId: 'message', rawText: 'original', expiresAt: new Date(Date.now() + 60000), expectedRevision: 0 };
    await expect(store.savePreparationClarificationSession(input)).resolves.toMatchObject({ revision: 1 });
    const results = await Promise.allSettled([
      store.savePreparationClarificationSession({ ...input, expectedRevision: 1, rawText: 'first' }),
      store.savePreparationClarificationSession({ ...input, expectedRevision: 1, rawText: 'second' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await store.closePreparationSession(tenantId, input.actorOpenId, input.chatId);
    await expect(store.savePreparationClarificationSession({ ...input, expectedRevision: 2 })).rejects.toThrow('revision conflict');
    expect(await store.getOpenPreparationSession(tenantId, input.actorOpenId, input.chatId)).toBeNull();
  });
  it('atomically closes only the current active revision', async () => {
    const input = { tenantId, actorOpenId: 'close-actor', chatId: 'close-chat', sourceMessageId: 'message', rawText: '准备', expiresAt: new Date(Date.now() + 60000), expectedRevision: 0 };
    await store.savePreparationClarificationSession(input);
    await store.savePreparationClarificationSession({ ...input, expectedRevision: 1 });
    await expect(store.closePreparationSession(tenantId, input.actorOpenId, input.chatId, 1)).resolves.toBe(false);
    expect(await store.getOpenPreparationSession(tenantId, input.actorOpenId, input.chatId)).toMatchObject({ revision: 2 });
    await expect(store.closePreparationSession(tenantId, input.actorOpenId, input.chatId, 2)).resolves.toBe(true);
    await expect(store.closePreparationSession(tenantId, input.actorOpenId, input.chatId, 2)).resolves.toBe(false);
    expect(await store.getOpenPreparationSession(tenantId, input.actorOpenId, input.chatId)).toBeNull();
    const baseline = await store.getOpenPreparationSession(tenantId, input.actorOpenId, input.chatId, true);
    expect(baseline).toMatchObject({ revision: 3, state: 'closed' });
    await expect(store.savePreparationClarificationSession({ ...input, rawText: '新准备', expectedRevision: baseline?.revision }))
      .resolves.toMatchObject({ revision: 4, rawText: '新准备' });
    await expect(store.savePreparationClarificationSession({ ...input, expectedRevision: 2 })).rejects.toThrow('revision conflict');
  });
});
