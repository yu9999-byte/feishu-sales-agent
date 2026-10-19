import type { JsonObject, JsonValue } from '@shared/api.interface';
import type {
  ProactiveNotificationMessage,
  ProactiveNotificationSection,
} from './proactive-notification-delivery.service';

const escapeMarkdown = (value: string): string =>
  value.replace(/[\\*~><\[\]()#:_]/gu, (character: string): string => {
    const code: number = character.codePointAt(0) ?? 0;
    return `&#${code};`;
  });

const trustedUrl = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    const parsed: URL = new URL(value);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch (_error: unknown) {
    return null;
  }
};

const sectionElement = (
  section: ProactiveNotificationSection,
  color: 'blue' | 'green' | 'orange' | 'red',
): JsonValue => ({
  tag: 'column_set',
  flex_mode: 'none',
  columns: [{
    tag: 'column',
    width: 'weighted',
    weight: 1,
    background_style: `${color}-50`,
    padding: '12px',
    vertical_spacing: '4px',
    elements: [{
      tag: 'markdown',
      content: `**<font color='${color}'>${
        escapeMarkdown(section.title)
      }</font>**\n${section.lines
        .slice(0, 5)
        .map((line: string): string => `- ${escapeMarkdown(line)}`)
        .join('\n')}`,
    }],
  }],
});

const templateForKind = (
  kind: ProactiveNotificationMessage['kind'],
): 'blue' | 'green' | 'orange' | 'red' => {
  if (kind === 'opportunity_risk') return 'red';
  if (kind === 'task_action') return 'orange';
  if (kind === 'daily_report') return 'green';
  return 'blue';
};

const createProactiveNotificationCard = (
  message: ProactiveNotificationMessage,
): JsonObject => {
  const template: 'blue' | 'green' | 'orange' | 'red' =
    templateForKind(message.kind);
  const elements: JsonValue[] = message.sections
    .filter((section: ProactiveNotificationSection): boolean =>
      section.lines.length > 0)
    .map((section: ProactiveNotificationSection): JsonValue =>
      sectionElement(section, template));
  const url: string | null = trustedUrl(message.actionUrl);
  for (const shortcut of (message.shortcuts ?? []).slice(0, 8)) {
    if (message.kind !== 'task_action' ||
      shortcut.value.recipientOpenId !== message.recipientOpenId) continue;
    elements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: shortcut.label.slice(0, 100) },
      type: 'default',
      behaviors: [{ type: 'callback', value: { ...shortcut.value } }],
    });
  }
  if (url !== null && message.actionLabel) {
    elements.push({
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: message.actionLabel.slice(0, 100),
      },
      type: 'primary_filled',
      width: 'fill',
      behaviors: [{ type: 'open_url', default_url: url }],
    });
  }
  elements.push({
    tag: 'markdown',
    content: '<font color=\'grey\'>生成跟进和创建任务仍需人工确认。</font>',
    text_size: 'notation',
  });
  return {
    schema: '2.0',
    config: {
      update_multi: true,
      width_mode: 'default',
      enable_forward: false,
      summary: { content: message.title },
    },
    header: {
      title: { tag: 'plain_text', content: message.title.slice(0, 100) },
      subtitle: {
        tag: 'plain_text',
        content: message.subtitle.slice(0, 200),
      },
      template,
      icon: { tag: 'standard_icon', token: 'myai_colorful' },
    },
    body: {
      direction: 'vertical',
      padding: '12px 12px 20px 12px',
      vertical_spacing: '12px',
      elements,
    },
  };
};

export { createProactiveNotificationCard };
