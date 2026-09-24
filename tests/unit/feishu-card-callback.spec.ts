import { describe, expect, it } from 'vitest';

import {
  decodeCardCallbackObject,
} from '@server/modules/feishu/feishu-webhook.bridge';

describe('Feishu Card 2.0 callback decoding', (): void => {
  it('decodes form_value JSON strings into typed callback fields', (): void => {
    expect(decodeCardCallbackObject(JSON.stringify({
      generatedBody: '客户认可方案',
      dueAt: '2026-09-22 14:00 +0800',
      task_0: true,
    }))).toEqual({
      generatedBody: '客户认可方案',
      dueAt: '2026-09-22 14:00 +0800',
      task_0: true,
    });
  });

  it('treats absent action values as an empty object', (): void => {
    expect(decodeCardCallbackObject(undefined)).toEqual({});
    expect(decodeCardCallbackObject('')).toEqual({});
  });
});
