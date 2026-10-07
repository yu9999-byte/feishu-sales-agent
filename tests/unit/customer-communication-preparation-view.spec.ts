import { describe, expect, it } from 'vitest';

import { WebPageController } from
  '@server/modules/platform-shell/web-page.controller';

import {
  customerCommunicationDraftChannelLabel,
  customerCommunicationEvidenceKindLabel,
  customerCommunicationMaterialStatusLabel,
  customerCommunicationStatusLabel,
} from '../../client/src/pages/CustomerCommunicationPreparationPage/customer-communication-preparation-view';

describe('customer communication preparation view helpers', (): void => {
  it('uses stable product language for preparation states', (): void => {
    expect(customerCommunicationStatusLabel('ready')).toBe('沟通内容已准备');
    expect(customerCommunicationStatusLabel('partial')).toBe('部分内容可准备');
    expect(customerCommunicationStatusLabel('empty')).toBe('客户不可见');
    expect(customerCommunicationStatusLabel('unavailable')).toBe(
      '暂时无法准备',
    );
  });

  it('labels sources, pending materials and preview drafts honestly', (): void => {
    expect(customerCommunicationEvidenceKindLabel('customer')).toBe('客户');
    expect(customerCommunicationEvidenceKindLabel('opportunity')).toBe('商机');
    expect(customerCommunicationEvidenceKindLabel('followup')).toBe('跟进');
    expect(customerCommunicationMaterialStatusLabel('material_pending')).toBe(
      '材料待补充',
    );
    expect(customerCommunicationDraftChannelLabel('feishu')).toBe('飞书消息');
    expect(customerCommunicationDraftChannelLabel('email')).toBe('邮件');
  });

  it('registers the communication page as a direct SPA route', (): void => {
    const routes: unknown = Reflect.getMetadata(
      'path',
      WebPageController.prototype.show,
    );
    expect(Array.isArray(routes)).toBe(true);
    if (!Array.isArray(routes)) {
      throw new Error('Web page routes are not registered');
    }
    expect(routes).toContain('customers/:customerRecordId/communication');
  });
});
