// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlaybookPublicationPanel } from '../../client/src/pages/PlaybookOptimizationPage/PlaybookPublicationPanel';
import * as api from '../../client/src/api';
import type { PlaybookPublicationResponse } from '../../shared/api.interface';

vi.mock('../../client/src/api', () => ({ getPlaybookPublication: vi.fn(), recordPlaybookPublication: vi.fn() }));
const approved: PlaybookPublicationResponse = {
  latestDraft: { candidateId: 'candidate-1', version: 1, title: '技术评审', body: '已保存的评审内容正文。',
    applicability: '技术评审阶段', changeNote: '初版', sources: [{ sourceId: 'source', sourceVersion: 'v7' }],
    authorMemberId: 'member', createdAt: '2026-10-21T00:00:00Z' },
  reviewSequence: 2, approvedVersion: 1, current: null, active: null, history: [], nextBeforeSequence: null,
};
const event = { candidateId: 'candidate-1', sequence: 1, version: 1, approvedReviewSequence: 2,
  action: 'publish' as const, actorMemberId: 'member', note: '正式发布', createdAt: '2026-10-21T00:00:00Z' };
const active: PlaybookPublicationResponse = { ...approved, current: event, history: [event],
  active: { candidateId: 'candidate-1', version: 1, publicationSequence: 1, title: '技术评审',
    body: '当前发布的评审内容正文。', applicability: '技术评审阶段', sources: [], publishedAt: event.createdAt } };
const removed: PlaybookPublicationResponse = { ...active, active: null,
  current: { ...event, sequence: 2, action: 'withdraw' }, history: [{ ...event, sequence: 2, action: 'withdraw' }, event] };
let root: Root;
let host: HTMLDivElement;
const onAccessFailure = vi.fn();
const onOperationState = vi.fn();
beforeEach((): void => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.mocked(api.getPlaybookPublication).mockResolvedValue(approved);
  vi.mocked(api.recordPlaybookPublication).mockResolvedValue(event);
});
afterEach(async (): Promise<void> => {
  await act(async (): Promise<void> => root.unmount()); host.remove(); vi.resetAllMocks();
});
const render = async (canPublish = true, disabled = false, candidateId = 'candidate-1'): Promise<void> => {
  await act(async (): Promise<void> => root.render(React.createElement(PlaybookPublicationPanel, {
    key: candidateId, candidateId, canPublish, disabled, onAccessFailure, onOperationState,
  })));
};
const button = (label: string): HTMLButtonElement => {
  const found = Array.from(host.querySelectorAll('button')).find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};
