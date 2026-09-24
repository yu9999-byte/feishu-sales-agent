class FollowupExtractionUnavailableError extends Error {
  readonly code = 'DEPENDENCY_UNAVAILABLE' as const;

  constructor() {
    super('Sales followup model temporarily unavailable');
    this.name = 'FollowupExtractionUnavailableError';
  }
}

export { FollowupExtractionUnavailableError };
