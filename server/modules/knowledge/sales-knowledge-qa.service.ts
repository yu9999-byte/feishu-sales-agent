import { Inject, Injectable } from '@nestjs/common';

import type {
  SalesKnowledgeCitation,
  SalesKnowledgeQaStatus,
} from '@shared/api.interface';
import type { SalesMaterialSourceConfig } from
  '@server/modules/agent-core/agent.types';
import type {
  SalesKnowledgeQaInput,
  SalesKnowledgeQaReader,
  SalesKnowledgeQaResult,
} from './sales-knowledge-qa.ports';
import {
  SALES_MATERIAL_GATEWAY,
  type SalesMaterialDocument,
  type SalesMaterialGateway,
  type SalesMaterialReadResult,
} from './sales-material.ports';

const MAX_CITATIONS = 3;
const MAX_EXCERPT_LENGTH = 320;
const MAX_MATCHED_TERMS = 12;
const MAX_QUESTION_TERMS = 80;

const STOP_TERMS: Set<string> = new Set<string>([
  '一下',
  '什么',
  '你们',
  '他们',
  '可以',
  '哪些',
  '如何',
  '怎么',
  '是否',
  '这个',
  '那个',
  '请问',
  '帮我',
  '我们',
  '有没有',
]);

interface RankedCitation {
  score: number;
  citation: SalesKnowledgeCitation;
}

const normalize = (value: string): string => value
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase('zh-CN')
  .replace(/\s+/gu, ' ');

const compact = (value: string): string => normalize(value)
  .replace(/[^\p{L}\p{N}]+/gu, '');

const uniqueStrings = (values: string[]): string[] => [
  ...new Set(values.filter((value: string): boolean => value.length > 0)),
];

const questionTerms = (question: string): string[] => {
  const normalized: string = normalize(question);
  const terms: string[] = normalized
    .split(/[^\p{L}\p{N}]+/gu)
    .filter((term: string): boolean => term.length >= 2);
  const compactQuestion: string = compact(question);
  const maximumLength: number = Math.min(6, compactQuestion.length);
  for (let length: number = maximumLength; length >= 2; length -= 1) {
    for (
      let index: number = 0;
      index + length <= compactQuestion.length;
      index += 1
    ) {
      terms.push(compactQuestion.slice(index, index + length));
    }
  }
  return uniqueStrings(terms)
    .filter((term: string): boolean => !STOP_TERMS.has(term))
    .slice(0, MAX_QUESTION_TERMS);
};

const matchingTerms = (
  document: SalesMaterialDocument,
  question: string,
): { keywordMatches: string[]; documentMatches: string[] } => {
  const normalizedQuestion: string = compact(question);
  const keywordMatches: string[] = uniqueStrings(
    document.keywords.map((keyword: string): string => compact(keyword)),
  ).filter((keyword: string): boolean =>
    keyword.length >= 2 && normalizedQuestion.includes(keyword),
  );
  const searchable: string = compact(
    `${document.title}\n${document.content}`,
  );
  const documentMatches: string[] = questionTerms(question)
    .filter((term: string): boolean => searchable.includes(term))
    .sort((left: string, right: string): number =>
      right.length - left.length || left.localeCompare(right, 'zh-CN'),
    )
    .slice(0, MAX_MATCHED_TERMS);
  return { keywordMatches, documentMatches };
};

const bestParagraph = (
  document: SalesMaterialDocument,
  terms: string[],
): { excerpt: string; citation: string; score: number } | null => {
  const paragraphs: string[] = document.content
    .split(/\r?\n+/u)
    .map((paragraph: string): string => paragraph.trim())
    .filter((paragraph: string): boolean => paragraph.length > 0);
  let selectedIndex: number = -1;
  let selectedScore: number = 0;
  paragraphs.forEach((paragraph: string, index: number): void => {
    const normalizedParagraph: string = compact(paragraph);
    const score: number = terms.reduce(
      (total: number, term: string): number =>
        normalizedParagraph.includes(term)
          ? total + Math.min(term.length, 8)
          : total,
      0,
    );
    if (score > selectedScore) {
      selectedIndex = index;
      selectedScore = score;
    }
  });
  if (selectedIndex < 0 || selectedScore <= 0) {
    return null;
  }
  const paragraph: string = paragraphs[selectedIndex] ?? '';
  const excerpt: string = paragraph.length <= MAX_EXCERPT_LENGTH
    ? paragraph
    : `${paragraph.slice(0, MAX_EXCERPT_LENGTH - 1)}…`;
  return {
    excerpt,
    citation: `正文第 ${String(selectedIndex + 1)} 段`,
    score: selectedScore,
  };
};

