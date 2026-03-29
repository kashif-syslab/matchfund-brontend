const webpush = require('web-push');
const User = require('../models/User');

let configured = false;

function configure() {
  if (configured) return !!process.env.VAPID_PRIVATE_KEY;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

function isPushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Send Web Push to all stored subscriptions for a user.
 * Removes subscriptions that return 404/410.
 */
async function sendPushToUser(userId, { title, body, url }) {
  if (!configure()) return;
  const user = await User.findById(userId).select('pushSubscriptions').lean();
  if (!user?.pushSubscriptions?.length) return;

  const payload = JSON.stringify({
    title: title || 'MatchFund',
    body: body || '',
    data: { url: url || '/notifications' },
  });

  for (const sub of user.pushSubscriptions) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: sub.keys,
    };
    try {
      await webpush.sendNotification(subscription, payload);
    } catch (err) {
      const code = err.statusCode;
      if (code === 404 || code === 410) {
        await User.updateOne({ _id: userId }, { $pull: { pushSubscriptions: { endpoint: sub.endpoint } } });
      }
    }
  }
}

module.exports = { sendPushToUser, isPushConfigured, configure };
