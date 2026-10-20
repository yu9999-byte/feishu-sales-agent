// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import CustomerCommunicationPreparationPage from
  '../../client/src/pages/CustomerCommunicationPreparationPage/CustomerCommunicationPreparationPage';
import * as api from '../../client/src/api';
import type {
  CustomerCommunicationPreparationResponse,
  CustomerPreparationDeliveryStatus,
  CustomerPreparationResultSnapshot,
} from '../../shared/api.interface';

vi.mock('../../client/src/api', () => ({
  getCustomerPreparationResult: vi.fn(),
  getCustomerPreparationDelivery: vi.fn(),
  getCustomerCommunicationPreparation: vi.fn(),
  confirmCustomerPreparationDelivery: vi.fn(),
  saveCustomerPreparationDraft: vi.fn(),
}));

const report: CustomerCommunicationPreparationResponse = {
  referenceDate: '2026-10-19', timezone: 'Asia/Shanghai',
  customer: {
    recordId: 'customer-1', name: '示例客户', contactName: null,
    latestSummary: '客户正在确认年度采购范围', lastFollowupAt: null,
    source: { recordId: 'customer-1', recordUrl: 'https://example.test/customer/1', sourceVersion: 'v1' },
  },
  objective: { id: 'objective', title: '沟通目标', detail: '确认下一步', sourceKeys: [] },
  angles: [], questions: [], materials: [], drafts: [], evidence: [],
  coverage: { scope: 'self', customers: 'complete', opportunities: 'complete', followups: 'complete', taskPromises: 'agent_confirmed_only', associations: 'explicit_record_links_only' },
  materialSearch: { status: 'not_configured', configuredSourceCount: 0, checkedSourceCount: 0, trustedResultCount: 0, warnings: [] },
  generatedAt: '2026-10-19T01:00:00Z', status: 'ready', warnings: [],
};

const completeReport: CustomerCommunicationPreparationResponse = {
  ...report,
  briefing: {
    metrics: { relatedOpportunityCount: 1, activeOpportunityCount: 1, riskOpportunityCount: 1, totalFollowupCount: 1, knownActiveExpectedAmount: null },
    opportunities: [{
      recordId: 'opportunity-1', name: '采购评审项目', lifecycleStatus: 'active',
      expectedAmount: null, progress: '等待采购评审', nextAction: null,
      dueAt: null, health: 'at_risk',
      risks: [{ code: 'followup_stale', severity: 'high', title: '评审进度待核实', detail: '最近没有可信评审进展', evidenceIds: ['followup:old'] }],
      gaps: [{ code: 'due_at_missing', title: '时间缺口', detail: '尚未确认下一步时间', evidenceIds: [] }],
      recommendation: { action: '建议确认评审参与人', reason: '参与范围尚未明确', dueAt: null, evidenceIds: ['followup:old'], requiresConfirmation: true },
      source: { recordId: 'opportunity-1', recordUrl: 'https://example.test/opportunity/1', sourceVersion: 'v1' },
      evidence: [{
        id: 'followup:old', kind: 'followup', label: '早期评审记录',
        value: '客户待明确参与范围', occurredAt: null,
        source: { recordId: 'old', recordUrl: 'https://example.test/followup/old', sourceVersion: 'v1' },
      }],
    }],
    recentFollowups: [{
      recordId: 'followup-1', opportunityRecordId: 'opportunity-1', opportunityName: '采购评审项目',
      summary: '客户要求核实技术验收范围', communicationAt: null, nextAction: '准备接口清单', dueAt: null,
      source: { recordId: 'followup-1', recordUrl: 'https://example.test/followup/1', sourceVersion: 'v1' },
    }],
    agenda: [{ sequence: 1, title: '对齐验收范围', purpose: '确认双方对验收的理解' }],
  },
};

const snapshot: CustomerPreparationResultSnapshot = {
  id: 'result-1', request: { customerName: '示例客户', communicationAt: null, purpose: null },
  report, revision: 1, createdAt: '2026-10-19T01:00:00Z',
};

let root: Root;
let container: HTMLDivElement;

