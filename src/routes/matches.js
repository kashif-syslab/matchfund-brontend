const express = require('express');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { getPlanConfig } = require('../config/subscriptionPlans');
const {
  assertRefreshAllowed,
  recordRefreshConsumed,
  assertFiltersAllowed,
  capMatches,
  getRefreshUsage,
  buildPlanUsagePayload,
} = require('../services/planEnforcement');
const {
  refreshMatchesForFounder,
  refreshMatchesForInvestor,
  listMatchesForUser,
} = require('../services/matchingService');
const Match = require('../models/Match');
const { notify } = require('../services/notificationService');
const { parsePaginationQuery, paginationMeta } = require('../utils/pagination');

const router = express.Router();
router.use(requireAuth);

async function runMatchQuery(req, res, doRefresh) {
  const userDoc = await User.findById(req.user.id).lean();
  if (!userDoc) return res.status(401).json({ error: 'Unauthorized' });

  const planConfig = getPlanConfig(userDoc.subscriptionPlan);
  const { sector, stage, checkMin, checkMax } = req.query;
  const filters = { sector, stage, checkMin, checkMax };

  assertFiltersAllowed(planConfig, req.query);

  if (doRefresh) {
    if (req.user.role === 'founder') {
      await assertRefreshAllowed(req.user.id);
      await refreshMatchesForFounder(req.user.id, filters);
      await recordRefreshConsumed(req.user.id);
    } else if (req.user.role === 'investor') {
      await assertRefreshAllowed(req.user.id);
      await refreshMatchesForInvestor(req.user.id, filters);
      await recordRefreshConsumed(req.user.id);
    } else {
      return res.status(403).json({ error: 'Founder or investor only' });
    }
  }

  let rows = await listMatchesForUser(req.user.id, req.user.role);
  if (sector) {
    const s = String(sector).toLowerCase();
    rows = rows.filter((m) => {
      if (req.user.role === 'investor') {
        const sec = (m.founderProfile?.sector || '').toLowerCase();
        return sec === s;
      }
      const ind = (m.investorProfile?.industries || []).map((x) => String(x).toLowerCase());
      return ind.includes(s);
    });
  }
  if (stage) {
    const st = String(stage).toLowerCase().trim();
    rows = rows.filter((m) => {
      if (req.user.role === 'investor') {
        return String(m.founderProfile?.stage || '').toLowerCase() === st;
      }
      return (m.investorProfile?.investmentFocusStages || [])
        .map((x) => String(x).toLowerCase())
        .includes(st);
    });
  }
  const minScore = req.query.minScore != null && req.query.minScore !== '' ? Number(req.query.minScore) : null;
  if (minScore != null && !Number.isNaN(minScore)) {
    rows = rows.filter((m) => m.score >= minScore);
  }

  const capResult = capMatches(rows, planConfig);
  const allRows = capResult.rows;
  const { page, limit, skip } = parsePaginationQuery(req.query, { defaultLimit: 12, maxLimit: 50 });
  const pagedMatches = allRows.slice(skip, skip + limit);
  const refreshUsage = await getRefreshUsage(req.user.id);
  const freshDoc = await User.findById(req.user.id).lean();

  res.json({
    matches: pagedMatches,
    pagination: paginationMeta(page, limit, allRows.length),
    planUsage: buildPlanUsagePayload(freshDoc || userDoc, refreshUsage, {
      rows: allRows,
      totalBeforeCap: capResult.totalBeforeCap,
      capped: capResult.capped,
    }),
  });
}

router.get('/', async (req, res, next) => {
  try {
    const doRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    await runMatchQuery(req, res, doRefresh);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    next(e);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const b = req.body || {};
    const fakeReq = {
      user: req.user,
      query: {
        refresh: 'true',
        sector: b.sector,
        stage: b.stage,
        checkMin: b.checkMin,
        checkMax: b.checkMax,
        minScore: b.minScore,
        page: b.page != null ? String(b.page) : '1',
        limit: b.limit != null ? String(b.limit) : undefined,
      },
    };
    await runMatchQuery(fakeReq, res, true);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    next(e);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['intro_requested', 'connected', 'declined', 'suggested'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const m = await Match.findById(req.params.id);
    if (!m) return res.status(404).json({ error: 'Not found' });
    const uid = req.user.id;
    if (m.founderId.toString() !== uid && m.investorId.toString() !== uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    m.status = status;
    await m.save();
    const other = m.founderId.toString() === uid ? m.investorId : m.founderId;
    await notify(other, 'admin', `Match status updated: ${status}`, m._id);
    res.json({ match: m.toObject() });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
