import { expect, it, vi } from 'vitest';
import type { AgentRuntimeConfig } from '@server/config/agent.config';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), structured: vi.fn() }));
vi.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    withStructuredOutput(...args: unknown[]) {
      mocks.structured(...args);
      return { invoke: mocks.invoke };
    }
  },
}));
import { LangChainIntentModel } from '@server/modules/llm/langchain-intent.model';

it('connects preparation extraction to the existing SDK client', async () => {
  const model = new LangChainIntentModel({ llm: { model: 'test', apiKey: 'test', baseUrl: 'http://localhost' } } as AgentRuntimeConfig);
  mocks.invoke.mockResolvedValue({ customerName: '客户甲', communicationAt: null, purpose: '评审' });
  await expect(model.extractPreparation({ text: '准备评审', previous: null, timezone: 'Asia/Shanghai', now: new Date() })).resolves.toMatchObject({ customerName: '客户甲' });
  expect(mocks.structured).toHaveBeenCalledWith(expect.anything(), { name: 'preparation_conditions', method: 'jsonMode' });
  mocks.invoke.mockResolvedValue({ customerName: '甲', communicationAt: null, purpose: null, customerRecordId: 'injected' });
  await expect(model.extractPreparation({ text: '准备沟通', previous: null, timezone: 'Asia/Shanghai', now: new Date() })).rejects.toThrow();
});
