const crypto = require('crypto');
const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const { signAccess, signRefresh } = require('../utils/jwt');

const router = express.Router();

const LINKEDIN_AUTH = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_USERINFO = 'https://api.linkedin.com/v2/userinfo';

function pushRefresh(userId, token) {
  return User.findByIdAndUpdate(userId, {
    $push: { refreshTokens: { $each: [{ token }], $slice: -10 } },
  });
}

function oauthCookieOpts() {
  const prod = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    maxAge: 10 * 60 * 1000,
    sameSite: 'lax',
    secure: prod,
    path: '/',
  };
}

function suspendedRedirect(clientOrigin) {
  return `${clientOrigin}/auth/login?error=suspended`;
}

/**
 * Link or create user for Google / LinkedIn (email required).
 * New OAuth-only accounts start as `pending` until they choose founder/investor on the client.
 * @param {'google'|'linkedin'} provider
 */
async function upsertOAuthUser(provider, oauthId, email, displayName) {
  const emailNorm = (email || '').toLowerCase().trim();
  if (!emailNorm) {
    throw new Error('No email from OAuth provider');
  }

  let user = await User.findOne({ oauthProvider: provider, oauthId });
  if (user) {
    if (user.isBanned) {
      const err = new Error('Account suspended');
      err.code = 'ACCOUNT_SUSPENDED';
      throw err;
    }
    return user;
  }

  user = await User.findOne({ email: emailNorm });
  if (user) {
    if (user.isBanned) {
      const err = new Error('Account suspended');
      err.code = 'ACCOUNT_SUSPENDED';
      throw err;
    }
    user.oauthProvider = provider;
    user.oauthId = oauthId;
    user.emailVerified = true;
    await user.save();
    return user;
  }

  return User.create({
    email: emailNorm,
    name: displayName || emailNorm.split('@')[0],
    role: 'pending',
    passwordHash: '',
    oauthProvider: provider,
    oauthId,
    emailVerified: true,
  });
}

function configureGoogle() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const base = process.env.OAUTH_CALLBACK_BASE || `http://localhost:${process.env.PORT || 5000}`;
  if (!id || !secret) return;
  passport.use(
    new GoogleStrategy(
      {
        clientID: id,
        clientSecret: secret,
        callbackURL: `${base}/auth/google/callback`,
        passReqToCallback: true,
      },
      async (req, _accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          const user = await upsertOAuthUser('google', profile.id, email, profile.displayName);
          return done(null, user);
        } catch (e) {
          done(e);
        }
      }
    )
  );
}

configureGoogle();

function redirectTokens(res, user) {
  const access = signAccess({ sub: user._id.toString(), role: user.role });
  const refresh = signRefresh({ sub: user._id.toString() });
  return pushRefresh(user._id, refresh).then(() => {
    const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
    const redirect = `${clientOrigin}/auth/callback?access=${encodeURIComponent(access)}&refresh=${encodeURIComponent(refresh)}`;
    res.redirect(redirect);
  });
}

router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(501).json({ error: 'Google OAuth not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)' });
  }
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

router.get(
  '/google/callback',
  (req, res, next) => {
    passport.authenticate('google', { session: false, failureRedirect: false })(req, res, next);
  },
  async (req, res) => {
    try {
      const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
      const user = req.user;
      if (!user) {
        return res.redirect(`${clientOrigin}/auth/login?error=oauth`);
      }
      if (user.isBanned) {
        return res.redirect(suspendedRedirect(clientOrigin));
      }
      await redirectTokens(res, user);
    } catch (e) {
      const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
      if (e?.code === 'ACCOUNT_SUSPENDED') {
        return res.redirect(suspendedRedirect(clientOrigin));
      }
      res.redirect(`${clientOrigin}/auth/login?error=oauth`);
    }
  }
);

router.get('/linkedin', (req, res) => {
  const id = process.env.LINKEDIN_CLIENT_ID;
  const secret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!id || !secret) {
    return res.status(501).json({
      error: 'LinkedIn OAuth not configured (set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET)',
    });
  }

  const base = process.env.OAUTH_CALLBACK_BASE || `http://localhost:${process.env.PORT || 5000}`;
  const redirectUri = `${base}/auth/linkedin/callback`;
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie('li_oauth_state', state, oauthCookieOpts());

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: redirectUri,
    state,
    scope: 'openid profile email',
  });
  res.redirect(`${LINKEDIN_AUTH}?${params.toString()}`);
});

router.get('/linkedin/callback', async (req, res) => {
  const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
  const { code, state, error, error_description: errorDesc } = req.query;

  const cookieState = req.cookies?.li_oauth_state;

  res.clearCookie('li_oauth_state', { path: '/' });

  if (error) {
    return res.redirect(
      `${clientOrigin}/auth/login?error=linkedin&reason=${encodeURIComponent(errorDesc || String(error))}`
    );
  }

  if (!code || !state || !cookieState || state !== cookieState) {
    return res.redirect(`${clientOrigin}/auth/login?error=oauth`);
  }

  const id = process.env.LINKEDIN_CLIENT_ID;
  const secret = process.env.LINKEDIN_CLIENT_SECRET;
  const base = process.env.OAUTH_CALLBACK_BASE || `http://localhost:${process.env.PORT || 5000}`;
  const redirectUri = `${base}/auth/linkedin/callback`;

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: redirectUri,
      client_id: id,
      client_secret: secret,
    });

    const tokenRes = await fetch(LINKEDIN_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      console.error('[oauth] LinkedIn token error:', tokenJson);
      return res.redirect(`${clientOrigin}/auth/login?error=linkedin_token`);
    }

    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      return res.redirect(`${clientOrigin}/auth/login?error=linkedin_token`);
    }

    const profileRes = await fetch(LINKEDIN_USERINFO, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await profileRes.json().catch(() => ({}));
    if (!profileRes.ok) {
      console.error('[oauth] LinkedIn userinfo error:', profile);
      return res.redirect(`${clientOrigin}/auth/login?error=linkedin_profile`);
    }

    const oauthId = profile.sub;
    const email = (profile.email || '').toLowerCase().trim();
    const displayName = profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ').trim();

    const user = await upsertOAuthUser('linkedin', oauthId, email, displayName);
    if (user.isBanned) {
      return res.redirect(suspendedRedirect(clientOrigin));
    }
    await redirectTokens(res, user);
  } catch (e) {
    console.error('[oauth] LinkedIn callback:', e);
    if (e?.code === 'ACCOUNT_SUSPENDED') {
      return res.redirect(suspendedRedirect(clientOrigin));
    }
    res.redirect(`${clientOrigin}/auth/login?error=oauth`);
  }
});

module.exports = router;
