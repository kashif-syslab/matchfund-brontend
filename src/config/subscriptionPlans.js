/**
 * Single source of truth for subscription tiers (NOT stored in DB).
 * Edit this file to change prices shown in the app, match caps, and refresh quotas.
 * Stripe Price IDs stay in .env; map them via `stripePriceEnv` below.
 */

const PLANS = {
  free: {
    id: 'free',
    label: 'Free',
    /** Shown on Billing + plan API — marketing copy only until Stripe Checkout */
    priceLabel: '$0',
    billingNote: 'Forever',
    description: 'Try the product with a small match window and limited recomputes.',
    features: [
      'Up to 5 matches shown in your feed',
      'Up to 3 full recomputes per calendar month',
      'Sector & stage filters',
      'Messages & deal rooms (within your visible matches)',
    ],
    limits: {
      /** Max rows returned after scoring/filtering; null = unlimited */
      maxMatchesVisible: 5,
      /** Full match recomputes per calendar month; null = unlimited */
      maxRefreshesPerMonth: 3,
      allowMinScoreFilter: false,
      allowCheckSizeFilter: false,
    },
    /** Env var name holding Stripe Price ID, or null if not sold via Checkout */
    stripePriceEnv: null,
  },
  starter: {
    id: 'starter',
    label: 'Starter',
    priceLabel: '$29',
    billingNote: 'per month',
    description: 'Serious fundraising: more matches and richer filters.',
    features: [
      'Up to 25 matches in your feed',
      'Up to 30 recomputes per month',
      'Minimum score filter',
      'Check-size filters (founders)',
    ],
    limits: {
      maxMatchesVisible: 25,
      maxRefreshesPerMonth: 30,
      allowMinScoreFilter: true,
      allowCheckSizeFilter: true,
    },
    stripePriceEnv: 'STRIPE_PRICE_STARTER',
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    priceLabel: '$79',
    billingNote: 'per month',
    description: 'Scale outreach with a larger pool and high refresh allowance.',
    features: [
      'Up to 100 matches in your feed',
      'Unlimited recomputes',
      'All filters including score & check size',
    ],
    limits: {
      maxMatchesVisible: 100,
      maxRefreshesPerMonth: null,
      allowMinScoreFilter: true,
      allowCheckSizeFilter: true,
    },
    stripePriceEnv: 'STRIPE_PRICE_PRO',
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise',
    priceLabel: '$99',
    billingNote: 'per month',
    description: 'Top-tier access with unlimited matches, recomputes, and premium filters.',
    features: [
      'Unlimited visible matches',
      'Unlimited recomputes',
      'All filters',
      'Priority support',
    ],
    limits: {
      maxMatchesVisible: null,
      maxRefreshesPerMonth: null,
      allowMinScoreFilter: true,
      allowCheckSizeFilter: true,
    },
    stripePriceEnv: 'STRIPE_PRICE_ENTERPRISE',
  },
};

const ORDER = ['free', 'starter', 'pro', 'enterprise'];

function getPlanConfig(planId) {
  const id = planId && PLANS[planId] ? planId : 'free';
  return PLANS[id];
}

function currentBillingMonthKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Payload for GET /billing/plans (safe for frontend; no secrets).
 */
function getPlansCatalogForClient() {
  return ORDER.map((id) => {
    const p = PLANS[id];
    const envName = p.stripePriceEnv;
    const priceId = envName ? process.env[envName] : null;
    return {
      id: p.id,
      label: p.label,
      priceLabel: p.priceLabel,
      billingNote: p.billingNote,
      description: p.description,
      features: p.features,
      limits: { ...p.limits },
      /** True if API can start a Stripe Checkout session for this plan */
      checkoutAvailable: Boolean(envName && priceId && process.env.STRIPE_SECRET_KEY),
    };
  });
}

function resolveStripePriceId(planId) {
  const p = getPlanConfig(planId);
  if (!p.stripePriceEnv) return null;
  return process.env[p.stripePriceEnv] || null;
}

module.exports = {
  PLANS,
  ORDER,
  getPlanConfig,
  currentBillingMonthKey,
  getPlansCatalogForClient,
  resolveStripePriceId,
};