const SwitchResult: React.FC = () => {
  const navigate = useNavigate();
  return React.createElement('button', {
    type: 'button',
    onClick: (): void => { void navigate('/preparations/result-2'); },
  }, '切换结果');
};

beforeEach(async (): Promise<void> => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(api.getCustomerPreparationResult).mockResolvedValue(snapshot);
  vi.mocked(api.getCustomerPreparationDelivery).mockResolvedValue({ status: 'sent' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

async function renderPage(): Promise<void> {
  await act(async (): Promise<void> => {
    root.render(React.createElement(MemoryRouter,
      { initialEntries: ['/preparations/result-1'] },
      React.createElement(React.Fragment, {},
        React.createElement(SwitchResult),
        React.createElement(Routes, {},
          React.createElement(Route, {
            path: '/preparations/:resultId',
            element: React.createElement(CustomerCommunicationPreparationPage),
          }),
        ),
      ),
    ));
  });
}

afterEach(async (): Promise<void> => {
  await act(async (): Promise<void> => root.unmount());
  container.remove();
  vi.resetAllMocks();
});

it.each([
  ['pending', '待投递'],
  ['dispatching', '发送处理中'],
  ['sent', '已记录发送'],
  ['unknown', '发送结果待核查'],
  ['not_recorded', '未记录投递状态'],
] as const)('presents %s delivery clearly', async (status, label): Promise<void> => {
  vi.mocked(api.getCustomerPreparationDelivery).mockResolvedValueOnce({
    status,
  } satisfies CustomerPreparationDeliveryStatus);
  await renderPage();
  expect(document.body.textContent).toContain(label);
  expect(document.body.textContent).toContain('沟通目标');
  expect(Array.from(document.querySelectorAll('button'))
    .some((button: HTMLButtonElement): boolean => button.textContent?.includes('重发') ?? false))
    .toBe(false);
  expect(api.confirmCustomerPreparationDelivery).not.toHaveBeenCalled();
  expect(api.getCustomerCommunicationPreparation).not.toHaveBeenCalled();
});

it('keeps the saved report usable when delivery status cannot be read', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationDelivery).mockRejectedValueOnce({
    status: 503, message: 'status unavailable', retryable: true,
  });
  await renderPage();
  expect(document.body.textContent).toContain('沟通目标');
  expect(document.body.textContent).toContain('投递状态暂不可用');
});

it('refreshes only the read-only delivery endpoint', async (): Promise<void> => {
  await renderPage();
  const button = Array.from(document.querySelectorAll('button'))
    .find((element: HTMLButtonElement): boolean => element.textContent?.includes('刷新状态') ?? false);
  if (!button) throw new Error('Missing delivery refresh button');
  await act(async (): Promise<void> => { button.click(); });
  expect(api.getCustomerPreparationDelivery).toHaveBeenCalledTimes(2);
  expect(api.getCustomerPreparationResult).toHaveBeenCalledOnce();
});

it('shows complete saved context with source links without regenerating', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationResult).mockResolvedValueOnce({ ...snapshot, report: completeReport });
  await renderPage();
  const text: string = document.body.textContent ?? '';
  for (const value of ['客户正在确认年度采购范围', '采购评审项目', '评审进度待核实',
    '最近没有可信评审进展', '时间缺口', '建议确认评审参与人',
    '客户要求核实技术验收范围', '准备接口清单', '对齐验收范围', '确认双方对验收的理解']) {
    expect(text).toContain(value);
  }
  expect(text).toContain('风险判断');
  expect(text).toContain('建议动作（待确认）');
  for (const href of ['https://example.test/customer/1', 'https://example.test/opportunity/1',
    'https://example.test/followup/1', 'https://example.test/followup/old']) {
    expect(container.querySelector(`a[href="${href}"]`)).not.toBeNull();
  }
  expect(api.getCustomerCommunicationPreparation).not.toHaveBeenCalled();
  expect(api.confirmCustomerPreparationDelivery).not.toHaveBeenCalled();
});