const rankDocument = (
  document: SalesMaterialDocument,
  question: string,
): RankedCitation | null => {
  const matches: {
    keywordMatches: string[];
    documentMatches: string[];
  } = matchingTerms(document, question);
  const terms: string[] = uniqueStrings([
    ...matches.keywordMatches,
    ...matches.documentMatches,
  ]).slice(0, MAX_MATCHED_TERMS);
  if (terms.length === 0) {
    return null;
  }
  const paragraph: {
    excerpt: string;
    citation: string;
    score: number;
  } | null = bestParagraph(document, terms);
  if (paragraph === null) {
    return null;
  }
  const title: string = compact(document.title);
  const titleScore: number = terms.reduce(
    (total: number, term: string): number =>
      title.includes(term) ? total + Math.min(term.length, 8) : total,
    0,
  );
  const keywordScore: number = matches.keywordMatches.reduce(
    (total: number, keyword: string): number =>
      total + 12 + Math.min(keyword.length, 8),
    0,
  );
  return {
    score: paragraph.score + titleScore + keywordScore,
    citation: {
      sourceId: document.sourceId,
      sourceType: document.sourceType,
      title: document.title,
      url: document.url,
      matchedTerms: terms,
      excerpt: paragraph.excerpt,
      citation: paragraph.citation,
      sourceVersion: document.sourceVersion,
      applicability: document.applicability,
      accessVerified: true,
    },
  };
};

const answerText = (citations: SalesKnowledgeCitation[]): string => [
  '根据你有权访问的企业资料，我找到以下依据：',
  ...citations.flatMap(
    (citation: SalesKnowledgeCitation, index: number): string[] => [
      '',
      `${String(index + 1)}. ${citation.excerpt}`,
      `来源：${citation.title}（${citation.citation}，${citation.sourceVersion}）`,
      `适用边界：${citation.applicability}`,
      `原文：${citation.url}`,
    ],
  ),
].join('\n');

const emptyResult = (
  status: Exclude<SalesKnowledgeQaStatus, 'answered' | 'partial'>,
  configuredSourceCount: number,
  checkedSourceCount: number,
): SalesKnowledgeQaResult => {
  const messages: Record<typeof status, string> = {
    not_configured:
      '当前企业资料库尚未配置，我不能基于企业资料回答这个问题。',
    no_trusted_match:
      '我没有在你有权访问的企业资料中找到可信答案。',
    unavailable:
      '企业资料暂时无法读取，我没有生成答案，请稍后再试。',
  };
  return {
    status,
    answer: messages[status],
    configuredSourceCount,
    checkedSourceCount,
    trustedResultCount: 0,
    citations: [],
    warnings: status === 'no_trusted_match'
      ? ['未找到可信答案']
      : status === 'unavailable'
      ? ['企业资料暂时无法读取']
      : ['资料库尚未配置'],
  };
};

@Injectable()
class SalesKnowledgeQaService implements SalesKnowledgeQaReader {
  constructor(
    @Inject(SALES_MATERIAL_GATEWAY)
    private readonly gateway: SalesMaterialGateway,
  ) {}

  async answer(
    input: SalesKnowledgeQaInput,
  ): Promise<SalesKnowledgeQaResult> {
    const sources: SalesMaterialSourceConfig[] =
      input.integration.base.knowledge?.sources ?? [];
    if (sources.length === 0) {
      return emptyResult('not_configured', 0, 0);
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
    const ranked: RankedCitation[] = reads
      .flatMap((read: SalesMaterialReadResult): RankedCitation[] => {
        if (read.status !== 'ready' || read.document === undefined) {
          return [];
        }
        const item: RankedCitation | null = rankDocument(
          read.document,
          input.question,
        );
        return item === null ? [] : [item];
      })
      .sort((left: RankedCitation, right: RankedCitation): number =>
        right.score - left.score ||
        left.citation.title.localeCompare(right.citation.title, 'zh-CN') ||
        left.citation.sourceId.localeCompare(right.citation.sourceId),
      )
      .slice(0, MAX_CITATIONS);
    if (ranked.length === 0) {
      const unavailableCount: number = reads.filter(
        (read: SalesMaterialReadResult): boolean =>
          read.status === 'unavailable' || read.status === 'unsupported',
      ).length;
      return emptyResult(
        unavailableCount === reads.length
          ? 'unavailable'
          : 'no_trusted_match',
        sources.length,
        reads.length,
      );
    }
    const citations: SalesKnowledgeCitation[] = ranked.map(
      (item: RankedCitation): SalesKnowledgeCitation => item.citation,
    );
    const isPartial: boolean = reads.some(
      (read: SalesMaterialReadResult): boolean => read.status !== 'ready',
    );
    return {
      status: isPartial ? 'partial' : 'answered',
      answer: isPartial
        ? `${answerText(citations)}\n\n提示：部分资料来源暂时无法核验。`
        : answerText(citations),
      configuredSourceCount: sources.length,
      checkedSourceCount: reads.length,
      trustedResultCount: citations.length,
      citations,
      warnings: isPartial ? ['部分资料来源暂时无法核验'] : [],
    };
  }
}

export { SalesKnowledgeQaService };
