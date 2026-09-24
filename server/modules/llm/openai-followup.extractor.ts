import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { z } from 'zod';

import type { AxiosError, AxiosResponse } from 'axios';
import type {
  FollowupDraft,
  FollowupMissingField,
} from '@shared/api.interface';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import { FollowupExtractionUnavailableError } from '@server/modules/agent-core/agent.errors';
import type { FollowupExtractor } from '@server/modules/agent-core/agent.ports';
import type { FollowupExtractionInput } from '@server/modules/agent-core/agent.types';
import {
  followupDraftSchema,
  getMissingFields,
  parseFollowupDraft,
} from '@server/modules/agent-core/agent.validation';
import { redactErrorMessage } from '@server/modules/agent-core/agent.redaction';

const openAiResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().min(1),
      }),
    }),
  ).min(1),
});

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  temperature: number;
  thinking: {
    type: 'disabled';
  };
  messages: ChatMessage[];
  response_format: {
    type: 'json_object';
  };
}

const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = [0, 1_500, 3_000, 6_000];

const localIsoTime = (date: Date, timezone: string): string => {
  const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    },
  ).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((part: Intl.DateTimeFormatPart): boolean =>
      part.type === type)?.value;
  const offsetName: string | undefined = value('timeZoneName');
  const offset: string | undefined = offsetName === 'GMT'
    ? '+00:00'
    : offsetName?.replace('GMT', '');
  const year: string | undefined = value('year');
  const month: string | undefined = value('month');
  const day: string | undefined = value('day');
  const hour: string | undefined = value('hour');
  const minute: string | undefined = value('minute');
  const second: string | undefined = value('second');
  if (!year || !month || !day || !hour || !minute || !second || !offset) {
    throw new Error(`Unable to format local time for ${timezone}`);
  }
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
};

@Injectable()
export class OpenAiFollowupExtractor implements FollowupExtractor {
  private readonly logger: Logger = new Logger(
    OpenAiFollowupExtractor.name,
  );

  constructor(
    private readonly http: HttpService,
    @Inject(AGENT_CONFIG)
    private readonly config: AgentRuntimeConfig,
  ) {}

  async extract(input: FollowupExtractionInput): Promise<FollowupDraft> {
    const request: ChatCompletionRequest = this.createRequest(input);
    let latestError: Error | null = null;
    let latestRetryable = false;

    for (let attempt: number = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response: AxiosResponse<unknown> = await firstValueFrom(
          this.http.post<unknown>(
            `${this.config.llm.baseUrl}/chat/completions`,
            request,
            {
              headers: {
                Authorization: `Bearer ${this.config.llm.apiKey}`,
                'Content-Type': 'application/json',
              },
              timeout: 30_000,
            },
          ),
        );
        const draft: FollowupDraft = this.parseResponse(response.data);
        this.validateEvidence(input.combinedText, draft.evidenceQuotes);
        return draft;
      } catch (error: unknown) {
        latestError = this.toError(error);
        latestRetryable = this.isRetryable(error);
        this.logger.warn(
          `LLM extraction attempt ${attempt} failed for model ` +
            `${this.config.llm.model}: ${redactErrorMessage(latestError)}`,
        );
        if (attempt === MAX_ATTEMPTS || !latestRetryable) {
          break;
        }
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, RETRY_DELAY_MS[attempt]);
        });
      }
    }

    if (latestRetryable) {
      throw new FollowupExtractionUnavailableError();
    }
    throw latestError ?? new Error('LLM extraction failed');
  }

  getMissingFields(draft: FollowupDraft): FollowupMissingField[] {
    return getMissingFields(draft);
  }

  private createRequest(
    input: FollowupExtractionInput,
  ): ChatCompletionRequest {
    const previousDraft: string = input.previousDraft
      ? JSON.stringify(input.previousDraft)
      : 'null';
    const userPayload: string = JSON.stringify({
      currentText: input.currentText,
      combinedText: input.combinedText,
      previousDraft,
      timezone: input.timezone,
      nowInstant: input.now.toISOString(),
      nowLocal: localIsoTime(input.now, input.timezone),
    });
    const outputSchema: string = JSON.stringify(
      z.toJSONSchema(followupDraftSchema),
    );

    return {
      model: this.config.llm.model,
      temperature: 0,
      thinking: {
        type: 'disabled',
      },
      messages: [
        {
          role: 'system',
          content: [
            '你是销售跟进结构化提取器，只输出 JSON 对象，不输出 Markdown。',
            `输出必须符合这个 JSON Schema：${outputSchema}`,
            '不得补造客户、金额、动作或时间。未知字段使用 null 或空数组。',
            'dueAt 必须是可解析的 ISO 8601 时间；相对时间按给定 nowLocal 和 timezone 解析，并保留业务时区的显式 UTC offset。',
            'communicationAt 表示本次已经发生的沟通时间，必须是可解析的 ISO 8601 时间；相对时间按给定 nowLocal 和 timezone 解析，并保留业务时区的显式 UTC offset。',
            '相对时间不得把本地钟点直接标成 Z；例如 Asia/Shanghai 的 10:00 必须写成 10:00:00+08:00。',
            'communicationMethod 只表示本次已经发生的沟通方式；不得用下一步行动方式臆推。',
            'topic 只概括本次沟通中明确出现的主题；未知时输出 null。',
            'nextActionChannel 只表示下一步行动的地点或执行方式；不得用本次沟通方式臆推。',
            'nextActionParticipants 只记录来源中明确出现的下一步参与人；未知时输出空数组。',
            'evidenceQuotes 中每一项都必须是 combinedText 中逐字出现的连续原文。',
            'summary 用简洁中文概括已知事实，不添加推断。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: userPayload,
        },
      ],
      response_format: {
        type: 'json_object',
      },
    };
  }

  private parseResponse(value: unknown): FollowupDraft {
    const parsed = openAiResponseSchema.parse(value);
    const content: string = parsed.choices[0].message.content;
    const jsonValue: unknown = JSON.parse(content);
    return parseFollowupDraft(jsonValue);
  }

  private validateEvidence(source: string, quotes: string[]): void {
    const invalidQuote: string | undefined = quotes.find(
      (quote: string): boolean => !source.includes(quote),
    );
    if (invalidQuote) {
      throw new Error('LLM returned an evidence quote absent from source text');
    }
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private isRetryable(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const httpError: AxiosError = error as AxiosError;
    const status: number | undefined = httpError.response?.status;
    return status === 429 ||
      (status !== undefined && status >= 500) ||
      httpError.code === 'ECONNABORTED' ||
      httpError.code === 'ETIMEDOUT';
  }
}
