import process from 'node:process';
import {
	formatCurrency,
	formatTokenCount,
	ResponsiveTable,
} from '@ccusage/terminal/table';
import { define } from 'gunshi';
import pc from 'picocolors';
import { DEFAULT_TIMEZONE } from '../_consts.ts';
import { sharedArgs } from '../_shared-args.ts';
import { buildDailyReport } from '../daily-report.ts';
import { loadTokenUsageEvents } from '../data-loader.ts';
import { normalizeFilterDate } from '../date-utils.ts';
import { log, logger } from '../logger.ts';
import { CodexPricingSource } from '../pricing.ts';
import { calculateCostUSD } from '../token-utils.ts';

type CodexUsageDisplay = {
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	reasoningOutputTokens: number;
	totalTokens: number;
	costUSD: number;
};

function formatPercent(value: number): string {
	if (!Number.isFinite(value)) {
		return '0.0%';
	}
	return `${value.toFixed(1)}%`;
}

function formatSharePercent(part: number, whole: number): string {
	return whole === 0 ? '0.0%' : formatPercent((part / whole) * 100);
}

function formatColoredCacheHitRate(inputTokens: number, cachedInputTokens: number): string {
	const value = inputTokens === 0 ? 0 : (cachedInputTokens / inputTokens) * 100;
	const formatted = formatPercent(value);
	if (value >= 90) {
		return pc.green(formatted);
	}
	if (value >= 60) {
		return pc.yellow(formatted);
	}
	return pc.red(formatted);
}

function joinLines(lines: string[]): string {
	return lines.join('\n');
}

function formatModelLabel(modelName: string, isFallback: boolean | undefined, index: number): string {
	const colors = [pc.yellow, pc.blue, pc.magenta, pc.green, pc.cyan] as const;
	const color = colors[index % colors.length] ?? pc.white;
	const label = isFallback === true ? `${modelName} (fallback)` : modelName;
	return color(label);
}

function formatCodexUsageGroupedRow(
	firstColumnValue: string,
	models: Array<{ name: string; usage: CodexUsageDisplay; isFallback?: boolean }>,
	total: CodexUsageDisplay,
): (string | number)[] {
	const modelLines = models.map((model, index) => formatModelLabel(model.name, model.isFallback, index));
	const shareLines = models.map((model) => formatSharePercent(model.usage.totalTokens, total.totalTokens));
	const inputLines = models.map((model) => formatTokenCount(model.usage.inputTokens));
	const outputLines = models.map((model) => formatTokenCount(model.usage.outputTokens));
	const reasoningLines = models.map((model) => formatTokenCount(model.usage.reasoningOutputTokens));
	const cacheReadLines = models.map((model) => formatTokenCount(model.usage.cachedInputTokens));
	const hitLines = models.map((model) =>
		formatColoredCacheHitRate(model.usage.inputTokens, model.usage.cachedInputTokens),
	);
	const totalLines = models.map((model) => formatTokenCount(model.usage.totalTokens));
	const costLines = models.map((model) => formatCurrency(model.usage.costUSD));

	modelLines.push(pc.bold('total'));
	shareLines.push(pc.bold('100.0%'));
	inputLines.push(pc.bold(formatTokenCount(total.inputTokens)));
	outputLines.push(pc.bold(formatTokenCount(total.outputTokens)));
	reasoningLines.push(pc.bold(formatTokenCount(total.reasoningOutputTokens)));
	cacheReadLines.push(pc.bold(formatTokenCount(total.cachedInputTokens)));
	hitLines.push(pc.bold(formatColoredCacheHitRate(total.inputTokens, total.cachedInputTokens)));
	totalLines.push(pc.bold(formatTokenCount(total.totalTokens)));
	costLines.push(pc.bold(formatCurrency(total.costUSD)));

	return [
		firstColumnValue,
		joinLines(modelLines),
		joinLines(shareLines),
		joinLines(inputLines),
		joinLines(outputLines),
		joinLines(reasoningLines),
		joinLines(cacheReadLines),
		joinLines(hitLines),
		joinLines(totalLines),
		joinLines(costLines),
	];
}

function formatCodexGrandTotalsRow(total: CodexUsageDisplay): (string | number)[] {
	return [
		pc.yellow('Total'),
		pc.yellow('Grand Total'),
		pc.yellow('100.0%'),
		pc.yellow(formatTokenCount(total.inputTokens)),
		pc.yellow(formatTokenCount(total.outputTokens)),
		pc.yellow(formatTokenCount(total.reasoningOutputTokens)),
		pc.yellow(formatTokenCount(total.cachedInputTokens)),
		formatColoredCacheHitRate(total.inputTokens, total.cachedInputTokens),
		pc.yellow(formatTokenCount(total.totalTokens)),
		pc.yellow(formatCurrency(total.costUSD)),
	];
}

