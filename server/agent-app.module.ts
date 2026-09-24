import { Module } from '@nestjs/common';

import {
  agentConfigProvider,
} from './config/agent.providers';
import { AgentWorkflowService } from './modules/agent-core/agent-workflow.service';
import { AgentExecutionModule } from './modules/agent-core/agent-execution.module';
import { AgentControlModule } from './modules/control-store/agent-control.module';
import { WebAuthModule } from './modules/web-auth/web-auth.module';
import { PlatformShellModule } from './modules/platform-shell/platform-shell.module';
import { SalesBehaviorModule } from './modules/sales-behavior/sales-behavior.module';
import { FeishuWebhookBridge } from './modules/feishu/feishu-webhook.bridge';
import { FeishuWebhookController } from './modules/feishu/feishu-webhook.controller';

@Module({
  imports: [
    AgentControlModule,
    AgentExecutionModule,
    WebAuthModule,
    PlatformShellModule,
    SalesBehaviorModule,
  ],
  controllers: [FeishuWebhookController],
  providers: [
    agentConfigProvider,
    FeishuWebhookBridge,
    AgentWorkflowService,
  ],
})
export class AgentAppModule {}
