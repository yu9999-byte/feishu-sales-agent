import { afterAll, describe, expect, it } from 'vitest';
import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';

import type { Sql } from 'postgres';
import { PostgresControlStore } from
  '@server/modules/control-store/postgres-control.store';
import { FeishuClientFactory } from
  '@server/modules/feishu/feishu-client.factory';
import { PostgresIdentityAccessRepository } from
  '@server/modules/identity-access/postgres-identity-access.repository';
import { FeishuSalesMaterialGateway } from
  '@server/modules/knowledge/feishu-sales-material.gateway';
import { SalesKnowledgeQaService } from
  '@server/modules/knowledge/sales-knowledge-qa.service';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import type { SalesKnowledgeQaResponse } from '@shared/api.interface';

loadEnvironment({
  path: ['.env.local', '.env'],
  quiet: true,
});

const runRealProbe: boolean =
  process.env.RUN_REAL_SALES_KNOWLEDGE_QA_PROBE === 'true';
const databaseUrl: string | undefined = process.env.DATABASE_URL;
const sql: Sql | null = runRealProbe && databaseUrl
  ? postgres(databaseUrl, {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 5,
      onnotice: (): void => undefined,
    })
  : null;

describe.runIf(runRealProbe)('Sales knowledge QA real read-only probe', (): void => {
  afterAll(async (): Promise<void> => {
    await sql?.end({ timeout: 5 });
  });

  it.each([
    ['销售 Agent 能做什么？', 'sales-agent-product-capabilities'],
    ['拜访客户前要准备什么？', 'customer-communication-visit-guide'],
    ['资料权限怎么控制？', 'sales-agent-data-security-boundary'],
  ])('answers %s from current whitelisted documents', async (
    question: string,
    expectedTopSourceId: string,
  ): Promise<void> => {
    if (sql === null) {
      throw new Error('DATABASE_URL is required for the real probe');
    }
    const store = new PostgresControlStore(sql);
    const integrations: TenantIntegration[] =
      await store.listActiveIntegrations();
    expect(integrations).toHaveLength(1);
    const integration: TenantIntegration | undefined = integrations[0];
    if (integration === undefined) {
      throw new Error('No active integration is available');
    }
    const memberId: string | undefined =
      process.env.STALE_OPPORTUNITY_REMINDER_ALLOWED_MEMBER_ID;
    if (!memberId) {
      throw new Error('The allowed sales member is not configured');
    }
    const identities = new PostgresIdentityAccessRepository(sql);
    const member = await identities.resolveMemberById(
      integration.tenantId,
      memberId,
    );
    if (member === null || member.status !== 'active') {
      throw new Error('The configured sales member is not active');
    }
    const service = new SalesKnowledgeQaService(
      new FeishuSalesMaterialGateway(new FeishuClientFactory()),
    );

    const result: SalesKnowledgeQaResponse = await service.answer({
      integration,
      actorOpenId: member.feishuOpenId,
      question,
    });

    process.stdout.write(`${JSON.stringify({
      question,
      status: result.status,
      sourceIds: result.citations.map((citation) => citation.sourceId),
      titles: result.citations.map((citation) => citation.title),
      versions: result.citations.map((citation) => citation.sourceVersion),
    })}\n`);

    expect(result.status).toBe('answered');
    expect(result.configuredSourceCount).toBe(3);
    expect(result.checkedSourceCount).toBe(3);
    expect(result.trustedResultCount).toBeGreaterThan(0);
    expect(result.citations.length).toBeLessThanOrEqual(3);
    expect(result.citations[0]?.sourceId).toBe(expectedTopSourceId);
    expect(result.citations.every((citation): boolean =>
      citation.accessVerified &&
      citation.sourceVersion.startsWith('revision:') &&
      citation.url.startsWith('https://') &&
      citation.excerpt.length > 0,
    )).toBe(true);
  });
});
