const express = require('express');
const { requireAuth } = require('../middleware/auth');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { isPushConfigured } = require('../services/pushService');
const { parsePaginationQuery, paginationMeta } = require('../utils/pagination');

const router = express.Router();

/** Public: browser needs this to subscribe (no auth). */
router.get('/push/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Web Push not configured (set VAPID keys)' });
  res.json({ publicKey: key });
});

router.use(requireAuth);

router.get('/meta', async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({ userId: req.user.id, readAt: null });
    res.json({ unreadCount });
  } catch (e) {
    next(e);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const filter = { userId: req.user.id };
    const { page, limit, skip } = parsePaginationQuery(req.query, { defaultLimit: 20, maxLimit: 100 });
    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ ...filter, readAt: null });
    const list = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    res.json({
      notifications: list,
      pagination: paginationMeta(page, limit, total),
      unreadCount,
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/read-all', async (req, res, next) => {
  try {
    await Notification.updateMany(
      { userId: req.user.id, readAt: null },
      { $set: { readAt: new Date() } }
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    const n = await Notification.findOne({ _id: req.params.id, userId: req.user.id });
    if (!n) return res.status(404).json({ error: 'Not found' });
    n.readAt = new Date();
    await n.save();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** Body: { subscription: PushSubscription JSON from the browser } */
router.post('/push/subscribe', async (req, res, next) => {
  try {
    if (!isPushConfigured()) return res.status(503).json({ error: 'Web Push not configured' });
    const sub = req.body?.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    const entry = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      createdAt: new Date(),
    };
    await User.updateOne({ _id: req.user.id }, { $pull: { pushSubscriptions: { endpoint: sub.endpoint } } });
    await User.updateOne({ _id: req.user.id }, { $push: { pushSubscriptions: entry } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** Body: { endpoint } to remove one subscription, or omit to clear all */
router.delete('/push/subscribe', async (req, res, next) => {
  try {
    const endpoint = req.body?.endpoint;
    if (endpoint) {
      await User.updateOne({ _id: req.user.id }, { $pull: { pushSubscriptions: { endpoint } } });
    } else {
      await User.updateOne({ _id: req.user.id }, { $set: { pushSubscriptions: [] } });
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
