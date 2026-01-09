/**
 * Antigravity Claude Proxy - Dashboard
 * Vanilla JavaScript application for monitoring proxy status
 */

// State
const state = {
    health: null,
    accountLimits: null,
    lastUpdated: null,
    autoRefresh: true,
    refreshInterval: 30000,
    refreshTimer: null,
    countdownTimer: null,
    filter: 'all',
    searchQuery: '',
    expandedAccounts: new Set(),
    isLoading: false
};

// DOM Elements
const elements = {
    serverStatus: document.getElementById('server-status'),
    lastUpdate: document.getElementById('last-update'),
    autoRefreshToggle: document.getElementById('auto-refresh-toggle'),
    refreshIntervalSelect: document.getElementById('refresh-interval'),
    manualRefreshBtn: document.getElementById('manual-refresh'),
    errorBanner: document.getElementById('error-banner'),
    errorMessage: document.getElementById('error-message'),
    errorRetry: document.getElementById('error-retry'),
    totalAccounts: document.getElementById('total-accounts'),
    availableAccounts: document.getElementById('available-accounts'),
    rateLimitedAccounts: document.getElementById('rate-limited-accounts'),
    invalidAccounts: document.getElementById('invalid-accounts'),
    filterButtons: document.querySelectorAll('.filter-btn'),
    accountSearch: document.getElementById('account-search'),
    accountsList: document.getElementById('accounts-list'),
    quotaMatrix: document.getElementById('quota-matrix'),
    // Global quota elements
    claudeQuota: document.getElementById('claude-quota'),
    claudeQuotaFill: document.getElementById('claude-quota-fill'),
    claudeReset: document.getElementById('claude-reset'),
    geminiQuota: document.getElementById('gemini-quota'),
    geminiQuotaFill: document.getElementById('gemini-quota-fill'),
    geminiReset: document.getElementById('gemini-reset'),
    nextResetTime: document.getElementById('next-reset-time'),
    nextResetModel: document.getElementById('next-reset-model')
};

// API Client
const API = {
    async getHealth() {
        const response = await fetch('/health');
        if (!response.ok) throw new Error('Health check failed: ' + response.status);
        return response.json();
    },

    async getAccountLimits() {
        const response = await fetch('/account-limits?format=json');
        if (!response.ok) throw new Error('Account limits failed: ' + response.status);
        return response.json();
    }
};

// Utilities
const Utils = {
    formatDuration(ms) {
        if (ms <= 0) return 'now';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return days + 'd ' + (hours % 24) + 'h';
        if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
        if (minutes > 0) return minutes + 'm ' + (seconds % 60) + 's';
        return seconds + 's';
    },

    formatTimestamp(isoString) {
        if (!isoString) return 'never';
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now - date;

        if (diffMs < 60000) return 'just now';
        if (diffMs < 3600000) return Math.floor(diffMs / 60000) + 'm ago';
        if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + 'h ago';
        return date.toLocaleDateString();
    },

    getQuotaLevel(fraction) {
        if (fraction === null || fraction === undefined) return 'na';
        if (fraction >= 0.75) return 'high';
        if (fraction >= 0.25) return 'medium';
        if (fraction > 0) return 'low';
        return 'exhausted';
    },

    maskEmail(email) {
        if (!email) return '';
        const parts = email.split('@');
        if (parts.length !== 2) return email;
        const local = parts[0];
        const domain = parts[1];
        const maskedLocal = local.length > 4
            ? local.slice(0, 4) + '***'
            : local.slice(0, 2) + '***';
        return maskedLocal + '@' + domain;
    },

    getModelFamily(modelId) {
        if (!modelId) return 'unknown';
        if (modelId.indexOf('claude') !== -1) return 'claude';
        if (modelId.indexOf('gemini') !== -1) return 'gemini';
        return 'unknown';
    },

    filterModels(models, filter) {
        if (filter === 'all') return models;
        return models.filter(function(m) {
            return Utils.getModelFamily(m) === filter;
        });
    },

    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }
};

// Render Functions
// Global quota state for countdown updates
const globalQuotaState = {
    claudeResetTime: null,
    geminiResetTime: null,
    nextResetTime: null,
    nextResetModel: null
};

