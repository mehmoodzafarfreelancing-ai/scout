import { config } from "@/lib/config";
import { MockLlmClient } from "./mock";
import { GeminiClient, groqClient, openrouterClient } from "./providers";
import type { LlmClient } from "./types";

export * from "./types";
export { extractStructured, type ExtractionResult } from "./extract";
export { parseLooseJson } from "./json";

export function createLlmClient(): LlmClient {
  switch (config.llm.provider) {
    case "gemini":
      return new GeminiClient();
    case "groq":
      return groqClient();
    case "openrouter":
      return openrouterClient();
    case "mock":
      return new MockLlmClient();
  }
}
