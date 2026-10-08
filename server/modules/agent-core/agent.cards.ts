import type {
  AgentExecutionResult,
  FollowupDraft,
  FollowupTaskCandidate,
  JsonObject,
  JsonValue,
} from '@shared/api.interface';
import type { FollowupProjectRiskInsight } from '@server/modules/insight/followup-project-risk.service';
import type { PendingAction } from './agent.types';

const escapeMarkdown = (value: string): string =>
  value.replace(/[\\*~><\[\]()#:_]/gu, (character: string): string => {
    const code: number = character.codePointAt(0) ?? 0;
    return `&#${code};`;
  });

const createSourceLink = (url: string | null, label: string): string => {
  if (url === null) return '';
  try {
    const parsed: URL = new URL(url);
    const trustedHost: boolean =
      parsed.hostname === 'feishu.cn' ||
      parsed.hostname.endsWith('.feishu.cn') ||
      parsed.hostname === 'larksuite.com' ||
      parsed.hostname.endsWith('.larksuite.com');
    if (parsed.protocol !== 'https:' || !trustedHost) return '';
    return ` · [${label}](<${parsed.href}>)`;
  } catch {
    return '';
  }
};

const createBaseCard = (
  title: string,
  subtitle: string,
  template: 'blue' | 'green' | 'red' | 'yellow',
  status: string,
  elements: JsonValue[],
): JsonObject => ({
  schema: '2.0',
  config: {
    update_multi: true,
    width_mode: 'default',
    enable_forward: false,
    summary: {
      content: title,
    },
  },
  header: {
    title: {
      tag: 'plain_text',
      content: title,
    },
    subtitle: {
      tag: 'plain_text',
      content: subtitle,
    },
    template,
    icon: {
      tag: 'standard_icon',
      token: template === 'green' ? 'todo_colorful' : 'myai_colorful',
    },
    text_tag_list: [
      {
        tag: 'text_tag',
        text: {
          tag: 'plain_text',
          content: status,
        },
        color: template,
      },
    ],
  },
  body: {
    direction: 'vertical',
    padding: '12px 12px 20px 12px',
    vertical_spacing: '12px',
    elements,
  },
});

const toPickerDateTime = (value: string | null): string | undefined => {
  if (value === null) return undefined;
  const localMatch: RegExpMatchArray | null = value.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/u,
  );
  if (localMatch !== null) {
    return `${localMatch[1]} ${localMatch[2]}`;
  }
  const timestamp: number = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  const dateParts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    },
  ).formatToParts(new Date(timestamp));
  const parts: Map<string, string> = new Map(
    dateParts.map((part: Intl.DateTimeFormatPart): [string, string] => [
      part.type,
      part.value,
    ]),
  );
  const year: string | undefined = parts.get('year');
  const month: string | undefined = parts.get('month');
  const day: string | undefined = parts.get('day');
  const hour: string | undefined = parts.get('hour');
  const minute: string | undefined = parts.get('minute');
  if (!year || !month || !day || !hour || !minute) return undefined;
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