export const dailyCommand = define({
	name: 'daily',
	description: 'Show Codex token usage grouped by day',
	args: sharedArgs,
	async run(ctx) {
		const jsonOutput = Boolean(ctx.values.json);
		if (jsonOutput) {
			logger.level = 0;
		}

		let since: string | undefined;
		let until: string | undefined;

		try {
			since = normalizeFilterDate(ctx.values.since);
			until = normalizeFilterDate(ctx.values.until);
		} catch (error) {
			logger.error(String(error));
			process.exit(1);
		}

		const { events, missingDirectories } = await loadTokenUsageEvents();

		for (const missing of missingDirectories) {
			logger.warn(`Codex session directory not found: ${missing}`);
		}

		if (events.length === 0) {
			log(jsonOutput ? JSON.stringify({ daily: [], totals: null }) : 'No Codex usage data found.');
			return;
		}

		const pricingSource = new CodexPricingSource({
			offline: ctx.values.offline,
		});
		try {
			const rows = await buildDailyReport(events, {
				pricingSource,
				timezone: ctx.values.timezone,
				since,
				until,
			});

			if (rows.length === 0) {
				log(
					jsonOutput
						? JSON.stringify({ daily: [], totals: null })
						: 'No Codex usage data found for provided filters.',
				);
				return;
			}

			const totals = rows.reduce(
				(acc, row) => {
					acc.inputTokens += row.inputTokens;
					acc.cachedInputTokens += row.cachedInputTokens;
					acc.outputTokens += row.outputTokens;
					acc.reasoningOutputTokens += row.reasoningOutputTokens;
					acc.totalTokens += row.totalTokens;
					acc.costUSD += row.costUSD;
					return acc;
				},
				{
					inputTokens: 0,
					cachedInputTokens: 0,
					outputTokens: 0,
					reasoningOutputTokens: 0,
					totalTokens: 0,
					costUSD: 0,
				},
			);

			if (jsonOutput) {
				log(
					JSON.stringify(
						{
							daily: rows,
							totals,
						},
						null,
						2,
					),
				);
				return;
			}

			logger.box(
				`Codex Token Usage Report - Daily (Timezone: ${ctx.values.timezone ?? DEFAULT_TIMEZONE})`,
			);

			const table: ResponsiveTable = new ResponsiveTable({
				head: [
					'Date',
					'Model',
					'Share',
					'Input',
					'Output',
					'Reasoning',
					'Cache Read',
					'Hit',
					'Total Tokens',
					'Cost (USD)',
				],
				colAligns: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
				compactHead: [
					'Date',
					'Model',
					'Share',
					'Input',
					'Output',
					'Reasoning',
					'Cache Read',
					'Hit',
					'Total Tokens',
					'Cost (USD)',
				],
				compactColAligns: [
					'left',
					'left',
					'right',
					'right',
					'right',
					'right',
					'right',
					'right',
					'right',
					'right',
				],
				compactThreshold: 100,
				forceCompact: ctx.values.compact,
				style: { head: ['cyan'] },
			});

			for (const row of rows) {
				const modelRows = await Promise.all(
					Object.entries(row.models)
						.map(async ([modelName, usage]) => {
							const pricing = await pricingSource.getPricing(modelName);
							return {
								name: modelName,
								isFallback: usage.isFallback,
								usage: {
									inputTokens: usage.inputTokens,
									cachedInputTokens: usage.cachedInputTokens,
									outputTokens: usage.outputTokens,
									reasoningOutputTokens: usage.reasoningOutputTokens,
									totalTokens: usage.totalTokens,
									costUSD: calculateCostUSD(usage, pricing),
								},
							};
						}),
				);
				modelRows.sort((a, b) => b.usage.totalTokens - a.usage.totalTokens);

				table.push(formatCodexUsageGroupedRow(row.date, modelRows, row));
			}

			table.push(formatCodexGrandTotalsRow(totals));

			log(table.toString());

			if (table.isCompactMode()) {
				logger.info('\nRunning in Compact Mode');
				logger.info('Expand terminal width to see cache metrics and total tokens');
			}
		} finally {
			pricingSource[Symbol.dispose]();
		}
	},
});
