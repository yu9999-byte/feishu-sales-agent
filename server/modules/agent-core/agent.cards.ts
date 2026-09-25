import type {
  AgentExecutionResult,
  FollowupDraft,
  FollowupQualitySnapshot,
  FollowupTaskCandidate,
  FollowupTaskMissingField,
  JsonObject,
  JsonValue,
  SalesContext,
} from '@shared/api.interface';
import type { FollowupProjectRiskInsight } from '@server/modules/insight/followup-project-risk.service';
import type { PendingAction } from './agent.types';

const escapeMarkdown = (value: string): string =>
  value.replace(/[\\*~><\[\]()#:_]/gu, (character: string): string => {
    const code: number = character.codePointAt(0) ?? 0;
    return `&#${code};`;
  });

const formatList = (items: string[]): string =>
  items.length > 0
    ? items.map((item: string): string => escapeMarkdown(item)).join('；')
    : '未识别';

const formatAmount = (amount: number | null): string =>
  amount === null
    ? '未提供'
    : new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: 'CNY',
        maximumFractionDigits: 0,
      }).format(amount);

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

const createDraftFields = (draft: FollowupDraft): JsonObject => ({
  tag: 'div',
  fields: [
    {
      is_short: true,
      text: {
        tag: 'lark_md',
        content: `**客户**\n${escapeMarkdown(draft.customerName ?? '未识别')}`,
      },
    },
    {
      is_short: true,
      text: {
        tag: 'lark_md',
        content: `**联系人**\n${escapeMarkdown(draft.contactName ?? '未提供')}`,
      },
    },
    {
      is_short: true,
      text: {
        tag: 'lark_md',
        content: `**预计金额**\n${escapeMarkdown(formatAmount(draft.expectedAmount))}`,
      },
    },
    {
      is_short: true,
      text: {
        tag: 'lark_md',
        content: `**截止时间**\n${escapeMarkdown(draft.dueAt ?? '未提供')}`,
      },
    },
  ],
});

const createSalesContextBlock = (context: SalesContext): JsonObject => {
  const lines: string[] = ['**本人可见的业务上下文**'];
  if (context.customer) {
    lines.push(
      `客户：${escapeMarkdown(context.customer.name)}（来源记录 ` +
      `${escapeMarkdown(context.customer.source.recordId)}）` +
      createSourceLink(context.customer.source.recordUrl, '查看客户'),
    );
    if (context.customer.latestSummary) {
      lines.push(`最近摘要：${escapeMarkdown(context.customer.latestSummary)}`);
    }
  }
  if (context.customerCandidates.length > 0) {
    lines.push('客户匹配不唯一，请核对：');
    for (const candidate of context.customerCandidates) {
      lines.push(
        `- ${escapeMarkdown(candidate.name)}（记录 ` +
        `${escapeMarkdown(candidate.source.recordId)}）`,
      );
    }
  }
  for (const opportunity of context.opportunities.slice(0, 3)) {
    lines.push(
      `商机：${escapeMarkdown(opportunity.name)}；进展：` +
      `${escapeMarkdown(opportunity.progress ?? '未提供')}；来源记录 ` +
      `${escapeMarkdown(opportunity.source.recordId)}` +
      createSourceLink(opportunity.source.recordUrl, '查看商机'),
    );
  }
  for (const followup of context.recentFollowups.slice(0, 3)) {
    lines.push(
      `近期跟进：${escapeMarkdown(followup.summary)}（记录 ` +
      `${escapeMarkdown(followup.source.recordId)}）` +
      createSourceLink(followup.source.recordUrl, '查看跟进'),
    );
  }
  for (const conflict of context.conflicts.slice(0, 3)) {
    const fieldName: string = conflict.field === 'nextAction'
      ? '下一步'
      : '截止时间';
    const newerSource: string = {
      opportunity: '商机记录较新',
      followup: '跟进记录较新',
      same: '两条记录时间相同',
      unknown: '无法比较记录时间',
    }[conflict.newerSource];
    lines.push(
      `上下文冲突（${fieldName}）：商机记录“` +
      `${escapeMarkdown(conflict.opportunityValue)}”与跟进记录“` +
      `${escapeMarkdown(conflict.followupValue)}”；${newerSource}。` +
      createSourceLink(conflict.opportunitySource.recordUrl, '查看商机') +
      createSourceLink(conflict.followupSource.recordUrl, '查看跟进'),
    );
  }
  for (const task of context.tasks.slice(0, 3)) {
    lines.push(
      `本人待办：${escapeMarkdown(task.title)}；状态：` +
      `${escapeMarkdown(task.status)}；任务 ${escapeMarkdown(task.guid)}` +
      createSourceLink(task.url, '查看待办'),
    );
  }
  if (context.warnings.length > 0 || context.status !== 'ready') {
    if (context.warnings.includes('sales_context_source_conflict')) {
      lines.push('来源信息不一致，已保留双方事实；请核对后再确认。');
    }
    lines.push(
      context.warnings.includes('business_context_permission_denied')
        ? '无权读取部分业务资料，本次草稿未将缺失信息当作事实。'
        : '上下文不完整，本次草稿未将缺失信息当作事实。',
    );
  }
  return { tag: 'markdown', content: lines.join('\n') };
};

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