const createFollowupInputCard = (action: PendingAction): JsonObject => {
  const form = action.payload.inputForm ?? {};
  const communicationAt: string | undefined = form.communicationAt
    ? toPickerDateTime(form.communicationAt)
    : undefined;
  const dueAt: string | undefined = form.dueAt
    ? toPickerDateTime(form.dueAt)
    : undefined;
  const errorElements: JsonValue[] = action.payload.inputError
    ? [{
        tag: 'markdown',
        content: `<font color='red'>${escapeMarkdown(
          action.payload.inputError,
        )}</font>`,
      }]
    : [];
  return createBaseCard(
    '录入销售跟进',
    '填写沟通内容后，AI 会先生成可编辑草案；此步不会写入业务系统',
    'blue',
    '待填写',
    [
      ...errorElements,
      {
      tag: 'form',
      name: 'followup_input_form',
      direction: 'vertical',
      vertical_spacing: '12px',
      padding: '12px',
      elements: [
        {
          tag: 'input',
          name: 'customerName',
          label: { tag: 'plain_text', content: '客户' },
          required: true,
          default_value: form.customerName ?? '',
          max_length: 200,
          width: 'fill',
        },
        {
          tag: 'input',
          name: 'contactName',
          label: { tag: 'plain_text', content: '联系人' },
          default_value: form.contactName ?? '',
          max_length: 100,
          width: 'fill',
        },
        {
          tag: 'input',
          name: 'communicationMethod',
          label: { tag: 'plain_text', content: '沟通方式' },
          required: true,
          default_value: form.communicationMethod ?? '',
          max_length: 100,
          width: 'fill',
        },
        {
          tag: 'markdown',
          content: '**沟通时间**',
          text_size: 'notation',
        },
        {
          tag: 'picker_datetime',
          name: 'communicationAt',
          required: true,
          initial_datetime: communicationAt,
          placeholder: communicationAt ? undefined : {
            tag: 'plain_text',
            content: '请选择沟通时间',
          },
          width: 'fill',
        },
        {
          tag: 'input',
          name: 'topic',
          label: { tag: 'plain_text', content: '沟通主题' },
          default_value: form.topic ?? '',
          max_length: 200,
          width: 'fill',
        },
        {
          tag: 'input',
          name: 'communicationContent',
          label: { tag: 'plain_text', content: '沟通原文' },
          input_type: 'multiline_text',
          rows: 5,
          // Feishu Card 2.0 input.max_length is capped at 1000.
          max_length: 1000,
          required: true,
          default_value: form.communicationContent ?? '',
          width: 'fill',
        },
        {
          tag: 'input',
          name: 'nextAction',
          label: { tag: 'plain_text', content: '待办内容' },
          default_value: form.nextAction ?? '',
          max_length: 500,
          width: 'fill',
        },
        {
          tag: 'markdown',
          content: '**待办截止时间**',
          text_size: 'notation',
        },
        {
          tag: 'picker_datetime',
          name: 'dueAt',
          initial_datetime: dueAt,
          placeholder: dueAt ? undefined : {
            tag: 'plain_text',
            content: '请选择执行时间',
          },
          width: 'fill',
        },
        {
          tag: 'input',
          name: 'nextActionChannel',
          label: { tag: 'plain_text', content: '待办执行方式' },
          default_value: form.nextActionChannel ?? '',
          max_length: 200,
          width: 'fill',
        },
        {
          tag: 'input',
          name: 'nextActionParticipants',
          label: { tag: 'plain_text', content: '待办参与人' },
          default_value: (form.nextActionParticipants ?? []).join('、'),
          max_length: 500,
          width: 'fill',
        },
        {
          tag: 'button',
          name: 'submit_followup_input',
          text: {
            tag: 'plain_text',
            content: '生成跟进草案',
          },
          type: 'primary_filled',
          width: 'fill',
          form_action_type: 'submit',
        },
      ],
      },
    ],
  );
};

const createDraftGenerationProcessingCard = (): JsonObject =>
  createBaseCard(
    '正在生成跟进草案',
    'AI 正在整理沟通内容',
    'blue',
    '生成中',
    [{
      tag: 'markdown',
      content: '请稍候，完成后会在这张卡片中展示草案。业务数据尚未写入。',
    }],
  );

const opportunityStatusLabels: Record<string, string> = {
  active: '进行中',
  won: '已赢单',
  lost: '已丢单',
  closed: '已关闭',
  unknown: '未设置',
};

const createOpportunityStatusConfirmationCard = (
  action: PendingAction,
): JsonObject => {
  const update = action.payload.opportunityStatusUpdate;
  if (!update) {
    return createBaseCard(
      '商机状态确认失败',
      '状态数据不完整，尚未修改业务数据',
      'red',
      '无法确认',
      [{
        tag: 'markdown',
        content: '请重新发送包含完整商机名称和目标状态的请求。',
      }],
    );
  }
  const sourceLink: string = createSourceLink(
    update.recordUrl ?? null,
    '打开商机记录',
  );
  return createBaseCard(
    '商机状态变更确认',
    '确认后只修改商机状态字段',
    'yellow',
    '待确认',
    [
      {
        tag: 'markdown',
        content: `**商机：**${escapeMarkdown(update.opportunityName)}${sourceLink}\n` +
          `**当前状态：**${opportunityStatusLabels[update.expectedStatus]}\n` +
          `**变更为：**${opportunityStatusLabels[update.targetStatus]}\n\n` +
          '确认后系统会再次核对负责人和当前状态，状态发生变化时将拒绝执行。',
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '确认变更商机状态' },
        type: 'primary_filled',
        width: 'fill',
        behaviors: [{
          type: 'callback',
          value: { action: 'confirm', pendingActionId: action.id },
        }],
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '取消本次变更' },
        type: 'text',
        width: 'fill',
        behaviors: [{
          type: 'callback',
          value: { action: 'cancel', pendingActionId: action.id },
        }],
      },
    ],
  );
};

