import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WebPageController } from
  '@server/modules/platform-shell/web-page.controller';
import {
  proactiveNotificationDecisionLabel,
  proactiveNotificationKindLabel,
  shouldAllowNotificationReconciliationDialogChange,
} from '../../client/src/pages/ProactiveNotificationReconciliationPage/proactive-notification-reconciliation-view';

describe('proactive notification reconciliation view', (): void => {
  it('uses clear business labels for notification kinds and decisions', (): void => {
    expect(proactiveNotificationKindLabel('task_action')).toBe('任务行动提醒');
    expect(proactiveNotificationKindLabel('opportunity_risk')).toBe('商机风险提醒');
    expect(proactiveNotificationKindLabel('daily_report')).toBe('销售日报');
    expect(proactiveNotificationKindLabel('weekly_personal')).toBe('个人周报');
    expect(proactiveNotificationKindLabel('weekly_team')).toBe('团队周报');
    expect(proactiveNotificationDecisionLabel('confirm_sent')).toBe('确认已送达');
    expect(proactiveNotificationDecisionLabel('authorize_retry')).toBe(
      '确认未送达并释放一次重试',
    );
    expect(proactiveNotificationDecisionLabel('keep_frozen')).toBe(
      '证据不足，继续冻结',
    );
  });

  it('registers the operations page as a direct SPA route', (): void => {
    const routes: unknown = Reflect.getMetadata(
      'path',
      WebPageController.prototype.show,
    );
    expect(Array.isArray(routes)).toBe(true);
    if (!Array.isArray(routes)) {
      throw new Error('Web page routes are not registered');
    }
    expect(routes).toContain('admin/notification-deliveries');
  });

  it('keeps reconciliation separate from delivery and exposes feedback states', (): void => {
    const pageSource: string = readFileSync(join(
      process.cwd(),
      'client/src/pages/ProactiveNotificationReconciliationPage/' +
        'ProactiveNotificationReconciliationPage.tsx',
    ), 'utf8');

    expect(pageSource).toContain('当前没有需要人工核对的通知');
    expect(pageSource).toContain('正在提交裁决');
    expect(pageSource).toContain('裁决已保存');
    expect(pageSource).toContain('记录已被其他管理员处理');
    expect(pageSource).not.toContain('sendProactiveNotification');
    expect(pageSource).not.toContain('runProactiveSalesNotifications');
  });

  it('keeps the reconciliation dialog visible while a decision is saving', (): void => {
    expect(shouldAllowNotificationReconciliationDialogChange(true, true)).toBe(
      true,
    );
    expect(shouldAllowNotificationReconciliationDialogChange(false, true)).toBe(
      false,
    );
    expect(shouldAllowNotificationReconciliationDialogChange(false, false)).toBe(
      true,
    );

    const pageSource: string = readFileSync(join(
      process.cwd(),
      'client/src/pages/ProactiveNotificationReconciliationPage/' +
        'ProactiveNotificationReconciliationPage.tsx',
    ), 'utf8');
    expect(pageSource).toContain('showCloseButton={!saving}');
    expect(pageSource).toContain('onEscapeKeyDown');
    expect(pageSource).toContain('onPointerDownOutside');
  });
});
