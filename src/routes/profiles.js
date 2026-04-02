const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const FounderProfile = require('../models/FounderProfile');
const InvestorProfile = require('../models/InvestorProfile');

const router = express.Router();

router.use(requireAuth);

router.get('/founder', async (req, res, next) => {
  try {
    if (req.user.role !== 'founder') return res.status(403).json({ error: 'Founder role required' });
    const profile = await FounderProfile.findOne({ userId: req.user.id }).lean();
    res.json({ profile });
  } catch (e) {
    next(e);
  }
});

router.put(
  '/founder',
  body('startupName').optional().isString(),
  async (req, res, next) => {
    try {
      if (req.user.role !== 'founder') return res.status(403).json({ error: 'Founder role required' });
      const u = await User.findById(req.user.id);
      let profile = await FounderProfile.findOne({ userId: req.user.id });
      const data = req.body;
      if (!profile) {
        profile = await FounderProfile.create({ userId: req.user.id, ...sanitizeFounder(data) });
        u.founderProfileId = profile._id;
        await u.save();
      } else {
        Object.assign(profile, sanitizeFounder(data));
        await profile.save();
      }
      res.json({ profile: profile.toObject() });
    } catch (e) {
      next(e);
    }
  }
);

router.get('/investor', async (req, res, next) => {
  try {
    if (req.user.role !== 'investor') return res.status(403).json({ error: 'Investor role required' });
    const profile = await InvestorProfile.findOne({ userId: req.user.id }).lean();
    res.json({ profile });
  } catch (e) {
    next(e);
  }
});

router.put(
  '/investor',
  async (req, res, next) => {
    try {
      if (req.user.role !== 'investor') return res.status(403).json({ error: 'Investor role required' });
      const u = await User.findById(req.user.id);
      let profile = await InvestorProfile.findOne({ userId: req.user.id });
      const data = req.body;
      if (!profile) {
        profile = await InvestorProfile.create({ userId: req.user.id, ...sanitizeInvestor(data) });
        u.investorProfileId = profile._id;
        await u.save();
      } else {
        Object.assign(profile, sanitizeInvestor(data));
        await profile.save();
      }
      res.json({ profile: profile.toObject() });
    } catch (e) {
      next(e);
    }
  }
);

function sanitizeFounder(b) {
  const allowed = [
    'startupName',
    'logoUrl',
    'bannerUrl',
    'sector',
    'stage',
    'pitchDeckURL',
    'onePagerUrl',
    'tractionMetrics',
    'fundingRequested',
    'location',
    'teamInfo',
    'techStack',
    'targetInvestorTypes',
  ];
  const o = {};
  for (const k of allowed) if (b[k] !== undefined) o[k] = b[k];
  return o;
}

function sanitizeInvestor(b) {
  const allowed = [
    'brandName',
    'logoUrl',
    'investmentFocusStages',
    'industries',
    'checkSizeMin',
    'checkSizeMax',
    'geography',
    'preferences',
    'portfolioHighlights',
    'website',
    'socialLinks',
  ];
  const o = {};
  for (const k of allowed) if (b[k] !== undefined) o[k] = b[k];
  return o;
}

module.exports = router;
