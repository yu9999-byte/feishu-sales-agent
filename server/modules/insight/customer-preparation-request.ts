import { z } from 'zod';
import type { CustomerPreparationRequest } from '@shared/api.interface';

const requestSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  communicationAt: z.string().datetime({ offset: true }).nullish(),
  purpose: z.string().trim().max(1000).nullish(),
}).strict();

const parseCustomerPreparationRequest = (input: unknown): CustomerPreparationRequest => {
  const request = requestSchema.parse(input);
  return {
    customerName: request.customerName,
    communicationAt: request.communicationAt ? new Date(request.communicationAt).toISOString() : null,
    purpose: request.purpose || null,
  };
};

export { parseCustomerPreparationRequest };
