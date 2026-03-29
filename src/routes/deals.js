const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const Deal = require('../models/Deal');
const { notify } = require('../services/notificationService');
const { roleMayEditField, permissionMatrix } = require('../config/dealFieldPermissions');
const { parsePaginationQuery, paginationMeta } = require('../utils/pagination');

const router = express.Router();
router.use(requireAuth);

const POPULATE_DEAL_PARTIES = [
  {
    path: 'founderId',
    select: 'name email role founderProfileId investorProfileId',
    populate: [
      { path: 'founderProfileId', select: 'startupName' },
      { path: 'investorProfileId', select: 'brandName' },
    ],
  },
  {
    path: 'investorId',
    select: 'name email role founderProfileId investorProfileId',
    populate: [
      { path: 'founderProfileId', select: 'startupName' },
      { path: 'investorProfileId', select: 'brandName' },
    ],
  },
];

const MAX_ACTIVITY = 50;

/** ObjectId or populated { _id, ... } — safe string for access checks. */
function refIdString(ref) {
  if (ref == null) return '';
  if (typeof ref === 'object' && ref._id != null) return String(ref._id);
  return String(ref);
}

function stableJson(obj) {
  try {
    return JSON.stringify(obj === undefined ? null : JSON.parse(JSON.stringify(obj)));
  } catch {
    return JSON.stringify(obj);
  }
}

function diffField(oldVal, newVal) {
  return stableJson(oldVal) !== stableJson(newVal);
}

router.get('/', async (req, res, next) => {
  try {
    const q = {
      $or: [{ founderId: req.user.id }, { investorId: req.user.id }],
    };
    const { page, limit, skip } = parsePaginationQuery(req.query, { defaultLimit: 12, maxLimit: 50 });
    const total = await Deal.countDocuments(q);
    const deals = await Deal.find(q)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate(POPULATE_DEAL_PARTIES[0])
      .populate(POPULATE_DEAL_PARTIES[1])
      .lean();
    res.json({ deals, pagination: paginationMeta(page, limit, total) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const deal = await Deal.findById(id)
      .populate(POPULATE_DEAL_PARTIES[0])
      .populate(POPULATE_DEAL_PARTIES[1])
      .populate('activityLog.userId', 'name email')
      .lean();
    if (!deal) return res.status(404).json({ error: 'Not found' });
    const uid = String(req.user.id);
    if (refIdString(deal.founderId) !== uid && refIdString(deal.investorId) !== uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const role = req.user.role === 'founder' || req.user.role === 'investor' ? req.user.role : null;
    res.json({
      deal,
      permissions: permissionMatrix(),
      editorRole: role,
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  body('counterpartyId').notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { counterpartyId, status, milestones, expectedFunding, fundingTerms, notes } = req.body;
      let founderId;
      let investorId;
      if (req.user.role === 'founder') {
        founderId = req.user.id;
        investorId = counterpartyId;
      } else if (req.user.role === 'investor') {
        investorId = req.user.id;
        founderId = counterpartyId;
      } else {
        return res.status(403).json({ error: 'Founder or investor only' });
      }

      const existing = await Deal.findOne({ founderId, investorId });
      if (existing) {
        const populated = await Deal.findById(existing._id)
          .populate(POPULATE_DEAL_PARTIES[0])
          .populate(POPULATE_DEAL_PARTIES[1])
          .lean();
        return res.status(200).json({ deal: populated, existing: true });
      }

      const deal = await Deal.create({
        founderId,
        investorId,
        status: status || 'open',
        milestones: milestones || [],
        expectedFunding: expectedFunding || 0,
        fundingTerms: fundingTerms || '',
        notes: notes || '',
      });
      await notify(counterpartyId, 'deal_update', 'New deal room opened', deal._id);
      const populated = await Deal.findById(deal._id)
        .populate(POPULATE_DEAL_PARTIES[0])
        .populate(POPULATE_DEAL_PARTIES[1])
        .lean();
      res.status(201).json({ deal: populated, existing: false });
    } catch (e) {
      next(e);
    }
  }
);

router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const deal = await Deal.findById(id);
    if (!deal) return res.status(404).json({ error: 'Not found' });
    const uid = req.user.id;
    if (deal.founderId.toString() !== uid && deal.investorId.toString() !== uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const role = req.user.role;
    if (role !== 'founder' && role !== 'investor') {
      return res.status(403).json({ error: 'Founder or investor only' });
    }

    const body = req.body || {};
    const allowedKeys = ['status', 'milestones', 'expectedFunding', 'fundingTerms', 'notes', 'investorNotes', 'documents'];
    const changedFields = [];

    for (const key of Object.keys(body)) {
      if (!allowedKeys.includes(key)) continue;
      if (body[key] === undefined) continue;
      if (!roleMayEditField(role, key)) {
        return res.status(403).json({
          error: `Your role (${role}) cannot edit "${key}".`,
          permissions: permissionMatrix(),
        });
      }
    }

    if (body.status !== undefined) {
      if (diffField(deal.status, body.status)) changedFields.push('status');
      deal.status = body.status;
    }
    if (body.milestones !== undefined) {
      if (diffField(deal.milestones, body.milestones)) changedFields.push('milestones');
      deal.milestones = body.milestones;
    }
    if (body.expectedFunding !== undefined) {
      if (diffField(deal.expectedFunding, body.expectedFunding)) changedFields.push('expectedFunding');
      deal.expectedFunding = body.expectedFunding;
    }
    if (body.fundingTerms !== undefined) {
      if (diffField(deal.fundingTerms, body.fundingTerms)) changedFields.push('fundingTerms');
      deal.fundingTerms = body.fundingTerms;
    }
    if (body.notes !== undefined) {
      if (diffField(deal.notes, body.notes)) changedFields.push('notes');
      deal.notes = body.notes;
    }
    if (body.investorNotes !== undefined) {
      if (diffField(deal.investorNotes, body.investorNotes)) changedFields.push('investorNotes');
      deal.investorNotes = body.investorNotes;
    }
    if (body.documents !== undefined) {
      if (diffField(deal.documents, body.documents)) changedFields.push('documents');
      deal.documents = body.documents;
    }

    if (changedFields.length > 0) {
      deal.activityLog.push({
        userId: uid,
        editorRole: role,
        fields: changedFields,
        at: new Date(),
      });
      if (deal.activityLog.length > MAX_ACTIVITY) {
        deal.activityLog = deal.activityLog.slice(-MAX_ACTIVITY);
      }
    }

    await deal.save();
    const other = deal.founderId.toString() === uid ? deal.investorId : deal.founderId;
    await notify(other, 'deal_update', 'Deal room updated', deal._id);

    const out = await Deal.findById(deal._id)
      .populate(POPULATE_DEAL_PARTIES[0])
      .populate(POPULATE_DEAL_PARTIES[1])
      .populate('activityLog.userId', 'name email')
      .lean();

    res.json({ deal: out, permissions: permissionMatrix(), editorRole: role });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
