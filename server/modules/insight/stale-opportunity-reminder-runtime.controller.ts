import { createHash, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  type StaleOpportunityReminderExecutionRequest,
  type StaleOpportunityReminderExecutionResponse,
  type StaleOpportunityReminderExecutionReadinessResponse,
  type StaleOpportunityReminderPlanResponse,
  type StaleOpportunityReminderPreflightResponse,
  type StaleOpportunityReminderScheduleObservationResponse,
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
import { StaleOpportunityReminderExecutionService } from
  './stale-opportunity-reminder-execution.service';
import { StaleOpportunityReminderExecutionReadinessService } from
  './stale-opportunity-reminder-execution-readiness.service';
import { StaleOpportunityReminderScheduleObservationService } from
  './stale-opportunity-reminder-schedule-observation.service';

interface StaleOpportunityReminderRuntimePreflightRunner {
  prepare(): Promise<StaleOpportunityReminderPreflightResponse>;
}

interface StaleOpportunityReminderRuntimePlanRunner {
  plan(): Promise<StaleOpportunityReminderPlanResponse>;
}

interface StaleOpportunityReminderRuntimeExecutionRunner {
  execute(
    input: StaleOpportunityReminderExecutionRequest,
  ): Promise<StaleOpportunityReminderExecutionResponse>;
}

interface StaleOpportunityReminderExecutionReadinessRunner {
  inspect(): Promise<StaleOpportunityReminderExecutionReadinessResponse>;
}

interface StaleOpportunityReminderScheduleObservationRunner {
  observe(): Promise<StaleOpportunityReminderScheduleObservationResponse>;
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
    @Inject(StaleOpportunityReminderExecutionService)
    private readonly execution: StaleOpportunityReminderRuntimeExecutionRunner,
    @Optional()
    @Inject(StaleOpportunityReminderExecutionReadinessService)
    private readonly executionReadiness?:
      StaleOpportunityReminderExecutionReadinessRunner,
    @Optional()
    @Inject(StaleOpportunityReminderScheduleObservationService)
    private readonly scheduleObservation?:
      StaleOpportunityReminderScheduleObservationRunner,
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

  @Post('execute')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async execute(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ): Promise<StaleOpportunityReminderExecutionResponse> {
    this.assertExecutionAuthorized(authorization);
    return this.execution.execute(this.parseExecutionRequest(body));
  }

  @Get('execution-readiness')
  @Header('Cache-Control', 'no-store')
  async executionReadinessCheck(
    @Headers('authorization') authorization?: string,
  ): Promise<StaleOpportunityReminderExecutionReadinessResponse> {
    this.assertExecutionAuthorized(authorization);
    if (!this.executionReadiness) {
      throw new ServiceUnavailableException({
        code: 'EXECUTION_READINESS_UNAVAILABLE',
        message: '商机提醒执行准备度检查未装配',
      });
    }
    return this.executionReadiness.inspect();
  }

  @Post('schedule-observation')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async observeSchedule(
    @Headers('authorization') authorization?: string,
  ): Promise<StaleOpportunityReminderScheduleObservationResponse> {
    this.assertScheduleObservationAuthorized(authorization);
    if (!this.scheduleObservation) {
      throw new ServiceUnavailableException({
        code: 'SCHEDULE_OBSERVATION_UNAVAILABLE',
        message: '商机提醒调度观察服务未装配',
      });
    }
    return this.scheduleObservation.observe();
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

  private assertExecutionAuthorized(
    authorization: string | undefined,
  ): void {
    const expected: string | undefined =
      this.config.staleOpportunityReminder?.execution?.triggerToken;
    if (!expected) {
      throw new ServiceUnavailableException({
        code: 'EXECUTION_DISABLED',
        message: '商机提醒执行入口未配置',
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
        message: '商机提醒执行凭证无效',
      });
    }
  }

  private assertScheduleObservationAuthorized(
    authorization: string | undefined,
  ): void {
    const expected: string | undefined =
      this.config.staleOpportunityReminder?.scheduleObservation
        ?.triggerToken?.trim();
    if (!expected) {
      throw new ServiceUnavailableException({
        code: 'SCHEDULE_OBSERVATION_DISABLED',
        message: '商机提醒调度观察入口未配置',
      });
    }
    const scanToken: string | undefined =
      this.config.staleOpportunityScan?.triggerToken?.trim();
    const executionToken: string | undefined =
      this.config.staleOpportunityReminder?.execution?.triggerToken?.trim();
    if (expected === scanToken || expected === executionToken) {
      throw new ServiceUnavailableException({
        code: 'SCHEDULE_OBSERVATION_CREDENTIAL_UNSAFE',
        message: '商机提醒调度观察凭证未与扫描和执行凭证隔离',
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
        message: '商机提醒调度观察凭证无效',
      });
    }
  }

  private parseExecutionRequest(
    body: unknown,
  ): StaleOpportunityReminderExecutionRequest {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw this.invalidExecutionRequest();
    }
    const value: Record<string, unknown> = body as Record<string, unknown>;
    const keys: string[] = Object.keys(value).sort();
    if (
      keys.length !== 2 ||
      keys[0] !== 'followupVersion' ||
      keys[1] !== 'opportunityRecordId' ||
      typeof value.opportunityRecordId !== 'string' ||
      !value.opportunityRecordId.trim() ||
      typeof value.followupVersion !== 'string' ||
      !value.followupVersion.trim()
    ) {
      throw this.invalidExecutionRequest();
    }
    return {
      opportunityRecordId: value.opportunityRecordId,
      followupVersion: value.followupVersion,
    };
  }

  private invalidExecutionRequest(): BadRequestException {
    return new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: '执行请求只能包含商机记录和跟进版本',
    });
  }
}

export { StaleOpportunityReminderRuntimeController };
export type {
  StaleOpportunityReminderExecutionReadinessRunner,
  StaleOpportunityReminderRuntimeExecutionRunner,
  StaleOpportunityReminderRuntimePlanRunner,
  StaleOpportunityReminderRuntimePreflightRunner,
  StaleOpportunityReminderScheduleObservationRunner,
};
