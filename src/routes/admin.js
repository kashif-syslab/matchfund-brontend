const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const User = require('../models/User');
const FounderProfile = require('../models/FounderProfile');
const InvestorProfile = require('../models/InvestorProfile');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'moderator'));

router.get('/pending-profiles', async (req, res, next) => {
  try {
    const founders = await FounderProfile.find({ adminApproved: false }).populate('userId').lean();
    const investors = await InvestorProfile.find({ adminApproved: false }).populate('userId').lean();
    res.json({ founders, investors });
  } catch (e) {
    next(e);
  }
});

router.post('/approve/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const u = await User.findById(userId);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (u.role === 'founder') {
      await FounderProfile.findOneAndUpdate({ userId }, { adminApproved: true });
    } else if (u.role === 'investor') {
      await InvestorProfile.findOneAndUpdate({ userId }, { adminApproved: true });
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/ban/:userId', async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.params.userId, { isBanned: true });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/flag/:type/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params;
    if (type === 'founder') await FounderProfile.findByIdAndUpdate(id, { flagged: true });
    else if (type === 'investor') await InvestorProfile.findByIdAndUpdate(id, { flagged: true });
    else return res.status(400).json({ error: 'Invalid type' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/export-summary', async (req, res, next) => {
  try {
    const users = await User.countDocuments();
    const founders = await User.countDocuments({ role: 'founder' });
    const investors = await User.countDocuments({ role: 'investor' });
    res.json({ exportedAt: new Date().toISOString(), users, founders, investors });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
