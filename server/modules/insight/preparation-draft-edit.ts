import { z } from 'zod';
import type { SaveCustomerPreparationDraftRequest } from '@shared/api.interface';

const editSchema = z.object({
  channel: z.enum(['feishu', 'email']),
  subject: z.string().max(300).nullable(),
  body: z.string().max(12000).refine((value: string): boolean => value.trim().length > 0),
  expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
}).strict().refine((value): boolean => value.channel !== 'feishu' || value.subject === null);

const parsePreparationDraftEdit = (input: unknown): SaveCustomerPreparationDraftRequest => {
  const parsed = editSchema.parse(input);
  return { channel: parsed.channel, subject: parsed.subject ?? null,
    body: parsed.body, expectedRevision: parsed.expectedRevision };
};

export { parsePreparationDraftEdit };