it('labels historical context as missing without recomputing it', async (): Promise<void> => {
  await renderPage();
  expect(document.body.textContent).toContain('历史结果未保存商机、跟进和议程');
  expect(document.body.textContent).toContain('客户正在确认年度采购范围');
  expect(api.getCustomerCommunicationPreparation).not.toHaveBeenCalled();
});

it('marks unresolved judgment evidence rather than treating the opportunity link as proof', async (): Promise<void> => {
  const partial: CustomerCommunicationPreparationResponse = structuredClone(completeReport);
  if (!partial.briefing) throw new Error('Expected briefing');
  partial.status = 'partial';
  partial.warnings = ['跟进来源不完整'];
  partial.briefing.opportunities[0].risks[0].evidenceIds.push('task-promise:missing');
  await act(async (): Promise<void> => {
    vi.mocked(api.getCustomerPreparationResult).mockResolvedValueOnce({ ...snapshot, report: partial });
  });
  await renderPage();
  expect(document.body.textContent).toContain('跟进来源不完整');
  expect(document.body.textContent).toContain('部分判断依据未包含在此结果中，需核实');
  expect(document.body.textContent).toContain('客户待明确参与范围');
});

it('does not claim no risks or complete history from empty partial lists', async (): Promise<void> => {
  const partial: CustomerCommunicationPreparationResponse = structuredClone(completeReport);
  if (!partial.briefing) throw new Error('Expected briefing');
  partial.status = 'partial';
  partial.coverage.followups = 'unavailable';
  partial.briefing.opportunities[0].risks = [];
  partial.briefing.recentFollowups = [];
  partial.briefing.agenda = [];
  vi.mocked(api.getCustomerPreparationResult).mockResolvedValueOnce({ ...snapshot, report: partial });
  await renderPage();
  expect(document.body.textContent).toContain('当前结果未提供风险判断');
  expect(document.body.textContent).toContain('跟进来源不可用');
  expect(document.body.textContent).toContain('暂无建议议程');
});

it.each(['active', 'unknown', 'won', 'lost', 'closed'] as const)(
  'uses lifecycle rather than missing health to label a %s opportunity',
  async (lifecycleStatus): Promise<void> => {
    const partial: CustomerCommunicationPreparationResponse = structuredClone(completeReport);
    if (!partial.briefing) throw new Error('Expected briefing');
    partial.status = 'partial';
    partial.briefing.opportunities[0].lifecycleStatus = lifecycleStatus;
    partial.briefing.opportunities[0].health = null;
    vi.mocked(api.getCustomerPreparationResult).mockResolvedValueOnce({ ...snapshot, report: partial });
    await renderPage();
    const opportunity: HTMLElement | undefined = Array.from(container.querySelectorAll('article'))
      .find((element: HTMLElement): boolean => element.textContent?.includes('采购评审项目') ?? false);
    if (!opportunity) throw new Error('Expected opportunity');
    if (lifecycleStatus === 'active' || lifecycleStatus === 'unknown') {
      expect(opportunity.textContent).toContain('风险状态待核实');
      expect(opportunity.textContent).not.toContain('历史商机');
      expect(opportunity.textContent).not.toContain('已结束商机');
    } else {
      expect(opportunity.textContent).toContain('已结束商机 · 历史背景');
      expect(opportunity.textContent).not.toContain('建议动作（待确认）');
    }
  },
);

