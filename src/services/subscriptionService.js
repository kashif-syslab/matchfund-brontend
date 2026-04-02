const User = require('../models/User');

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LOCAL_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

function paidStatusSet() {
  return new Set(['trialing', 'active', 'past_due']);
}

function toDateOrNull(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function freePlanPatch() {
  return {
    subscriptionPlan: 'free',
    subscriptionStatus: 'free',
    subscriptionExpiresAt: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    subscriptionCheckedAt: new Date(),
  };
}

function localPaidPatch(plan) {
  return {
    subscriptionPlan: plan,
    subscriptionStatus: 'manual',
    subscriptionExpiresAt: new Date(Date.now() + LOCAL_PERIOD_MS),
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    subscriptionCheckedAt: new Date(),
  };
}

function stripeSubscriptionPatch(plan, subscription) {
  const periodEndUnix = subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end || null;
  return {
    subscriptionPlan: plan,
    subscriptionStatus: subscription.status || 'active',
    subscriptionExpiresAt: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
    stripeSubscriptionId: subscription.id || null,
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || null,
    subscriptionCheckedAt: new Date(),
  };
}

async function maybePersist(userDoc, patch) {
  const next = { ...userDoc.toObject?.(), ...patch };
  const changed = Object.keys(patch).some((key) => {
    const before = userDoc[key] instanceof Date ? userDoc[key]?.toISOString() : userDoc[key];
    const after = next[key] instanceof Date ? next[key]?.toISOString() : next[key];
    return before !== after;
  });
  if (!changed) return userDoc;
  Object.assign(userDoc, patch);
  await userDoc.save();
  return userDoc;
}

async function syncUserSubscriptionState(userDoc) {
  if (!userDoc) return null;
  const plan = userDoc.subscriptionPlan || 'free';
  const now = Date.now();
  const expiresAt = toDateOrNull(userDoc.subscriptionExpiresAt);

  if (plan === 'free') {
    return maybePersist(userDoc, freePlanPatch());
  }

  if (expiresAt && expiresAt.getTime() <= now) {
    return maybePersist(userDoc, freePlanPatch());
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !userDoc.stripeSubscriptionId) {
    return userDoc;
  }

  const lastChecked = toDateOrNull(userDoc.subscriptionCheckedAt);
  const shouldSync =
    !lastChecked ||
    now - lastChecked.getTime() >= SYNC_INTERVAL_MS ||
    (expiresAt && expiresAt.getTime() - now <= 24 * 60 * 60 * 1000);
  if (!shouldSync) return userDoc;

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);
    const subscription = await stripe.subscriptions.retrieve(userDoc.stripeSubscriptionId);
    const patch = stripeSubscriptionPatch(plan, subscription);
    const hasAccess =
      paidStatusSet().has(subscription.status) && (!patch.subscriptionExpiresAt || patch.subscriptionExpiresAt.getTime() > now);
    if (!hasAccess) {
      return maybePersist(userDoc, freePlanPatch());
    }
    return maybePersist(userDoc, patch);
  } catch (e) {
    console.warn('[billing] Stripe subscription sync failed:', e.message);
    return maybePersist(userDoc, { subscriptionCheckedAt: new Date() });
  }
}

async function hydrateSubscriptionState(userId) {
  const user = await User.findById(userId);
  if (!user) return null;
  return syncUserSubscriptionState(user);
}

module.exports = {
  freePlanPatch,
  localPaidPatch,
  stripeSubscriptionPatch,
  syncUserSubscriptionState,
  hydrateSubscriptionState,
};
