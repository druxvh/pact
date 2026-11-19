/** A problem a person can act on ("password-protected", "page doesn’t exist"). Everything else is an unexpected failure. */
export class PdfError extends Error {}

/** Thrown inside a job when the person pressed Cancel (only the main-thread fallback needs it; a worker is simply terminated). */
export class CancelledError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'CancelledError';
  }
}
