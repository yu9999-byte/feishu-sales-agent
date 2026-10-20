// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskPromiseEvidencePanel } from '../../client/src/pages/TaskFulfillmentPage/TaskPromiseEvidencePanel';
import * as api from '../../client/src/api';
import type { TaskPromiseEvidenceResponse, TaskPromiseEvidenceEvent } from '../../shared/api.interface';

vi.mock('../../client/src/api', () => ({ getTaskPromiseEvidence: vi.fn(), recordTaskPromiseEvidence: vi.fn() }));
const empty: TaskPromiseEvidenceResponse = { revision: 0, current: null, history: [], nextBeforeRevision: null };
const event: TaskPromiseEvidenceEvent = { actionId: 'action-a', revision: 1, state: 'reported_fulfilled',
  note: '方案已经交付', evidenceUrl: 'https://example.feishu.cn/docx/abc', actorMemberId: 'member-a',
  createdAt: '2026-10-20T00:00:00Z' };
let root: Root;
let host: HTMLDivElement;
const onAccessFailure = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.mocked(api.getTaskPromiseEvidence).mockResolvedValue(empty);
  vi.mocked(api.recordTaskPromiseEvidence).mockResolvedValue(event);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.resetAllMocks(); });
const render = async (actionId = 'action-a', canWrite = true): Promise<void> => {
  await act(async () => root.render(React.createElement(TaskPromiseEvidencePanel, {
    key: actionId, actionId, nextAction: '周五交付最终方案', canWrite,
    onAccessFailure,
  })));
};
const button = (label: string): HTMLButtonElement => {
  const result = Array.from(document.querySelectorAll('button')).find((item) => item.textContent === label);
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
};
const click = async (label: string): Promise<void> => { await act(async () => button(label).click()); };
const edit = async (name: string, value: string): Promise<void> => {
  const field = document.querySelector(`[name="${name}"]`);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) throw new Error('Missing field');
  await act(async () => {
    const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const fill = async (): Promise<void> => { await edit('note', event.note); await edit('evidenceUrl', event.evidenceUrl!); };

it('shows the exact promise and keeps declarations separate from task completion', async () => {
  await render(); expect(document.body.textContent).toContain('周五交付最终方案');
  vi.mocked(api.getTaskPromiseEvidence).mockResolvedValue({ ...empty, revision: 1, current: event, history: [event] });
  expect(button('保存本人声明').disabled).toBe(true); await fill(); await click('保存本人声明');
  expect(api.recordTaskPromiseEvidence).toHaveBeenCalledWith('action-a', expect.objectContaining({
    expectedRevision: 0, state: 'reported_fulfilled', note: event.note, evidenceUrl: event.evidenceUrl,
  }));
  expect(document.body.textContent).toContain('本人声明已兑现');
  expect(document.body.textContent).toContain('未自动核验');
});
it('freezes uncertain input and retries the same request', async () => {
  vi.mocked(api.recordTaskPromiseEvidence).mockRejectedValueOnce({ status: 503, message: '响应丢失' }).mockResolvedValueOnce(event);
  await render(); await fill(); await click('保存本人声明');
  expect(document.querySelector('textarea')?.disabled).toBe(true);
  expect(button('刷新凭证').disabled).toBe(true);
  await click('重试原请求');
  expect(vi.mocked(api.recordTaskPromiseEvidence).mock.calls[1]).toEqual(vi.mocked(api.recordTaskPromiseEvidence).mock.calls[0]);
});
it('preserves local input on conflict and requires a successful refresh', async () => {
  vi.mocked(api.recordTaskPromiseEvidence).mockRejectedValueOnce({ status: 409, message: '版本变化' });
  await render(); await fill(); await click('保存本人声明');
  expect(button('保存本人声明').disabled).toBe(true);
  vi.mocked(api.getTaskPromiseEvidence).mockRejectedValueOnce({ status: 503, message: '读取失败' });
  await click('刷新凭证'); expect(button('保存本人声明').disabled).toBe(true);
  expect(document.querySelector('textarea')?.value).toBe(event.note);
  vi.mocked(api.getTaskPromiseEvidence).mockResolvedValue({ ...empty, revision: 1, current: event, history: [event] });
  await click('刷新凭证'); await click('保存本人声明');
  expect(api.recordTaskPromiseEvidence).toHaveBeenLastCalledWith('action-a', expect.objectContaining({ expectedRevision: 1 }));
});
it.each([401, 403, 404])('clears all promise and evidence content when access fails %s', async (status) => {
  await render(); await fill();
  vi.mocked(api.recordTaskPromiseEvidence).mockRejectedValueOnce({ status, message: '访问失效' });
  await click('保存本人声明');
  expect(document.body.textContent).not.toContain('周五交付最终方案');
  expect(document.querySelector('textarea')).toBeNull();
  expect(onAccessFailure).toHaveBeenCalledWith(expect.objectContaining({ status }));
});
it('ignores a late response after switching promises', async () => {
  let resolve: (value: TaskPromiseEvidenceEvent) => void = () => undefined;
  vi.mocked(api.recordTaskPromiseEvidence).mockImplementation(() => new Promise((done) => { resolve = done; }));
  await render(); await fill(); await click('保存本人声明'); await render('action-b');
  await act(async () => resolve(event));
  expect(document.body.textContent).not.toContain(event.note);
  expect(document.body.textContent).toContain('尚无本人声明');
});
it('supports read-only access and paged history', async () => {
  vi.mocked(api.getTaskPromiseEvidence).mockResolvedValueOnce({ ...empty, revision: 21, current: { ...event, revision: 21 },
    history: [{ ...event, revision: 21 }], nextBeforeRevision: 2 }).mockResolvedValueOnce({ ...empty,
    revision: 21, current: { ...event, revision: 21 }, history: [event] });
  await render('action-a', false); expect(document.querySelector('form')).toBeNull(); await click('更早记录');
  expect(api.getTaskPromiseEvidence).toHaveBeenLastCalledWith('action-a', 2);
  expect(document.querySelectorAll('[data-evidence-revision]')).toHaveLength(2);
});

it('requires an explicit save to retract and allows an empty evidence URL', async () => {
  Element.prototype.scrollIntoView = vi.fn();
  await render();
  const trigger = document.querySelector('[role="combobox"]');
  if (!(trigger instanceof HTMLElement)) throw new Error('Missing state selector');
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((item) => item.textContent === '撤回声明');
  if (!(option instanceof HTMLElement)) throw new Error('Missing retract option');
  await act(async () => {
    option.focus(); option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(api.recordTaskPromiseEvidence).not.toHaveBeenCalled();
  await edit('note', '原声明需要重新核实'); await click('确认撤回声明');
  expect(api.recordTaskPromiseEvidence).toHaveBeenCalledWith('action-a', expect.objectContaining({ state: 'retracted', evidenceUrl: null }));
});
