import type {
  FollowupDraft,
  FollowupOpportunityAssociation,
  SalesContext,
  SalesContextOpportunity,
} from '@shared/api.interface';

interface ResolveOpportunityAssociationResult {
  association: FollowupOpportunityAssociation;
  error?: string;
}

const EXPLICIT_NO_OPPORTUNITY_PATTERNS: RegExp[] = [
  /(?:不(?:要|需要|用|打算|准备|考虑)?|无需|暂不|先不|目前不|暂时不).{0,8}(?:创建|新建|建立|录入|登记|关联).{0,4}(?:新)?商机/u,
  /(?:没有|暂无|尚无|未有|还没有|未形成|未明确).{0,12}(?:采购项目|销售机会|商机)/u,
];

const hasExplicitNoOpportunitySignal = (sourceText: string): boolean => {
  const normalized: string = sourceText.normalize('NFKC').trim();
  return normalized.length > 0 && EXPLICIT_NO_OPPORTUNITY_PATTERNS.some(
    (pattern: RegExp): boolean => pattern.test(normalized),
  );
};

const comparableText = (value: string | null | undefined): string =>
  value?.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase(
    'zh-CN',
  ) ?? '';

const contextMatchesCustomer = (
  draft: FollowupDraft,
  context: SalesContext | undefined,
): boolean => {
  const draftCustomer: string = comparableText(draft.customerName);
  const contextCustomer: string = comparableText(context?.customer?.name);
  return draftCustomer.length > 0 && contextCustomer === draftCustomer;
};

const availableOpportunities = (
  draft: FollowupDraft,
  context: SalesContext | undefined,
): SalesContextOpportunity[] => contextMatchesCustomer(draft, context)
  ? context?.opportunities ?? []
  : [];

const defaultFollowupOpportunityAssociation = (
  draft: FollowupDraft,
  context: SalesContext | undefined,
  sourceText: string = '',
): FollowupOpportunityAssociation => {
  if (hasExplicitNoOpportunitySignal(sourceText)) return { mode: 'none' };
  const opportunityName: string = comparableText(draft.opportunityName);
  if (opportunityName.length === 0) return { mode: 'none' };
  const exactMatches: SalesContextOpportunity[] = availableOpportunities(
    draft,
    context,
  ).filter((opportunity: SalesContextOpportunity): boolean =>
    comparableText(opportunity.name) === opportunityName,
  );
  if (exactMatches.length === 1) {
    const matched: SalesContextOpportunity = exactMatches[0];
    return {
      mode: 'existing',
      opportunityRecordId: matched.source.recordId,
      opportunityName: matched.name,
      ...(matched.source.recordUrl === null
        ? {}
        : { opportunityRecordUrl: matched.source.recordUrl }),
    };
  }
  if (exactMatches.length > 1) return { mode: 'none' };
  return {
    mode: 'create',
    opportunityName: draft.opportunityName?.trim() ?? null,
  };
};

const resolveFollowupOpportunityAssociation = (
  selection: string | undefined,
  draft: FollowupDraft,
  context: SalesContext | undefined,
  current: FollowupOpportunityAssociation | undefined,
  sourceText: string = '',
): ResolveOpportunityAssociationResult => {
  if (selection === undefined || selection === 'keep_current') {
    return {
      association: current ?? defaultFollowupOpportunityAssociation(
        draft,
        context,
        sourceText,
      ),
    };
  }
  if (selection === 'none') {
    return { association: { mode: 'none' } };
  }
  if (selection === 'create') {
    return {
      association: {
        mode: 'create',
        opportunityName: draft.opportunityName?.trim() || null,
      },
      ...(draft.opportunityName?.trim()
        ? {}
        : { error: '选择创建新商机时，请填写明确的商机名称。' }),
    };
  }
  const prefix: string = 'existing:';
  if (!selection.startsWith(prefix)) {
    return {
      association: { mode: 'none' },
      error: '商机关联选项无效，请重新选择。',
    };
  }
  const recordId: string = selection.slice(prefix.length).trim();
  const matched: SalesContextOpportunity | undefined = availableOpportunities(
    draft,
    context,
  ).find((opportunity: SalesContextOpportunity): boolean =>
    opportunity.source.recordId === recordId,
  );
  if (matched === undefined) {
    return {
      association: { mode: 'none' },
      error: '所选商机已不可用，请重新选择或暂不关联。',
    };
  }
  return {
    association: {
      mode: 'existing',
      opportunityRecordId: matched.source.recordId,
      opportunityName: matched.name,
      ...(matched.source.recordUrl === null
        ? {}
        : { opportunityRecordUrl: matched.source.recordUrl }),
    },
  };
};

const opportunityAssociationFormValue = (
  association: FollowupOpportunityAssociation,
): string => association.mode === 'existing'
  ? `existing:${association.opportunityRecordId}`
  : association.mode;

export {
  availableOpportunities,
  defaultFollowupOpportunityAssociation,
  hasExplicitNoOpportunitySignal,
  opportunityAssociationFormValue,
  resolveFollowupOpportunityAssociation,
};
export type { ResolveOpportunityAssociationResult };
