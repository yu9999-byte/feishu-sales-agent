interface PreparationCustomerCandidate {
  recordId: string;
  name: string;
}

interface PreparationCustomerResolution {
  status: 'matched' | 'ambiguous' | 'not_found';
  candidates: PreparationCustomerCandidate[];
}

// The caller must obtain visibleCustomers from the authenticated actor's scoped source.
// This function never reads records or accepts a model-supplied customer identifier.
const resolvePreparationCustomer = (
  requestedName: string,
  visibleCustomers: PreparationCustomerCandidate[],
): PreparationCustomerResolution => {
  const name: string = requestedName.trim();
  if (!name || name.length > 200) throw new Error('INVALID_CUSTOMER_NAME');
  const matches: Map<string, PreparationCustomerCandidate> = new Map();
  for (const customer of visibleCustomers) {
    if (customer.recordId.trim() && customer.name.trim() === name) {
      matches.set(customer.recordId, { recordId: customer.recordId, name: customer.name });
    }
  }
  const candidates: PreparationCustomerCandidate[] = [...matches.values()].sort(
    (left: PreparationCustomerCandidate, right: PreparationCustomerCandidate): number =>
      left.recordId.localeCompare(right.recordId),
  );
  return { status: candidates.length === 0 ? 'not_found' : candidates.length === 1 ? 'matched' : 'ambiguous',
    candidates };
};

export { resolvePreparationCustomer };
export type { PreparationCustomerCandidate, PreparationCustomerResolution };
