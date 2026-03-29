const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const { getPlansCatalogForClient, getPlanConfig, resolveStripePriceId } = require('../config/subscriptionPlans');

const router = express.Router();

/** Catalog is hardcoded in `config/subscriptionPlans.js` — safe to expose to the signed-in client. */
router.get('/plans', requireAuth, (req, res) => {
  res.json({
    plans: getPlansCatalogForClient(),
    currentPlan: req.userDoc.subscriptionPlan || 'free',
  });
});

router.use(requireAuth);

router.post(
  '/subscribe',
  body('plan').isIn(['free', 'starter', 'pro', 'enterprise']),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { plan } = req.body;
      getPlanConfig(plan);

      if (plan === 'free') {
        await User.findByIdAndUpdate(req.user.id, { subscriptionPlan: 'free' });
        return res.json({ ok: true, subscriptionPlan: 'free', checkoutUrl: null });
      }

      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        await User.findByIdAndUpdate(req.user.id, { subscriptionPlan: plan });
        return res.json({
          ok: true,
          subscriptionPlan: plan,
          checkoutUrl: null,
          note: 'Stripe not configured; plan updated locally for development.',
        });
      }

      const priceId = resolveStripePriceId(plan);
      if (!priceId) {
        if (plan === 'enterprise') {
          return res.status(501).json({
            error:
              'Enterprise checkout is not configured. Set STRIPE_PRICE_ENTERPRISE in .env or contact sales.',
          });
        }
        return res.status(501).json({ error: 'Stripe price ID not configured for this plan (check .env).' });
      }

      const Stripe = require('stripe');
      const stripe = Stripe(stripeKey);
      const u = await User.findById(req.user.id);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.CLIENT_ORIGIN}/billing?success=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_ORIGIN}/billing`,
        customer_email: u.email,
        metadata: { userId: u._id.toString(), plan },
      });
      res.json({ checkoutUrl: session.url, subscriptionPlan: u.subscriptionPlan });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * After Stripe Checkout redirect, the client sends the session id; we verify with Stripe
 * and set subscriptionPlan from session metadata (no Stripe Dashboard webhook required).
 */
router.post(
  '/complete-checkout',
  body('sessionId').isString().trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        return res.status(503).json({ error: 'Stripe is not configured.' });
      }

      const sessionId = String(req.body.sessionId).trim();
      // Stripe IDs look like cs_test_51AbC... (underscores after mode, not only cs_ + alnum)
      if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
        return res.status(400).json({ error: 'Invalid session id.' });
      }

      const Stripe = require('stripe');
      const stripe = Stripe(stripeKey);
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.status !== 'complete') {
        return res.status(400).json({ error: 'Checkout is not complete yet.' });
      }

      const metaUserId = session.metadata && session.metadata.userId;
      const plan = session.metadata && session.metadata.plan;
      if (!metaUserId || !plan) {
        return res.status(400).json({ error: 'Session is missing subscription metadata.' });
      }
      if (metaUserId !== req.user.id) {
        return res.status(403).json({ error: 'This checkout session does not belong to the signed-in user.' });
      }

      if (!['starter', 'pro', 'enterprise'].includes(plan)) {
        return res.status(400).json({ error: 'Invalid plan on checkout session.' });
      }
      getPlanConfig(plan);

      const paidOk =
        session.payment_status === 'paid' ||
        session.payment_status === 'no_payment_required';
      if (!paidOk) {
        return res.status(400).json({ error: 'Payment has not completed for this session.' });
      }

      await User.findByIdAndUpdate(req.user.id, { subscriptionPlan: plan });
      const u = await User.findById(req.user.id).select('subscriptionPlan');
      res.json({ ok: true, subscriptionPlan: u.subscriptionPlan });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
