// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlaybookDraftWorkspace } from
  '../../client/src/pages/PlaybookOptimizationPage/PlaybookDraftWorkspace';
import * as api from '../../client/src/api';
import type { PlaybookDraftVersion, PlaybookOptimizationCandidate } from '../../shared/api.interface';

vi.mock('../../client/src/api', () => ({
  getPlaybookDraft: vi.fn(), getPlaybookDraftVersion: vi.fn(), savePlaybookDraft: vi.fn(),
}));
const candidate: PlaybookOptimizationCandidate = {
  id: 'candidate-1', topicPreview: '技术评审', status: 'accepted_for_authoring',
  sources: [], reasons: [], occurrenceCount: 3, lastQaStatus: 'answered',
  firstObservedAt: '2026-10-20T00:00:00Z', lastObservedAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
};
const latest: PlaybookDraftVersion = {
  candidateId: candidate.id, version: 1, title: '技术评审', body: '确认双方接口范围与验收标准。',
  applicability: '技术评审阶段', changeNote: '创建初版', authorMemberId: 'member-1',
  sources: [], createdAt: '2026-10-20T00:00:00Z',
};
let root: Root;
let host: HTMLDivElement;
const onClose = vi.fn();
const onAccessFailure = vi.fn();
beforeEach((): void => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.mocked(api.getPlaybookDraft).mockResolvedValue({ latest, history: [latest], nextBeforeVersion: null });
});
afterEach(async (): Promise<void> => {
  await act(async (): Promise<void> => root.unmount()); host.remove(); vi.resetAllMocks();
});
const render = async (value = candidate): Promise<void> => {
  await act(async (): Promise<void> => root.render(React.createElement(PlaybookDraftWorkspace, {
    key: value.id, candidate: value, canApprove: false, onClose, onAccessFailure,
  })));
};
const button = (label: string): HTMLButtonElement => {
  const found = Array.from(document.querySelectorAll('button')).find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};
