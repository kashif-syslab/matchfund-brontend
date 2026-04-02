const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: '' },
    name: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: ['pending', 'founder', 'investor', 'admin', 'moderator'],
      required: true,
    },
    founderProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FounderProfile', default: null },
    investorProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'InvestorProfile', default: null },
    subscriptionPlan: {
      type: String,
      enum: ['free', 'starter', 'pro', 'enterprise'],
      default: 'free',
    },
    subscriptionStatus: {
      type: String,
      enum: ['free', 'manual', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired'],
      default: 'free',
    },
    subscriptionExpiresAt: { type: Date, default: null },
    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    subscriptionCheckedAt: { type: Date, default: null },
    emailVerified: { type: Boolean, default: false },
    emailVerifyToken: { type: String, default: null },
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, default: null },
    accreditationVerified: { type: Boolean, default: false },
    oauthProvider: { type: String, enum: ['google', 'linkedin', null], default: null },
    oauthId: { type: String, default: null },
    isBanned: { type: Boolean, default: false },
    refreshTokens: [{ token: String, createdAt: { type: Date, default: Date.now } }],
    /** UTC month key `YYYY-MM` for match recompute quota (see subscriptionPlans.js). */
    billingPeriodKey: { type: String, default: '' },
    matchRefreshCount: { type: Number, default: 0 },
    /** Browser Web Push subscriptions (VAPID). */
    pushSubscriptions: [
      {
        endpoint: { type: String, required: true },
        keys: {
          p256dh: { type: String, required: true },
          auth: { type: String, required: true },
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

userSchema.index({ oauthProvider: 1, oauthId: 1 }, { sparse: true });

module.exports = mongoose.model('User', userSchema);
