import {
  Controller, Get, Header, Inject, ServiceUnavailableException,
} from '@nestjs/common';

import type { AgentReadinessResponse } from '@shared/api.interface';
import { AgentRuntimeHealthService } from './agent-runtime-health.service';

@Controller('api/health')
class AgentRuntimeHealthController {
  constructor(
    @Inject(AgentRuntimeHealthService)
    private readonly health: AgentRuntimeHealthService,
  ) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live(): { status: 'alive' } {
    return { status: 'alive' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(): Promise<AgentReadinessResponse> {
    const result: AgentReadinessResponse = await this.health.readiness();
    if (result.status !== 'ready') throw new ServiceUnavailableException(result);
    return result;
  }
}

export { AgentRuntimeHealthController };
