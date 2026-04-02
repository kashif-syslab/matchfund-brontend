const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/jwt');
const { requireAuth } = require('../middleware/auth');
const { isSmtpConfigured, sendVerificationEmail } = require('../services/emailService');
const { syncUserSubscriptionState } = require('../services/subscriptionService');

const router = express.Router();

const SALT = 12;

async function pushRefreshToken(userId, token) {
  await User.findByIdAndUpdate(userId, {
    $push: { refreshTokens: { $each: [{ token }], $slice: -10 } },
  });
}

function serializeUser(user) {
  return {
    id: user._id,
    email: user.email,
    name: user.name,
    role: user.role,
    subscriptionPlan: user.subscriptionPlan,
    subscriptionStatus: user.subscriptionStatus,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
    emailVerified: user.emailVerified,
  };
}

router.post(
  '/signup',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { email, password, name } = req.body;
      const exists = await User.findOne({ email });
      if (exists) return res.status(409).json({ error: 'Email already registered' });
      const passwordHash = await bcrypt.hash(password, SALT);
      const emailVerifyToken = uuidv4();
      const user = await User.create({
        email,
        passwordHash,
        name,
        role: 'pending',
        emailVerifyToken,
        emailVerified: process.env.SKIP_EMAIL_VERIFY === 'true',
      });
      if (!user.emailVerified && isSmtpConfigured()) {
        await sendVerificationEmail(user.email, emailVerifyToken).catch((err) => {
          console.error('[email] verification send failed:', err.message);
        });
      }
      const access = signAccess({ sub: user._id.toString(), role: user.role });
      const refresh = signRefresh({ sub: user._id.toString() });
      await pushRefreshToken(user._id, refresh);
      res.status(201).json({
        user: serializeUser(user),
        accessToken: access,
        refreshToken: refresh,
        emailVerifyToken: process.env.NODE_ENV === 'development' ? emailVerifyToken : undefined,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { email, password } = req.body;
      let user = await User.findOne({ email });
      if (!user || !user.passwordHash) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      if (user.isBanned) return res.status(403).json({ error: 'Account suspended' });
      user = await syncUserSubscriptionState(user);
      const access = signAccess({ sub: user._id.toString(), role: user.role });
      const refresh = signRefresh({ sub: user._id.toString() });
      await pushRefreshToken(user._id, refresh);
      res.json({
        user: serializeUser(user),
        accessToken: access,
        refreshToken: refresh,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.post('/refresh', body('refreshToken').notEmpty(), async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { refreshToken } = req.body;
    let payload;
    try {
      payload = verifyRefresh(refreshToken);
    } catch {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    let user = await User.findById(payload.sub);
    if (!user || user.isBanned) return res.status(401).json({ error: 'Unauthorized' });
    user = await syncUserSubscriptionState(user);
    const has = user.refreshTokens.some((r) => r.token === refreshToken);
    if (!has) return res.status(401).json({ error: 'Invalid refresh token' });
    const access = signAccess({ sub: user._id.toString(), role: user.role });
    res.json({ accessToken: access });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/choose-role',
  requireAuth,
  body('role').isIn(['founder', 'investor']),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      if (req.user.role !== 'pending') {
        return res.status(400).json({ error: 'Account type is already set' });
      }
      const user = await User.findById(req.user.id);
      if (!user || user.isBanned) return res.status(401).json({ error: 'Unauthorized' });
      user.role = req.body.role;
      await user.save();
      const access = signAccess({ sub: user._id.toString(), role: user.role });
      const refresh = signRefresh({ sub: user._id.toString() });
      await pushRefreshToken(user._id, refresh);
      res.json({
        user: serializeUser(user),
        accessToken: access,
        refreshToken: refresh,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.post('/logout', requireAuth, body('refreshToken').optional(), async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await User.findByIdAndUpdate(req.user.id, { $pull: { refreshTokens: { token: refreshToken } } });
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-passwordHash -refreshTokens -twoFactorSecret')
      .lean();
    res.json({ user });
  } catch (e) {
    next(e);
  }
});

router.post('/verify-email', body('token').notEmpty(), async (req, res, next) => {
  try {
    const { token } = req.body;
    const user = await User.findOne({ emailVerifyToken: token });
    if (!user) return res.status(400).json({ error: 'Invalid token' });
    user.emailVerified = true;
    user.emailVerifyToken = null;
    await user.save();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
