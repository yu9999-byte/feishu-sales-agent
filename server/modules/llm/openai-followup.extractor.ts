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

const NEXT_WEEKDAY = /下(?:周|星期)([一二三四五六日天])/gu;
const WEEKDAY_INDEX: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
};

const META_TEST_LABEL =
  /^(?:P\d+|S\d+|B\d+)?\s*(?:回归|联调|验收|冒烟|功能)?测试(?:消息|用例)?$/iu;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const removeMetaOpportunityName = (
  draft: FollowupDraft,
  input: FollowupExtractionInput,
): FollowupDraft => {
  const opportunityName: string | null = draft.opportunityName?.trim() ?? null;
  if (!opportunityName || !META_TEST_LABEL.test(opportunityName)) {
    return draft;
  }
  const escapedName: string = escapeRegExp(opportunityName);
  const explicitBusinessName = new RegExp(
    `(?:商机(?:名称)?|项目(?:名称)?|主题)\\s*(?:是|为|[:：])?\\s*${escapedName}`,
    'iu',
  );
  if (explicitBusinessName.test(input.combinedText)) {
    return draft;
  }
  const metaAnnotation = new RegExp(
    `(?:这是|仅供|用于|作为)\\s*${escapedName}(?:[。.!！]|$)`,
    'iu',
  );
  return metaAnnotation.test(input.combinedText)
    ? { ...draft, opportunityName: null }
    : draft;
};

const correctNextWeekDueAt = (
  draft: FollowupDraft,
  input: FollowupExtractionInput,
): FollowupDraft => {
  if (!draft.dueAt || Number.isNaN(Date.parse(draft.dueAt))) return draft;
  const nextStep: string = input.combinedText.match(
    /下一步[：:\s]?([^。；;\n]+)/u,
  )?.[1] ?? input.combinedText;
  if (/下(?:周|星期)[一二三四五六日天]\s*(?:之前|前)/u.test(nextStep)) {
    return { ...draft, dueAt: null };
  }
  const mentions: RegExpMatchArray[] = [...input.combinedText.matchAll(
    NEXT_WEEKDAY,
  )];
  const mentionedWeekdays: number[] = Array.from(new Set(
    mentions.flatMap((mention: RegExpMatchArray): number[] => {
      const weekday: number | undefined = WEEKDAY_INDEX[mention[1]];
      return weekday === undefined ? [] : [weekday];
    }),
  ));
  if (mentionedWeekdays.length !== 1) return draft;
  const weekday: number | undefined = mentionedWeekdays[0];
  if (weekday === undefined) return draft;

  const nowLocal: string = localIsoTime(input.now, input.timezone);
  const today: Date = new Date(`${nowLocal.slice(0, 10)}T00:00:00Z`);
  const dayOfWeek: number = today.getUTCDay() || 7;
  const daysUntilTarget: number = 7 - dayOfWeek + weekday;
  const target: Date = new Date(today);
  target.setUTCDate(today.getUTCDate() + daysUntilTarget);
  const targetDate: string = target.toISOString().slice(0, 10);
  const modelLocal: string = localIsoTime(
    new Date(draft.dueAt),
    input.timezone,
  );
  const localClock: string = modelLocal.slice(11, 19);
  const targetMidday: Date = new Date(`${targetDate}T12:00:00Z`);
  const offset: string = localIsoTime(targetMidday, input.timezone).slice(-6);
  return { ...draft, dueAt: `${targetDate}T${localClock}${offset}` };
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
        const draft: FollowupDraft = correctNextWeekDueAt(
          removeMetaOpportunityName(this.parseResponse(response.data), input),
          input,
        );
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
      salesContext: input.salesContext ?? null,
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
            '“下周五前”等只给日期不含具体钟点的下一步截止时间，dueAt 输出 null；不得把当前消息时刻当作执行时间。',
            'communicationMethod 只表示本次已经发生的沟通方式；不得用下一步行动方式臆推。',
            'topic 只概括本次沟通中明确出现的主题；未知时输出 null。',
            '不要把“这是P0测试”“回归测试”“测试消息”等测试标签、备注或元话语识别为商机名或主题。',
            'nextActionChannel 只表示下一步行动的地点或执行方式；不得用本次沟通方式臆推。',
            'nextActionParticipants 只记录来源中明确出现的下一步参与人；未知时输出空数组。',
            'evidenceQuotes 中每一项都必须是 combinedText 中逐字出现的连续原文。',
            'summary 用简洁中文概括已知事实，不添加推断。',
            'salesContext 仅用于客户/商机匹配、发现冲突和避免重复动作；不要把业务上下文里、但 combinedText 未提到的历史事实写入本次跟进 summary、progress 或 risks。',
            'agreements、decisionChain、competitors 只记录 combinedText 中明确出现的内容；未知时输出空数组。',
            '若 salesContext.conflicts 非空，不得静默采用任一来源的冲突值；保留 combinedText 中用户本次明确提供的内容，冲突来源和较新标记由确认卡展示。',
            '若 salesContext.status 为 needs_clarification 或 unavailable，不要擅自选择客户/商机；未知字段按 null 输出。',
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