const click = async (label: string): Promise<void> => { await act(async (): Promise<void> => button(label).click()); };
const note = async (value: string): Promise<void> => {
  const field = host.querySelector('textarea'); if (!field) throw new Error('Missing note');
  await act(async (): Promise<void> => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const start = async (): Promise<void> => { await note('  已确认发布范围  '); await click('发布此版本'); await click('确认发布'); };

it('previews the saved approved version with frozen sources and requires explicit confirmation', async (): Promise<void> => {
  await render(); expect(host.textContent).toContain('已保存的评审内容正文。'); expect(host.textContent).toContain('source · v7');
  expect(button('发布此版本').disabled).toBe(true); await note('已确认发布范围'); await click('发布此版本');
  expect(api.recordPlaybookPublication).not.toHaveBeenCalled(); await click('取消');
  expect(api.recordPlaybookPublication).not.toHaveBeenCalled(); await click('发布此版本');
  vi.mocked(api.getPlaybookPublication).mockResolvedValue(active); await click('确认发布');
  expect(api.recordPlaybookPublication).toHaveBeenCalledWith('candidate-1', expect.objectContaining({
    action: 'publish', expectedVersion: 1, expectedReviewSequence: 2, expectedPublicationSequence: 0,
    note: '已确认发布范围', requestId: expect.any(String),
  }));
  expect(host.textContent).toContain('当前已发布 v1'); expect(host.textContent).toContain('当前发布的评审内容正文。');
});
it('uses refreshed current state after a delayed publication replay instead of resurrecting it', async (): Promise<void> => {
  await render(); vi.mocked(api.getPlaybookPublication).mockResolvedValue(removed); await start();
  expect(host.textContent).toContain('当前已撤回');
  expect(host.querySelector('[aria-label="已发布版本 v1"]')).toBeNull();
});
it('withdraws the current published version even after a newer unapproved draft', async (): Promise<void> => {
  vi.mocked(api.getPlaybookPublication).mockResolvedValue({ ...active,
    latestDraft: { ...approved.latestDraft!, version: 2 }, approvedVersion: null });
  await render(); expect(host.textContent).not.toContain('发布此版本'); await note('需要撤回旧版');
  await click('撤回当前版本'); expect(api.recordPlaybookPublication).not.toHaveBeenCalled();
  vi.mocked(api.getPlaybookPublication).mockResolvedValue(removed); await click('确认撤回');
  expect(api.recordPlaybookPublication).toHaveBeenCalledWith('candidate-1', expect.objectContaining({
    action: 'withdraw', expectedVersion: 1, expectedReviewSequence: null, expectedPublicationSequence: 1,
  })); expect(host.textContent).toContain('当前已撤回');
});
it('freezes uncertain requests and retries all original fields', async (): Promise<void> => {
  vi.mocked(api.recordPlaybookPublication).mockRejectedValueOnce({ status: 503, message: '结果未知' }).mockResolvedValueOnce(event);
  await render(); await start(); expect(button('刷新发布状态').disabled).toBe(true);
  expect(onOperationState).toHaveBeenCalledWith(true);
  expect(host.textContent).not.toContain('已保存的评审内容正文。');
  vi.mocked(api.getPlaybookPublication).mockResolvedValue(removed); await click('重试原发布请求');
  const calls = vi.mocked(api.recordPlaybookPublication).mock.calls;
  expect(calls[1]).toEqual(calls[0]); expect(host.textContent).toContain('当前已撤回');
  expect(onOperationState).toHaveBeenLastCalledWith(false);
});
it('hides stale state and blocks another write when the post-write refresh fails', async (): Promise<void> => {
  await render(); vi.mocked(api.getPlaybookPublication).mockRejectedValueOnce({ status: 503, message: '回读失败' });
  await start(); expect(host.querySelector('textarea')).toBeNull(); expect(host.textContent).not.toContain('发布此版本');
  expect(host.textContent).not.toContain('重试原发布请求');
  vi.mocked(api.getPlaybookPublication).mockResolvedValue(active); await click('刷新发布状态');
  expect(host.textContent).toContain('当前已发布 v1'); expect(api.recordPlaybookPublication).toHaveBeenCalledTimes(1);
});
it('preserves the note after a conflict and requires successful refresh before another action', async (): Promise<void> => {
  vi.mocked(api.recordPlaybookPublication).mockRejectedValue({ status: 409, message: '状态已变化' });
  await render(); await start(); expect(host.querySelector('textarea')).toBeNull();
  vi.mocked(api.getPlaybookPublication).mockRejectedValueOnce({ status: 503, message: '读取失败' });
  await click('刷新发布状态'); expect(host.textContent).not.toContain('发布此版本');
  vi.mocked(api.getPlaybookPublication).mockResolvedValue(approved); await click('刷新发布状态');
  expect(host.querySelector('textarea')?.value).toBe('  已确认发布范围  ');
  expect(api.recordPlaybookPublication).toHaveBeenCalledTimes(1);
});
it.each([401, 403, 404])('clears private state when access fails with %s', async (status): Promise<void> => {
  vi.mocked(api.recordPlaybookPublication).mockRejectedValue({ status, message: '无权访问' });
  await render(); await start(); expect(onAccessFailure).toHaveBeenCalled();
  expect(host.querySelector('textarea')).toBeNull(); expect(host.textContent).not.toContain('已保存的评审内容正文。');
});
it('does not show publication commands to reviewers without publication permission', async (): Promise<void> => {
  await render(false); expect(host.querySelector('textarea')).toBeNull(); expect(host.textContent).not.toContain('发布此版本');
});
it('blocks publication for local unsaved changes or an unapproved version', async (): Promise<void> => {
  await render(true, true); expect(button('发布此版本').disabled).toBe(true);
  vi.mocked(api.getPlaybookPublication).mockResolvedValue({ ...approved, approvedVersion: null });
  await render(true, false, 'candidate-2'); expect(host.textContent).not.toContain('发布此版本');
});
it('ignores late write responses after changing candidates', async (): Promise<void> => {
  let resolve: (value: typeof event) => void = (): void => undefined;
  vi.mocked(api.recordPlaybookPublication).mockImplementation(() => new Promise((done): void => { resolve = done; }));
  await render(); await start(); await render(true, false, 'candidate-2');
  await act(async (): Promise<void> => resolve(event));
  expect(api.getPlaybookPublication).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('尚未发布'); expect(host.textContent).not.toContain('当前已发布');
});
it('loads exclusive history pages and deduplicates events', async (): Promise<void> => {
  vi.mocked(api.getPlaybookPublication).mockResolvedValue({ ...active, nextBeforeSequence: 1 });
  await render(); vi.mocked(api.getPlaybookPublication).mockResolvedValue({ ...active, nextBeforeSequence: null });
  await click('更早发布记录'); expect(api.getPlaybookPublication).toHaveBeenLastCalledWith('candidate-1', 1);
  expect(host.querySelectorAll('ol li')).toHaveLength(1);
});
