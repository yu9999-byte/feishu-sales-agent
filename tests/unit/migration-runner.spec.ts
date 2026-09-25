import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Agent migration runner', (): void => {
  it('lists only versioned application migrations in dependency order', (): void => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/migrate-agent.cjs'), '--list'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split(/\r?\n/u)).toEqual([
      '003_agent_control.sql',
      '005_platform_foundation.sql',
      '006_web_auth.sql',
      '007_sales_behavior_drafts.sql',
      '008_conversation_memory.sql',
      '009_followup_context_snapshot.sql',
      '010_followup_progress_assessment.sql',
    ]);
    expect(result.stdout).not.toContain('004_agent_p0_demo_tenant');
  });
});
