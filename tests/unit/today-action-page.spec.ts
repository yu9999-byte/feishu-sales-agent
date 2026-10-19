// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TodayActionPage from '../../client/src/pages/TodayActionPage/TodayActionPage';
import * as api from '../../client/src/api';
import type { TodayActionTaskConfirmResponse } from '@shared/api.interface';

vi.mock('../../client/src/api', () => ({
  getTodayActions: vi.fn(), createTodayTaskDraft: vi.fn(), confirmTodayTaskDraft: vi.fn(),
  getTodayTaskStatus: vi.fn(), operateTodayAction: vi.fn(), createTodayFollowupDraft: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
function NavigationHarness(): React.ReactElement {
  const navigate = useNavigate();
  return React.createElement(React.Fragment, {}, React.createElement(TodayActionPage),
    React.createElement('button', { onClick: () => navigate('/?taskAction=other') }, '切换任务'));
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(api.getTodayActions).mockResolvedValue({ referenceDate: '2026-10-17', timezone: 'Asia/Shanghai',
    generatedAt: '2026-10-17T01:00:00Z', status: 'ready', warnings: [], items: [{
      id: 'task:one', version: 'v1', title: '跟进报价', reason: '任务今天到期', evidence: ['报价待确认'],
      suggestedAction: '联系客户确认报价', suggestedCompletionDate: '2026-10-17',
      state: { status: 'open', revision: 0, itemId: 'task:one', itemVersion: 'v1', remindAt: null },
    }] } as never);
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(MemoryRouter, {}, React.createElement(NavigationHarness))); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });

function button(text: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find((element) => element.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

it.each(['success', 'failure'])('ignores an old confirmation %s after navigating to another task', async (outcome) => {
  vi.mocked(api.createTodayTaskDraft).mockResolvedValue({ actionId: 'one', title: '旧任务',
    dueAt: '2026-10-17T09:00:00Z', requiresConfirmation: true, status: 'pendingConfirmation' });
  vi.mocked(api.getTodayTaskStatus).mockImplementation(async (id: string) => ({
    actionId: id, title: id === 'one' ? '旧任务' : '新任务', dueAt: '2026-10-17T09:00:00Z', status: 'succeeded',
  }));
  let finish: ((result: TodayActionTaskConfirmResponse) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  vi.mocked(api.confirmTodayTaskDraft).mockImplementation(() => new Promise((resolve, reject) => {
    finish = resolve; fail = reject;
  }));
  await act(async () => button('创建任务').click());
  await act(async () => button('确认并创建任务').click());
  await act(async () => button('切换任务').click());
  expect(document.querySelector('section[role="status"]')?.textContent).toContain('新任务');
  await act(async () => {
    if (outcome === 'success') finish?.({ actionId: 'one', status: 'succeeded' });
    else fail?.(new Error('旧任务确认失败'));
  });
  expect(document.querySelector('section[role="status"]')?.textContent).toContain('新任务');
  expect(document.querySelector('section[role="status"]')?.textContent).not.toContain('旧任务');
  expect(document.body.textContent).not.toContain('旧任务确认失败');
});

it('retains task input and reuses the key after failure while blocking consecutive clicks', async () => {
  vi.mocked(api.createTodayTaskDraft).mockRejectedValueOnce({ message: '暂时不可用' });
  await act(async () => button('创建任务').click());
  const title = document.querySelector<HTMLInputElement>('[role="dialog"] input');
  if (!title) throw new Error('Missing task input');
  await act(async () => { button('确认并创建任务').click(); button('确认并创建任务').click(); });
  expect(api.createTodayTaskDraft).toHaveBeenCalledOnce();
  expect(title.value).toBe('联系客户确认报价');
  expect(document.body.textContent).toContain('暂时不可用');
  vi.mocked(api.createTodayTaskDraft).mockResolvedValue({ actionId: 'one', title: title.value,
    dueAt: '2026-10-17T09:00:00Z', requiresConfirmation: true, status: 'pendingConfirmation' });
  vi.mocked(api.confirmTodayTaskDraft).mockResolvedValue({ actionId: 'one', status: 'executing' });
  vi.mocked(api.getTodayTaskStatus).mockResolvedValue({ actionId: 'one', status: 'succeeded',
    title: title.value, dueAt: '2026-10-17T09:00:00Z', taskUrl: 'https://applink.feishu.cn/task/one' });
  await act(async () => button('确认并创建任务').click());
  expect(api.createTodayTaskDraft).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.createTodayTaskDraft).mock.calls[1][0]).toEqual(
    vi.mocked(api.createTodayTaskDraft).mock.calls[0][0]);
  expect(api.confirmTodayTaskDraft).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain('任务执行成功');
  await act(async () => button('刷新任务状态').click());
  expect(api.confirmTodayTaskDraft).toHaveBeenCalledOnce();
  expect(document.querySelector('a[href="https://applink.feishu.cn/task/one"]')).not.toBeNull();
});

it('preserves the original snooze request across a failed UI operation and retry', async () => {
  vi.mocked(api.operateTodayAction).mockRejectedValueOnce({ message: '网络暂不可用' })
    .mockResolvedValue({ itemId: 'task:one', itemVersion: 'v1', revision: 1,
      status: 'snoozed', remindAt: '2026-10-17T09:00:00Z' });
  await act(async () => { button('一小时后提醒').click(); button('一小时后提醒').click(); });
  expect(api.operateTodayAction).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain('网络暂不可用');
  await act(async () => button('一小时后提醒').click());
  expect(api.operateTodayAction).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.operateTodayAction).mock.calls[1][0]).toEqual(
    vi.mocked(api.operateTodayAction).mock.calls[0][0]);
  expect(api.createTodayTaskDraft).not.toHaveBeenCalled();
  expect(api.confirmTodayTaskDraft).not.toHaveBeenCalled();
});

it('requires actual communication and retains it when followup generation fails', async () => {
  vi.mocked(api.createTodayFollowupDraft).mockRejectedValue({ message: '草案暂不可用' });
  await act(async () => button('生成跟进').click());
  expect(button('生成并检查草案').disabled).toBe(true);
  const input = document.querySelector<HTMLTextAreaElement>('#today-communication');
  if (!input) throw new Error('Missing communication input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, '客户今天确认预算，要求周一联系');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { button('生成并检查草案').click(); button('生成并检查草案').click(); });
  expect(api.createTodayFollowupDraft).toHaveBeenCalledOnce();
  expect(vi.mocked(api.createTodayFollowupDraft).mock.calls[0][0].communicationText)
    .toBe('客户今天确认预算，要求周一联系');
  expect(input.value).toBe('客户今天确认预算，要求周一联系');
  expect(document.body.textContent).toContain('草案暂不可用');
  await act(async () => button('生成并检查草案').click());
  expect(vi.mocked(api.createTodayFollowupDraft).mock.calls[1][0]).toEqual(
    vi.mocked(api.createTodayFollowupDraft).mock.calls[0][0]);
  expect(api.confirmTodayTaskDraft).not.toHaveBeenCalled();
});
