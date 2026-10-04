import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Controller,
  Get,
  Headers,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  type StaleOpportunityReminderPlanResponse,
  type StaleOpportunityReminderPreflightResponse,
} from '@shared/api.interface';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import {
  StaleOpportunityReminderRuntimeService,
} from './stale-opportunity-reminder-runtime.service';
import { StaleOpportunityReminderPlanService } from
  './stale-opportunity-reminder-plan.service';

interface StaleOpportunityReminderRuntimePreflightRunner {
  prepare(): Promise<StaleOpportunityReminderPreflightResponse>;
}

interface StaleOpportunityReminderRuntimePlanRunner {
  plan(): Promise<StaleOpportunityReminderPlanResponse>;
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
    @Inject(StaleOpportunityReminderPlanService)
    private readonly planner: StaleOpportunityReminderRuntimePlanRunner,
  ) {}

  @Get('preflight')
  @Header('Cache-Control', 'no-store')
  async preflight(
    @Headers('authorization') authorization?: string,
  ): Promise<StaleOpportunityReminderPreflightResponse> {
    this.assertAuthorized(authorization);
    return this.runtime.prepare();
  }

  @Post('plan')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async plan(
    @Headers('authorization') authorization?: string,
  ): Promise<StaleOpportunityReminderPlanResponse> {
    this.assertAuthorized(authorization);
    return this.planner.plan();
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
export type {
  StaleOpportunityReminderRuntimePlanRunner,
  StaleOpportunityReminderRuntimePreflightRunner,
};
