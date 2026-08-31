import { config } from "@/lib/config";
import { LlmError, type CompletionRequest, type CompletionResult, type LlmClient } from "./types";

const classify = (status: number) => status === 429 || status >= 500;

/**
 * Google AI Studio, over a chain of model names.
 *
 * A single model name is not durable enough here. On a fresh key,
 * `gemini-2.5-flash` returned 404 "no longer available to new users" (listed by
 * the API, closed to new accounts) and `gemini-flash-latest` returned 503 for
 * high demand, within a minute of each other. Neither is a bug in the caller
 * and neither is recoverable by retrying the same name.
 *
 * So the model list is walked in order, and a model that is retired or
 * overloaded steps aside for the next. This is the same fallback shape the
 * scraper and the provider selection already use, for the same reason: a free
 * tier is a moving target and the pipeline has to survive it moving.
 */
export class GeminiClient implements LlmClient {
  readonly name = "gemini";
  private readonly chain: string[];
  /** The model that last answered. Reported so runs record what actually ran. */
  private active: string;

  constructor() {
    this.chain = config.llm.model.gemini
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    this.active = this.chain[0] ?? "gemini-flash-latest";
  }

  get model(): string {
    return this.active;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    let lastError: LlmError | null = null;

    // Start from whichever model answered last, so one run does not re-pay the
    // discovery cost on every single record.
    const startAt = Math.max(0, this.chain.indexOf(this.active));
    const order = [...this.chain.slice(startAt), ...this.chain.slice(0, startAt)];

    for (const model of order) {
      try {
        const result = await this.callModel(model, req);
        this.active = model;
        return result;
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        lastError = err;

        // 404 means retired, 503 means busy. Both are answered by a different
        // model, not by trying this one again. Anything else is ours to fix.
        const tryNext = err.status === 404 || err.status === 503;
        if (!tryNext) throw err;
        console.warn(`[gemini] ${model} unavailable (${err.status}), trying next`);
      }
    }

    throw lastError ?? new LlmError("no gemini model available", true);
  }

  private async callModel(model: string, req: CompletionRequest): Promise<CompletionResult> {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
      `?key=${config.llm.geminiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: req.temperature ?? 0,
          maxOutputTokens: req.maxTokens ?? 4096,
          ...(req.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      throw new LlmError(
        `gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
        classify(res.status),
        res.status,
      );
    }

    type Res = {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const json = (await res.json()) as Res;
    const candidate = json.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    if (!text) {
      // An empty candidate with MAX_TOKENS means the answer was cut off, which
      // is a budget problem rather than a transient one. Say which it was.
      const reason = candidate?.finishReason ?? "no candidate";
      throw new LlmError(`gemini returned nothing (${reason})`, reason !== "MAX_TOKENS");
    }

    return {
      text,
      model,
      usage: json.usageMetadata
        ? {
            input: json.usageMetadata.promptTokenCount ?? 0,
            output: json.usageMetadata.candidatesTokenCount ?? 0,
          }
        : null,
    };
  }
}

/** OpenAI-compatible chat completions — covers Groq and OpenRouter both. */
class OpenAiCompatibleClient implements LlmClient {
  constructor(
    readonly name: string,
    readonly model: string,
    private readonly endpoint: string,
    private readonly apiKey: string | undefined,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: req.temperature ?? 0,
        max_tokens: req.maxTokens ?? 2048,
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      throw new LlmError(
        `${this.name} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`,
        classify(res.status),
        res.status,
      );
    }

    type Res = {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const json = (await res.json()) as Res;
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text) throw new LlmError(`${this.name} returned an empty choice`, true);

    return {
      text,
      model: this.model,
      usage: json.usage
        ? { input: json.usage.prompt_tokens ?? 0, output: json.usage.completion_tokens ?? 0 }
        : null,
    };
  }
}

export const groqClient = () =>
  new OpenAiCompatibleClient(
    "groq",
    config.llm.model.groq,
    "https://api.groq.com/openai/v1/chat/completions",
    config.llm.groqKey,
  );

export const openrouterClient = () =>
  new OpenAiCompatibleClient(
    "openrouter",
    config.llm.model.openrouter,
    "https://openrouter.ai/api/v1/chat/completions",
    config.llm.openrouterKey,
    { "x-title": "Scout" },
  );
