import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import type { ProactiveSalesNotificationRunResponse } from
  '@shared/api.interface';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import { ProactiveSalesNotificationService } from
  './proactive-sales-notification.service';

interface ProactiveSalesNotificationRunner {
  run(): Promise<ProactiveSalesNotificationRunResponse>;
}

const TOKEN_PATTERN: RegExp = /^Bearer ([^\s]+)$/iu;
const digestToken = (value: string): Buffer =>
  createHash('sha256').update(value, 'utf8').digest();

@Controller('internal/proactive-sales-notifications')
class ProactiveSalesNotificationController {
  constructor(
    @Inject(AGENT_CONFIG)
    private readonly config: AgentRuntimeConfig,
    @Inject(ProactiveSalesNotificationService)
    private readonly runner: ProactiveSalesNotificationRunner,
  ) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async run(
    @Headers('authorization') authorization?: string,
  ): Promise<ProactiveSalesNotificationRunResponse> {
    this.assertAuthorized(authorization);
    return this.runner.run();
  }

  private assertAuthorized(authorization: string | undefined): void {
    const expected: string | undefined =
      this.config.proactiveSalesNotifications?.triggerToken?.trim();
    if (!expected || this.reusesAnotherToken(expected)) {
      throw new ServiceUnavailableException({
        code: 'PROACTIVE_SCHEDULER_DISABLED',
        message: '主动销售通知调度入口未安全配置',
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
        message: '主动销售通知调度凭证无效',
      });
    }
  }

  private reusesAnotherToken(expected: string): boolean {
    const otherTokens: Array<string | undefined> = [
      this.config.staleOpportunityScan?.triggerToken,
      this.config.staleOpportunityReminder?.execution?.triggerToken,
      this.config.staleOpportunityReminder?.scheduleObservation?.triggerToken,
    ];
    return otherTokens.some(
      (token: string | undefined): boolean => token?.trim() === expected,
    );
  }
}

export { ProactiveSalesNotificationController };
export type { ProactiveSalesNotificationRunner };
