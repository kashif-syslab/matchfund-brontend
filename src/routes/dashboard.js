const express = require('express');
const { requireAuth } = require('../middleware/auth');
const Match = require('../models/Match');
const Conversation = require('../models/Conversation');
const FounderProfile = require('../models/FounderProfile');
const InvestorProfile = require('../models/InvestorProfile');
const Deal = require('../models/Deal');
const User = require('../models/User');
const { peerDisplayName } = require('../utils/peerDisplayName');

const router = express.Router();

const POPULATE_DEAL_USER = {
  select: 'name email role founderProfileId investorProfileId',
  populate: [
    { path: 'founderProfileId', select: 'startupName' },
    { path: 'investorProfileId', select: 'brandName' },
  ],
};
router.use(requireAuth);

function profileCompleteness(fp) {
  if (!fp) return 0;
  const fields = [
    'startupName',
    'sector',
    'stage',
    'pitchDeckURL',
    'location',
    'teamInfo',
    'fundingRequested',
  ];
  let done = 0;
  for (const f of fields) {
    const v = fp[f];
    if (v !== undefined && v !== null && String(v).trim() !== '' && v !== 0) done += 1;
  }
  return Math.round((done / fields.length) * 100);
}

function investorCompleteness(ip) {
  if (!ip) return 0;
  const fields = ['brandName', 'industries', 'investmentFocusStages', 'checkSizeMax', 'geography'];
  let done = 0;
  for (const f of fields) {
    const v = ip[f];
    if (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '' && v !== 0) {
      done += 1;
    }
  }
  return Math.round((done / fields.length) * 100);
}

router.get('/founder', async (req, res, next) => {
  try {
    if (req.user.role !== 'founder') return res.status(403).json({ error: 'Founder only' });
    const [matchCount, openConvs, deals, fp] = await Promise.all([
      Match.countDocuments({ founderId: req.user.id }),
      Conversation.countDocuments({ participants: req.user.id }),
      Deal.find({ founderId: req.user.id }).populate({ path: 'investorId', ...POPULATE_DEAL_USER }).lean(),
      FounderProfile.findOne({ userId: req.user.id }).lean(),
    ]);
    const convs = await Conversation.find({ participants: req.user.id }).select('_id').lean();
    const roomIds = convs.map((c) => c._id);
    const Message = require('../models/Message');
    const recentInbound = await Message.countDocuments({
      roomId: { $in: roomIds },
      senderId: { $ne: req.user.id },
    });
    res.json({
      matchedInvestors: matchCount,
      openConversations: openConvs,
      profileCompleteness: profileCompleteness(fp),
      engagementMetrics: { inboundMessages: recentInbound },
      fundingStatus: deals.map((d) => ({
        id: d._id,
        status: d.status,
        expectedFunding: d.expectedFunding,
        counterpartyLabel: peerDisplayName(d.investorId),
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/investor', async (req, res, next) => {
  try {
    if (req.user.role !== 'investor') return res.status(403).json({ error: 'Investor only' });
    const [matchCount, openConvs, deals, ip] = await Promise.all([
      Match.countDocuments({ investorId: req.user.id }),
      Conversation.countDocuments({ participants: req.user.id }),
      Deal.find({ investorId: req.user.id }).populate({ path: 'founderId', ...POPULATE_DEAL_USER }).lean(),
      InvestorProfile.findOne({ userId: req.user.id }).lean(),
    ]);
    res.json({
      matchedStartups: matchCount,
      openConversations: openConvs,
      profileCompleteness: investorCompleteness(ip),
      dealPipeline: deals.map((d) => ({
        id: d._id,
        status: d.status,
        counterpartyLabel: peerDisplayName(d.founderId),
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/admin', async (req, res, next) => {
  try {
    if (!['admin', 'moderator'].includes(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const mau = await User.countDocuments({
      updatedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });
    const pendingFounders = await FounderProfile.countDocuments({ adminApproved: false });
    const pendingInvestors = await InvestorProfile.countDocuments({ adminApproved: false });
    res.json({
      platformMetrics: { mauApprox: mau },
      approvalsQueue: { founders: pendingFounders, investors: pendingInvestors },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