it('ignores a result response that arrives after navigating to another result', async (): Promise<void> => {
  let resolveFirst: (value: CustomerPreparationResultSnapshot) => void =
    (): void => {};
  const firstResult: Promise<CustomerPreparationResultSnapshot> =
    new Promise((resolve): void => { resolveFirst = resolve; });
  const secondSnapshot: CustomerPreparationResultSnapshot = {
    ...snapshot,
    id: 'result-2',
    report: {
      ...report,
      customer: report.customer ? {
        ...report.customer, recordId: 'customer-2', name: '第二客户',
        latestSummary: '第二客户的独有近况',
      } : null,
      objective: {
        ...report.objective!,
        title: '第二份结果目标',
        detail: '第二份结果的独有内容',
      },
    },
  };
  vi.mocked(api.getCustomerPreparationResult)
    .mockImplementationOnce((): Promise<CustomerPreparationResultSnapshot> => firstResult)
    .mockResolvedValueOnce(secondSnapshot);

  await renderPage();
  expect(api.getCustomerPreparationResult).toHaveBeenCalledOnce();
  const switchButton: HTMLButtonElement | null =
    container.querySelector('button');
  if (!switchButton) throw new Error('Missing result navigation control');
  await act(async (): Promise<void> => {
    switchButton.click();
    await new Promise<void>((resolve): void => { setTimeout(resolve, 0); });
  });
  expect(api.getCustomerPreparationResult).toHaveBeenCalledTimes(2);
  expect(api.getCustomerPreparationResult).toHaveBeenLastCalledWith('result-2');
  const secondRequest: Promise<CustomerPreparationResultSnapshot> | undefined =
    vi.mocked(api.getCustomerPreparationResult).mock.results[1]?.value;
  if (!secondRequest) throw new Error('Missing second result request');
  await act(async (): Promise<void> => { await secondRequest; });
  expect(document.body.textContent).toContain('第二份结果的独有内容');

  await act(async (): Promise<void> => {
    resolveFirst(snapshot);
    await firstResult;
  });

  expect(document.body.textContent).toContain('第二份结果的独有内容');
  expect(document.body.textContent).not.toContain('示例客户');
});

it('ignores a stale result failure after navigating to another result', async (): Promise<void> => {
  let rejectFirst: (reason: unknown) => void = (): void => {};
  const firstResult: Promise<CustomerPreparationResultSnapshot> =
    new Promise((_, reject): void => { rejectFirst = reject; });
  const secondSnapshot: CustomerPreparationResultSnapshot = {
    ...snapshot,
    id: 'result-2',
    report: {
      ...report,
      customer: report.customer ? {
        ...report.customer, recordId: 'customer-2', name: '第二客户',
        latestSummary: '第二客户的独有近况',
      } : null,
      objective: {
        ...report.objective!,
        title: '第二份结果目标',
        detail: '第二份结果的独有内容',
      },
    },
  };
  vi.mocked(api.getCustomerPreparationResult)
    .mockImplementationOnce((): Promise<CustomerPreparationResultSnapshot> => firstResult)
    .mockResolvedValueOnce(secondSnapshot);

  await renderPage();
  const switchButton: HTMLButtonElement | null =
    container.querySelector('button');
  if (!switchButton) throw new Error('Missing result navigation control');
  await act(async (): Promise<void> => {
    switchButton.click();
    await new Promise<void>((resolve): void => { setTimeout(resolve, 0); });
  });
  const secondRequest: Promise<CustomerPreparationResultSnapshot> | undefined =
    vi.mocked(api.getCustomerPreparationResult).mock.results[1]?.value;
  if (!secondRequest) throw new Error('Missing second result request');
  await act(async (): Promise<void> => { await secondRequest; });
  expect(document.body.textContent).toContain('第二份结果的独有内容');

  await act(async (): Promise<void> => {
    rejectFirst({ status: 503, message: '旧结果读取失败', retryable: true });
    await Promise.resolve();
  });

  expect(document.body.textContent).toContain('第二份结果的独有内容');
  expect(document.body.textContent).not.toContain('旧结果读取失败');
});

