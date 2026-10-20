import { z } from 'zod';

const preparationExtractionSchema = z.object({
  customerName: z.string().trim().min(1).max(200).nullable(),
  communicationAt: z.string().datetime({ offset: true }).nullable(),
  purpose: z.string().trim().max(1000).nullable(),
}).strict();

const parsePreparationExtraction = (input: unknown): {
  customerName: string | null;
  communicationAt: string | null;
  purpose: string | null;
} => {
  const value = preparationExtractionSchema.parse(input);
  if (!value.customerName && !value.communicationAt && !value.purpose) {
    throw new Error('Preparation extraction must contain a condition');
  }
  return {
    customerName: value.customerName,
    communicationAt: value.communicationAt
      ? new Date(value.communicationAt).toISOString()
      : null,
    purpose: value.purpose || null,
  };
};

export { parsePreparationExtraction, preparationExtractionSchema };
