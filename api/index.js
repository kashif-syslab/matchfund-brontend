/**
 * Vercel serverless entry — wraps the Express app with serverless-http.
 * MongoDB connects on first invocation (cold start) and is reused when warm.
 *
 * Note: Socket.IO in src/server.js does not run here. Use `npm start` (Railway/Render)
 * for full realtime, or host realtime separately.
 */
const mongoose = require('mongoose');
const serverless = require('serverless-http');
const { connectDatabase } = require('../src/config/database');

let cachedHandler;

function getHandler() {
  if (cachedHandler) return cachedHandler;
  const app = require('../src/app');
  cachedHandler = serverless(app);
  return cachedHandler;
}

module.exports = async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    await connectDatabase();
  }
  const handler = getHandler();
  return handler(req, res);
};
