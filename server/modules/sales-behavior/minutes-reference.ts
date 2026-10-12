interface MinutesReference {
  minuteToken: string;
  canonicalUrl: string;
}

class MinutesReferenceError extends Error {
  readonly code = 'MINUTES_INVALID_REFERENCE' as const;

  constructor() {
    super('妙记链接无效');
    this.name = 'MinutesReferenceError';
  }
}

const URL_CANDIDATE = /https?:\/\/[^\s<>"'，。！？；]+/giu;
const MINUTE_TOKEN = /^[a-z0-9]{8,128}$/u;

const isTrustedHost = (hostname: string): boolean => {
  const normalized: string = hostname.toLowerCase();
  return normalized === 'feishu.cn' || normalized.endsWith('.feishu.cn') ||
    normalized === 'larksuite.com' ||
    normalized.endsWith('.larksuite.com');
};

const parseCandidate = (value: string): MinutesReference | null => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MinutesReferenceError();
  }
  const pathnameLooksLikeMinutes: boolean =
    parsed.pathname.toLowerCase().includes('/minutes/');
  const trustedHost: boolean = isTrustedHost(parsed.hostname);
  if (!pathnameLooksLikeMinutes && !trustedHost) return null;
  if (
    parsed.protocol !== 'https:' ||
    !trustedHost ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.port.length > 0
  ) {
    throw new MinutesReferenceError();
  }
  const segments: string[] = parsed.pathname
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);
  if (
    segments.length !== 2 ||
    segments[0]?.toLowerCase() !== 'minutes' ||
    !MINUTE_TOKEN.test(segments[1] ?? '')
  ) {
    throw new MinutesReferenceError();
  }
  const minuteToken: string = segments[1] ?? '';
  return {
    minuteToken,
    canonicalUrl: `https://${parsed.hostname.toLowerCase()}` +
      `/minutes/${minuteToken}`,
  };
};

const findMinutesReference = (text: string): MinutesReference | null => {
  const candidates: RegExpMatchArray[] = [...text.matchAll(URL_CANDIDATE)];
  for (const match of candidates) {
    const value: string | undefined = match[0];
    if (value === undefined) continue;
    const reference: MinutesReference | null = parseCandidate(value);
    if (reference !== null) return reference;
  }
  return null;
};

export { findMinutesReference, MinutesReferenceError };
export type { MinutesReference };
