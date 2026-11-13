import { config } from '../config';
import { AzureAiProvider } from './azure';
import { MockAiProvider } from './mock';
import type { AiProvider } from './types';

export function createAiProvider(): AiProvider {
  if (config.ai.provider === 'azure') {
    if (!config.ai.openaiEndpoint) throw new Error('AI_PROVIDER=azure braucht AZURE_OPENAI_ENDPOINT');
    return new AzureAiProvider();
  }
  return new MockAiProvider();
}

export type { AiProvider };
