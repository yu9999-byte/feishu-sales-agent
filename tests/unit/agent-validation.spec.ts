import { HttpService } from '@nestjs/axios';
import { AxiosHeaders } from 'axios';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { AxiosResponse } from 'axios';
import type { Observable } from 'rxjs';
import type {
  FollowupDraft,
  JsonObject,
  JsonValue,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import {
  createConfirmationCard,
  createResultCard,
} from '@server/modules/agent-core/agent.cards';
import { FollowupExtractionUnavailableError } from '@server/modules/agent-core/agent.errors';
import { redactSensitiveText } from '@server/modules/agent-core/agent.redaction';
import {
  getMissingFields,
  parseFollowupDraft,
  parsePendingActionPayload,
} from '@server/modules/agent-core/agent.validation';
import type {
  FollowupExtractionInput,
  PendingAction,
} from '@server/modules/agent-core/agent.types';
import { OpenAiFollowupExtractor } from '@server/modules/llm/openai-followup.extractor';

const validDraft: FollowupDraft = {
  customerName: '北辰制造',
  contactName: '张总',
  opportunityName: '北辰数字化项目',
  communicationMethod: '飞书',
  communicationAt: '2026-09-18T10:00:00+08:00',
  topic: '试点方案确认',
  summary: '客户认可方案，下一步发送实施计划。',
  customerNeeds: ['实施计划'],
  objections: [],
  risks: ['采购周期待确认'],
  progress: '方案已认可',
  expectedAmount: 500000,
  nextAction: '发送实施计划',
  dueAt: '2026-09-20T10:00:00+08:00',
  evidenceQuotes: ['客户认可方案'],
};

const runtimeConfig: AgentRuntimeConfig = {
  host: '127.0.0.1',
  port: 3100,
  databaseUrl: 'postgres://unused',
  llm: {
    baseUrl: 'https://llm.example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
  },
  feishu: {
    verificationToken: 'test-verification-token',
    encryptKey: 'test-encrypt-key',
  },
};

const extractionInput: FollowupExtractionInput = {
  currentText: '客户认可方案，下一步发送实施计划。',
  combinedText: '客户认可方案，下一步发送实施计划。',
  previousDraft: null,
  timezone: 'Asia/Shanghai',
  now: new Date('2026-09-18T10:00:00+08:00'),
};

const pendingAction: PendingAction = {
  id: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  actorOpenId: 'ou_test',
  chatId: 'oc_test',
  cardMessageId: null,
  status: 'pendingConfirmation',
  payload: {
    version: 1,
    sourceMessageId: 'om_source',
    rawText: extractionInput.combinedText,
    draft: validDraft,
  },
  result: {
    pendingActionId: '00000000-0000-4000-8000-000000000001',
    status: 'pendingConfirmation',
  },
  expiresAt: new Date('2026-09-19T10:00:00+08:00'),
  createdAt: new Date('2026-09-18T10:00:00+08:00'),
  updatedAt: new Date('2026-09-18T10:00:00+08:00'),
};

const createResponse = (draft: FollowupDraft): AxiosResponse<unknown> => ({
  data: {
    choices: [
      {
        message: {
          content: JSON.stringify(draft),
        },
      },
    ],
  },
  status: 200,
  statusText: 'OK',
  headers: {},
  config: {
    headers: new AxiosHeaders(),
  },
});

const collectVisibleContent = (value: JsonValue): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item: JsonValue): string[] =>
      collectVisibleContent(item),
    );
  }
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(
    ([key, child]: [string, JsonValue]): string[] => {
      if (key === 'content' && typeof child === 'string') return [child];
      return collectVisibleContent(child);
    },
  );
};

