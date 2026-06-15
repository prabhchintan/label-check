/**
 * Provider factory, the only place the app decides which model backend to use.
 */

import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import type { ModelProvider } from "./types";

export interface ProviderEnv {
  ANTHROPIC_API_KEY?: string;
}

export function getProvider(env: ProviderEnv): ModelProvider {
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim() !== "") {
    return new AnthropicProvider(env.ANTHROPIC_API_KEY);
  }
  return new MockProvider();
}