function buttonNamed(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((element): boolean => element.textContent?.includes(label) ?? false);
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

async function clickButton(label: string): Promise<void> {
  await act(async (): Promise<void> => {
    buttonNamed(label).click();
    await new Promise<void>((resolve): void => { setTimeout(resolve, 0); });
  });
}

async function enterField(id: string, value: string): Promise<void> {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!field) throw new Error(`Missing field: ${id}`);
  const prototype = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('Missing native setter');
  await act(async (): Promise<void> => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function editableSnapshot(revision: number = 1, body: string = '原消息'): CustomerPreparationResultSnapshot {
  return {
    ...snapshot, revision,
    report: { ...report, drafts: [{
      channel: 'feishu', title: '沟通消息', subject: null, body,
      editable: true, execution: 'preview_only', sourceKeys: [],
    }] },
  };
}

it.each([401, 403, 404])('clears cached customer content after refresh returns %s', async (status): Promise<void> => {
  vi.mocked(api.getCustomerPreparationResult)
    .mockResolvedValueOnce(editableSnapshot())
    .mockRejectedValueOnce({ status, message: '结果不可访问', retryable: false });
  await renderPage();
  await enterField('communication-feishu-body', '本地敏感内容');
  await clickButton('刷新结果');
  expect(container.textContent).toContain('结果不可访问');
  expect(container.textContent).not.toContain('示例客户');
  expect(container.querySelector('#communication-feishu-body')).toBeNull();
  expect(container.textContent).not.toContain('已记录发送');
});

it('clears customer content when a draft save detects revoked access', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationResult).mockResolvedValue(editableSnapshot());
  vi.mocked(api.saveCustomerPreparationDraft)
    .mockRejectedValueOnce({ status: 403, message: '客户权限已撤销', retryable: false });
  await renderPage();
  await enterField('communication-feishu-body', '本地敏感内容');
  await clickButton('保存草稿');
  expect(container.textContent).toContain('客户权限已撤销');
  expect(container.querySelector('#communication-feishu-body')).toBeNull();
  expect(container.textContent).not.toContain('示例客户');
});

it('shares the returned revision between channel editors and keeps unsaved email edits', async (): Promise<void> => {
  const original = editableSnapshot(4);
  const email = { ...original.report.drafts[0], channel: 'email' as const, subject: '邮件主题', body: '原邮件' };
  original.report.drafts.push(email);
  const saved = structuredClone(original);
  saved.revision = 5;
  saved.draftEdits = [{ channel: 'feishu', subject: null, body: '更新消息' }];
  vi.mocked(api.getCustomerPreparationResult).mockResolvedValue(original);
  vi.mocked(api.saveCustomerPreparationDraft).mockResolvedValue(saved);
  await renderPage();
  await enterField('communication-email-body', '未保存邮件');
  await enterField('communication-feishu-body', '更新消息');
  await clickButton('保存草稿');
  expect(container.querySelector<HTMLTextAreaElement>('#communication-email-body')?.value).toBe('未保存邮件');
  const emailForm = container.querySelector('#communication-email-body')?.closest('form');
  if (!emailForm) throw new Error('Missing email form');
  await act(async (): Promise<void> => {
    emailForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(api.saveCustomerPreparationDraft).toHaveBeenLastCalledWith('result-1', {
    channel: 'email', subject: '邮件主题', body: '未保存邮件', expectedRevision: 5,
  });
});

it('ignores duplicate draft submissions without leaving a successful save blocked', async (): Promise<void> => {
  let finishSave: (value: CustomerPreparationResultSnapshot) => void = (): void => undefined;
  vi.mocked(api.getCustomerPreparationResult).mockResolvedValue(editableSnapshot());
  vi.mocked(api.saveCustomerPreparationDraft).mockImplementationOnce(() =>
    new Promise((resolve): void => { finishSave = resolve; }));
  await renderPage();
  await enterField('communication-feishu-body', '一次修改');
  const form = container.querySelector('#communication-feishu-body')?.closest('form');
  if (!form) throw new Error('Missing draft form');
  await act(async (): Promise<void> => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(api.saveCustomerPreparationDraft).toHaveBeenCalledOnce();
  await act(async (): Promise<void> => { finishSave(editableSnapshot(2, '一次修改')); });
  expect(buttonNamed('保存草稿').disabled).toBe(false);
  expect(container.textContent).not.toContain('另一个草稿操作正在进行');
});

it('lets the user adopt the latest content after a conflict', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationResult)
    .mockResolvedValueOnce(editableSnapshot())
    .mockResolvedValueOnce(editableSnapshot(2, '远端内容'));
  vi.mocked(api.saveCustomerPreparationDraft)
    .mockRejectedValueOnce({ status: 409, message: '版本变化', retryable: false });
  await renderPage();
  await enterField('communication-feishu-body', '本地内容');
  await clickButton('保存草稿');
  await clickButton('读取最新版本');
  await clickButton('采用最新内容');
  expect(container.querySelector<HTMLTextAreaElement>('#communication-feishu-body')?.value).toBe('远端内容');
  expect(buttonNamed('保存草稿').disabled).toBe(false);
});

it('clears customer content when reading delivery status detects revoked access', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationDelivery)
    .mockRejectedValueOnce({ status: 403, message: '客户权限已撤销', retryable: false });
  await renderPage();
  expect(container.textContent).toContain('客户权限已撤销');
  expect(container.textContent).not.toContain('示例客户');
});

