import { z } from 'zod';
import type { JsonObject, JsonValue } from '@shared/api.interface';

const taskFormSchema = z.object({
  title: z.string().trim().min(1).max(3000),
  dueAt: z.string().datetime({ offset: true }),
  participants: z.string().max(2000).optional(),
  channel: z.string().trim().max(200).optional(),
}).strict();

const todayTaskConfirmationSchema = z.object({
  action: z.literal('today_task_confirm'),
  actionId: z.string().min(1).max(128),
  version: z.number().int().positive(),
  recipientOpenId: z.string().min(1).max(256),
}).strict();

const parseTodayTaskConfirmation = (value: unknown) => todayTaskConfirmationSchema.parse(value);

const parseTodayTaskForm = (value: unknown) => {
  const parsed = taskFormSchema.parse(value);
  return { title: parsed.title, dueAt: new Date(parsed.dueAt).toISOString(),
    participants: [...new Set((parsed.participants ?? '').split(/[,，、;；\n]+/u)
      .map((name: string) => name.trim()).filter(Boolean))], channel: parsed.channel ?? '' };
};

interface TodayTaskCardInput {
  actionId: string; version: number; recipientOpenId: string;
  title: string; dueAt: string; channel: string; participants: string[];
  operation?: 'create' | 'update';
}

const createTodayTaskCard = (input: TodayTaskCardInput): JsonObject => {
  const verb: string = input.operation === 'update' ? '更新' : '创建';
  const field = (name: string, label: string, value: string, required: boolean): JsonValue => ({
    tag: 'input', name, label: { tag: 'plain_text', content: label },
    default_value: value, required, width: 'fill', max_length: 1000,
  });
  return { schema: '2.0', config: { update_multi: true, enable_forward: false },
    header: { title: { tag: 'plain_text', content: `确认${verb}任务` }, template: 'blue' },
    body: { elements: [{ tag: 'markdown', content: `核对任务内容后一次确认。确认后只${verb}任务。` },
      { tag: 'form', name: 'today_task_form', elements: [
        field('title', '任务内容', input.title, true),
        field('dueAt', '截止时间（含时区，例如 2026-10-17T17:00:00+08:00）', input.dueAt, true),
        field('channel', '执行方式', input.channel, false),
        field('participants', '参与人', input.participants.join('、'), false),
        { tag: 'button', name: 'today_task_confirm', type: 'primary_filled',
          text: { tag: 'plain_text', content: `确认后${verb}任务` }, form_action_type: 'submit',
          value: { action: 'today_task_confirm', actionId: input.actionId,
            version: input.version, recipientOpenId: input.recipientOpenId } },
      ] } ] } };
};

export { parseTodayTaskForm, createTodayTaskCard, parseTodayTaskConfirmation };
