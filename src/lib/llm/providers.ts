import { config } from "@/lib/config";
import { LlmError, type CompletionRequest, type CompletionResult, type LlmClient } from "./types";

const classify = (status: number) => status === 429 || status >= 500;

/** Google AI Studio. The most generous free tier at time of writing. */
export class GeminiClient implements LlmClient {
  readonly name = "gemini";
  readonly model = config.llm.model.gemini;

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent` +
      `?key=${config.llm.geminiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: req.temperature ?? 0,
          maxOutputTokens: req.maxTokens ?? 2048,
          ...(req.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      throw new LlmError(
        `gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`,
        classify(res.status),
        res.status,
      );
    }

    type Res = {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const json = (await res.json()) as Res;
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new LlmError("gemini returned an empty candidate", true);

    return {
      text,
      model: this.model,
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
