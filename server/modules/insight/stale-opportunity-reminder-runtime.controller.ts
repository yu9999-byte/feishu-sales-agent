import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Controller,
  Get,
  Headers,
  Header,
  Inject,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import {
  StaleOpportunityReminderRuntimeService,
  type StaleOpportunityReminderRuntimePreparationResult,
} from './stale-opportunity-reminder-runtime.service';

interface StaleOpportunityReminderRuntimePreflightRunner {
  prepare(): Promise<StaleOpportunityReminderRuntimePreparationResult>;
}

const TOKEN_PATTERN: RegExp = /^Bearer ([^\s]+)$/iu;

const digestToken = (value: string): Buffer =>
  createHash('sha256').update(value, 'utf8').digest();

@Controller('internal/stale-opportunity-reminder')
class StaleOpportunityReminderRuntimeController {
  constructor(
    @Inject(AGENT_CONFIG)
    private readonly config: AgentRuntimeConfig,
    @Inject(StaleOpportunityReminderRuntimeService)
    private readonly runtime: StaleOpportunityReminderRuntimePreflightRunner,
  ) {}

  @Get('preflight')
  @Header('Cache-Control', 'no-store')
  async preflight(
    @Headers('authorization') authorization?: string,
  ): Promise<StaleOpportunityReminderRuntimePreparationResult> {
    this.assertAuthorized(authorization);
    return this.runtime.prepare();
  }

  private assertAuthorized(authorization: string | undefined): void {
    const expected: string | undefined =
      this.config.staleOpportunityScan?.triggerToken;
    if (!expected) {
      throw new ServiceUnavailableException({
        code: 'TRIGGER_DISABLED',
        message: '商机提醒运行前检查入口未配置',
      });
    }
    const match: RegExpExecArray | null = TOKEN_PATTERN.exec(
      authorization ?? '',
    );
    if (
      match === null ||
      !timingSafeEqual(digestToken(match[1]), digestToken(expected))
    ) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: '运行前检查凭证无效',
      });
    }
  }
}

export { StaleOpportunityReminderRuntimeController };
export type { StaleOpportunityReminderRuntimePreflightRunner };
