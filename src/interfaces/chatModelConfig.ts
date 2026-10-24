import type {
  ModelCost,
  OpenAICompletionsCompat,
  SamplingParams,
  SamplingParamsByThinkingLevel,
} from "@earendil-works/pi-ai";

/**
 * Minimal chat model config matching Pi's ProviderChatModelConfig shape.
 * Defined locally because ProviderChatModelConfig is not exported from
 * the public entry point of @earendil-works/pi-coding-agent.
 */
export interface ChatModelConfig {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevelMap: Record<string, string>;
  input: ("text" | "image")[];
  contextWindow: number;
  cost: ModelCost;
  maxTokens: number;
  compat?: Partial<OpenAICompletionsCompat>;
  samplingParams?: SamplingParams;
  samplingParamsByThinkingLevel?: SamplingParamsByThinkingLevel;
}
