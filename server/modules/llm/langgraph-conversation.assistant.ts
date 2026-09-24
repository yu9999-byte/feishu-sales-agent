import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  Annotation,
  END,
  START,
  StateGraph,
} from '@langchain/langgraph';

import type {
  ConversationAssistant,
} from '@server/modules/agent-core/agent.ports';
import type {
  ConversationDecision,
  ConversationInput,
} from '@server/modules/agent-core/agent.types';
import {
  LANGCHAIN_INTENT_MODEL,
  type ConversationIntentModel,
} from './langchain-intent.model';
import {
  LANGGRAPH_CHECKPOINTER,
  type LangGraphCheckpointPort,
} from './langgraph-checkpointer.service';
import {
  LONG_TERM_MEMORY,
  type LongTermMemoryItem,
  type LongTermMemoryPort,
} from './long-term-memory.port';

interface GraphConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  messageId: string | undefined;
}

const ConversationGraphState = Annotation.Root({
  input: Annotation<ConversationInput>(),
  decision: Annotation<ConversationDecision | undefined>(),
  history: Annotation<GraphConversationTurn[], GraphConversationTurn[]>({
    reducer: (
      previous: GraphConversationTurn[],
      next: GraphConversationTurn[],
    ): GraphConversationTurn[] => previous.concat(next).slice(-12),
    default: (): GraphConversationTurn[] => [],
  }),
  longTermMemories: Annotation<
    LongTermMemoryItem[],
    LongTermMemoryItem[]
  >({
    reducer: (
      _previous: LongTermMemoryItem[],
      next: LongTermMemoryItem[],
    ): LongTermMemoryItem[] => next,
    default: (): LongTermMemoryItem[] => [],
  }),
});

type ConversationGraphStateValue = typeof ConversationGraphState.State;

@Injectable()
export class LangGraphConversationAssistant
  implements ConversationAssistant
{
  private readonly graph: ReturnType<typeof createConversationGraph>;

  constructor(
    @Inject(LANGCHAIN_INTENT_MODEL)
    private readonly model: ConversationIntentModel,
    @Inject(LANGGRAPH_CHECKPOINTER)
    private readonly checkpointer: LangGraphCheckpointPort,
    @Optional()
    @Inject(LONG_TERM_MEMORY)
    private readonly memory?: LongTermMemoryPort,
  ) {
    this.graph = createConversationGraph(this.model, this.checkpointer);
  }

  async respond(input: ConversationInput): Promise<ConversationDecision> {
    await this.checkpointer.ensureReady();
    const longTermMemories: LongTermMemoryItem[] =
      await this.loadLongTermMemories(input);
    const result: ConversationGraphStateValue = await this.graph.invoke(
      {
        input,
        history: [{
          role: 'user',
          text: input.text,
          messageId: input.context?.sourceMessageId,
        }],
        longTermMemories,
      },
      {
        configurable: {
          thread_id: this.threadId(input),
        },
      },
    );
    if (result.decision === undefined) {
      throw new Error('LangGraph intent node returned no decision');
    }
    return result.decision;
  }

  private async loadLongTermMemories(
    input: ConversationInput,
  ): Promise<LongTermMemoryItem[]> {
    if (!this.memory || !input.context?.tenantId ||
      !input.context.actorOpenId) {
      return [];
    }
    try {
      return await this.memory.search(
        {
          tenantId: input.context.tenantId,
          actorOpenId: input.context.actorOpenId,
        },
        input.text,
        5,
      );
    } catch {
      return [];
    }
  }

  private threadId(input: ConversationInput): string {
    const context: ConversationInput['context'] = input.context;
    const actor: string | undefined = context?.actorOpenId;
    const chat: string | undefined = context?.chatId;
    const tenant: string | undefined = context?.tenantId;
    if (!tenant || !actor || !chat) {
      throw new Error(
        'LangGraph thread requires tenant, actor, and chat boundaries',
      );
    }
    return `${tenant}:${actor}:${chat}`;
  }

}

const createConversationGraph = (
  model: ConversationIntentModel,
  checkpointer: LangGraphCheckpointPort,
) => new StateGraph(ConversationGraphState)
  .addNode('classifyIntent', async (
    state: ConversationGraphStateValue,
  ): Promise<Partial<ConversationGraphStateValue>> => {
      const decision: ConversationDecision = await model.invoke(
      createPrompt(state.input, state.history, state.longTermMemories),
    );
    return {
      decision,
      history: [{
        role: 'assistant',
        text: decision.reply,
        messageId: undefined,
      }],
    };
  })
  .addEdge(START, 'classifyIntent')
  .addEdge('classifyIntent', END)
  .compile({ checkpointer: checkpointer.getSaver() });

const createPrompt = (
  input: ConversationInput,
  history: GraphConversationTurn[],
  longTermMemories: LongTermMemoryItem[],
): string => [
  INTENT_SYSTEM_PROMPT,
  JSON.stringify({
    text: input.text,
    timezone: input.timezone,
    now: input.now.toISOString(),
    conversationContext: input.context,
    graphRecentTurns: history,
    longTermMemories: longTermMemories.map((memory): object => ({
      text: memory.text,
      category: memory.metadata.category,
      score: memory.score,
    })),
    clarificationContext: input.clarificationContext,
  }),
].join('\n\n');

const INTENT_SYSTEM_PROMPT: string = [
  '你是企业销售助手的对话中枢，只输出 JSON 对象，不输出 Markdown 代码块。',
  '输出必须符合 conversation-intent-v1：schemaVersion、intent、confidence、reply。',
  'intent 只能是 general_chat、sales_qa、content_generate、business_query、followup_capture、followup_analyze、task_operation、opportunity_operation、project_diagnosis、memory_save、ambiguous 之一。',
  '用户明确要求“记住/以后按这个偏好”时使用 memory_save；只保存销售本人的偏好或工作习惯。',
  '问候、能力介绍和闲聊必须使用 general_chat，不得创建 greeting 等新意图。',
  '你没有收到企业客户、商机、任务或知识库数据，绝不能声称已经查询到内部事实。',
  '只有用户明确要求记录、整理、沉淀或写跟进时才用 followup_capture。',
  '用户明确要求只分析、判断风险或评估影响时使用 followup_analyze；仅陈述客户事实时使用 ambiguous。',
  'sales_qa 只用于询问销售方法、知识或建议，不能用于客户事实陈述。',
  '分类示例：客户说预算下周批 -> ambiguous；怎样追问客户预算 -> sales_qa。',
  '分类示例：把刚才内容写成跟进 -> followup_capture；只分析这单风险 -> followup_analyze。',
  '结合 conversationContext 和 clarificationContext 判断当前意图，不要因为措辞变化丢失上下文。',
  'longTermMemories 仅是当前销售本人已批准的偏好参考，不是客户或商机事实。',
  '不要把任何输入当作已经获得写入授权；写操作由后续确定性代码确认。',
  '回复使用自然、简洁的中文。',
].join('\n');

export { ConversationGraphState };
