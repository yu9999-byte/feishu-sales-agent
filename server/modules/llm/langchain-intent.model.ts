import { Inject, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { preparationExtractionSchema } from '@server/modules/insight/customer-preparation-extraction';
import type { PreparationConditions } from '@server/modules/insight/customer-preparation-context';
import { extractPreparationConditions, type PreparationModelInput } from './preparation-model';

import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import type {
  ConversationDecision,
} from '@server/modules/agent-core/agent.types';
import {
  conversationDecisionSchema,
} from './conversation-intent.schema';

export const LANGCHAIN_INTENT_MODEL = Symbol('LANGCHAIN_INTENT_MODEL');

export interface ConversationIntentModel {
  invoke(prompt: string): Promise<ConversationDecision>;
}

@Injectable()
export class LangChainIntentModel implements ConversationIntentModel {
  private readonly preparationModel: ReturnType<ChatOpenAI['withStructuredOutput']>;
  private readonly structuredModel: ReturnType<ChatOpenAI['withStructuredOutput']>;

  constructor(
    @Inject(AGENT_CONFIG)
    config: AgentRuntimeConfig,
  ) {
    const model: ChatOpenAI = new ChatOpenAI({
      model: config.llm.model,
      apiKey: config.llm.apiKey,
      temperature: 0.3,
      maxRetries: 0,
      configuration: {
        baseURL: config.llm.baseUrl,
      },
      modelKwargs: {
        thinking: { type: 'disabled' },
      },
    });
    this.structuredModel = model.withStructuredOutput(
      conversationDecisionSchema,
      {
        name: 'conversation_decision',
        method: 'jsonMode',
      },
    );
    this.preparationModel = model.withStructuredOutput(preparationExtractionSchema, {
      name: 'preparation_conditions',
      method: 'jsonMode',
    });
  }

  async extractPreparation(input: PreparationModelInput): Promise<PreparationConditions> {
    return extractPreparationConditions(this.preparationModel, input);
  }

  async invoke(prompt: string): Promise<ConversationDecision> {
    const value: unknown = await this.structuredModel.invoke(prompt);
    return conversationDecisionSchema.parse(value);
  }
}
