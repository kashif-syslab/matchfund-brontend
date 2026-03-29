/**
 * Vercel serverless entry — wraps the Express app with serverless-http.
 * MongoDB connects on first invocation (cold start) and is reused when warm.
 *
 * Note: Socket.IO in src/server.js does not run here. Use `npm start` (Railway/Render)
 * for full realtime, or host realtime separately.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const serverless = require('serverless-http');
const { connectDatabase } = require('../src/config/database');

let cachedHandler;

function pathOnly(url) {
  if (!url) return '';
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}

/** Routes that only redirect or return static JSON — no Mongo until callbacks / API use models. */
function shouldConnectDatabase(req) {
  const p = pathOnly(req.url || '');
  const method = (req.method || 'GET').toUpperCase();
  if (p === '/health') return false;
  if (method === 'GET' && (p === '/auth/google' || p === '/auth/linkedin')) return false;
  return true;
}

function getHandler() {
  if (cachedHandler) return cachedHandler;
  const app = require('../src/app');
  cachedHandler = serverless(app);
  return cachedHandler;
}

module.exports = async (req, res) => {
  try {
    if (shouldConnectDatabase(req) && mongoose.connection.readyState !== 1) {
      await connectDatabase();
    }
    const handler = getHandler();
    return await handler(req, res);
  } catch (err) {
    console.error('[vercel-api]', err);
    if (res.headersSent) return;
    const msg = err?.message || String(err);
    const isConfig = msg.includes('MONGODB_URI');
    res.status(isConfig ? 503 : 500).json({
      error: isConfig ? 'Database not configured or unreachable' : 'Internal server error',
      ...(process.env.NODE_ENV !== 'production' && { detail: msg }),
    });
  }
};
