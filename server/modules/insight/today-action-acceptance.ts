import { createHash } from 'node:crypto';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import type { TodayActionService } from './today-action.service';
import type { PostgresTodayActionStateStore } from './postgres-today-action-state.store';
import type {
  ProactiveNotificationControlReader, ProactiveNotificationIdentityReader,
  ProactiveNotificationSessionReader, ProactiveNotificationDeliveryRunner,
} from './proactive-sales-notification.service';
import { planTodayActionDigest } from './today-action-digest';

interface TodayActionAcceptanceInput {
  tenantId: string;
  memberId: string;
  recipientOpenId: string;
  itemIds: string[];
  marker: string;
  runKey: string;
  send?: boolean;
  now?: Date;
}

interface TodayActionAcceptanceDependencies {
  settings: AgentRuntimeConfig['proactiveSalesNotifications'];
  control: ProactiveNotificationControlReader;
  identity: ProactiveNotificationIdentityReader;
  sessions: ProactiveNotificationSessionReader;
  actions: Pick<TodayActionService, 'analyze'>;
  states: Pick<PostgresTodayActionStateStore, 'read'>;
  delivery: ProactiveNotificationDeliveryRunner;
}

const runTodayActionAcceptance = async (
  deps: TodayActionAcceptanceDependencies,
  input: TodayActionAcceptanceInput,
) => {
  const settings = deps.settings;
  if (!input.tenantId || !input.memberId || !input.recipientOpenId ||
    settings?.allowedTenantId !== input.tenantId || settings.allowedMemberId !== input.memberId ||
    settings.allowedRecipientOpenId !== input.recipientOpenId) throw new Error('ACCESS_DENIED');
  if (!/^TCL-UAT-\d{8}$/u.test(input.marker) || !/^[a-zA-Z0-9_-]{1,64}$/u.test(input.runKey) ||
    input.itemIds.length < 1 || input.itemIds.length > 2 ||
    input.itemIds.some((id: string) => !id.trim()) || new Set(input.itemIds).size !== input.itemIds.length) {
    throw new Error('SELECTION_INVALID');
  }
  const now: Date = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('SELECTION_INVALID');
  const integrations = await deps.control.listActiveIntegrations();
  const integration = integrations.find((entry) => entry.tenantId === input.tenantId && entry.status === 'active');
  if (!integration) throw new Error('ACCESS_DENIED');
  const members = await deps.identity.listMembers(input.tenantId);
  if (!members.some((member) => member.tenantId === input.tenantId && member.id === input.memberId &&
    member.feishuOpenId === input.recipientOpenId && member.status === 'active')) throw new Error('ACCESS_DENIED');
  const session = await deps.sessions.getSessionByMembership(input.tenantId, input.memberId, now);
  if (session.tenant.id !== input.tenantId || session.member.id !== input.memberId ||
    session.member.feishuOpenId !== input.recipientOpenId ||
    !['customer:read', 'opportunity:read', 'task:read'].every((permission) =>
      session.permissions.some((granted) => granted === permission))) throw new Error('ACCESS_DENIED');
  const localDate: string = new Intl.DateTimeFormat('en-CA', {
    timeZone: session.tenant.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const report = await deps.actions.analyze({ integration, actorOpenId: input.recipientOpenId,
    referenceDate: localDate, timezone: session.tenant.timezone });
  const selected = [];
  for (const id of input.itemIds) {
    const matches = report.items.filter((item) => item.id === id);
    const item = matches[0];
    if (matches.length !== 1 || !item.title.includes(input.marker)) throw new Error('SELECTION_INVALID');
    const state = await deps.states.read({ tenantId: input.tenantId, memberId: input.memberId,
      actorOpenId: input.recipientOpenId }, item.id, item.version) ?? item.state;
    if (state.status !== 'open') throw new Error('SELECTION_INVALID');
    selected.push({ ...item, state });
  }
  const message = planTodayActionDigest({ tenantId: input.tenantId, recipientMemberId: input.memberId,
    recipientOpenId: input.recipientOpenId, localDate, now, timezone: session.tenant.timezone,
    webPublicUrl: settings.webPublicUrl }, selected, []);
  if (!message) throw new Error('SELECTION_INVALID');
  // One stable manual request occupies one ledger slot. Retries use its frozen first payload.
  message.notificationKey = `acceptance:${input.runKey}`;
  message.subjectKey = 'today-action-acceptance';
  message.payloadFingerprint = createHash('sha256').update(JSON.stringify({
    sections: message.sections, shortcuts: message.shortcuts,
  })).digest('hex');
  if (input.send !== true) return { mode: 'preview' as const, message };
  const delivery = await deps.delivery.deliver({ enabled: true, message, now });
  return { mode: 'send' as const, message, delivery };
};

export { runTodayActionAcceptance };
export type { TodayActionAcceptanceInput };