const click = async (label: string): Promise<void> => {
  await act(async (): Promise<void> => button(label).click());
};
const edit = async (name: string, value: string): Promise<void> => {
  const input = document.querySelector(`[name="${name}"]`);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) throw new Error('Missing field');
  const prototype = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  await act(async (): Promise<void> => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

it('creates a first version only from explicit human input', async (): Promise<void> => {
  vi.mocked(api.getPlaybookDraft).mockResolvedValue({ latest: null, history: [], nextBeforeVersion: null });
  vi.mocked(api.savePlaybookDraft).mockResolvedValue(latest);
  await render();
  expect((document.querySelector('[name="body"]') as HTMLTextAreaElement).value).toBe('');
  await edit('body', latest.body); await edit('applicability', latest.applicability);
  await edit('changeNote', latest.changeNote); await click('保存新版本');
  expect(api.savePlaybookDraft).toHaveBeenCalledWith(candidate.id, expect.objectContaining({
    expectedVersion: 0, body: latest.body, requestId: expect.any(String),
  }));
  expect(document.body.textContent).toContain('已保存 v1');
});

it('preserves input and retries the identical request after an uncertain response', async (): Promise<void> => {
  vi.mocked(api.savePlaybookDraft).mockRejectedValueOnce({ status: 503, message: '响应丢失' })
    .mockResolvedValueOnce({ ...latest, version: 2 });
  await render(); await edit('body', '本地正在编写且必须保留的技术内容。');
  await click('保存新版本');
  expect((document.querySelector('[name="body"]') as HTMLTextAreaElement).value).toContain('本地正在编写');
  await click('重试原保存请求');
  const calls = vi.mocked(api.savePlaybookDraft).mock.calls;
  expect(calls[1]).toEqual(calls[0]);
});

it('reads a conflict then requires an explicit local or remote choice', async (): Promise<void> => {
  const remote = { ...latest, version: 2, body: '另一位审核人保存的最新技术说明。' };
  vi.mocked(api.savePlaybookDraft).mockRejectedValueOnce({ status: 409, message: '版本变化' })
    .mockResolvedValueOnce({ ...remote, version: 3 });
  await render(); await edit('body', '本地审核人希望保留的完整技术说明。');
  vi.mocked(api.getPlaybookDraft).mockResolvedValue({ latest: remote, history: [remote, latest], nextBeforeVersion: null });
  await click('保存新版本');
  expect(button('保存新版本').disabled).toBe(true);
  await click('保留本地内容'); await click('保存新版本');
  expect(api.savePlaybookDraft).toHaveBeenLastCalledWith(candidate.id, expect.objectContaining({
    expectedVersion: 2, body: '本地审核人希望保留的完整技术说明。',
  }));
});

it.each([401, 403, 404])('clears editor and history on access failure %s', async (status): Promise<void> => {
  await render(); vi.mocked(api.savePlaybookDraft).mockRejectedValue({ status, message: '无权访问' });
  await edit('body', '不应该继续显示的敏感内容文本。'); await click('保存新版本');
  expect(onAccessFailure).toHaveBeenCalled();
  expect(document.body.textContent).not.toContain(latest.body);
  expect(document.querySelector('[name="body"]')).toBeNull();
});

it('ignores a late save response after switching candidates', async (): Promise<void> => {
  let resolveSave: (value: PlaybookDraftVersion) => void = (): void => undefined;
  vi.mocked(api.savePlaybookDraft).mockImplementation(() => new Promise((resolve): void => { resolveSave = resolve; }));
  await render(); await edit('body', '第一位候选的修改仍在保存处理中。'); await click('保存新版本');
  await render({ ...candidate, id: 'candidate-2' });
  await act(async (): Promise<void> => resolveSave({ ...latest, version: 99 }));
  expect(document.body.textContent).not.toContain('v99');
});

it('keeps a conflict locked after a failed read and allows an explicit remote choice after recovery', async (): Promise<void> => {
  const remote = { ...latest, version: 2, body: '其他审核人已保存的最新技术评审正文。' };
  await render(); await edit('body', '仍应保留的本地完整技术评审正文。');
  vi.mocked(api.savePlaybookDraft).mockRejectedValueOnce({ status: 409, message: '版本变化' });
  vi.mocked(api.getPlaybookDraft).mockRejectedValueOnce({ status: 503, message: '读取暂不可用' })
    .mockResolvedValueOnce({ latest: remote, history: [remote, latest], nextBeforeVersion: null });
  await click('保存新版本');
  expect(button('保存新版本').disabled).toBe(true);
  expect((document.querySelector('[name="body"]') as HTMLTextAreaElement).value).toContain('仍应保留');
  await click('读取最新版本');
  expect(button('保存新版本').disabled).toBe(true);
  await click('使用远端内容');
  expect((document.querySelector('[name="body"]') as HTMLTextAreaElement).value).toBe(remote.body);
  expect(button('保存新版本').disabled).toBe(true);
  expect(api.savePlaybookDraft).toHaveBeenCalledTimes(1);
});

it('loads older history and displays plain text version details without changing the editor', async (): Promise<void> => {
  const current = { ...latest, version: 2 };
  vi.mocked(api.getPlaybookDraft).mockResolvedValueOnce({ latest: current, history: [current], nextBeforeVersion: 2 })
    .mockResolvedValueOnce({ latest: current, history: [latest], nextBeforeVersion: null });
  vi.mocked(api.getPlaybookDraftVersion).mockResolvedValueOnce({ ...latest,
    body: '<script>untrusted()</script>历史正文', sources: [{ sourceId: 'source-1', sourceVersion: 'v1' }] });
  await render();
  await act(async (): Promise<void> => {
    const tab = document.querySelector('[role="tab"][data-state="inactive"]');
    if (!(tab instanceof HTMLButtonElement)) throw new Error('Missing history tab');
    tab.focus();
  });
  await click('更早版本');
  expect(api.getPlaybookDraft).toHaveBeenLastCalledWith(candidate.id, 2);
  await click('查看 v1');
  const detail = document.querySelector('[aria-label="版本 1 正文"]');
  expect(detail?.textContent).toContain('<script>untrusted()</script>历史正文');
  expect(detail?.textContent).toContain('source-1 · v1');
  expect(detail?.querySelector('script')).toBeNull();
  expect(api.savePlaybookDraft).not.toHaveBeenCalled();
});

it('sends only one save while repeated submit events are in flight', async (): Promise<void> => {
  let resolveSave: (value: PlaybookDraftVersion) => void = (): void => undefined;
  vi.mocked(api.savePlaybookDraft).mockImplementation(() => new Promise((resolve): void => { resolveSave = resolve; }));
  await render(); await edit('body', '两次快速保存仍应仅生成一个新版本。');
  await act(async (): Promise<void> => {
    const form = document.querySelector('form');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(api.savePlaybookDraft).toHaveBeenCalledTimes(1);
  await act(async (): Promise<void> => resolveSave({ ...latest, version: 2 }));
});

it('requires explicit discard before closing an unsaved edit', async (): Promise<void> => {
  await render(); await edit('body', '尚未保存且关闭前需要确认的正文。');
  await click('关闭'); expect(onClose).not.toHaveBeenCalled();
  await click('继续编辑'); expect(onClose).not.toHaveBeenCalled();
  expect((document.querySelector('[name="body"]') as HTMLTextAreaElement).value).toContain('尚未保存');
  await click('关闭'); await click('放弃并关闭');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('can recover an initial read failure without creating a version', async (): Promise<void> => {
  vi.mocked(api.getPlaybookDraft).mockRejectedValueOnce({ status: 503, message: '暂不可用' })
    .mockResolvedValueOnce({ latest, history: [latest], nextBeforeVersion: null });
  await render(); expect(document.querySelector('form')).toBeNull();
  await click('重新读取草稿');
  expect((document.querySelector('[name="body"]') as HTMLTextAreaElement).value).toBe(latest.body);
  expect(api.savePlaybookDraft).not.toHaveBeenCalled();
});
