import type { LiteLLMModelPricing } from '@ccusage/internal/pricing';
import {
	createPricingDataset,
	fetchLiteLLMPricingDataset,
	filterPricingDataset,
} from '@ccusage/internal/pricing-fetch-utils';

const USAGE_MODEL_PREFIXES = [
	'claude-',
	'anthropic.claude-',
	'anthropic/claude-',
	'gpt-',
	'openai/gpt-',
	'azure/gpt-',
	'openrouter/openai/gpt-',
	'gemini-',
	'gemini/',
	'google/gemini',
	'vertex_ai/gemini',
	'openrouter/google/gemini',
	'deepseek-',
	'deepseek/',
	'openrouter/deepseek',
	'MiniMax-',
	'minimax/',
	'openrouter/minimax',
];

function isUsageModel(modelName: string, _pricing: LiteLLMModelPricing): boolean {
	return USAGE_MODEL_PREFIXES.some((prefix) => modelName.startsWith(prefix));
}

export async function prefetchUsagePricing(): Promise<Record<string, LiteLLMModelPricing>> {
	try {
		const dataset = await fetchLiteLLMPricingDataset();
		return filterPricingDataset(dataset, isUsageModel);
	} catch (error) {
		console.warn('Failed to prefetch usage pricing data, proceeding with empty cache.', error);
		return createPricingDataset();
	}
}
