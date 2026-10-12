type DocumentReferenceType = 'docx' | 'wiki';

interface DocumentReference {
  referenceType: DocumentReferenceType;
  token: string;
  canonicalUrl: string;
}

type DocumentReferenceErrorCode =
  | 'DOCUMENT_INVALID_REFERENCE'
  | 'DOCUMENT_MULTIPLE_REFERENCES';

class DocumentReferenceError extends Error {
  constructor(readonly code: DocumentReferenceErrorCode) {
    super(code === 'DOCUMENT_MULTIPLE_REFERENCES'
      ? '一次只能提交一份飞书文档'
      : '飞书文档链接无效');
    this.name = 'DocumentReferenceError';
  }
}

const URL_CANDIDATE: RegExp = /https?:\/\/[^\s<>"'，。！？；]+/giu;
const DOCUMENT_TOKEN: RegExp = /^[A-Za-z0-9_-]{8,128}$/u;

const isTrustedHost = (hostname: string): boolean => {
  const normalized: string = hostname.toLocaleLowerCase('en-US');
  return normalized === 'feishu.cn' ||
    normalized.endsWith('.feishu.cn') ||
    normalized === 'larksuite.com' ||
    normalized.endsWith('.larksuite.com');
};

const parseCandidate = (value: string): DocumentReference | null => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DocumentReferenceError('DOCUMENT_INVALID_REFERENCE');
  }
  const trustedHost: boolean = isTrustedHost(parsed.hostname);
  const pathLooksSupported: boolean = /^\/(?:docx|wiki)\//iu.test(
    parsed.pathname,
  );
  if (!pathLooksSupported) return null;
  if (
    parsed.protocol !== 'https:' ||
    !trustedHost ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.port.length > 0
  ) {
    throw new DocumentReferenceError('DOCUMENT_INVALID_REFERENCE');
  }
  const segments: string[] = parsed.pathname
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);
  const rawType: string = segments[0]?.toLocaleLowerCase('en-US') ?? '';
  if (
    segments.length !== 2 ||
    (rawType !== 'docx' && rawType !== 'wiki') ||
    !DOCUMENT_TOKEN.test(segments[1] ?? '')
  ) {
    throw new DocumentReferenceError('DOCUMENT_INVALID_REFERENCE');
  }
  const referenceType: DocumentReferenceType = rawType;
  const token: string = segments[1] ?? '';
  const hostname: string = parsed.hostname.toLocaleLowerCase('en-US');
  return {
    referenceType,
    token,
    canonicalUrl: `https://${hostname}/${referenceType}/${token}`,
  };
};

const findDocumentReference = (text: string): DocumentReference | null => {
  const references: Map<string, DocumentReference> = new Map();
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const value: string | undefined = match[0];
    if (value === undefined) continue;
    const reference: DocumentReference | null = parseCandidate(value);
    if (reference !== null) {
      references.set(
        `${reference.referenceType}:${reference.token}`,
        reference,
      );
    }
  }
  if (references.size > 1) {
    throw new DocumentReferenceError('DOCUMENT_MULTIPLE_REFERENCES');
  }
  return references.values().next().value ?? null;
};

export { DocumentReferenceError, findDocumentReference };
export type {
  DocumentReference,
  DocumentReferenceErrorCode,
  DocumentReferenceType,
};
