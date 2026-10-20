// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlaybookDraftReviewPanel } from '../../client/src/pages/PlaybookOptimizationPage/PlaybookDraftReviewPanel';
import * as api from '../../client/src/api';
import type { PlaybookDraftReviewResponse, PlaybookDraftVersion } from '../../shared/api.interface';

vi.mock('../../client/src/api', () => ({
  getPlaybookDraftReview: vi.fn(), recordPlaybookDraftReview: vi.fn(), getPlaybookDraftVersion: vi.fn(),
}));
const version: PlaybookDraftVersion = { candidateId: 'candidate-1', version: 1, title: '技术评审',
  body: '核对双方技术接口与实际验收范围。', applicability: '技术评审阶段', changeNote: '创建初版',
  authorMemberId: 'member-1', sources: [], createdAt: '2026-10-20T00:00:00Z' };
const empty: PlaybookDraftReviewResponse = { latestDraftVersion: 1, status: 'not_submitted',
  current: null, history: [], nextBeforeSequence: null };
const submitted: PlaybookDraftReviewResponse = { ...empty, status: 'pending_review',
  current: { candidateId: 'candidate-1', sequence: 1, version: 1, action: 'submit', note: '检查完成',
    actorMemberId: 'member-1', createdAt: '2026-10-20T00:00:00Z' } };
let root: Root;
let host: HTMLDivElement;
const onAccessFailure = vi.fn();
beforeEach((): void => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.mocked(api.getPlaybookDraftReview).mockResolvedValue(empty);
  vi.mocked(api.getPlaybookDraftVersion).mockResolvedValue(version);
});
afterEach(async (): Promise<void> => {
  await act(async (): Promise<void> => root.unmount()); host.remove(); vi.resetAllMocks();
});
const render = async (canApprove = false, disabled = false, candidateId = 'candidate-1'): Promise<void> => {
  await act(async (): Promise<void> => root.render(React.createElement(PlaybookDraftReviewPanel, {
    key: candidateId, candidateId, version: 1, canApprove, disabled, onAccessFailure,
  })));
};
const button = (label: string): HTMLButtonElement => {
  const item = Array.from(document.querySelectorAll('button')).find((value) => value.textContent === label);
  if (!item) throw new Error(`Missing button: ${label}`);
  return item;
};
const click = async (label: string): Promise<void> => { await act(async (): Promise<void> => button(label).click()); };
const note = async (value: string): Promise<void> => {
  const field = document.querySelector('textarea');
  if (!field) throw new Error('Missing review note');
  await act(async (): Promise<void> => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

it('shows the exact saved snapshot and submits only a completed note', async (): Promise<void> => {
  vi.mocked(api.recordPlaybookDraftReview).mockResolvedValue(submitted.current!);
  await render(); expect(document.body.textContent).toContain(version.body);
  expect(button('提交审核').disabled).toBe(true); await note('  证据和适用条件已复核  ');
  vi.mocked(api.getPlaybookDraftReview).mockResolvedValue(submitted);
  await click('提交审核');
  expect(api.recordPlaybookDraftReview).toHaveBeenCalledWith('candidate-1', expect.objectContaining({
    action: 'submit', expectedVersion: 1, expectedReviewSequence: 0, note: '证据和适用条件已复核', requestId: expect.any(String),
  }));
  expect(document.body.textContent).toContain('待管理员审核');
  expect(document.body.textContent).not.toContain('批准此版本');
});

it('shows the frozen source references inside the reviewed version snapshot', async (): Promise<void> => {
  vi.mocked(api.getPlaybookDraftVersion).mockResolvedValue({ ...version, sources: [
    { sourceId: 'saved-source', sourceVersion: 'revision:7' },
    { sourceId: 'unversioned-source', sourceVersion: null },
  ] });
  await render();
  const snapshot: Element | null = document.querySelector('article[aria-label="审核快照 v1"]');
  expect(snapshot?.textContent).toContain('来源版本');
  expect(snapshot?.textContent).toContain('saved-source · revision:7');
  expect(snapshot?.textContent).toContain('unversioned-source · 未知版本');
});

it('explicitly shows missing source records in the reviewed snapshot', async (): Promise<void> => {
  await render();
  expect(document.querySelector('article')?.textContent).toContain('无来源记录');
});

it('exposes decisions only to administrators for the current submitted version', async (): Promise<void> => {
  vi.mocked(api.getPlaybookDraftReview).mockResolvedValue(submitted);
  vi.mocked(api.recordPlaybookDraftReview).mockResolvedValue(submitted.current!);
  await render(true); await note('管理员已复核范围');
  expect(button('批准此版本').disabled).toBe(false);
  await click('批准此版本');
  expect(api.recordPlaybookDraftReview).toHaveBeenCalledWith('candidate-1', expect.objectContaining({
    action: 'approve', expectedReviewSequence: 1, expectedVersion: 1,
  }));
});

it('locks actions for unsaved content or a remote newer version', async (): Promise<void> => {
  await render(false, true); await note('等待本地保存完成');
  expect(button('提交审核').disabled).toBe(true);
  vi.mocked(api.getPlaybookDraftReview).mockResolvedValue({ ...empty, latestDraftVersion: 2 });
  await render(false, false, 'candidate-2'); await note('等待最新版本读取');
  expect(button('提交审核').disabled).toBe(true);
});

it('retries the identical uncertain request with all fields frozen', async (): Promise<void> => {
  vi.mocked(api.recordPlaybookDraftReview).mockRejectedValueOnce({ status: 503, message: '响应丢失' })
    .mockResolvedValueOnce(submitted.current!);
  await render(); await note('需要保留的审核说明'); await click('提交审核');
  expect(document.querySelector('textarea')?.disabled).toBe(true);
  expect(button('提交审核').disabled).toBe(true); await click('重试原审核请求');
  const calls = vi.mocked(api.recordPlaybookDraftReview).mock.calls;
  expect(calls[1]).toEqual(calls[0]);
});

it('blocks stale actions after conflict and failed refresh, preserving the note', async (): Promise<void> => {
  await render(); await note('当前本地审核说明');
  vi.mocked(api.recordPlaybookDraftReview).mockRejectedValueOnce({ status: 409, message: '审核状态变化' });
  vi.mocked(api.getPlaybookDraftReview).mockRejectedValueOnce({ status: 503, message: '读取失败' });
  await click('提交审核'); await click('刷新审核状态');
  expect(document.querySelector('textarea')?.value).toBe('当前本地审核说明');
  expect(api.recordPlaybookDraftReview).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain(version.body);
});

it.each([401, 403, 404])('clears the snapshot on access failure %s', async (status): Promise<void> => {
  await render(); await note('不会继续保留的敏感说明');
  vi.mocked(api.recordPlaybookDraftReview).mockRejectedValue({ status, message: '访问失效' });
  await click('提交审核');
  expect(onAccessFailure).toHaveBeenCalled();
  expect(document.body.textContent).not.toContain(version.body);
  expect(document.querySelector('textarea')).toBeNull();
});

it('ignores a late review response when changing candidates', async (): Promise<void> => {
  let resolve: (value: NonNullable<PlaybookDraftReviewResponse['current']>) => void = (): void => undefined;
  vi.mocked(api.recordPlaybookDraftReview).mockImplementation(() => new Promise((done): void => { resolve = done; }));
  await render(); await note('第一份候选的说明'); await click('提交审核');
  await render(false, false, 'candidate-2');
  await act(async (): Promise<void> => resolve(submitted.current!));
  expect(api.getPlaybookDraftReview).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).not.toContain('待管理员审核');
});
