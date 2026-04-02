const { verifyAccess } = require('../utils/jwt');
const User = require('../models/User');
const { syncUserSubscriptionState } = require('../services/subscriptionService');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = header.slice(7);
    const decoded = verifyAccess(token);
    let user = await User.findById(decoded.sub);
    user = await syncUserSubscriptionState(user);
    if (!user || user.isBanned) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
      subscriptionPlan: user.subscriptionPlan || 'free',
      subscriptionStatus: user.subscriptionStatus || 'free',
    };
    req.userDoc = user.toObject();
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
