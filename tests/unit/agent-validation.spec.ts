import { HttpService } from '@nestjs/axios';
import { AxiosHeaders } from 'axios';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { AxiosResponse } from 'axios';
import type { Observable } from 'rxjs';
import type {
  FollowupDraft,
  FollowupProgressSnapshot,
  JsonObject,
  JsonValue,
  SalesContext,
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

const progressAssessment: FollowupProgressSnapshot = {
  state: 'advanced',
  headline: '本次沟通带来了新的商机进展',
  facts: [
    {
      id: 'message-0',
      kind: 'message',
      label: '本次沟通',
      content: '客户认可方案',
      quote: '客户认可方案',
      source: null,
    },
    {
      id: 'opportunity-1',
      kind: 'opportunity',
      label: '商机记录',
      content: '方案评估中',
      quote: null,
      source: {
        recordId: 'opportunity-1',
        recordUrl: 'https://feishu.cn/opportunity-1',
        sourceVersion: '2026-09-17T08:00:00.000Z',
      },
    },
  ],
  findings: [{
    id: 'progress_changed',
    kind: 'change',
    code: 'progress_changed',
    title: '本次沟通有新的进展',
    detail: '商机原进展为“方案评估中”，本次记录为“方案已认可”。',
    evidenceIds: ['message-0', 'opportunity-1'],
  }],
  recommendation: {
    action: '发送实施计划',
    dueAt: '2026-09-20T10:00:00+08:00',
    reason: '根据本次沟通和当前业务上下文整理，确认后才会执行。',
    evidenceIds: ['message-0'],
    requiresConfirmation: true,
    editableFields: ['nextAction', 'dueAt'],
  },
  warnings: [],
  assessedAt: '2026-09-18T02:00:00.000Z',
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

  it('round-trips a progress assessment while accepting legacy payloads', (): void => {
    const payload: PendingAction['payload'] = {
      ...pendingAction.payload,
      progressAssessment,
    };

    expect(parsePendingActionPayload(payload).progressAssessment)
      .toEqual(progressAssessment);
    expect(parsePendingActionPayload(pendingAction.payload).progressAssessment)
      .toBeUndefined();
    expect(() => parsePendingActionPayload({
      ...payload,
      progressAssessment: {
        ...progressAssessment,
        recommendation: {
          ...progressAssessment.recommendation,
          requiresConfirmation: false,
        },
      },
    })).toThrow();
  });

  it('round-trips an overdue task candidate in a persisted draft', (): void => {
    const salesContext: SalesContext = {
      status: 'ready',
      customer: {
        name: '北辰制造',
        contactName: '张总',
        latestSummary: '客户认可方案',
        lastFollowupAt: null,
        source: {
          recordId: 'customer-1',
          recordUrl: 'https://feishu.cn/customer-1',
          sourceVersion: null,
        },
      },
      customerCandidates: [],
      opportunities: [],
      recentFollowups: [],
      conflicts: [],
      tasks: [],
      warnings: [],
      readAt: '2026-09-25T08:00:00.000Z',
    };
    const payload: PendingAction['payload'] = {
      ...pendingAction.payload,
      salesContext,
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

    const { conflicts, ...legacySalesContext } = salesContext;
    expect(conflicts).toEqual([]);
    expect(parsePendingActionPayload({
      ...payload,
      salesContext: legacySalesContext,
    })).toEqual(payload);
  });

  it('shows both sources when business context facts conflict', (): void => {
    const opportunitySource = {
      recordId: 'opportunity-1',
      recordUrl: 'https://feishu.cn/opportunity-1',
      sourceVersion: '2026-09-24T02:00:00.000Z',
    };
    const followupSource = {
      recordId: 'followup-1',
      recordUrl: 'https://feishu.cn/followup-1',
      sourceVersion: '2026-09-25T02:00:00.000Z',
    };
    const context: SalesContext = {
      status: 'partial',
      customer: null,
      customerCandidates: [],
      opportunities: [{
        name: '北辰数字化项目',
        progress: '方案已确认',
        expectedAmount: null,
        nextAction: '提交实施方案',
        dueAt: null,
        source: opportunitySource,
      }],
      recentFollowups: [{
        summary: '客户要求先发送合同',
        opportunityRecordId: 'opportunity-1',
        nextAction: '发送合同',
        dueAt: null,
        source: followupSource,
      }],
      conflicts: [{
        field: 'nextAction',
        opportunityValue: '提交实施方案',
        followupValue: '发送合同',
        opportunitySource,
        followupSource,
        newerSource: 'followup',
      }],
      tasks: [],
      warnings: ['sales_context_source_conflict'],
      readAt: '2026-09-25T08:00:00.000Z',
    };
    const visibleContent: string = collectVisibleContent(
      createConfirmationCard({
        ...pendingAction,
        payload: { ...pendingAction.payload, salesContext: context },
      }) as JsonObject,
    ).join('\n');

    expect(visibleContent).toContain(
      '上下文冲突（下一步）：商机记录“提交实施方案”与跟进记录“发送合同”',
    );
    expect(visibleContent).toContain('跟进记录较新');
    expect(visibleContent).toContain('来源信息不一致');
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
        progressAssessment,
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
    expect(visibleContent).toContain('事实依据');
    expect(visibleContent).toContain('Agent 判断');
    expect(visibleContent).toContain('建议下一步');
    expect(visibleContent).toContain('确认后执行');
    expect(visibleContent).toContain('查看来源');
  });

  it('labels a withheld task preview without denying the recognized next step', (): void => {
    const action: PendingAction = {
      ...pendingAction,
      payload: {
        ...pendingAction.payload,
        progressAssessment,
        taskCandidates: [],
        selectedTaskCandidateIds: [],
      },
    };
    const visibleContent: string = collectVisibleContent(
      createConfirmationCard(action) as JsonObject,
    ).join('\n');

    expect(visibleContent).toContain('下一步建议已保留');
    expect(visibleContent).toContain('不创建待办');
    expect(visibleContent).not.toContain('本次未识别到可创建的下一步待办');
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

    const salesContext: SalesContext = {
      status: 'ready',
      customer: null,
      customerCandidates: [],
      opportunities: [],
      recentFollowups: [],
      conflicts: [],
      tasks: [],
      warnings: [],
      readAt: '2026-09-25T08:00:00.000Z',
    };
    await expect(extractor.extract({
      ...extractionInput,
      salesContext,
    })).resolves.toEqual(
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
            content: expect.stringMatching(
              /"nowLocal":"2026-09-18T10:00:00\+08:00".*"salesContext"/u,
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

  it('corrects repeated mentions of the same next weekday', async (): Promise<void> => {
    const http: HttpService = new HttpService();
    vi.spyOn(http, 'post').mockReturnValue(of(createResponse({
      ...validDraft,
      dueAt: '2026-09-29T10:00:00+08:00',
    })));
    const extractor: OpenAiFollowupExtractor = new OpenAiFollowupExtractor(
      http,
      runtimeConfig,
    );

    const result: FollowupDraft = await extractor.extract({
      ...extractionInput,
      currentText: '客户认可方案，客户下周五10点反馈，下周五10点发送材料。',
      combinedText: '客户认可方案，客户下周五10点反馈，下周五10点发送材料。',
      now: new Date('2026-09-26T00:46:27+08:00'),
    });

    expect(result.dueAt).toBe('2026-10-02T10:00:00+08:00');
  });

  it('requires a clock when the next action says only before next Friday', async (): Promise<void> => {
    const http: HttpService = new HttpService();
    vi.spyOn(http, 'post').mockReturnValue(of(createResponse({
      ...validDraft,
      dueAt: '2026-09-29T00:46:27+08:00',
    })));
    const extractor: OpenAiFollowupExtractor = new OpenAiFollowupExtractor(
      http,
      runtimeConfig,
    );

    const result: FollowupDraft = await extractor.extract({
      ...extractionInput,
      currentText: '客户认可方案，下周五前发送材料。',
      combinedText: '客户认可方案，下周五前发送材料。',
      now: new Date('2026-09-26T00:46:27+08:00'),
    });

    expect(result.dueAt).toBeNull();
  });

  it('does not treat a test annotation as the opportunity name', async (): Promise<void> => {
    const http: HttpService = new HttpService();
    vi.spyOn(http, 'post').mockReturnValue(of(createResponse({
      ...validDraft,
      opportunityName: 'P0测试',
    })));
    const extractor: OpenAiFollowupExtractor = new OpenAiFollowupExtractor(
      http,
      runtimeConfig,
    );

    const result: FollowupDraft = await extractor.extract({
      ...extractionInput,
      currentText: '客户认可方案，今天与华南科技沟通，这是P0测试。',
      combinedText: '客户认可方案，今天与华南科技沟通，这是P0测试。',
    });

    expect(result.opportunityName).toBeNull();
  });

  it('keeps an explicitly named test opportunity', async (): Promise<void> => {
    const http: HttpService = new HttpService();
    vi.spyOn(http, 'post').mockReturnValue(of(createResponse({
      ...validDraft,
      opportunityName: 'P0测试',
    })));
    const extractor: OpenAiFollowupExtractor = new OpenAiFollowupExtractor(
      http,
      runtimeConfig,
    );

    const result: FollowupDraft = await extractor.extract({
      ...extractionInput,
      currentText: '客户认可方案，商机名称：P0测试，客户已确认下一步。',
      combinedText: '客户认可方案，商机名称：P0测试，客户已确认下一步。',
    });

    expect(result.opportunityName).toBe('P0测试');
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
