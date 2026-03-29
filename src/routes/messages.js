const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { notify } = require('../services/notificationService');
const { joinUsersToRoom, emitNewChatMessage } = require('../realtime');
const { parsePaginationQuery, paginationMeta } = require('../utils/pagination');
const { peerDisplayName } = require('../utils/peerDisplayName');

const router = express.Router();
router.use(requireAuth);

function ensureParticipant(conv, userId) {
  return conv.participants.some((p) => p.toString() === userId);
}

const PARTICIPANT_POPULATE = {
  path: 'participants',
  select: 'name email role founderProfileId investorProfileId',
  populate: [
    { path: 'investorProfileId', select: 'brandName' },
    { path: 'founderProfileId', select: 'startupName' },
  ],
};

router.get('/rooms', async (req, res, next) => {
  try {
    const filter = { participants: req.user.id };
    const { page, limit, skip } = parsePaginationQuery(req.query, { defaultLimit: 30, maxLimit: 100 });
    const total = await Conversation.countDocuments(filter);
    const rooms = await Conversation.find(filter)
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate(PARTICIPANT_POPULATE)
      .lean();
    const uid = String(req.user.id);
    const enriched = rooms.map((r) => {
      const peer = (r.participants || []).find((p) => String(p._id) !== uid);
      return {
        ...r,
        peerName: peerDisplayName(peer),
        peerEmail: peer?.email || '',
        peerId: peer?._id || null,
      };
    });
    res.json({ rooms: enriched, pagination: paginationMeta(page, limit, total) });
  } catch (e) {
    next(e);
  }
});

router.post('/rooms', body('otherUserId').notEmpty(), async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { otherUserId } = req.body;
    if (otherUserId === req.user.id) return res.status(400).json({ error: 'Invalid participant' });
    let conv = await Conversation.findOne({
      participants: { $all: [req.user.id, otherUserId], $size: 2 },
    });
    if (!conv) {
      conv = await Conversation.create({ participants: [req.user.id, otherUserId] });
    }
    joinUsersToRoom(conv._id.toString(), [req.user.id, otherUserId]);
    res.json({ room: conv.toObject() });
  } catch (e) {
    next(e);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { roomId } = req.query;
    if (!roomId) return res.status(400).json({ error: 'roomId required' });
    const conv = await Conversation.findById(roomId);
    if (!conv || !ensureParticipant(conv, req.user.id)) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const { page, limit } = parsePaginationQuery(req.query, { defaultLimit: 50, maxLimit: 100 });
    const total = await Message.countDocuments({ roomId });
    const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
    const effectivePage = Math.min(Math.max(1, page), totalPages);
    const skipFromStart = Math.max(0, total - effectivePage * limit);
    const messages = await Message.find({ roomId })
      .sort({ createdAt: 1 })
      .skip(skipFromStart)
      .limit(limit)
      .lean();
    const hasOlder = skipFromStart > 0;
    res.json({
      messages,
      pagination: {
        ...paginationMeta(effectivePage, limit, total),
        hasOlder,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  body('roomId').notEmpty(),
  body('text').optional().isString(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { roomId, text, attachments } = req.body;
      const conv = await Conversation.findById(roomId);
      if (!conv || !ensureParticipant(conv, req.user.id)) {
        return res.status(404).json({ error: 'Room not found' });
      }
      const msg = await Message.create({
        roomId,
        senderId: req.user.id,
        text: text || '',
        attachments: attachments || [],
      });
      conv.lastMessageAt = new Date();
      await conv.save();
      const other = conv.participants.find((p) => p.toString() !== req.user.id);
      if (other) {
        await notify(other, 'new_message', 'New message in MatchFund', msg._id);
      }
      const participantIds = conv.participants.map((p) => p.toString());
      emitNewChatMessage(roomId, participantIds, msg);
      res.status(201).json({ message: msg.toObject() });
    } catch (e) {
      next(e);
    }
  }
);

router.patch('/:messageId/read', async (req, res, next) => {
  try {
    const msg = await Message.findById(req.params.messageId);
    if (!msg) return res.status(404).json({ error: 'Not found' });
    const conv = await Conversation.findById(msg.roomId);
    if (!conv || !ensureParticipant(conv, req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!msg.readBy.map((id) => id.toString()).includes(req.user.id)) {
      msg.readBy.push(req.user.id);
      await msg.save();
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