const missingTaskLabels = (
  fields: FollowupTaskMissingField[],
): string => {
  const labels: Record<FollowupTaskMissingField, string> = {
    dueAt: '时间',
    pastDueAt: '执行时间已过期，请修改',
    channel: '地点/方式',
    participants: '参与人',
  };
  return fields.map((field: FollowupTaskMissingField): string =>
    labels[field]).join('、');
};

const createQualityBlock = (
  quality: FollowupQualitySnapshot | undefined,
): JsonObject => {
  const fieldLabels: Record<string, string> = {
    customerName: '客户名称',
    contactName: '联系人',
    communicationMethod: '沟通方式',
    communicationAt: '沟通时间',
    topic: '沟通主题',
    nextAction: '下一步动作',
    dueAt: '下一步时间',
    nextActionOwner: '下一步负责人',
    nextActionParticipants: '下一步参与人',
  };
  const blockingFields: Set<string> = new Set([
    'customerName',
    'nextAction',
    'dueAt',
  ]);
  const missingItems: string[] = quality?.missingItems ?? [];
  const blockers: string[] = missingItems
    .filter((field: string): boolean => blockingFields.has(field))
    .map((field: string): string => fieldLabels[field] ?? field);
  if ((quality?.invalidEvidence.length ?? 0) > 0) {
    blockers.push('存在无法在沟通原文中定位的事实');
  }
  const ready: boolean = quality?.confirmable !== false &&
    blockers.length === 0;
  const blockingText: string = ready
    ? '关键事实已具备，可以确认保存'
    : `请先确认：${blockers.map(escapeMarkdown).join('、')}`;
  const missingSuggestions: string[] = missingItems
    .filter((field: string): boolean => !blockingFields.has(field))
    .flatMap((field: string): string[] => {
      const label: string | undefined = fieldLabels[field];
      return label ? [`补充${label}`] : [];
    });
  const localizedSuggestions: string[] = (quality?.suggestions ?? []).map(
    (suggestion: string): string => {
      let localized: string = suggestion;
      let referencedInternalField: boolean = false;
      Object.entries(fieldLabels).forEach(
        ([field, label]: [string, string]): void => {
          if (!localized.includes(field)) return;
          referencedInternalField = true;
          localized = localized.split(field).join(label);
        },
      );
      if (
        !referencedInternalField &&
        /^请补充\s+[A-Za-z][A-Za-z0-9]*$/u.test(localized)
      ) {
        return '';
      }
      return referencedInternalField
        ? localized.replace(/^请补充\s*/u, '补充')
        : localized;
    },
  ).filter((suggestion: string): boolean => suggestion.length > 0);
  const suggestions: string[] = Array.from(new Set([
    ...missingSuggestions,
    ...localizedSuggestions,
  ]));
  const suggestionText: string = suggestions.length > 0
    ? suggestions.slice(0, 3).map(escapeMarkdown).join('；')
    : '没有额外建议；未知信息可在后续沟通中补充';
  return {
    tag: 'column_set',
    flex_mode: 'none',
    horizontal_spacing: '12px',
    columns: [
      {
        tag: 'column',
        width: 'weighted',
        weight: 1,
        background_style: 'blue-50',
        padding: '12px',
        elements: [{
          tag: 'markdown',
          text_size: 'normal',
          content: `**保存前检查**\n**${ready ? '可以保存' : '需要确认'}**\n` +
            `<font color='grey'>${blockingText}</font>`,
        }],
      },
      {
        tag: 'column',
        width: 'weighted',
        weight: 2,
        background_style: 'grey-50',
        padding: '12px',
        elements: [{
          tag: 'markdown',
          content: `**建议补充**\n${suggestionText}`,
        }],
      },
    ],
  };
};

