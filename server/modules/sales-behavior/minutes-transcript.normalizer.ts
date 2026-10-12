interface MinutesTranscriptSegment {
  index: number;
  speaker: string;
  relativeTime: string;
  text: string;
}

interface NormalizedMinutesTranscript {
  segments: MinutesTranscriptSegment[];
  normalizedText: string;
  truncated: boolean;
}

const DEFAULT_MAX_LENGTH: number = 120_000;
const OMITTED_MARKER: string = '[中间逐字稿因长度限制已省略]';
const HEADER_PATTERN = /^(.+?)\s+(\d{2,}:\d{2}:\d{2}(?:[.]\d{1,3})?)$/u;

const renderSegment = (segment: MinutesTranscriptSegment): string =>
  `${segment.speaker} ${segment.relativeTime}\n${segment.text}`;

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

const renderSegmentWithinBudget = (
  segment: MinutesTranscriptSegment,
  maxLength: number,
  direction: 'head' | 'tail',
): string => {
  const header: string = `${segment.speaker} ${segment.relativeTime}\n`;
  if (maxLength <= header.length) {
    return safeSliceStart(header, maxLength);
  }
  const bodyBudget: number = maxLength - header.length;
  const body: string = direction === 'head'
    ? safeSliceStart(segment.text, bodyBudget)
    : safeSliceEnd(segment.text, bodyBudget);
  return `${header}${body}`;
};

const parseSegments = (raw: string): MinutesTranscriptSegment[] => {
  const lines: string[] = raw.replace(/\r\n?/gu, '\n').split('\n');
  const segments: MinutesTranscriptSegment[] = [];
  let speaker: string | null = null;
  let relativeTime: string | null = null;
  let body: string[] = [];

  const flush = (): void => {
    const text: string = body.join('\n').trim();
    if (speaker !== null && relativeTime !== null && text.length > 0) {
      segments.push({
        index: segments.length,
        speaker,
        relativeTime,
        text,
      });
    }
    body = [];
  };

  for (const lineValue of lines) {
    const line: string = lineValue.trimEnd();
    const match: RegExpMatchArray | null = line.match(HEADER_PATTERN);
    if (match !== null) {
      flush();
      speaker = match[1]?.trim() || '未知说话人';
      relativeTime = match[2] ?? '00:00:00';
      continue;
    }
    if (speaker !== null && line.trim().length > 0) body.push(line.trim());
  }
  flush();
  return segments;
};

const normalizeMinutesTranscript = (
  raw: string,
  maxLength: number = DEFAULT_MAX_LENGTH,
): NormalizedMinutesTranscript => {
  const segments: MinutesTranscriptSegment[] = parseSegments(raw);
  if (segments.length === 0) {
    return { segments: [], normalizedText: '', truncated: false };
  }
  const rendered: string[] = segments.map(renderSegment);
  const complete: string = rendered.join('\n\n');
  if (complete.length <= maxLength) {
    return { segments, normalizedText: complete, truncated: false };
  }

  const selectedHead: string[] = [];
  const selectedTail: string[] = [];
  const contentBudget: number = Math.max(
    0,
    maxLength - OMITTED_MARKER.length - 4,
  );
  const halfBudget: number = Math.floor(contentBudget / 2);
  let headLength: number = 0;
  let tailLength: number = 0;
  let headIndex: number = 0;
  let tailIndex: number = rendered.length - 1;
  while (headIndex <= tailIndex) {
    const value: string | undefined = rendered[headIndex];
    if (value === undefined || headLength + value.length > halfBudget) break;
    selectedHead.push(value);
    headLength += value.length + 2;
    headIndex += 1;
  }
  if (selectedHead.length === 0 && segments[0] !== undefined) {
    const partialHead: string = renderSegmentWithinBudget(
      segments[0],
      halfBudget,
      'head',
    );
    if (partialHead.length > 0) {
      selectedHead.push(partialHead);
      headLength = partialHead.length + 2;
      headIndex = 1;
    }
  }
  while (tailIndex >= headIndex) {
    const value: string | undefined = rendered[tailIndex];
    if (
      value === undefined ||
      tailLength + value.length > contentBudget - headLength
    ) {
      break;
    }
    selectedTail.unshift(value);
    tailLength += value.length + 2;
    tailIndex -= 1;
  }
  if (
    selectedTail.length === 0 &&
    tailIndex >= headIndex &&
    segments[tailIndex] !== undefined
  ) {
    const partialTail: string = renderSegmentWithinBudget(
      segments[tailIndex],
      Math.max(0, contentBudget - headLength),
      'tail',
    );
    if (partialTail.length > 0) selectedTail.push(partialTail);
  }
  const normalizedTextValue: string = [
    selectedHead.join('\n\n'),
    OMITTED_MARKER,
    selectedTail.join('\n\n'),
  ].filter((value: string): boolean => value.length > 0).join('\n\n');
  const normalizedText: string = safeSliceStart(
    normalizedTextValue,
    maxLength,
  );
  const retainedSegments: MinutesTranscriptSegment[] = [
    ...segments.slice(0, selectedHead.length),
    ...segments.slice(segments.length - selectedTail.length),
  ].map(
    (
      segment: MinutesTranscriptSegment,
      index: number,
    ): MinutesTranscriptSegment => ({ ...segment, index }),
  );
  return {
    segments: retainedSegments,
    normalizedText,
    truncated: true,
  };
};

export { normalizeMinutesTranscript };
export type {
  MinutesTranscriptSegment,
  NormalizedMinutesTranscript,
};
