import { Inject, Injectable } from '@nestjs/common';

import type {
  CustomerCommunicationEvidence,
  CustomerCommunicationMaterial,
  CustomerCommunicationMaterialSearch,
  CustomerCommunicationPendingMaterial,
  CustomerCommunicationRecommendedMaterial,
} from '@shared/api.interface';
import type { SalesMaterialSourceConfig } from
  '@server/modules/agent-core/agent.types';
import {
  SALES_MATERIAL_GATEWAY,
  type SalesMaterialDocument,
  type SalesMaterialGateway,
  type SalesMaterialReadResult,
  type SalesMaterialRetrievalInput,
  type SalesMaterialRetrievalResult,
} from './sales-material.ports';

const MAX_RECOMMENDATIONS = 3;
const MAX_EXCERPT_LENGTH = 240;

interface RankedMaterial {
  score: number;
  sourceId: string;
  pendingId: string;
  material: CustomerCommunicationRecommendedMaterial;
}

const normalize = (value: string): string =>
  value.trim().toLocaleLowerCase('zh-CN');

const uniqueStrings = (values: string[]): string[] => [
  ...new Set(values.filter((value: string): boolean => value.length > 0)),
];

const queryText = (
  pending: CustomerCommunicationPendingMaterial,
  evidence: CustomerCommunicationEvidence[],
): string => {
  const allowedKeys: Set<string> = new Set<string>(pending.sourceKeys);
  const factText: string[] = evidence
    .filter((item: CustomerCommunicationEvidence): boolean =>
      allowedKeys.has(item.key),
    )
    .flatMap((item: CustomerCommunicationEvidence): string[] => [
      item.label,
      item.value,
    ]);
  return normalize([
    pending.title,
    pending.purpose,
    pending.reason,
    ...factText,
  ].join('\n'));
};

const findMatchedKeywords = (
  document: SalesMaterialDocument,
  pending: CustomerCommunicationPendingMaterial,
  evidence: CustomerCommunicationEvidence[],
): string[] => {
  const query: string = queryText(pending, evidence);
  const content: string = normalize(`${document.title}\n${document.content}`);
  return uniqueStrings(document.keywords.map(normalize)).filter(
    (keyword: string): boolean =>
      query.includes(keyword) && content.includes(keyword),
  );
};

const scoreDocument = (
  document: SalesMaterialDocument,
  matchedKeywords: string[],
): number => {
  const title: string = normalize(document.title);
  const content: string = normalize(document.content);
  return matchedKeywords.reduce((score: number, keyword: string): number => {
    const titleScore: number = title.includes(keyword) ? 5 : 0;
    const contentScore: number = content.includes(keyword) ? 2 : 0;
    return score + 3 + titleScore + contentScore;
  }, 0);
};

const excerptFor = (
  content: string,
  matchedKeywords: string[],
): { excerpt: string; citation: string } => {
  const paragraphs: string[] = content
    .split(/\r?\n+/u)
    .map((paragraph: string): string => paragraph.trim())
    .filter((paragraph: string): boolean => paragraph.length > 0);
  let selectedIndex: number = 0;
  let selectedScore: number = -1;
  paragraphs.forEach((paragraph: string, index: number): void => {
    const normalized: string = normalize(paragraph);
    const score: number = matchedKeywords.filter(
      (keyword: string): boolean => normalized.includes(keyword),
    ).length;
    if (score > selectedScore) {
      selectedIndex = index;
      selectedScore = score;
    }
  });
  const paragraph: string = paragraphs[selectedIndex] ?? content.trim();
  const excerpt: string = paragraph.length <= MAX_EXCERPT_LENGTH
    ? paragraph
    : `${paragraph.slice(0, MAX_EXCERPT_LENGTH - 1)}…`;
  return {
    excerpt,
    citation: `正文第 ${String(selectedIndex + 1)} 段`,
  };
};

const rankDocument = (
  document: SalesMaterialDocument,
  pending: CustomerCommunicationPendingMaterial,
  evidence: CustomerCommunicationEvidence[],
): RankedMaterial | null => {
  if (!document.categories.includes(pending.category)) {
    return null;
  }
  const matchedKeywords: string[] = findMatchedKeywords(
    document,
    pending,
    evidence,
  );
  if (matchedKeywords.length === 0) {
    return null;
  }
  const excerpt: { excerpt: string; citation: string } = excerptFor(
    document.content,
    matchedKeywords,
  );
  return {
    score: scoreDocument(document, matchedKeywords),
    sourceId: document.sourceId,
    pendingId: pending.id,
    material: {
      id: `source:${document.sourceId}`,
      category: pending.category,
      title: document.title,
      purpose: pending.purpose,
      reason: pending.reason,
      status: 'recommended',
      sourceKeys: [...pending.sourceKeys],
      sourceType: document.sourceType,
      url: document.url,
      matchReason: `匹配“${matchedKeywords.join('、')}”`,
      excerpt: excerpt.excerpt,
      citation: excerpt.citation,
      sourceVersion: document.sourceVersion,
      applicability: document.applicability,
      accessVerified: true,
    },
  };
};

