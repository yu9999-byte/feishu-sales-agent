import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import type { StaleOpportunityTriggerResponse } from '@shared/api.interface';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import {
  StaleOpportunityTriggerService,
} from './stale-opportunity-trigger.service';

interface StaleOpportunityTriggerRunner {
  run(): Promise<StaleOpportunityTriggerResponse>;
}

const TOKEN_PATTERN: RegExp = /^Bearer ([^\s]+)$/iu;

const digestToken = (value: string): Buffer =>
  createHash('sha256').update(value, 'utf8').digest();

@Controller('internal/stale-opportunity-scan')
class StaleOpportunityTriggerController {
  constructor(
    @Inject(AGENT_CONFIG)
    private readonly config: AgentRuntimeConfig,
    @Inject(StaleOpportunityTriggerService)
    private readonly trigger: StaleOpportunityTriggerRunner,
  ) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  async run(
    @Headers('authorization') authorization?: string,
  ): Promise<StaleOpportunityTriggerResponse> {
    this.assertAuthorized(authorization);
    return this.trigger.run();
  }

  private assertAuthorized(authorization: string | undefined): void {
    const expected: string | undefined =
      this.config.staleOpportunityScan?.triggerToken;
    if (!expected) {
      throw new ServiceUnavailableException({
        code: 'TRIGGER_DISABLED',
        message: '商机停滞扫描触发入口未配置',
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
        message: '触发凭证无效',
      });
    }
  }
}

export { StaleOpportunityTriggerController };
export type { StaleOpportunityTriggerRunner };