const createConfirmationCard = (action: PendingAction): JsonObject => {
  if (action.payload.actionKind === 'opportunity_status') {
    return createOpportunityStatusConfirmationCard(action);
  }
  if (action.payload.interactionStage === 'input') {
    return createFollowupInputCard(action);
  }
  const draft: FollowupDraft = action.payload.draft;
  const draftVersion: number = action.payload.draftVersion ?? 1;
  const taskCandidate: FollowupTaskCandidate | undefined =
    (action.payload.taskCandidates ?? [])[0];
  const readyTask: FollowupTaskCandidate | undefined =
    (action.payload.taskCandidates ?? []).find(
    (candidate: FollowupTaskCandidate): boolean =>
      candidate.status === 'ready',
  );
  const dueAt: string | undefined = toPickerDateTime(draft.dueAt);
  const communicationAt: string | undefined = toPickerDateTime(
    action.payload.inputForm?.communicationAt ??
      draft.communicationAt ??
      null,
  );
  const taskIssue: string | null = readyTask
    ? null
    : draft.nextAction === null || draft.nextAction.trim().length === 0 ||
      taskCandidate === undefined
      ? '请补充可执行的待办内容后再提交。'
      : draft.dueAt === null || Number.isNaN(Date.parse(draft.dueAt))
        ? '请补充有效的待办截止时间后再提交。'
        : '待办截止时间已过期，请修改后再提交。';
  const followupIssue: string | null = draft.customerName === null ||
    draft.customerName.trim().length === 0
    ? '请补充客户后再提交。'
    : null;

  return createBaseCard(
    '销售跟进草案',
    `v${draftVersion} · 确认后将同时保存跟进并创建待办`,
    'blue',
    '待确认',
    [
      {
        tag: 'form',
        name: 'followup_draft_form',
        direction: 'vertical',
        vertical_spacing: '12px',
        padding: '12px',
        elements: [
          {
            tag: 'markdown',
            content: '**一、跟进内容**',
          },
          ...(followupIssue === null ? [] : [{
            tag: 'markdown',
            content: `<font color='red'>${followupIssue}</font>`,
          }]),
          {
            tag: 'input',
            name: 'generatedBody',
            label: { tag: 'plain_text', content: '跟进内容' },
            input_type: 'multiline_text',
            rows: 4,
            max_length: 1000,
            required: true,
            default_value: action.payload.generatedBody ?? draft.summary,
            width: 'fill',
          },
          {
            tag: 'input',
            name: 'customerName',
            label: { tag: 'plain_text', content: '客户' },
            required: true,
            default_value: draft.customerName ?? '',
            max_length: 200,
            width: 'fill',
          },
          {
            tag: 'input',
            name: 'contactName',
            label: { tag: 'plain_text', content: '联系人' },
            default_value: draft.contactName ?? '',
            max_length: 100,
            width: 'fill',
          },
          {
            tag: 'input',
            name: 'communicationMethod',
            label: { tag: 'plain_text', content: '沟通方式' },
            default_value: action.payload.inputForm?.communicationMethod ?? '',
            max_length: 100,
            width: 'fill',
          },
          {
            tag: 'markdown',
            content: '**沟通时间**',
            text_size: 'notation',
          },
          {
            tag: 'picker_datetime',
            name: 'communicationAt',
            initial_datetime: communicationAt,
            placeholder: communicationAt ? undefined : {
              tag: 'plain_text',
              content: '请选择沟通时间',
            },
            width: 'fill',
          },
          {
            tag: 'input',
            name: 'topic',
            label: { tag: 'plain_text', content: '沟通主题' },
            default_value: action.payload.inputForm?.topic ?? '',
            max_length: 200,
            width: 'fill',
          },
          {
            tag: 'hr',
          },
          {
            tag: 'markdown',
            content: '**二、待办**',
          },
          ...(taskIssue === null ? [] : [{
            tag: 'markdown',
            content: `<font color='red'>${taskIssue}</font>`,
          }]),
          {
            tag: 'input',
            name: 'nextAction',
            label: { tag: 'plain_text', content: '待办内容' },
            required: true,
            default_value: draft.nextAction ?? '',
            max_length: 500,
            width: 'fill',
          },
          {
            tag: 'markdown',
            content: '**待办截止时间**',
            text_size: 'notation',
          },
          {
            tag: 'picker_datetime',
            name: 'dueAt',
            required: true,
            initial_datetime: dueAt,
            placeholder: dueAt ? undefined : {
              tag: 'plain_text',
              content: '请选择执行时间',
            },
            width: 'fill',
          },
          {
            tag: 'input',
            name: 'nextActionChannel',
            label: { tag: 'plain_text', content: '待办执行方式' },
            default_value: draft.nextActionChannel ?? '',
            max_length: 200,
            width: 'fill',
          },
          {
            tag: 'input',
            name: 'nextActionParticipants',
            label: { tag: 'plain_text', content: '待办参与人' },
            default_value: (draft.nextActionParticipants ?? []).join('、'),
            max_length: 500,
            width: 'fill',
          },
          {
            tag: 'markdown',
            content: '**待办负责人**\n当前销售本人',
            text_size: 'notation',
          },
          {
            tag: 'hr',
          },
          {
            tag: 'markdown',
            content: '**三、提交**\n提交后将一次性保存跟进并创建上述待办。',
          },
          {
            tag: 'button',
            name: `confirm_followup_v${draftVersion}`,
            text: {
              tag: 'plain_text',
              content: '保存跟进并创建待办',
            },
            type: 'primary_filled',
            width: 'fill',
            form_action_type: 'submit',
          },
        ],
      },
    ],
  );
};

