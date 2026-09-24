import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { agentConfigProvider } from '@server/config/agent.providers';
import { AgentControlModule } from '@server/modules/control-store/agent-control.module';
import { FeishuApiModule } from '@server/modules/feishu/feishu-api.module';
import { FeishuMessengerService } from '@server/modules/feishu/feishu-messenger.service';
import { FeishuBaseGateway } from '@server/modules/integrations/base/feishu-base.gateway';
import { FeishuTaskGateway } from '@server/modules/integrations/task/feishu-task.gateway';
import { OpenAiFollowupExtractor } from '@server/modules/llm/openai-followup.extractor';
import { LangChainIntentModel } from '@server/modules/llm/langchain-intent.model';
import { Mem0MemoryAdapter } from '@server/modules/llm/mem0-memory.adapter';
import { LangGraphCheckpointerService } from '@server/modules/llm/langgraph-checkpointer.service';
import {
  LANGGRAPH_CHECKPOINTER,
} from '@server/modules/llm/langgraph-checkpointer.service';
import { LangGraphConversationAssistant } from '@server/modules/llm/langgraph-conversation.assistant';
import { FollowupProjectRiskService } from '@server/modules/insight/followup-project-risk.service';
import { AgentActionExecutorService } from './agent-action-executor.service';
import {
  FEISHU_MESSENGER,
  CONVERSATION_ASSISTANT,
  FOLLOWUP_EXTRACTOR,
  SALES_RECORDS_GATEWAY,
  TASK_GATEWAY,
} from './agent.ports';
import { LANGCHAIN_INTENT_MODEL } from '@server/modules/llm/langchain-intent.model';
import {
  LONG_TERM_MEMORY,
} from '@server/modules/llm/long-term-memory.port';

@Module({
  imports: [
    AgentControlModule,
    FeishuApiModule,
    HttpModule.register({ timeout: 30_000, maxRedirects: 2 }),
  ],
  providers: [
    agentConfigProvider,
    OpenAiFollowupExtractor,
    LangChainIntentModel,
    Mem0MemoryAdapter,
    LangGraphCheckpointerService,
    LangGraphConversationAssistant,
    FeishuMessengerService,
    FeishuBaseGateway,
    FeishuTaskGateway,
    FollowupProjectRiskService,
    AgentActionExecutorService,
    { provide: FOLLOWUP_EXTRACTOR, useExisting: OpenAiFollowupExtractor },
    {
      provide: LANGCHAIN_INTENT_MODEL,
      useExisting: LangChainIntentModel,
    },
    {
      provide: LANGGRAPH_CHECKPOINTER,
      useExisting: LangGraphCheckpointerService,
    },
    {
      provide: CONVERSATION_ASSISTANT,
      useExisting: LangGraphConversationAssistant,
    },
    { provide: LONG_TERM_MEMORY, useExisting: Mem0MemoryAdapter },
    { provide: FEISHU_MESSENGER, useExisting: FeishuMessengerService },
    { provide: SALES_RECORDS_GATEWAY, useExisting: FeishuBaseGateway },
    { provide: TASK_GATEWAY, useExisting: FeishuTaskGateway },
  ],
  exports: [
    FOLLOWUP_EXTRACTOR,
    CONVERSATION_ASSISTANT,
    LONG_TERM_MEMORY,
    FEISHU_MESSENGER,
    AgentActionExecutorService,
  ],
})
class AgentExecutionModule {}

export { AgentExecutionModule };
