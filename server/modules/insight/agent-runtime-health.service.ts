import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';

import type { AgentReadinessResponse } from '@shared/api.interface';
import { AGENT_DATABASE } from
  '@server/modules/control-store/postgres-control.store';

const REQUIRED_AGENT_MIGRATIONS: readonly string[] = [
  '003_agent_control.sql',
  '005_platform_foundation.sql',
  '006_web_auth.sql',
  '007_sales_behavior_drafts.sql',
  '008_conversation_memory.sql',
  '009_followup_context_snapshot.sql',
  '010_followup_progress_assessment.sql',
  '011_stale_opportunity_reminders.sql',
  '012_stale_opportunity_delivery_state.sql',
  '013_task_status_snapshots.sql',
  '014_task_completion_evidence.sql',
  '015_task_status_events.sql',
  '016_task_event_receipts.sql',
  '017_stale_opportunity_reminder_reconciliations.sql',
  '018_playbook_optimization.sql',
  '019_playbook_optimization_tenant_cleanup.sql',
  '020_proactive_sales_notifications.sql',
  '021_proactive_notification_reconciliations.sql',
  '022_feishu_user_credentials.sql',
  '023_today_action_state.sql',
  '024_proactive_notification_payload.sql',
  '025_preparation_sessions.sql',
  '026_preparation_context.sql',
  '027_preparation_revision.sql',
  '028_preparation_results.sql',
  '029_preparation_draft_edits.sql',
  '030_preparation_result_deliveries.sql',
  '031_preparation_delivery_reconciliation.sql',
  '032_playbook_draft_versions.sql',
  '033_playbook_draft_reviews.sql',
  '034_task_promise_evidence.sql',
];

@Injectable()
class AgentRuntimeHealthService {
  private inFlight: Promise<AgentReadinessResponse> | null = null;

  constructor(@Inject(AGENT_DATABASE) private readonly sql: Sql) {}

  readiness(): Promise<AgentReadinessResponse> {
    if (this.inFlight !== null) return this.inFlight;
    const check = this.checkDatabase();
    const response = this.probe(check);
    this.inFlight = response;
    // Keep one probe while a lost connection is still settling after the HTTP deadline.
    void Promise.all([check, response]).then((): void => {
      if (this.inFlight === response) this.inFlight = null;
    });
    return response;
  }

  private async checkDatabase(): Promise<AgentReadinessResponse['database']> {
    try {
      const rows = await this.sql.begin('READ ONLY', async (transaction) => {
        await transaction`SET LOCAL statement_timeout = '1500ms'`;
        return transaction<Array<{ filename: string }>>`
          SELECT filename FROM agent_schema_migrations
        `;
      });
      const applied: Set<string> = new Set(rows.map((row) => row.filename));
      return REQUIRED_AGENT_MIGRATIONS.every((name: string) => applied.has(name))
        ? 'ready' : 'schema_pending';
    } catch (_error: unknown) {
      return 'unavailable';
    }
  }

  private async probe(check: Promise<AgentReadinessResponse['database']>): Promise<AgentReadinessResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const database: AgentReadinessResponse['database'] = await Promise.race([
        check,
        new Promise<'unavailable'>((resolve): void => {
          timer = setTimeout((): void => resolve('unavailable'), 2000);
        }),
      ]);
      return {
        status: database === 'ready' ? 'ready' : 'not_ready',
        database,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

export { AgentRuntimeHealthService, REQUIRED_AGENT_MIGRATIONS };