const createProcessingCard = (): JsonObject =>
  createBaseCard(
    '正在执行销售动作',
    '已收到确认，正在保存跟进并创建待办',
    'blue',
    '执行中',
    [
      {
        tag: 'column_set',
        flex_mode: 'none',
        columns: [
          {
            tag: 'column',
            width: 'weighted',
            weight: 1,
            background_style: 'blue-50',
            padding: '12px',
            elements: [
              {
                tag: 'markdown',
                content:
                  '**执行中，请等待**\n将依次写入客户、商机、跟进，' +
                  '并创建飞书待办。',
              },
            ],
          },
        ],
      },
      {
        tag: 'markdown',
        content: '<font color=\'grey\'>请勿重复点击，完成后卡片会自动更新。</font>',
        text_size: 'notation',
      },
    ],
  );

const createCancelledCard = (): JsonObject =>
  createBaseCard(
    '已取消销售动作',
    '未写入业务数据，也未创建任务',
    'yellow',
    '已取消',
    [
      {
        tag: 'column_set',
        flex_mode: 'none',
        columns: [
          {
            tag: 'column',
            width: 'weighted',
            weight: 1,
            background_style: 'yellow-50',
            padding: '12px',
            elements: [
              {
                tag: 'markdown',
                content: '**操作已取消**\n你可以重新发送一条跟进进行修改。',
              },
            ],
          },
        ],
      },
    ],
  );