it('saves edits with the snapshot revision and uses the returned revision on the next save', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationResult).mockResolvedValue(editableSnapshot(4));
  vi.mocked(api.saveCustomerPreparationDraft)
    .mockResolvedValueOnce(editableSnapshot(5, '第一次修改'))
    .mockResolvedValueOnce(editableSnapshot(6, '第二次修改'));
  await renderPage();
  await enterField('communication-feishu-body', '第一次修改');
  await clickButton('保存草稿');
  expect(api.saveCustomerPreparationDraft).toHaveBeenLastCalledWith('result-1', {
    channel: 'feishu', subject: null, body: '第一次修改', expectedRevision: 4,
  });
  await enterField('communication-feishu-body', '第二次修改');
  await clickButton('保存草稿');
  expect(api.saveCustomerPreparationDraft).toHaveBeenLastCalledWith('result-1', {
    channel: 'feishu', subject: null, body: '第二次修改', expectedRevision: 5,
  });
});

it('keeps edits on conflict and requires reading and choosing how to merge before saving again', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationResult)
    .mockResolvedValueOnce(editableSnapshot(1))
    .mockResolvedValueOnce(editableSnapshot(2, '远端修改'));
  vi.mocked(api.saveCustomerPreparationDraft)
    .mockRejectedValueOnce({ status: 409, message: '版本变化', retryable: false })
    .mockResolvedValueOnce(editableSnapshot(3, '我的修改'));
  await renderPage();
  await enterField('communication-feishu-body', '我的修改');
  await clickButton('保存草稿');
  expect(container.querySelector<HTMLTextAreaElement>('#communication-feishu-body')?.value).toBe('我的修改');
  expect(buttonNamed('保存草稿').disabled).toBe(true);
  await clickButton('读取最新版本');
  expect(container.textContent).toContain('远端修改');
  expect(container.querySelector<HTMLTextAreaElement>('#communication-feishu-body')?.value).toBe('我的修改');
  await clickButton('保留本地修改');
  await clickButton('保存草稿');
  expect(api.saveCustomerPreparationDraft).toHaveBeenLastCalledWith('result-1', {
    channel: 'feishu', subject: null, body: '我的修改', expectedRevision: 2,
  });
});

it('keeps unsaved input on a report refresh and a failed save', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationResult).mockResolvedValue(editableSnapshot());
  vi.mocked(api.saveCustomerPreparationDraft).mockRejectedValueOnce({
    status: 503, message: '保存暂不可用', retryable: true,
  });
  await renderPage();
  await enterField('communication-feishu-body', '尚未保存');
  await clickButton('刷新结果');
  expect(container.querySelector<HTMLTextAreaElement>('#communication-feishu-body')?.value).toBe('尚未保存');
  await clickButton('保存草稿');
  expect(container.textContent).toContain('保存暂不可用');
  expect(container.querySelector<HTMLTextAreaElement>('#communication-feishu-body')?.value).toBe('尚未保存');
});

it('isolates edits and a late save when switching results with the same generatedAt', async (): Promise<void> => {
  let resolveSave: (value: CustomerPreparationResultSnapshot) => void = (): void => {};
  const saving = new Promise<CustomerPreparationResultSnapshot>((resolve): void => { resolveSave = resolve; });
  vi.mocked(api.getCustomerPreparationResult)
    .mockResolvedValueOnce(editableSnapshot())
    .mockResolvedValueOnce({ ...editableSnapshot(9, '第二结果正文'), id: 'result-2' });
  vi.mocked(api.saveCustomerPreparationDraft).mockReturnValueOnce(saving);
  await renderPage();
  await enterField('communication-feishu-body', '第一结果修改');
  await clickButton('保存草稿');
  await clickButton('切换结果');
  expect(container.querySelector<HTMLTextAreaElement>('#communication-feishu-body')?.value).toBe('第二结果正文');
  await act(async (): Promise<void> => { resolveSave(editableSnapshot(2, '第一结果修改')); await saving; });
  expect(container.querySelector<HTMLTextAreaElement>('#communication-feishu-body')?.value).toBe('第二结果正文');
});

