interface DocumentContentSegment {
  index: number;
  text: string;
}

interface NormalizedDocumentContent {
  segments: DocumentContentSegment[];
  normalizedText: string;
  truncated: boolean;
}

const DEFAULT_MAX_LENGTH: number = 120_000;
const OMITTED_MARKER: string = '[中间文档内容因长度限制已省略]';
const SEPARATOR: string = '\n\n';

const safeSliceStart = (value: string, maxLength: number): string => {
  let end: number = Math.min(value.length, Math.max(0, maxLength));
  if (
    end > 0 &&
    end < value.length &&
    /[\uD800-\uDBFF]/u.test(value[end - 1] ?? '') &&
    /[\uDC00-\uDFFF]/u.test(value[end] ?? '')
  ) {
    end -= 1;
  }
  return value.slice(0, end);
};

const safeSliceEnd = (value: string, maxLength: number): string => {
  let start: number = Math.max(0, value.length - Math.max(0, maxLength));
  if (
    start > 0 &&
    start < value.length &&
    /[\uDC00-\uDFFF]/u.test(value[start] ?? '') &&
    /[\uD800-\uDBFF]/u.test(value[start - 1] ?? '')
  ) {
    start += 1;
  }
  return value.slice(start);
};

const parseSegments = (raw: string): DocumentContentSegment[] =>
  raw.replace(/\r\n?/gu, '\n')
    .split(/\n[\t ]*\n+/u)
    .map((value: string): string => value.trim())
    .filter((value: string): boolean => value.length > 0)
    .map((text: string, index: number): DocumentContentSegment => ({
      index,
      text,
    }));

const takeCompleteHead = (
  values: string[],
  budget: number,
): { text: string; count: number } => {
  const selected: string[] = [];
  let used: number = 0;
  for (const value of values) {
    const cost: number = value.length +
      (selected.length > 0 ? SEPARATOR.length : 0);
    if (used + cost > budget) break;
    selected.push(value);
    used += cost;
  }
  return { text: selected.join(SEPARATOR), count: selected.length };
};

const takeCompleteTail = (
  values: string[],
  startIndex: number,
  budget: number,
): { text: string; count: number } => {
  const selected: string[] = [];
  let used: number = 0;
  for (let index: number = values.length - 1; index >= startIndex; index -= 1) {
    const value: string | undefined = values[index];
    if (value === undefined) continue;
    const cost: number = value.length +
      (selected.length > 0 ? SEPARATOR.length : 0);
    if (used + cost > budget) break;
    selected.unshift(value);
    used += cost;
  }
  return { text: selected.join(SEPARATOR), count: selected.length };
};

const normalizeDocumentContent = (
  raw: string,
  maxLength: number = DEFAULT_MAX_LENGTH,
): NormalizedDocumentContent => {
  const segments: DocumentContentSegment[] = parseSegments(raw);
  const values: string[] = segments.map(
    (segment: DocumentContentSegment): string => segment.text,
  );
  const complete: string = values.join(SEPARATOR);
  if (complete.length <= maxLength) {
    return { segments, normalizedText: complete, truncated: false };
  }

  const markerBlockLength: number = OMITTED_MARKER.length +
    SEPARATOR.length * 2;
  const contentBudget: number = Math.max(0, maxLength - markerBlockLength);
  const headBudget: number = Math.floor(contentBudget / 2);
  const tailBudget: number = contentBudget - headBudget;
  const completeHead = takeCompleteHead(values, headBudget);
  const head: string = completeHead.text.length > 0
    ? completeHead.text
    : safeSliceStart(values[0] ?? '', headBudget);
  const headCount: number = completeHead.count > 0 ? completeHead.count : 1;
  const completeTail = takeCompleteTail(values, headCount, tailBudget);
  const tail: string = completeTail.text.length > 0
    ? completeTail.text
    : safeSliceEnd(values.at(-1) ?? '', tailBudget);
  const normalizedText: string = safeSliceStart(
    [head, OMITTED_MARKER, tail]
      .filter((value: string): boolean => value.length > 0)
      .join(SEPARATOR),
    maxLength,
  );
  return { segments, normalizedText, truncated: true };
};

export { normalizeDocumentContent };
export type { DocumentContentSegment, NormalizedDocumentContent };