const defaultSearch = (
  status: CustomerCommunicationMaterialSearch['status'],
  configuredSourceCount: number,
  checkedSourceCount: number,
  trustedResultCount: number,
  warnings: string[],
): CustomerCommunicationMaterialSearch => ({
  status,
  configuredSourceCount,
  checkedSourceCount,
  trustedResultCount,
  warnings: uniqueStrings(warnings),
});

@Injectable()
class SalesMaterialRetrievalService {
  constructor(
    @Inject(SALES_MATERIAL_GATEWAY)
    private readonly gateway: SalesMaterialGateway,
  ) {}

  async retrieve(
    input: SalesMaterialRetrievalInput,
  ): Promise<SalesMaterialRetrievalResult> {
    const sources: SalesMaterialSourceConfig[] =
      input.integration.base.knowledge?.sources ?? [];
    if (sources.length === 0) {
      return {
        materials: input.pendingMaterials,
        search: defaultSearch(
          'not_configured',
          0,
          0,
          0,
          ['资料库尚未配置'],
        ),
      };
    }

    const reads: SalesMaterialReadResult[] = await Promise.all(
      sources.map((source: SalesMaterialSourceConfig) =>
        this.gateway.readSource(
          input.integration,
          input.actorOpenId,
          source,
        ),
      ),
    );
    const rankedBySource: Map<string, RankedMaterial> =
      new Map<string, RankedMaterial>();
    reads.forEach((read: SalesMaterialReadResult): void => {
      if (read.status !== 'ready' || read.document === undefined) {
        return;
      }
      const document: SalesMaterialDocument = read.document;
      input.pendingMaterials.forEach(
        (pending: CustomerCommunicationPendingMaterial): void => {
          const ranked: RankedMaterial | null = rankDocument(
            document,
            pending,
            input.evidence,
          );
          if (ranked === null) {
            return;
          }
          const current: RankedMaterial | undefined =
            rankedBySource.get(ranked.sourceId);
          if (current === undefined || ranked.score > current.score) {
            rankedBySource.set(ranked.sourceId, ranked);
          }
        },
      );
    });
    const selected: RankedMaterial[] = [...rankedBySource.values()]
      .sort((left: RankedMaterial, right: RankedMaterial): number =>
        right.score - left.score ||
        left.material.title.localeCompare(right.material.title, 'zh-CN') ||
        left.sourceId.localeCompare(right.sourceId),
      )
      .slice(0, MAX_RECOMMENDATIONS);
    const failureCount: number = reads.filter(
      (read: SalesMaterialReadResult): boolean =>
        read.status === 'unavailable' || read.status === 'unsupported',
    ).length;
    if (selected.length === 0) {
      const allUnavailable: boolean = failureCount === reads.length;
      return {
        materials: input.pendingMaterials,
        search: defaultSearch(
          allUnavailable ? 'unavailable' : 'no_trusted_match',
          sources.length,
          reads.length,
          0,
          [
            allUnavailable
              ? '销售资料库暂时不可用'
              : '未找到可信材料',
          ],
        ),
      };
    }

    const satisfiedPendingIds: Set<string> = new Set<string>(
      selected.map((item: RankedMaterial): string => item.pendingId),
    );
    const materials: CustomerCommunicationMaterial[] = [
      ...selected.map(
        (item: RankedMaterial): CustomerCommunicationRecommendedMaterial =>
          item.material,
      ),
      ...input.pendingMaterials.filter(
        (item: CustomerCommunicationPendingMaterial): boolean =>
          !satisfiedPendingIds.has(item.id),
      ),
    ];
    const isPartial: boolean = reads.some(
      (read: SalesMaterialReadResult): boolean => read.status !== 'ready',
    );
    return {
      materials,
      search: defaultSearch(
        isPartial ? 'partial' : 'ready',
        sources.length,
        reads.length,
        selected.length,
        isPartial ? ['部分资料来源暂时无法核验'] : [],
      ),
    };
  }
}

export { SalesMaterialRetrievalService };
