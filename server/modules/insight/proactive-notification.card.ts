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
): JsonValue => ({
  tag: 'markdown',
  content: `**${escapeMarkdown(section.title)}**\n${section.lines
    .slice(0, 5)
    .map((line: string): string => `- ${escapeMarkdown(line)}`)
    .join('\n')}`,
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
  const elements: JsonValue[] = message.sections
    .filter((section: ProactiveNotificationSection): boolean =>
      section.lines.length > 0)
    .map(sectionElement);
  const url: string | null = trustedUrl(message.actionUrl);
  if (url !== null && message.actionLabel) {
    elements.push({
      tag: 'markdown',
      content: `[${escapeMarkdown(message.actionLabel)}](<${url}>)`,
    });
  }
  elements.push({
    tag: 'note',
    elements: [{
      tag: 'plain_text',
      content: '以上为只读提醒；涉及业务变更时仍需人工确认。',
    }],
  });
  const template: 'blue' | 'green' | 'orange' | 'red' =
    templateForKind(message.kind);
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