async function enterDeliveryEvidence(): Promise<void> {
  await enterField('preparation-delivery-message-id', 'om_existing');
  await enterField('preparation-delivery-sent-at', '2026-10-19T09:00:00+08:00');
  await enterField('preparation-delivery-note', '已在原会话核对消息正文与发送时间');
}

it('confirms only an unknown delivery with evidence and its current version', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationDelivery).mockResolvedValueOnce({ status: 'unknown', reconciliationVersion: 3 });
  vi.mocked(api.confirmCustomerPreparationDelivery).mockResolvedValueOnce({ status: 'sent', updatedAt: '2026-10-20T01:00:00Z' });
  await renderPage();
  await enterDeliveryEvidence();
  await clickButton('确认已发送');
  expect(api.confirmCustomerPreparationDelivery).toHaveBeenCalledExactlyOnceWith('result-1', {
    expectedVersion: 3, messageId: 'om_existing', sentAt: '2026-10-19T09:00:00+08:00',
    note: '已在原会话核对消息正文与发送时间',
  });
  expect(container.textContent).toContain('已记录发送');
});

it('rejects incomplete or future delivery evidence locally', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationDelivery).mockResolvedValueOnce({ status: 'unknown', reconciliationVersion: 1 });
  await renderPage();
  await clickButton('确认已发送');
  expect(api.confirmCustomerPreparationDelivery).not.toHaveBeenCalled();
  expect(container.textContent).toContain('请填写飞书消息 ID');
  await enterDeliveryEvidence();
  await enterField('preparation-delivery-sent-at', '2099-01-01T00:00:00Z');
  await clickButton('确认已发送');
  expect(api.confirmCustomerPreparationDelivery).not.toHaveBeenCalled();
  expect(container.textContent).toContain('发送时间不能晚于当前时间');
});

it('reads delivery after an ambiguous confirmation error instead of submitting again', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationDelivery)
    .mockResolvedValueOnce({ status: 'unknown', reconciliationVersion: 1 })
    .mockResolvedValueOnce({ status: 'sent', updatedAt: '2026-10-20T01:00:00Z' });
  vi.mocked(api.confirmCustomerPreparationDelivery).mockRejectedValueOnce({ status: 503, message: '响应丢失', retryable: true });
  await renderPage();
  await enterDeliveryEvidence();
  await clickButton('确认已发送');
  expect(api.getCustomerPreparationDelivery).toHaveBeenCalledTimes(2);
  expect(api.confirmCustomerPreparationDelivery).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('已记录发送');
});

it('blocks confirmation after an error until delivery can be rechecked, preserving evidence', async (): Promise<void> => {
  vi.mocked(api.getCustomerPreparationDelivery)
    .mockResolvedValueOnce({ status: 'unknown', reconciliationVersion: 1 })
    .mockRejectedValueOnce({ status: 503, message: '回读失败', retryable: true })
    .mockResolvedValueOnce({ status: 'unknown', reconciliationVersion: 2 });
  vi.mocked(api.confirmCustomerPreparationDelivery).mockRejectedValueOnce({ status: 503, message: '提交失败', retryable: true });
  await renderPage();
  await enterDeliveryEvidence();
  await clickButton('确认已发送');
  expect(buttonNamed('确认已发送').disabled).toBe(true);
  expect(container.querySelector<HTMLInputElement>('#preparation-delivery-message-id')?.value).toBe('om_existing');
  await clickButton('刷新状态');
  expect(buttonNamed('确认已发送').disabled).toBe(false);
});
