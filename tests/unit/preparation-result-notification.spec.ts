import { expect, it } from 'vitest';
import { preparationResultNotification } from '@server/modules/agent-core/preparation-result-notification';

it.each([undefined, '', 'invalid', 'javascript:alert(1)', 'file:///tmp'])('falls back safely for public URL %s', (url) => {
  const notification = preparationResultNotification('result-id', '客户甲', url);
  expect(notification.text).toContain('结果编号：result-id');
  expect(notification.key).toBe('preparation-result:result-id');
});

it('preserves deployment path and encodes the result ID', () => {
  const notification = preparationResultNotification('id/a', '客户甲', 'https://example.com/app/');
  expect(notification.text).toContain('查看：https://example.com/app/preparations/id%2Fa');
  expect(notification.key).toBe('preparation-result:id/a');
});
