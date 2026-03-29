const { Server } = require('socket.io');
const { verifyAccess } = require('./utils/jwt');
const Conversation = require('./models/Conversation');

let ioInstance = null;
/** @type {Map<string, Set<string>>} */
const userIdToSocketIds = new Map();

function trackSocket(userId, socket) {
  const key = String(userId);
  if (!userIdToSocketIds.has(key)) userIdToSocketIds.set(key, new Set());
  userIdToSocketIds.get(key).add(socket.id);
  socket.once('disconnect', () => {
    userIdToSocketIds.get(key)?.delete(socket.id);
    if (userIdToSocketIds.get(key)?.size === 0) userIdToSocketIds.delete(key);
  });
}

/**
 * Ensure all active connections for these users join the Socket.IO room for live `message:new` fan-out.
 */
function joinUsersToRoom(roomId, userIds) {
  const io = ioInstance;
  if (!io || !roomId || !userIds?.length) return;
  const room = `room:${roomId}`;
  const { sockets } = io.sockets;
  for (const raw of userIds) {
    const set = userIdToSocketIds.get(String(raw));
    if (!set) continue;
    for (const sid of set) {
      sockets.get(sid)?.join(room);
    }
  }
}

/**
 * Notify both participants: new message + optional room-list refresh hint.
 */
function emitNewChatMessage(roomId, participantIds, messageDoc) {
  const io = ioInstance;
  if (!io) return;
  const rid = String(roomId);
  const msg = typeof messageDoc.toObject === 'function' ? messageDoc.toObject() : messageDoc;
  for (const pid of participantIds) {
    const id = String(pid);
    io.to(`user:${id}`).emit('message:new', { roomId: rid, message: msg });
    io.to(`user:${id}`).emit('messages:rooms_changed', { roomId: rid });
  }
}

function initRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
      credentials: true,
    },
    path: '/socket.io',
  });

  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (typeof socket.handshake.headers?.authorization === 'string'
          ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
          : null);
      if (!token) return next(new Error('Unauthorized'));
      const payload = verifyAccess(token);
      socket.userId = String(payload.sub);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const uid = socket.userId;
    trackSocket(uid, socket);
    socket.join(`user:${uid}`);

    try {
      const convs = await Conversation.find({ participants: uid }).select('_id').lean();
      for (const c of convs) {
        socket.join(`room:${c._id}`);
      }
    } catch (e) {
      console.warn('[socket] join rooms:', e.message);
    }

    socket.on('chat:join', async (roomId, cb) => {
      try {
        if (!roomId) {
          cb?.({ error: 'roomId required' });
          return;
        }
        const conv = await Conversation.findById(roomId);
        if (!conv || !conv.participants.some((p) => p.toString() === uid)) {
          cb?.({ error: 'Forbidden' });
          return;
        }
        socket.join(`room:${roomId}`);
        cb?.({ ok: true });
      } catch (e) {
        cb?.({ error: e.message });
      }
    });
  });

  ioInstance = io;
  return io;
}

function getIo() {
  return ioInstance;
}

module.exports = {
  initRealtime,
  getIo,
  joinUsersToRoom,
  emitNewChatMessage,
};
