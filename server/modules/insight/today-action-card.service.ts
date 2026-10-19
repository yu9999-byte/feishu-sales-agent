import { Inject, Injectable, Optional } from '@nestjs/common';
import type { JsonObject } from '@shared/api.interface';
import { CONTROL_STORE, type ControlStore } from '@server/modules/agent-core/agent.ports';
import type { IncomingCardAction } from '@server/modules/agent-core/agent.types';
import { PlatformSessionService } from '@server/modules/platform-shell/platform-session.service';
import { PostgresProactiveNotificationStore } from './postgres-proactive-notification.store';
import { PostgresTodayActionStateStore } from './postgres-today-action-state.store';
import { TodayActionService } from './today-action.service';
import { handleTodayActionStateCallback } from './today-action-card-handler';
import { renderTodayActionCardResult } from './today-action-card-result';
import { FeishuMessengerService } from '@server/modules/feishu/feishu-messenger.service';
import { parseTodayActionCardAction } from './today-action-card-contract';
import { openTodayFollowupInput } from './today-action-followup-input';
import { AgentActionExecutorService } from '@server/modules/agent-core/agent-action-executor.service';
import { confirmTodayTaskCard } from './today-action-task-confirmation';
import { openTodayTaskDraft } from './today-action-task-draft';

@Injectable()
class TodayActionCardService {
  constructor(
    @Inject(CONTROL_STORE) private readonly control: ControlStore,
    private readonly sessions: PlatformSessionService,
    private readonly notifications: PostgresProactiveNotificationStore,
    private readonly states: PostgresTodayActionStateStore,
    private readonly actions: TodayActionService,
    private readonly messenger: FeishuMessengerService,
    @Optional() private readonly executor?: AgentActionExecutorService,
  ) {}

  async handle(incoming: IncomingCardAction): Promise<JsonObject> {
    try {
      const integration = await this.control.resolveTenant(incoming.feishuTenantKey);
      if (!integration || integration.status !== 'active') throw new Error('ACCESS_DENIED');
      const member = await this.sessions.getActiveMember(integration.tenantId, incoming.operatorOpenId);
      if (!member) throw new Error('ACCESS_DENIED');
      const session = await this.sessions.getSessionByMembership(integration.tenantId, member.id);
      if (!session.permissions.includes('customer:read') ||
        !session.permissions.includes('opportunity:read') ||
        !session.permissions.includes('task:read')) throw new Error('ACCESS_DENIED');
      const now: Date = new Date();
      if (incoming.value.action === 'today_task_confirm') {
        if (!session.permissions.includes('task:assign')) throw new Error('ACCESS_DENIED');
        if (!this.executor) throw new Error('EXECUTOR_UNAVAILABLE');
        const status = await confirmTodayTaskCard(this.control, this.executor, integration, incoming);
        return { toast: { type: 'success', content: status === 'succeeded' ? '任务已创建' : '任务正在创建中' } };
      }
      const shortcut = parseTodayActionCardAction(incoming.value);
      if (shortcut.operation === 'generate_followup' || shortcut.operation === 'create_task') {
        const permission = shortcut.operation === 'create_task' ? 'task:assign' : 'followup:create-own';
        if (!session.permissions.includes(permission) || !incoming.chatId ||
          !incoming.cardMessageId || shortcut.recipientOpenId !== incoming.operatorOpenId ||
          !await this.notifications.ownsSentCard({ tenantId: integration.tenantId,
            memberId: member.id, actorOpenId: incoming.operatorOpenId,
            messageId: incoming.cardMessageId, callback: shortcut })) throw new Error('ACCESS_DENIED');
        const referenceDate: string = new Intl.DateTimeFormat('en-CA', {
          timeZone: session.tenant.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(now);
        const report = await this.actions.analyze({ integration, actorOpenId: incoming.operatorOpenId,
          referenceDate, timezone: session.tenant.timezone });
        const item = report.items.find((candidate) => candidate.id === shortcut.itemId &&
          candidate.version === shortcut.itemVersion);
        if (!item) throw new Error('ACTION_CONFLICT');
        if (shortcut.operation === 'create_task') {
          await openTodayTaskDraft(this.control, this.messenger, integration, {
            memberId: member.id, actorOpenId: incoming.operatorOpenId, chatId: incoming.chatId,
            messageId: incoming.cardMessageId, item, now,
          });
          return { toast: { type: 'success', content: '请核对任务并填写截止时间后确认' } };
        }
        await openTodayFollowupInput(this.control, this.messenger, integration, {
          tenantId: integration.tenantId, memberId: member.id, actorOpenId: incoming.operatorOpenId,
          chatId: incoming.chatId, messageId: incoming.cardMessageId, itemId: shortcut.itemId,
          itemVersion: shortcut.itemVersion, now,
        });
        return { toast: { type: 'success', content: '请填写真实沟通内容，生成草案后确认' } };
      }
      const result = await handleTodayActionStateCallback({
        store: this.states,
        ownsCard: (scope, messageId, callback) => this.notifications.ownsSentCard({ ...scope, messageId, callback }),
        readVisibleItem: async (scope, itemId) => {
          const referenceDate: string = new Intl.DateTimeFormat('en-CA', {
            timeZone: session.tenant.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
          }).format(now);
          const report = await this.actions.analyze({ integration, actorOpenId: scope.actorOpenId,
            referenceDate, timezone: session.tenant.timezone });
          const item = report.items.find((candidate) => candidate.id === itemId);
          return item ? { itemId: item.id, itemVersion: item.version, revision: item.state.revision } : null;
        },
      }, { tenantId: integration.tenantId, memberId: member.id, actorOpenId: incoming.operatorOpenId },
      incoming.cardMessageId ?? '', incoming.value, now);
      const scope = { tenantId: integration.tenantId, memberId: member.id,
        actorOpenId: incoming.operatorOpenId };
      const message = await this.notifications.readSentCard({ ...scope,
        messageId: incoming.cardMessageId ?? '' });
      if (!message) throw new Error('ACCESS_DENIED');
      const states = await Promise.all((message.shortcuts ?? []).map((shortcut) =>
        this.states.read(scope, shortcut.value.itemId, shortcut.value.itemVersion)));
      const card = renderTodayActionCardResult(message,
        states.filter((state): state is NonNullable<typeof state> => state !== null));
      try {
        await this.messenger.updateCard(integration, incoming.cardMessageId ?? '', card);
      } catch {
        return { toast: { type: 'error', content: '操作已保存，卡片刷新失败；可再次点击恢复显示' } };
      }
      return { toast: { type: 'success', content: result.status === 'resolved' ? '已标记处理' : '已设置稍后提醒' } };
    } catch (error: unknown) {
      const code: string = error instanceof Error ? error.message : '';
      return { toast: { type: 'error', content: code === 'ACCESS_DENIED' ? '无权操作此卡片' :
        code === 'ACTION_CONFLICT' ? '事项已变化，请打开今日行动中心刷新' : '操作未完成，请稍后重试' } };
    }
  }
}

export { TodayActionCardService };
