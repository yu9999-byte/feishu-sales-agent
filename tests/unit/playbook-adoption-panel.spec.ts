// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlaybookAdoptionPanel } from '../../client/src/pages/PlaybookOptimizationPage/PlaybookPublicationPanel';
import * as api from '../../client/src/api';
import type { PlaybookAdoptionEvent, PlaybookAdoptionResponse } from '../../shared/api.interface';

vi.mock('../../client/src/api', () => ({
  getPlaybookAdoption: vi.fn(), recordPlaybookAdoption: vi.fn(),
  getPlaybookPublication: vi.fn(), recordPlaybookPublication: vi.fn(),
}));

const publication = { version: 3, publicationSequence: 7 };
const initial: PlaybookAdoptionResponse = {
  publication, adoptionSequence: 0, status: 'not_adopted', verifiedAdoptionCount: 0,
  retractionCount: 0, current: null, history: [], nextBeforeSequence: null,
};
const recorded: PlaybookAdoptionEvent = {
  candidateId: 'candidate-1', sequence: 1, publicationVersion: 3,
  publicationSequence: 7, action: 'record', actorMemberId: 'member-1',
  evidence: { kind: 'followup', recordId: 'rec-1', actionId: '40000000-0000-4000-8000-000000000001', note: '已写入跟进' },
  note: '已在客户沟通后采用', createdAt: '2026-10-23T00:00:00Z',
};
const retracted: PlaybookAdoptionEvent = { ...recorded, sequence: 2, action: 'retract', evidence: null, note: '采用结果已撤回' };

let root: Root;
let host: HTMLDivElement;
const onAccessFailure = vi.fn();

beforeEach((): void => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.mocked(api.getPlaybookAdoption).mockResolvedValue(initial);
  vi.mocked(api.recordPlaybookAdoption).mockResolvedValue(recorded);
});
afterEach(async (): Promise<void> => {
  await act(async (): Promise<void> => root.unmount()); host.remove(); vi.resetAllMocks();
});
const render = async (canAdopt = true): Promise<void> => {
  await act(async (): Promise<void> => root.render(React.createElement(PlaybookAdoptionPanel, {
    candidateId: 'candidate-1', canAdopt, onAccessFailure,
  })));
};
const field = (label: string): HTMLInputElement | HTMLTextAreaElement => {
  const element = Array.from(host.querySelectorAll('label')).find((item) => item.textContent?.includes(label))
    ?.querySelector('input, textarea');
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error(`Missing field: ${label}`);
  return element;
};
const setValue = async (element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
  await act(async (): Promise<void> => {
    Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const button = (label: string): HTMLButtonElement => {
  const found = Array.from(host.querySelectorAll('button')).find((item) => item.textContent === label);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return found;
};
const fill = async (): Promise<void> => {
  await setValue(field('真实记录 ID'), 'rec-1');
  await setValue(field('action ID'), recorded.evidence!.actionId);
  await setValue(field('业务证据说明'), '已写入跟进');
  await setValue(field('采用说明'), '已在客户沟通后采用');
};

it('records evidence bound to the published version', async (): Promise<void> => {
  await render(); await fill(); await act(async (): Promise<void> => button('记录已采用').click());
  expect(api.recordPlaybookAdoption).toHaveBeenCalledWith('candidate-1', expect.objectContaining({
    publicationVersion: 3, publicationSequence: 7, expectedAdoptionSequence: 0,
    evidence: expect.objectContaining({ recordId: 'rec-1', actionId: recorded.evidence!.actionId }),
  }));
  expect(host.textContent).toContain('已验证采用');
});

it('confirms withdrawal and updates the status without reloading stale data', async (): Promise<void> => {
  vi.mocked(api.getPlaybookAdoption).mockResolvedValue({ ...initial, status: 'adopted', adoptionSequence: 1, current: recorded });
  vi.mocked(api.recordPlaybookAdoption).mockResolvedValue(retracted);
  await render(); await setValue(field('采用说明'), '采用结果已撤回'); await act(async (): Promise<void> => button('撤回采用').click());
  expect(host.textContent).toContain('撤回当前采用记录？'); await act(async (): Promise<void> => button('确认撤回采用').click());
  expect(api.recordPlaybookAdoption).toHaveBeenCalledWith('candidate-1', expect.objectContaining({
    action: 'retract', expectedAdoptionSequence: 1, evidence: null,
  }));
  expect(host.textContent).toContain('采用已撤回');
});

it('refreshes after a conflict while retaining evidence input', async (): Promise<void> => {
  vi.mocked(api.recordPlaybookAdoption).mockRejectedValueOnce({ status: 409, message: '状态已变化' });
  vi.mocked(api.getPlaybookAdoption).mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, adoptionSequence: 1, status: 'adopted', current: recorded });
  await render(); await fill(); await act(async (): Promise<void> => button('记录已采用').click());
  expect(api.getPlaybookAdoption).toHaveBeenCalledTimes(2);
  expect((field('真实记录 ID') as HTMLInputElement).value).toBe('rec-1');
  expect(host.textContent).toContain('已验证采用');
});

it.each([401, 403, 404])('clears private evidence after access failure %s', async (status): Promise<void> => {
  vi.mocked(api.recordPlaybookAdoption).mockRejectedValueOnce({ status, message: '无权访问' });
  await render(); await fill(); await act(async (): Promise<void> => button('记录已采用').click());
  expect(onAccessFailure).toHaveBeenCalled(); expect(host.textContent).toContain('已清除证据输入');
  expect(host.querySelector('input')).toBeNull(); expect(host.querySelector('textarea')).toBeNull();
});
