#!/usr/bin/env node

/**
 * Quota Check CLI
 *
 * Displays remaining quota for all accounts and models.
 * Shows average remaining quota similar to the web dashboard.
 *
 * Usage:
 *   node src/cli/quota.js         # Show quota summary
 *   npm run left                  # Same as above
 */

import { existsSync, readFileSync } from 'fs';
import { ACCOUNT_CONFIG_PATH } from '../constants.js';
import { refreshAccessToken } from '../auth/oauth.js';
import { getModelQuotas } from '../cloudcode/index.js';

/**
 * Load accounts from config
 */
function loadAccounts() {
    try {
        if (existsSync(ACCOUNT_CONFIG_PATH)) {
            const data = readFileSync(ACCOUNT_CONFIG_PATH, 'utf-8');
            const config = JSON.parse(data);
            return config.accounts || [];
        }
    } catch (error) {
        console.error('Error loading accounts:', error.message);
    }
    return [];
}

/**
 * Get access token for an account
 */
async function getToken(account) {
    const tokens = await refreshAccessToken(account.refreshToken);
    return tokens.accessToken;
}

/**
 * Format percentage with color
 */
function formatPercent(fraction) {
    if (fraction === null || fraction === undefined) return '\x1b[90mN/A\x1b[0m';
    const pct = Math.round(fraction * 100);
    if (pct >= 50) return `\x1b[32m${pct}%\x1b[0m`;  // Green
    if (pct >= 20) return `\x1b[33m${pct}%\x1b[0m`;  // Yellow
    return `\x1b[31m${pct}%\x1b[0m`;  // Red
}

/**
 * Format percentage for average (no color for calculation display)
 */
function formatAvgPercent(fraction) {
    if (fraction === null || fraction === undefined) return 'N/A';
    const pct = Math.round(fraction * 100);
    if (pct >= 50) return `\x1b[32m${pct}%\x1b[0m`;  // Green
    if (pct >= 20) return `\x1b[33m${pct}%\x1b[0m`;  // Yellow
    return `\x1b[31m${pct}%\x1b[0m`;  // Red
}

/**
 * Main function
 */
async function main() {
    console.log('');
    console.log('\x1b[1m╔═══════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[1m║      Antigravity Quota Overview       ║\x1b[0m');
    console.log('\x1b[1m╚═══════════════════════════════════════╝\x1b[0m');

    const accounts = loadAccounts();

    if (accounts.length === 0) {
        console.log('\n\x1b[33mNo accounts configured.\x1b[0m');
        console.log('Run \x1b[36mnpm run accounts:add\x1b[0m to add an account.\n');
        process.exit(1);
    }

    console.log(`\nFetching quotas for ${accounts.length} account(s)...\n`);

    // Fetch quotas for all accounts
    const allQuotas = [];
    const modelTotals = {}; // modelId -> { sum, count }

    for (const account of accounts) {
        const shortEmail = account.email.split('@')[0];
        process.stdout.write(`  Checking ${shortEmail}... `);

        try {
            const token = await getToken(account);
            const quotas = await getModelQuotas(token);

            allQuotas.push({
                email: account.email,
                status: 'ok',
                quotas
            });

            // Accumulate for averages
            for (const [modelId, info] of Object.entries(quotas)) {
                if (info.remainingFraction !== null) {
                    if (!modelTotals[modelId]) {
                        modelTotals[modelId] = { sum: 0, count: 0 };
                    }
                    modelTotals[modelId].sum += info.remainingFraction;
                    modelTotals[modelId].count += 1;
                }
            }

            console.log('\x1b[32mOK\x1b[0m');
        } catch (error) {
            allQuotas.push({
                email: account.email,
                status: 'error',
                error: error.message
            });
            console.log(`\x1b[31mError: ${error.message}\x1b[0m`);
        }
    }

    // Calculate averages per model
    const modelAverages = {};
    for (const [modelId, totals] of Object.entries(modelTotals)) {
        modelAverages[modelId] = totals.count > 0 ? totals.sum / totals.count : null;
    }

    // Calculate overall average (average of model averages)
    const avgValues = Object.values(modelAverages).filter(v => v !== null);
    const overallAverage = avgValues.length > 0
        ? avgValues.reduce((a, b) => a + b, 0) / avgValues.length
        : null;

    // Detailed per-account breakdown
    const sortedModels = Object.keys(modelAverages).sort();

    console.log('\n\x1b[1m═══════════════════════════════════════\x1b[0m');
    console.log('\x1b[1m           PER-ACCOUNT DETAILS          \x1b[0m');
    console.log('\x1b[1m═══════════════════════════════════════\x1b[0m\n');

    for (const result of allQuotas) {
        const shortEmail = result.email.split('@')[0];
        console.log(`  \x1b[1m${shortEmail}\x1b[0m`);

        if (result.status === 'error') {
            console.log(`    \x1b[31mError: ${result.error}\x1b[0m\n`);
            continue;
        }

        const quotas = result.quotas;
        const modelIds = Object.keys(quotas).sort();

        if (modelIds.length === 0) {
            console.log('    \x1b[90mNo quota data available\x1b[0m\n');
            continue;
        }

        for (const modelId of modelIds) {
            const info = quotas[modelId];
            const remaining = formatPercent(info.remainingFraction);
            console.log(`    ${modelId.padEnd(30)} ${remaining}`);
        }
        console.log('');
    }

    // Display average summary at the bottom
    console.log('\x1b[1m═══════════════════════════════════════\x1b[0m');
    console.log('\x1b[1m           AVERAGE REMAINING            \x1b[0m');
    console.log('\x1b[1m═══════════════════════════════════════\x1b[0m\n');

    // Per-model averages
    if (sortedModels.length > 0) {
        console.log('  \x1b[1mBy Model:\x1b[0m');
        for (const modelId of sortedModels) {
            const avg = modelAverages[modelId];
            console.log(`    ${modelId.padEnd(30)} ${formatAvgPercent(avg)}`);
        }
        console.log('');
    }

    // Overall average
    if (overallAverage !== null) {
        const overallPct = Math.round(overallAverage * 100);
        let color = '\x1b[32m'; // Green
        if (overallPct < 50) color = '\x1b[33m'; // Yellow
        if (overallPct < 20) color = '\x1b[31m'; // Red

        console.log(`  \x1b[1mOverall Average:\x1b[0m ${color}${overallPct}%\x1b[0m\n`);
    }

    console.log('\x1b[90mTip: Run the server and visit http://localhost:8085 for the web dashboard.\x1b[0m\n');
}

main().catch(error => {
    console.error('\x1b[31mFatal error:\x1b[0m', error.message);
    process.exit(1);
});