const Render = {
    globalQuota: function(accountLimits) {
        if (!accountLimits || !accountLimits.accounts) {
            elements.claudeQuota.textContent = '-';
            elements.claudeQuotaFill.style.width = '0%';
            elements.claudeReset.textContent = '-';
            elements.geminiQuota.textContent = '-';
            elements.geminiQuotaFill.style.width = '0%';
            elements.geminiReset.textContent = '-';
            elements.nextResetTime.textContent = '-';
            elements.nextResetModel.textContent = '-';
            return;
        }

        // Calculate average quota per account for each model family
        // We average the quotas per account (not per model), so each account contributes once
        var claudePerAccount = {}; // email -> { sum, count, soonestReset }
        var geminiPerAccount = {}; // email -> { sum, count, soonestReset }
        var allResets = [];

        accountLimits.accounts.forEach(function(acc) {
            if (acc.status !== 'ok' && acc.status !== 'rate-limited') return;
            if (!acc.limits) return;

            Object.keys(acc.limits).forEach(function(modelId) {
                var limit = acc.limits[modelId];
                if (!limit) return;

                var fraction = limit.remainingFraction;
                // Treat null as 0% (exhausted/rate-limited)
                if (fraction === null || fraction === undefined) {
                    fraction = 0;
                }
                var resetTime = limit.resetTime;
                var family = Utils.getModelFamily(modelId);

                if (family === 'claude') {
                    if (!claudePerAccount[acc.email]) {
                        claudePerAccount[acc.email] = { sum: 0, count: 0, soonestReset: null };
                    }
                    claudePerAccount[acc.email].sum += fraction;
                    claudePerAccount[acc.email].count += 1;
                    // Track soonest reset for this account
                    if (resetTime) {
                        var rt = new Date(resetTime).getTime();
                        if (!claudePerAccount[acc.email].soonestReset || rt < claudePerAccount[acc.email].soonestReset) {
                            claudePerAccount[acc.email].soonestReset = rt;
                        }
                    }
                } else if (family === 'gemini') {
                    if (!geminiPerAccount[acc.email]) {
                        geminiPerAccount[acc.email] = { sum: 0, count: 0, soonestReset: null };
                    }
                    geminiPerAccount[acc.email].sum += fraction;
                    geminiPerAccount[acc.email].count += 1;
                    if (resetTime) {
                        var grt = new Date(resetTime).getTime();
                        if (!geminiPerAccount[acc.email].soonestReset || grt < geminiPerAccount[acc.email].soonestReset) {
                            geminiPerAccount[acc.email].soonestReset = grt;
                        }
                    }
                }

                // Track all reset times for exhausted quotas
                if (resetTime && fraction === 0) {
                    allResets.push({ time: new Date(resetTime).getTime(), model: modelId });
                }
            });
        });

        // Calculate average Claude quota across all accounts
        var claudeAccounts = Object.keys(claudePerAccount);
        var claudeAvgFraction = 0;
        var claudeSoonestReset = null;
        if (claudeAccounts.length > 0) {
            var claudeTotal = 0;
            claudeAccounts.forEach(function(email) {
                var acc = claudePerAccount[email];
                // Average for this account
                var accAvg = acc.sum / acc.count;
                claudeTotal += accAvg;
                // Track soonest reset
                if (acc.soonestReset && (!claudeSoonestReset || acc.soonestReset < claudeSoonestReset)) {
                    claudeSoonestReset = acc.soonestReset;
                }
            });
            claudeAvgFraction = claudeTotal / claudeAccounts.length;
        }

        // Calculate average Gemini quota across all accounts
        var geminiAccounts = Object.keys(geminiPerAccount);
        var geminiAvgFraction = 0;
        var geminiSoonestReset = null;
        if (geminiAccounts.length > 0) {
            var geminiTotal = 0;
            geminiAccounts.forEach(function(email) {
                var acc = geminiPerAccount[email];
                var accAvg = acc.sum / acc.count;
                geminiTotal += accAvg;
                if (acc.soonestReset && (!geminiSoonestReset || acc.soonestReset < geminiSoonestReset)) {
                    geminiSoonestReset = acc.soonestReset;
                }
            });
            geminiAvgFraction = geminiTotal / geminiAccounts.length;
        }

        // Find next reset time (soonest exhausted quota)
        var nextReset = null;
        allResets.forEach(function(r) {
            if (r.time > Date.now() && (!nextReset || r.time < nextReset.time)) {
                nextReset = r;
            }
        });

        // Update Claude quota display
        if (claudeAccounts.length > 0) {
            var claudePercent = Math.round(claudeAvgFraction * 100);
            elements.claudeQuota.textContent = claudePercent + '%';
            elements.claudeQuotaFill.style.width = claudePercent + '%';

            if (claudeSoonestReset && claudeSoonestReset > Date.now()) {
                globalQuotaState.claudeResetTime = new Date(claudeSoonestReset).toISOString();
                var resetMs = claudeSoonestReset - Date.now();
                elements.claudeReset.textContent = 'Avg across ' + claudeAccounts.length + ' accounts';
            } else {
                globalQuotaState.claudeResetTime = null;
                elements.claudeReset.textContent = 'Avg across ' + claudeAccounts.length + ' accounts';
            }
        } else {
            elements.claudeQuota.textContent = 'N/A';
            elements.claudeQuotaFill.style.width = '0%';
            elements.claudeReset.textContent = 'No data';
            globalQuotaState.claudeResetTime = null;
        }

        // Update Gemini quota display
        if (geminiAccounts.length > 0) {
            var geminiPercent = Math.round(geminiAvgFraction * 100);
            elements.geminiQuota.textContent = geminiPercent + '%';
            elements.geminiQuotaFill.style.width = geminiPercent + '%';

            globalQuotaState.geminiResetTime = null;
            elements.geminiReset.textContent = 'Avg across ' + geminiAccounts.length + ' accounts';
        } else {
            elements.geminiQuota.textContent = 'N/A';
            elements.geminiQuotaFill.style.width = '0%';
            elements.geminiReset.textContent = 'No data';
            globalQuotaState.geminiResetTime = null;
        }

        // Update next reset display
        if (nextReset) {
            globalQuotaState.nextResetTime = nextReset.time;
            globalQuotaState.nextResetModel = nextReset.model;
            var nextResetMs = nextReset.time - Date.now();
            elements.nextResetTime.textContent = Utils.formatDuration(nextResetMs);
            elements.nextResetModel.textContent = nextReset.model;
        } else {
            globalQuotaState.nextResetTime = null;
            globalQuotaState.nextResetModel = null;
            elements.nextResetTime.textContent = 'All OK';
            elements.nextResetModel.textContent = 'No exhausted quotas';
        }
    },

    summary: function(health) {
        if (!health) return;

        elements.totalAccounts.textContent = health.counts.total;
        elements.availableAccounts.textContent = health.counts.available;
        elements.rateLimitedAccounts.textContent = health.counts.rateLimited;
        elements.invalidAccounts.textContent = health.counts.invalid;
    },

    accounts: function(health) {
        if (!health || !health.accounts || health.accounts.length === 0) {
            elements.accountsList.textContent = '';
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-state';
            emptyDiv.innerHTML = '<h3>No accounts configured</h3><p>Run <code>npm run accounts:add</code> to add an account</p>';
            elements.accountsList.appendChild(emptyDiv);
            return;
        }

        // Filter accounts
        let filteredAccounts = health.accounts;

        // Apply search filter
        if (state.searchQuery) {
            const query = state.searchQuery.toLowerCase();
            filteredAccounts = filteredAccounts.filter(function(acc) {
                return acc.email.toLowerCase().indexOf(query) !== -1;
            });
        }

        if (filteredAccounts.length === 0) {
            elements.accountsList.textContent = '';
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-state';
            emptyDiv.innerHTML = '<h3>No matching accounts</h3><p>Try adjusting your search or filter</p>';
            elements.accountsList.appendChild(emptyDiv);
            return;
        }

        // Clear and rebuild
        elements.accountsList.textContent = '';

        filteredAccounts.forEach(function(acc) {
            const isExpanded = state.expandedAccounts.has(acc.email);
            const statusClass = acc.status === 'ok' ? 'ok' :
                               acc.status === 'rate-limited' ? 'rate-limited' :
                               acc.status === 'invalid' ? 'invalid' : 'error';

            // Get models filtered by current filter
            const allModels = Object.keys(acc.models || {});
            const filteredModels = Utils.filterModels(allModels, state.filter);

            const card = document.createElement('article');
            card.className = 'account-card status-' + statusClass + (isExpanded ? ' expanded' : '');
            card.dataset.email = acc.email;

            // Build card header
            const header = document.createElement('div');
            header.className = 'card-header';
            header.onclick = function() { Events.toggleAccount(acc.email); };

            const info = document.createElement('div');
            info.className = 'account-info';

            const emailSpan = document.createElement('span');
            emailSpan.className = 'account-email';
            emailSpan.textContent = Utils.maskEmail(acc.email);
            info.appendChild(emailSpan);

            const statusSpan = document.createElement('span');
            statusSpan.className = 'account-status ' + statusClass;
            statusSpan.textContent = acc.status;
            info.appendChild(statusSpan);

            const meta = document.createElement('div');
            meta.className = 'account-meta';

            const lastUsedSpan = document.createElement('span');
            lastUsedSpan.className = 'last-used';
            lastUsedSpan.textContent = 'Last: ' + Utils.formatTimestamp(acc.lastUsed);
            meta.appendChild(lastUsedSpan);

            const expandIcon = document.createElement('span');
            expandIcon.className = 'expand-icon';
            expandIcon.innerHTML = '&#9660;';
            meta.appendChild(expandIcon);

            header.appendChild(info);
            header.appendChild(meta);
            card.appendChild(header);

            // Build card details
            const details = document.createElement('div');
            details.className = 'card-details';

            if (acc.error) {
                const errorP = document.createElement('p');
                errorP.style.color = 'var(--status-error)';
                errorP.style.marginBottom = '1rem';
                errorP.textContent = acc.error;
                details.appendChild(errorP);
            }

            const quotasDiv = document.createElement('div');
            quotasDiv.className = 'model-quotas';

            if (filteredModels.length > 0) {
                filteredModels.forEach(function(modelId) {
                    const quota = acc.models[modelId];
                    const fraction = quota ? quota.remainingFraction : null;
                    const level = Utils.getQuotaLevel(fraction);
                    const percent = fraction !== null && fraction !== undefined
                        ? Math.round(fraction * 100)
                        : null;
                    const resetTime = quota ? quota.resetTime : null;
                    const resetMs = resetTime ? new Date(resetTime).getTime() - Date.now() : 0;

                    const item = document.createElement('div');
                    item.className = 'quota-item';

                    const qHeader = document.createElement('div');
                    qHeader.className = 'quota-header';

                    const modelName = document.createElement('span');
                    modelName.className = 'model-name';
                    modelName.textContent = modelId;
                    qHeader.appendChild(modelName);

                    const quotaPercent = document.createElement('span');
                    quotaPercent.className = 'quota-percent';
                    quotaPercent.textContent = percent !== null ? percent + '%' : 'N/A';
                    qHeader.appendChild(quotaPercent);

                    item.appendChild(qHeader);

                    const bar = document.createElement('div');
                    bar.className = 'quota-bar';

                    const fill = document.createElement('div');
                    fill.className = 'quota-fill ' + level;
                    fill.style.width = (percent !== null ? percent : 0) + '%';
                    bar.appendChild(fill);

                    item.appendChild(bar);

                    if (resetMs > 0) {
                        const resetDiv = document.createElement('div');
                        resetDiv.className = 'quota-reset';
                        resetDiv.dataset.reset = resetTime;
                        resetDiv.textContent = 'Resets in ' + Utils.formatDuration(resetMs);
                        item.appendChild(resetDiv);
                    }

                    quotasDiv.appendChild(item);
                });
            } else {
                const noModels = document.createElement('p');
                noModels.style.color = 'var(--text-muted)';
                noModels.textContent = 'No models match the current filter';
                quotasDiv.appendChild(noModels);
            }

            details.appendChild(quotasDiv);
            card.appendChild(details);
            elements.accountsList.appendChild(card);
        });
    },

    matrix: function(accountLimits) {
        if (!accountLimits || !accountLimits.accounts || accountLimits.accounts.length === 0) {
            elements.quotaMatrix.textContent = '';
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.textContent = 'No data available';
            row.appendChild(cell);
            elements.quotaMatrix.appendChild(row);
            return;
        }

        // Get filtered models
        const allModels = accountLimits.models || [];
        const filteredModels = Utils.filterModels(allModels, state.filter);

        if (filteredModels.length === 0) {
            elements.quotaMatrix.textContent = '';
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.textContent = 'No models match the current filter';
            row.appendChild(cell);
            elements.quotaMatrix.appendChild(row);
            return;
        }

        // Filter accounts by search
        let filteredAccounts = accountLimits.accounts;
        if (state.searchQuery) {
            const query = state.searchQuery.toLowerCase();
            filteredAccounts = filteredAccounts.filter(function(acc) {
                return acc.email.toLowerCase().indexOf(query) !== -1;
            });
        }

        // Clear table
        elements.quotaMatrix.textContent = '';

        // Build header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        const accountTh = document.createElement('th');
        accountTh.textContent = 'Account';
        headerRow.appendChild(accountTh);

        filteredModels.forEach(function(m) {
            const th = document.createElement('th');
            th.textContent = m;
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        elements.quotaMatrix.appendChild(thead);

        // Build body
        const tbody = document.createElement('tbody');

        filteredAccounts.forEach(function(acc) {
            const row = document.createElement('tr');

            const accountCell = document.createElement('td');
            accountCell.textContent = Utils.maskEmail(acc.email);
            row.appendChild(accountCell);

            filteredModels.forEach(function(modelId) {
                const cell = document.createElement('td');
                cell.className = 'quota-cell';

                if (acc.status !== 'ok' && acc.status !== 'rate-limited') {
                    cell.className += ' na';
                    cell.textContent = '[' + acc.status + ']';
                } else {
                    const limit = acc.limits ? acc.limits[modelId] : null;

                    if (!limit) {
                        cell.className += ' na';
                        cell.textContent = '-';
                    } else {
                        const fraction = limit.remainingFraction;
                        const level = Utils.getQuotaLevel(fraction);
                        const percent = fraction !== null && fraction !== undefined
                            ? Math.round(fraction * 100)
                            : null;
                        const resetTime = limit.resetTime;
                        const resetMs = resetTime ? new Date(resetTime).getTime() - Date.now() : 0;

                        cell.className += ' ' + level;

                        if (percent !== null) {
                            cell.textContent = percent + '%';
                            if (resetMs > 0 && percent === 0) {
                                const resetSpan = document.createElement('span');
                                resetSpan.className = 'reset-time';
                                resetSpan.dataset.reset = resetTime;
                                resetSpan.textContent = Utils.formatDuration(resetMs);
                                cell.appendChild(resetSpan);
                            }
                        } else {
                            cell.textContent = 'N/A';
                        }
                    }
                }

                row.appendChild(cell);
            });

            tbody.appendChild(row);
        });

        elements.quotaMatrix.appendChild(tbody);
    },

    serverStatus: function(isOk, latencyMs) {
        if (isOk) {
            elements.serverStatus.textContent = 'OK (' + latencyMs + 'ms)';
            elements.serverStatus.className = 'status-badge ok';
        } else {
            elements.serverStatus.textContent = 'Error';
            elements.serverStatus.className = 'status-badge error';
        }
    },

    lastUpdated: function() {
        if (state.lastUpdated) {
            const seconds = Math.floor((Date.now() - state.lastUpdated) / 1000);
            elements.lastUpdate.textContent = seconds < 5 ? 'just now' : seconds + 's ago';
        }
    },

    error: function(message) {
        if (message) {
            elements.errorMessage.textContent = message;
            elements.errorBanner.classList.remove('hidden');
        } else {
            elements.errorBanner.classList.add('hidden');
        }
    },

    loading: function(isLoading) {
        state.isLoading = isLoading;
        if (isLoading) {
            elements.manualRefreshBtn.classList.add('loading');
            elements.manualRefreshBtn.disabled = true;
            elements.serverStatus.textContent = 'Loading...';
            elements.serverStatus.className = 'status-badge loading';
        } else {
            elements.manualRefreshBtn.classList.remove('loading');
            elements.manualRefreshBtn.disabled = false;
        }
    },

    updateCountdowns: function() {
        // Update all countdown timers
        var resetElements = document.querySelectorAll('[data-reset]');
        resetElements.forEach(function(el) {
            var resetTime = el.dataset.reset;
            if (resetTime) {
                var resetMs = new Date(resetTime).getTime() - Date.now();
                if (resetMs > 0) {
                    var text = el.classList.contains('reset-time')
                        ? Utils.formatDuration(resetMs)
                        : 'Resets in ' + Utils.formatDuration(resetMs);
                    el.textContent = text;
                } else {
                    el.textContent = 'resetting...';
                }
            }
        });

        // Update global quota countdowns
        if (globalQuotaState.claudeResetTime) {
            var claudeMs = new Date(globalQuotaState.claudeResetTime).getTime() - Date.now();
            if (claudeMs > 0) {
                elements.claudeReset.textContent = 'Resets in ' + Utils.formatDuration(claudeMs);
            } else {
                elements.claudeReset.textContent = 'Resetting...';
            }
        }

        if (globalQuotaState.geminiResetTime) {
            var geminiMs = new Date(globalQuotaState.geminiResetTime).getTime() - Date.now();
            if (geminiMs > 0) {
                elements.geminiReset.textContent = 'Resets in ' + Utils.formatDuration(geminiMs);
            } else {
                elements.geminiReset.textContent = 'Resetting...';
            }
        }

        if (globalQuotaState.nextResetTime) {
            var nextMs = globalQuotaState.nextResetTime - Date.now();
            if (nextMs > 0) {
                elements.nextResetTime.textContent = Utils.formatDuration(nextMs);
            } else {
                elements.nextResetTime.textContent = 'Resetting...';
            }
        }

        // Update "updated X seconds ago"
        Render.lastUpdated();
    }
};

// Event Handlers
const Events = {
    toggleAutoRefresh: function() {
        state.autoRefresh = elements.autoRefreshToggle.checked;
        if (state.autoRefresh) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    },

    changeRefreshInterval: function() {
        state.refreshInterval = parseInt(elements.refreshIntervalSelect.value, 10);
        if (state.autoRefresh) {
            stopAutoRefresh();
            startAutoRefresh();
        }
    },

    manualRefresh: function() {
        refresh();
    },

    filterByModel: function(filter) {
        state.filter = filter;
        elements.filterButtons.forEach(function(btn) {
            if (btn.dataset.filter === filter) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        // Re-render with new filter
        Render.accounts(state.health);
        Render.matrix(state.accountLimits);
    },

    searchAccounts: function() {
        state.searchQuery = elements.accountSearch.value.trim();
        // Debounce search
        clearTimeout(state.searchTimeout);
        state.searchTimeout = setTimeout(function() {
            Render.accounts(state.health);
            Render.matrix(state.accountLimits);
        }, 300);
    },

    toggleAccount: function(email) {
        if (state.expandedAccounts.has(email)) {
            state.expandedAccounts.delete(email);
        } else {
            state.expandedAccounts.add(email);
        }
        // Find and toggle the card
        var card = document.querySelector('.account-card[data-email="' + email + '"]');
        if (card) {
            card.classList.toggle('expanded');
        }
    },

    retryAfterError: function() {
        Render.error(null);
        refresh();
    }
};

// Make Events globally accessible for onclick handlers
window.Events = Events;

// Core Functions
async function refresh() {
    if (state.isLoading) return;

    Render.loading(true);
    Render.error(null);

    try {
        // Fetch both endpoints in parallel
        const results = await Promise.all([
            API.getHealth(),
            API.getAccountLimits()
        ]);

        const health = results[0];
        const accountLimits = results[1];

        state.health = health;
        state.accountLimits = accountLimits;
        state.lastUpdated = Date.now();

        // Render all components
        Render.serverStatus(true, health.latencyMs);
        Render.globalQuota(accountLimits);
        Render.summary(health);
        Render.accounts(health);
        Render.matrix(accountLimits);
        Render.lastUpdated();

    } catch (error) {
        console.error('Refresh failed:', error);
        Render.serverStatus(false);
        Render.error('Failed to connect: ' + error.message);
    } finally {
        Render.loading(false);
    }
}

function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = setInterval(refresh, state.refreshInterval);
}

function stopAutoRefresh() {
    if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
        state.refreshTimer = null;
    }
}

function startCountdownUpdater() {
    // Update countdowns every second
    state.countdownTimer = setInterval(Render.updateCountdowns, 1000);
}

function init() {
    // Set up event listeners
    elements.autoRefreshToggle.addEventListener('change', Events.toggleAutoRefresh);
    elements.refreshIntervalSelect.addEventListener('change', Events.changeRefreshInterval);
    elements.manualRefreshBtn.addEventListener('click', Events.manualRefresh);
    elements.accountSearch.addEventListener('input', Events.searchAccounts);
    elements.errorRetry.addEventListener('click', Events.retryAfterError);

    elements.filterButtons.forEach(function(btn) {
        btn.addEventListener('click', function() {
            Events.filterByModel(btn.dataset.filter);
        });
    });

    // Initial fetch
    refresh();

    // Start auto-refresh if enabled
    if (state.autoRefresh) {
        startAutoRefresh();
    }

    // Start countdown updater
    startCountdownUpdater();
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
