// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublishedPlaybookCatalog } from '../../client/src/pages/PlaybookOptimizationPage/PublishedPlaybookCatalog';
import * as api from '../../client/src/api';

vi.mock('../../client/src/api', () => ({ getPublishedPlaybooks: vi.fn(), getPublishedPlaybook: vi.fn() }));
const content = { candidateId: 'candidate-1', version: 1, publicationSequence: 1, title: '技术评审',
  body: '已发布的评审内容正文。', applicability: '技术评审阶段', sources: [], publishedAt: '2026-10-21T00:00:00Z' };
let host: HTMLDivElement;
let root: Root;
beforeEach((): void => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.mocked(api.getPublishedPlaybooks).mockResolvedValue({ items: [content], nextAfterCandidateId: null });
  vi.mocked(api.getPublishedPlaybook).mockResolvedValue(content);
});
afterEach(async (): Promise<void> => { await act(async (): Promise<void> => root.unmount()); host.remove(); vi.resetAllMocks(); });
const render = async (): Promise<void> => { await act(async (): Promise<void> => root.render(React.createElement(PublishedPlaybookCatalog))); };
const click = async (label: string): Promise<void> => {
  const found = Array.from(host.querySelectorAll('button')).find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  await act(async (): Promise<void> => found.click());
};
it('reads fresh current content on every open and removes withdrawn content after a failed read', async (): Promise<void> => {
  await render(); expect(host.textContent).not.toContain(content.body); await click('查看资料');
  expect(host.textContent).toContain(content.body); await click('关闭正文');
  vi.mocked(api.getPublishedPlaybook).mockRejectedValueOnce({ status: 404, message: '已撤回' }); await click('查看资料');
  expect(host.textContent).not.toContain(content.body); expect(host.textContent).toContain('已撤回');
  expect(api.getPublishedPlaybook).toHaveBeenCalledTimes(2);
});
it.each([401, 403])('clears catalog and content on access loss %s', async (status): Promise<void> => {
  await render(); await click('查看资料');
  vi.mocked(api.getPublishedPlaybook).mockRejectedValue({ status, message: '访问失效' }); await click('刷新正文');
  expect(host.textContent).not.toContain(content.title); expect(host.textContent).not.toContain(content.body);
  expect(host.textContent).not.toContain('刷新资料');
});
it('loads more summaries with the exclusive cursor', async (): Promise<void> => {
  vi.mocked(api.getPublishedPlaybooks).mockResolvedValueOnce({ items: [content], nextAfterCandidateId: content.candidateId })
    .mockResolvedValueOnce({ items: [{ ...content, candidateId: 'candidate-2', title: '第二份资料' }], nextAfterCandidateId: null });
  await render(); await click('更多资料');
  expect(api.getPublishedPlaybooks).toHaveBeenLastCalledWith(content.candidateId);
  expect(host.textContent).toContain('第二份资料'); expect(host.querySelectorAll('li')).toHaveLength(2);
});
