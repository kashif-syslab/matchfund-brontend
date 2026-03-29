const User = require('../models/User');
const { getPlanConfig, currentBillingMonthKey } = require('../config/subscriptionPlans');

function planIdForUser(userDoc) {
  return getPlanConfig(userDoc?.subscriptionPlan).id;
}

/**
 * Reset month counter if needed; return { count, monthKey, limit }.
 */
async function getRefreshUsage(userId) {
  const monthKey = currentBillingMonthKey();
  let u = await User.findById(userId).select('billingPeriodKey matchRefreshCount subscriptionPlan');
  if (!u) return { count: 0, monthKey, limit: 0 };
  const limit = getPlanConfig(u.subscriptionPlan).limits.maxRefreshesPerMonth;
  if (u.billingPeriodKey !== monthKey) {
    u.billingPeriodKey = monthKey;
    u.matchRefreshCount = 0;
    await u.save();
  }
  return { count: u.matchRefreshCount || 0, monthKey, limit };
}

async function assertRefreshAllowed(userId) {
  const { count, limit } = await getRefreshUsage(userId);
  if (limit == null) return;
  if (count >= limit) {
    const err = new Error(
      `You have used all ${limit} match recomputes for this month on your plan. Upgrade in Billing or wait until next month.`
    );
    err.status = 403;
    err.code = 'REFRESH_LIMIT';
    throw err;
  }
}

async function recordRefreshConsumed(userId) {
  const monthKey = currentBillingMonthKey();
  const u = await User.findById(userId).select('billingPeriodKey matchRefreshCount subscriptionPlan');
  if (!u) return;
  const limit = getPlanConfig(u.subscriptionPlan).limits.maxRefreshesPerMonth;
  if (limit == null) return;
  if (u.billingPeriodKey !== monthKey) {
    u.billingPeriodKey = monthKey;
    u.matchRefreshCount = 0;
  }
  u.matchRefreshCount = (u.matchRefreshCount || 0) + 1;
  await u.save();
}

function assertFiltersAllowed(planConfig, query) {
  const { allowMinScoreFilter, allowCheckSizeFilter } = planConfig.limits;
  const minScore = query.minScore != null && query.minScore !== '' ? Number(query.minScore) : null;
  if (minScore != null && !Number.isNaN(minScore) && !allowMinScoreFilter) {
    const err = new Error('Minimum score filter requires Starter or higher. Upgrade under Billing.');
    err.status = 403;
    err.code = 'PLAN_FILTER';
    throw err;
  }
  const hasCheck =
    (query.checkMin != null && query.checkMin !== '') || (query.checkMax != null && query.checkMax !== '');
  if (hasCheck && !allowCheckSizeFilter) {
    const err = new Error('Check-size filters require Starter or higher. Upgrade under Billing.');
    err.status = 403;
    err.code = 'PLAN_FILTER';
    throw err;
  }
}

function capMatches(rows, planConfig) {
  const cap = planConfig.limits.maxMatchesVisible;
  if (cap == null) return { rows, totalBeforeCap: rows.length, capped: false };
  if (rows.length <= cap) return { rows, totalBeforeCap: rows.length, capped: false };
  return { rows: rows.slice(0, cap), totalBeforeCap: rows.length, capped: true };
}

function buildPlanUsagePayload(userDoc, refreshUsage, capMeta) {
  const planId = planIdForUser(userDoc);
  const cfg = getPlanConfig(planId);
  const lim = cfg.limits.maxRefreshesPerMonth;
  return {
    planId,
    maxMatchesVisible: cfg.limits.maxMatchesVisible,
    totalMatched: capMeta.totalBeforeCap,
    visibleCount: capMeta.rows.length,
    matchesCapped: capMeta.capped,
    refreshesUsedThisMonth: refreshUsage.count,
    refreshesLimit: lim,
    refreshesRemaining: lim == null ? null : Math.max(0, lim - refreshUsage.count),
  };
}

module.exports = {
  planIdForUser,
  getRefreshUsage,
  assertRefreshAllowed,
  recordRefreshConsumed,
  assertFiltersAllowed,
  capMatches,
  buildPlanUsagePayload,
};