const createResultCard = (result: AgentExecutionResult): JsonObject => {
  if (result.status === 'succeeded' && result.opportunityStatus) {
    const statusResult = result.opportunityStatus;
    const recordLink: string = result.opportunityRecordUrl
      ? `[打开商机记录](${result.opportunityRecordUrl})`
      : '商机记录已更新';
    return createBaseCard(
      '商机状态已更新',
      '已完成一次确认后的状态变更',
      'green',
      '成功',
      [{
        tag: 'markdown',
        content: `**${escapeMarkdown(statusResult.opportunityName)}**\n` +
          `${opportunityStatusLabels[statusResult.previousStatus]} → ` +
          `${opportunityStatusLabels[statusResult.status]}\n\n${recordLink}`,
      }],
    );
  }
  if (result.status === 'succeeded') {
    const taskCreated: boolean = Boolean(result.taskGuid);
    const taskLink: string = result.taskAction === 'unchanged'
      ? result.taskUrl
        ? `已有待办未更新 · [打开飞书任务](${result.taskUrl})`
        : '已有待办未更新'
      : result.taskUrl
        ? `[打开飞书任务](${result.taskUrl})`
        : result.taskAction === 'updated'
          ? '待办已更新'
          : taskCreated
            ? '待办已创建'
            : '本次未创建待办';
    const followupLink: string = result.followupRecordUrl
      ? `[查看跟进记录](${result.followupRecordUrl})`
      : '跟进记录已保存';

    const successElements: JsonValue[] = [
      {
        tag: 'column_set',
        flex_mode: 'none',
        columns: [
          {
            tag: 'column',
            width: 'weighted',
            weight: 1,
            background_style: 'green-50',
            padding: '12px',
            elements: [
              {
                tag: 'markdown',
                content: `**跟进登记成功**\n客户、商机和跟进已写入。` +
                  `\n\n${followupLink}\n\n${taskLink}`,
              },
            ],
          },
        ],
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '编辑跟进' },
        type: 'default',
        width: 'fill',
        behaviors: [{
          type: 'callback',
          value: {
            action: 'edit',
            pendingActionId: result.pendingActionId,
          },
        }],
      },
    ];
    return createBaseCard(
      '跟进登记成功',
      result.taskAction === 'updated'
        ? '业务记录已保存，原待办已更新'
        : result.taskAction === 'unchanged'
          ? '业务记录已保存，原待办保持不变'
          : taskCreated
            ? '业务记录已保存，所选本人待办已创建'
            : '业务记录已保存，本次未创建待办',
      'green',
      '成功',
      successElements,
    );
  }

  const retryAllowed: boolean =
    result.status === 'failed' || result.status === 'partialFailure';
  const elements: JsonValue[] = [
    {
      tag: 'column_set',
      flex_mode: 'none',
      columns: [
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          background_style: 'red-50',
          padding: '12px',
          elements: [
            {
              tag: 'markdown',
              content: `**执行未完成**\n${escapeMarkdown(
                result.errorMessage ?? '外部服务暂时不可用',
              )}`,
            },
          ],
        },
      ],
    },
  ];

  if (retryAllowed) {
    elements.push({
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: '重试未完成步骤',
      },
      type: 'primary_filled',
      width: 'fill',
      behaviors: [
        {
          type: 'callback',
          value: {
            action: 'retry',
            pendingActionId: result.pendingActionId,
          },
        },
      ],
    });
  }

  elements.push({
    tag: 'button',
    text: {
      tag: 'plain_text',
      content: '返回编辑',
    },
    type: 'default',
    width: 'fill',
    behaviors: [
      {
        type: 'callback',
        value: {
          action: 'edit',
          pendingActionId: result.pendingActionId,
        },
      },
    ],
  });

  return createBaseCard(
    '销售动作未完成',
    result.status === 'partialFailure'
      ? '已保留成功步骤，重试不会重复创建'
      : '尚未完成业务写入',
    'red',
    result.status === 'partialFailure' ? '部分失败' : '失败',
    elements,
  );
};

const createProjectRiskCard = (
  action: PendingAction,
  insight: FollowupProjectRiskInsight,
): JsonObject => {
  const hasHighRisk: boolean = insight.risks.some(
    (risk): boolean => risk.severity === 'high',
  );
  const riskElements: JsonValue[] = insight.risks.map(
    (risk): JsonValue => ({
      tag: 'column_set',
      flex_mode: 'none',
      columns: [{
        tag: 'column',
        width: 'weighted',
        weight: 1,
        background_style: risk.severity === 'high' ? 'red-50' : 'yellow-50',
        padding: '12px',
        elements: [{
          tag: 'markdown',
          content: `**${escapeMarkdown(risk.label)}**\n` +
            `**证据：**「${escapeMarkdown(risk.evidence)}」\n\n` +
            `**建议：**${escapeMarkdown(risk.suggestion)}`,
        }],
      }],
    }),
  );
  const customerName: string =
    action.payload.draft.customerName ?? '当前客户';

  return createBaseCard(
    '项目推进风险提醒',
    `${customerName} · 本次已确认跟进命中新可行动信号`,
    hasHighRisk ? 'red' : 'yellow',
    '需关注',
    [
      {
        tag: 'markdown',
        content: '**项目健康度**\n样本不足，暂不生成项目健康度评分。',
      },
      ...riskElements,
      {
        tag: 'markdown',
        text_size: 'notation',
        content: '<font color=\'grey\'>本卡只依据本次已确认原文，' +
          '不会代替完整项目历史分析。</font>',
      },
    ],
  );
};

const createAlreadyHandledCard = (
  result: AgentExecutionResult,
): JsonObject =>
  result.status === 'cancelled'
    ? createCancelledCard()
    : createResultCard(result);

export {
  createAlreadyHandledCard,
  createCancelledCard,
  createConfirmationCard,
  createDraftGenerationProcessingCard,
  createProcessingCard,
  createProjectRiskCard,
  createResultCard,
};
