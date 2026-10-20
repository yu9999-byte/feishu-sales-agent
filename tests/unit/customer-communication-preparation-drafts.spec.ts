// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import CustomerCommunicationDrafts from
  '../../client/src/pages/CustomerCommunicationPreparationPage/CustomerCommunicationDrafts';
import type { CustomerCommunicationDraft } from '../../shared/api.interface';

const drafts: CustomerCommunicationDraft[] = [{
  channel: 'email',
  title: '会后邮件',
  subject: '原主题',
  body: '原正文',
  editable: true,
  execution: 'preview_only',
  sourceKeys: [],
}];

let root: Root;
let container: HTMLDivElement;
let clipboardDescriptor: PropertyDescriptor | undefined;

beforeEach((): void => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async (): Promise<void> => {
  await act(async (): Promise<void> => root.unmount());
  container.remove();
  if (clipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
  vi.restoreAllMocks();
});

async function renderDrafts(): Promise<void> {
  await act(async (): Promise<void> => {
    root.render(React.createElement(CustomerCommunicationDrafts, {
      drafts,
      generatedAt: '2026-10-20T00:00:00Z',
    }));
  });
}

function updateValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype: object = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter: ((nextValue: string) => void) | undefined =
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('Expected a native value setter');
  setter.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function findButton(label: string): HTMLButtonElement {
  const button: HTMLButtonElement | undefined = Array.from(
    container.querySelectorAll('button'),
  ).find((element: HTMLButtonElement): boolean =>
    element.textContent?.includes(label) ?? false);
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

it('copies the edited email subject and body', async (): Promise<void> => {
  const writeText = vi.fn<(content: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  await renderDrafts();

  const subject: HTMLInputElement | null = container.querySelector(
    '#communication-email-subject',
  );
  const body: HTMLTextAreaElement | null = container.querySelector(
    '#communication-email-body',
  );
  if (!subject || !body) throw new Error('Missing email draft fields');

  await act(async (): Promise<void> => {
    updateValue(subject, '已调整的主题');
    updateValue(body, '已调整的正文');
  });
  await act(async (): Promise<void> => {
    findButton('复制草稿').click();
    await Promise.resolve();
  });

  expect(writeText).toHaveBeenCalledWith('已调整的主题\n\n已调整的正文');
  expect(container.textContent).toContain('已复制');
});

it('copies only the edited body for a Feishu message draft', async (): Promise<void> => {
  const feishuDraft: CustomerCommunicationDraft[] = [{
    channel: 'feishu',
    subject: null,
    title: '沟通消息',
    body: '原消息',
    editable: true,
    execution: 'preview_only',
    sourceKeys: [],
  }];
  const writeText = vi.fn<(content: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  await act(async (): Promise<void> => {
    root.render(React.createElement(CustomerCommunicationDrafts, {
      drafts: feishuDraft,
      generatedAt: '2026-10-20T00:00:00Z',
    }));
  });

  const body: HTMLTextAreaElement | null = container.querySelector(
    '#communication-feishu-body',
  );
  if (!body) throw new Error('Missing Feishu draft body');
  await act(async (): Promise<void> => updateValue(body, '已调整的消息'));
  await act(async (): Promise<void> => {
    findButton('复制草稿').click();
    await Promise.resolve();
  });

  expect(writeText).toHaveBeenCalledWith('已调整的消息');
  expect(container.textContent).toContain('已复制');
});

it('reports a clipboard failure without claiming the draft was copied', async (): Promise<void> => {
  const writeText = vi.fn<(content: string) => Promise<void>>()
    .mockRejectedValue(new Error('clipboard unavailable'));
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  await renderDrafts();

  await act(async (): Promise<void> => {
    findButton('复制草稿').click();
    await Promise.resolve();
  });

  expect(writeText).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('复制不可用');
  expect(container.textContent).not.toContain('已复制');
});
