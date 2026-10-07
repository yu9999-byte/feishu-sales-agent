import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WebPageController } from
  '@server/modules/platform-shell/web-page.controller';

import {
  customerCommunicationDraftChannelLabel,
  customerCommunicationEvidenceKindLabel,
  customerCommunicationMaterialSearchStatusLabel,
  customerCommunicationMaterialSearchNotice,
  customerCommunicationMaterialSourceTypeLabel,
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
    expect(customerCommunicationMaterialStatusLabel('recommended')).toBe(
      '可信资料',
    );
    expect(customerCommunicationMaterialSearchStatusLabel('ready')).toBe(
      '已找到可信材料',
    );
    expect(
      customerCommunicationMaterialSearchStatusLabel('no_trusted_match'),
    ).toBe('未找到可信材料');
    expect(customerCommunicationMaterialSourceTypeLabel('docx')).toBe(
      '飞书文档',
    );
    expect(customerCommunicationMaterialSourceTypeLabel('wiki')).toBe(
      '飞书知识库',
    );
    expect(customerCommunicationMaterialSearchNotice('ready')).toContain(
      '白名单与本人权限核验',
    );
    expect(
      customerCommunicationMaterialSearchNotice('not_configured'),
    ).toContain('尚未配置');
    expect(
      customerCommunicationMaterialSearchNotice('no_trusted_match'),
    ).toContain('未找到可信材料');
    expect(customerCommunicationMaterialSearchNotice('partial')).toContain(
      '部分来源',
    );
    expect(
      customerCommunicationMaterialSearchNotice('unavailable'),
    ).toContain('暂时无法核验');
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

  it('renders real material provenance without adding execution actions', (): void => {
    const planSource: string = readFileSync(join(
      process.cwd(),
      'client/src/pages/CustomerCommunicationPreparationPage/' +
        'CustomerCommunicationPlan.tsx',
    ), 'utf8');

    expect(planSource).toContain('material.sourceVersion');
    expect(planSource).toContain('material.citation');
    expect(planSource).toContain('material.excerpt');
    expect(planSource).toContain('material.applicability');
    expect(planSource).toContain('打开原资料');
    expect(planSource).not.toContain('sendMessage');
    expect(planSource).not.toContain('sendEmail');
    expect(planSource).not.toContain('createTask');
    expect(planSource).not.toContain('saveMaterial');

    const evidenceSource: string = readFileSync(join(
      process.cwd(),
      'client/src/pages/CustomerCommunicationPreparationPage/' +
        'CustomerCommunicationEvidence.tsx',
    ), 'utf8');
    const contentSource: string = readFileSync(join(
      process.cwd(),
      'server/modules/insight/' +
        'customer-communication-preparation-content.ts',
    ), 'utf8');

    expect(evidenceSource).toContain(
      'customerCommunicationMaterialSearchNotice',
    );
    expect(evidenceSource).not.toContain('材料库尚未接入');
    expect(contentSource).not.toContain('v1 尚未接入经审核案例库');
  });
});
