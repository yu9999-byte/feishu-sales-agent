import { z } from 'zod';

const conditionsSchema = z.object({
  customerName: z.string().trim().max(200).nullable(),
  communicationAt: z.string().datetime({ offset: true }).nullable(),
  purpose: z.string().trim().max(1000).nullable(),
}).strict();

type PreparationConditions = z.infer<typeof conditionsSchema>;
const preparationContextSchema = z.object({
  conditions: conditionsSchema,
  turnCount: z.number().int().min(1).max(8),
  candidates: z.array(z.object({
    recordId: z.string().trim().min(1).max(500),
    name: z.string().trim().min(1).max(200),
  }).strict()).max(20).optional(),
}).strict();
type PreparationContext = z.infer<typeof preparationContextSchema>;

const parsePreparationContext = (value: unknown, rawText: string): PreparationContext | null => {
  if (rawText.length > 12000) throw new Error('Preparation context exceeds text limit');
  return value == null ? null : preparationContextSchema.parse(value);
};

const mergePreparationConditions = (
  previous: PreparationConditions | null,
  input: unknown,
  turnCount: number,
  rawTextLength: number,
): PreparationConditions => {
  z.number().int().min(1).max(8).parse(turnCount);
  z.number().int().min(0).max(12000).parse(rawTextLength);
  const patch = conditionsSchema.partial().parse(input);
  const prior: PreparationConditions = previous
    ? conditionsSchema.parse(previous)
    : { customerName: null, communicationAt: null, purpose: null };
  const customerName: string | null = patch.customerName === undefined
    ? prior.customerName
    : patch.customerName || null;
  const customerChanged: boolean = customerName !== prior.customerName;
  const communicationAt: string | null = patch.communicationAt === undefined
    ? customerChanged ? null : prior.communicationAt
    : patch.communicationAt;
  const purpose: string | null = patch.purpose === undefined
    ? customerChanged ? null : prior.purpose
    : patch.purpose || null;
  return {
    customerName,
    communicationAt: communicationAt ? new Date(communicationAt).toISOString() : null,
    purpose,
  };
};

export { mergePreparationConditions, parsePreparationContext };
export type { PreparationConditions, PreparationContext };