describe('follow-up validation', (): void => {
  it('accepts a complete structured draft', (): void => {
    expect(parseFollowupDraft(validDraft)).toEqual(validDraft);
    expect(getMissingFields(validDraft)).toEqual([]);
  });

  it('reports missing business fields and invalid dates', (): void => {
    const incomplete: FollowupDraft = {
      ...validDraft,
      customerName: null,
      nextAction: null,
      dueAt: 'not-a-date',
    };

    expect(getMissingFields(incomplete)).toEqual([
      'customerName',
      'nextAction',
      'dueAt',
    ]);
  });

  it('rejects invalid structured field types', (): void => {
    const invalid: Record<string, unknown> = {
      ...validDraft,
      expectedAmount: '500000',
    };

    expect((): FollowupDraft => parseFollowupDraft(invalid)).toThrow();
  });

  it('round-trips an overdue task candidate in a persisted draft', (): void => {
    const payload: PendingAction['payload'] = {
      ...pendingAction.payload,
      taskCandidates: [{
        id: `${pendingAction.id}:v1:task:0`,
        draftId: pendingAction.id,
        draftVersion: 1,
        ownerMemberId: 'member-1',
        title: '发送产品报价方案',
        dueAt: '2026-09-19T18:00:00+08:00',
        channel: '飞书',
        participants: ['王经理'],
        customerName: validDraft.customerName,
        opportunityName: validDraft.opportunityName,
        status: 'needs_input',
        missingFields: ['pastDueAt'],
      }],
    };

    expect(parsePendingActionPayload(JSON.parse(JSON.stringify(payload))))
      .toEqual(payload);
  });

  it('builds a Card 2.0 confirmation with opaque callback values', (): void => {
    const action: PendingAction = {
      ...pendingAction,
      payload: {
        ...pendingAction.payload,
        draftVersion: 1,
        generatedBody: '北辰制造：客户认可方案。',
        quality: {
          score: 76,
          grade: 'B',
          confirmable: true,
          scoreVersion: 'followup-quality-v1',
          dimensions: {
            basics: 20, dealFacts: 10, nextStep: 20,
            evidence: 16, writing: 10,
          },
          missingItems: ['communicationMethod', 'communicationAt'],
          invalidEvidence: [],
          risks: ['budget_unknown'],
          suggestions: [
            '请补充 communicationMethod',
            '请补充 communicationAt',
            '建议补充预算信息',
          ],
        },
        taskCandidates: [{
          id: `${pendingAction.id}:v1:task:0`,
          draftId: pendingAction.id,
          draftVersion: 1,
          ownerMemberId: 'member-1',
          title: '发送实施计划',
          dueAt: validDraft.dueAt,
          channel: '邮件',
          participants: ['张总'],
          customerName: validDraft.customerName,
          opportunityName: validDraft.opportunityName,
          status: 'ready',
          missingFields: [],
        }],
        selectedTaskCandidateIds: [`${pendingAction.id}:v1:task:0`],
      },
    };
    const serialized: string = JSON.stringify(
      createConfirmationCard(action),
    );
    const visibleContent: string = collectVisibleContent(
      createConfirmationCard(action) as JsonObject,
    ).join('\n');

    expect(serialized).toContain('"schema":"2.0"');
    expect(serialized).toContain('"tag":"form"');
    expect(serialized).toContain('"name":"generatedBody"');
    expect(serialized).toContain('"name":"task_0"');
    expect(serialized).not.toContain('"name":"review_followup_v1"');
    expect(serialized).toContain('"name":"confirm_followup_v1"');
    expect(serialized).toContain('"form_action_type":"submit"');
    expect(serialized).toContain('"action":"cancel"');
    expect(serialized).toContain(
      '"pendingActionId":"00000000-0000-4000-8000-000000000001"',
    );
    expect(serialized).not.toContain('tenantId');
    expect(serialized).not.toContain('rawText');
    expect(serialized).not.toContain('appToken');
    expect(serialized).toContain('保存前检查');
    expect(serialized).toContain('建议补充');
    expect(serialized).not.toContain('保存前质检');
    expect(serialized).not.toContain('等级 B');
    expect(serialized).not.toContain('>76<');
    expect(serialized).not.toContain('保存修改并重新质检');
    expect(serialized).not.toContain('检查修改');
    expect(visibleContent).not.toContain('communicationMethod');
    expect(visibleContent).not.toContain('communicationAt');
    expect(visibleContent.match(/补充沟通方式/gu)).toHaveLength(1);
    expect(visibleContent.match(/补充沟通时间/gu)).toHaveLength(1);
  });

  it('describes a successful save without claiming an uncreated task', (): void => {
    const serialized: string = JSON.stringify(createResultCard({
      pendingActionId: pendingAction.id,
      status: 'succeeded',
      customerRecordId: 'rec-customer',
      opportunityRecordId: 'rec-opportunity',
      followupRecordId: 'rec-followup',
      followupRecordUrl: 'https://base.example/followups/rec-followup',
    }));

    expect(serialized).toContain('跟进登记成功');
    expect(serialized).toContain('查看跟进记录');
    expect(serialized)
      .toContain('https://base.example/followups/rec-followup');
    expect(serialized).toContain('未创建待办');
    expect(serialized).not.toContain('任务已创建');
    expect(serialized).toContain('编辑跟进');
    expect(serialized).toContain('"action":"edit"');
  });

  it('redacts credentials from log-safe text', (): void => {
    const secretText: string = [
      'Authorization: Bearer bearer-secret',
      'appSecret=app-secret',
      'api_key: api-secret',
      'callbackToken="callback-secret"',
    ].join(' ');
    const redacted: string = redactSensitiveText(secretText);

    expect(redacted).not.toContain('bearer-secret');
    expect(redacted).not.toContain('app-secret');
    expect(redacted).not.toContain('api-secret');
    expect(redacted).not.toContain('callback-secret');
    expect(redacted.match(/\[REDACTED\]/gu)).toHaveLength(4);
  });

  it('accepts evidence copied from the source text', async (): Promise<void> => {
    const http: HttpService = new HttpService();
    const response$: Observable<AxiosResponse<unknown>> = of(
      createResponse(validDraft),
    );
    const post = vi.spyOn(http, 'post').mockReturnValue(response$);
    const extractor: OpenAiFollowupExtractor =
      new OpenAiFollowupExtractor(http, runtimeConfig);

    await expect(extractor.extract(extractionInput)).resolves.toEqual(
      validDraft,
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      'https://llm.example.test/v1/chat/completions',
      expect.objectContaining({
        model: 'test-model',
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining(
              'Asia/Shanghai 的 10:00 必须写成 10:00:00+08:00',
            ),
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining(
              '"nowLocal":"2026-09-18T10:00:00+08:00"',
            ),
          }),
        ]),
      }),
      expect.any(Object),
    );
  });

  it('corrects next Tuesday in the business timezone without changing the clock', async (): Promise<void> => {
    const http: HttpService = new HttpService();
    const post = vi.spyOn(http, 'post').mockReturnValue(of(createResponse({
      ...validDraft,
      dueAt: '2026-09-25T10:00:00+08:00',
    })));
    const extractor: OpenAiFollowupExtractor = new OpenAiFollowupExtractor(
      http,
      runtimeConfig,
    );

    const result: FollowupDraft = await extractor.extract({
      ...extractionInput,
      currentText: '下一步下周二上午10点发送报价。',
      combinedText: '客户认可方案，下一步下周二上午10点发送报价。',
      now: new Date('2026-09-23T13:40:15+08:00'),
    });

    expect(result.dueAt).toBe('2026-09-29T10:00:00+08:00');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not infer a due date from a weekday when the model found none', async (): Promise<void> => {
    const http: HttpService = new HttpService();
    vi.spyOn(http, 'post').mockReturnValue(of(createResponse({
      ...validDraft,
      dueAt: null,
    })));
    const extractor: OpenAiFollowupExtractor = new OpenAiFollowupExtractor(
      http,
      runtimeConfig,
    );

    const result: FollowupDraft = await extractor.extract({
      ...extractionInput,
      combinedText: '客户认可方案，客户下周二确认预算。',
    });
    expect(result.dueAt).toBeNull();
  });

  it('does not retry hallucinated evidence', async (): Promise<void> => {
    const http: HttpService = new HttpService();
    const hallucinated: FollowupDraft = {
      ...validDraft,
      evidenceQuotes: ['原文中不存在的证据'],
    };
    const response$: Observable<AxiosResponse<unknown>> = of(
      createResponse(hallucinated),
    );
    const post = vi.spyOn(http, 'post').mockReturnValue(response$);
    const extractor: OpenAiFollowupExtractor =
      new OpenAiFollowupExtractor(http, runtimeConfig);

    await expect(extractor.extract(extractionInput)).rejects.toThrow(
      'evidence quote absent from source text',
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('backs off and retries a transient model 429', async (): Promise<void> => {
    const http: HttpService = new HttpService();
    const busy$: Observable<AxiosResponse<unknown>> = throwError(
      (): Error => Object.assign(new Error('model busy'), {
        response: { status: 429 },
      }),
    );
    const post = vi.spyOn(http, 'post')
      .mockReturnValueOnce(busy$)
      .mockReturnValueOnce(of(createResponse(validDraft)));
    const extractor: OpenAiFollowupExtractor =
      new OpenAiFollowupExtractor(http, runtimeConfig);

    await expect(extractor.extract(extractionInput)).resolves.toEqual(
      validDraft,
    );
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('surfaces exhausted model 429 attempts as unavailable', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const http: HttpService = new HttpService();
      const busy$: Observable<AxiosResponse<unknown>> = throwError(
        (): Error => Object.assign(new Error('model busy'), {
          response: { status: 429 },
        }),
      );
      const post = vi.spyOn(http, 'post').mockReturnValue(busy$);
      const extractor: OpenAiFollowupExtractor =
        new OpenAiFollowupExtractor(http, runtimeConfig);
      const result: Promise<FollowupDraft> = extractor.extract(extractionInput);
      const assertion: Promise<void> = expect(result).rejects.toBeInstanceOf(
        FollowupExtractionUnavailableError,
      );
      await vi.runAllTimersAsync();
      await assertion;
      expect(post).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off and retries a transient timeout', async (): Promise<void> => {
    const http: HttpService = new HttpService();
    const timedOut$: Observable<AxiosResponse<unknown>> = throwError(
      (): Error => Object.assign(new Error('timeout'), {
        code: 'ECONNABORTED',
      }),
    );
    const post = vi.spyOn(http, 'post')
      .mockReturnValueOnce(timedOut$)
      .mockReturnValueOnce(of(createResponse(validDraft)));
    const extractor: OpenAiFollowupExtractor =
      new OpenAiFollowupExtractor(http, runtimeConfig);

    await expect(extractor.extract(extractionInput)).resolves.toEqual(
      validDraft,
    );
    expect(post).toHaveBeenCalledTimes(2);
  });
});