const createTaskFormElements = (action: PendingAction): JsonValue[] => {
  const candidates: FollowupTaskCandidate[] =
    action.payload.taskCandidates ?? [];
  if (candidates.length === 0) {
    return [{
      tag: 'markdown',
      content: '**待办预览**\n本次未识别到可创建的下一步待办。',
    }];
  }
  const selected: Set<string> = new Set(
    action.payload.selectedTaskCandidateIds ?? candidates
      .filter((candidate: FollowupTaskCandidate): boolean =>
        candidate.status === 'ready',
      )
      .map((candidate: FollowupTaskCandidate): string => candidate.id),
  );
  const elements: JsonValue[] = [{
    tag: 'markdown',
    content: '**待办预览**\n只会创建你勾选的本人待办。',
  }];
  candidates.forEach((candidate: FollowupTaskCandidate, index: number): void => {
    const ready: boolean = candidate.status === 'ready';
    const hasPastDueAt: boolean = candidate.missingFields.includes(
      'pastDueAt',
    );
    const detail: string = ready
      ? `${candidate.dueAt ?? ''} · ` +
        `${candidate.channel ?? '执行方式未提供'} · ` +
        (candidate.participants.length > 0
          ? candidate.participants.join('、')
          : '参与人未提供')
      : hasPastDueAt
        ? missingTaskLabels(candidate.missingFields)
        : `待补充：${missingTaskLabels(candidate.missingFields)}`;
    elements.push({
      tag: 'checker',
      name: `task_${index}`,
      checked: ready && selected.has(candidate.id),
      disabled: !ready,
      disabled_tips: !ready ? {
        tag: 'plain_text',
        content: detail,
      } : undefined,
      text: {
        tag: 'lark_md',
        content: `**${escapeMarkdown(candidate.title)}**\n` +
          `<font color='grey'>${escapeMarkdown(detail)}</font>`,
      },
      padding: '8px 0px',
    });
  });
  return elements;
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
    '填写沟通内容后，AI 会先生成草案并检查可用性；此步不会写入业务系统',
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
          max_length: 5000,
          required: true,
          default_value: form.communicationContent ?? '',
          width: 'fill',
        },
        {
          tag: 'input',
          name: 'nextAction',
          label: { tag: 'plain_text', content: '下一步计划' },
          default_value: form.nextAction ?? '',
          max_length: 500,
          width: 'fill',
        },
        {
          tag: 'markdown',
          content: '**下一步时间**',
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
          label: { tag: 'plain_text', content: '下一步地点 / 方式' },
          default_value: form.nextActionChannel ?? '',
          max_length: 200,
          width: 'fill',
        },
        {
          tag: 'input',
          name: 'nextActionParticipants',
          label: { tag: 'plain_text', content: '下一步参与人' },
          default_value: (form.nextActionParticipants ?? []).join('、'),
          max_length: 500,
          width: 'fill',
        },
        {
          tag: 'button',
          name: 'submit_followup_input',
          text: {
            tag: 'plain_text',
            content: '生成草案并检查',
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
    'AI 正在整理沟通内容并执行保存前检查',
    'blue',
    '生成中',
    [{
      tag: 'markdown',
      content: '请稍候，完成后会在这张卡片中展示草案。业务数据尚未写入。',
    }],
  );

const createConfirmationCard = (action: PendingAction): JsonObject => {
  if (action.payload.interactionStage === 'input') {
    return createFollowupInputCard(action);
  }
  const draft: FollowupDraft = action.payload.draft;
  const draftVersion: number = action.payload.draftVersion ?? 1;
  const hasReadyTask: boolean = (action.payload.taskCandidates ?? []).some(
    (candidate: FollowupTaskCandidate): boolean =>
      candidate.status === 'ready',
  );
  const dueAt: string | undefined = toPickerDateTime(draft.dueAt);

  return createBaseCard(
    '销售跟进草案',
    `v${draftVersion} · 检查无误后一次性确认提交`,
    'blue',
    '待确认',
    [
      ...(action.payload.salesContext
        ? [createSalesContextBlock(action.payload.salesContext)]
        : []),
      createDraftFields(draft),
      createQualityBlock(action.payload.quality),
      {
        tag: 'form',
        name: 'followup_draft_form',
        direction: 'vertical',
        vertical_spacing: '12px',
        padding: '12px',
        elements: [
          {
            tag: 'input',
            name: 'generatedBody',
            label: { tag: 'plain_text', content: 'AI 跟进正文' },
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
            tag: 'input',
            name: 'communicationAt',
            label: { tag: 'plain_text', content: '沟通时间' },
            default_value: action.payload.inputForm?.communicationAt ?? '',
            max_length: 100,
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
            tag: 'input',
            name: 'nextAction',
            label: { tag: 'plain_text', content: '下一步计划' },
            required: true,
            default_value: draft.nextAction ?? '',
            max_length: 500,
            width: 'fill',
          },
          {
            tag: 'markdown',
            content: '**执行时间**',
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
            label: { tag: 'plain_text', content: '地点 / 方式' },
            default_value: draft.nextActionChannel ?? '',
            max_length: 200,
            width: 'fill',
          },
          {
            tag: 'input',
            name: 'nextActionParticipants',
            label: { tag: 'plain_text', content: '参与人' },
            default_value: (draft.nextActionParticipants ?? []).join('、'),
            max_length: 500,
            width: 'fill',
          },
          ...createTaskFormElements(action),
          {
            tag: 'button',
            name: `confirm_followup_v${draftVersion}`,
            text: {
              tag: 'plain_text',
              content: hasReadyTask
                ? '确认保存并创建所示待办'
                : '确认保存（不创建待办）',
            },
            type: 'primary_filled',
            width: 'fill',
            form_action_type: 'submit',
          },
        ],
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '取消本次跟进' },
        type: 'text',
        width: 'fill',
        behaviors: [{
          type: 'callback',
          value: {
            action: 'cancel',
            pendingActionId: action.id,
          },
        }],
      },
    ],
  );
};

const createProcessingCard = (): JsonObject =>
  createBaseCard(
    '正在执行销售动作',
    '已收到确认，正在保存业务记录并处理所选待办',
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
                  '并按你的选择处理飞书待办。',
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
