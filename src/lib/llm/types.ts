export type CompletionRequest = {
  system: string;
  user: string;
  /** Ask the provider for strict JSON where it supports it. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
};

export type CompletionResult = {
  text: string;
  model: string;
  /** Null when the provider does not report usage (several free tiers do not). */
  usage: { input: number; output: number } | null;
};

export interface LlmClient {
  readonly name: string;
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * Free tiers rate-limit aggressively and the correct response to 429 is to wait,
 * not to fail the run. Exponential backoff with jitter, capped attempts.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 4, baseMs = 800 } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = !(err instanceof LlmError) || err.retryable;
      if (!retryable || i === attempts - 1) break;
      const delay = baseMs * 2 ** i + Math.random() * 400;
      console.warn(`[llm] attempt ${i + 1}/${attempts} failed, retrying in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
