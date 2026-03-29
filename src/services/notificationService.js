const Notification = require('../models/Notification');
const { getIo } = require('../realtime');
const { sendPushToUser } = require('./pushService');

async function notify(userId, type, message, objectId = null) {
  const doc = await Notification.create({ userId, type, message, objectId });
  const io = getIo();
  if (io) {
    const notification = doc.toObject();
    io.to(`user:${String(userId)}`).emit('notification:new', { notification });
  }
  sendPushToUser(userId, { title: 'MatchFund', body: message, url: '/notifications' }).catch(() => {});
  return doc;
}

module.exports = { notify };
