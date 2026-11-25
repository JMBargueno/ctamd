export class CtamdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CtamdError';
  }
}

export class CtamdApiError extends CtamdError {
  readonly statusCode?: number;
  readonly url?: string;
  readonly retryAfterMs?: number;

  constructor(message: string, statusCode?: number, url?: string, retryAfterMs?: number) {
    super(message);
    this.name = 'CtamdApiError';
    this.statusCode = statusCode;
    this.url = url;
    this.retryAfterMs = retryAfterMs;
  }
}

export class CtamdValidationError extends CtamdError {
  constructor(message: string) {
    super(message);
    this.name = 'CtamdValidationError';
  }
}
