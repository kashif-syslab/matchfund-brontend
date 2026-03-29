const mongoose = require('mongoose');

function explainMongoError(err) {
  const msg = err?.message || String(err);
  if (msg.includes('querySrv') || err?.code === 'ECONNREFUSED') {
    return [
      '\n[MongoDB] SRV lookup failed (mongodb+srv uses DNS SRV).',
      '  Use a standard replica-set URI from Atlas (mongodb:// with 3 hosts) — see Backend/.env comments.\n',
    ].join('\n');
  }
  return '';
}

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 20_000,
    });
  } catch (err) {
    console.error(explainMongoError(err));
    throw err;
  }
  return mongoose.connection;
}

module.exports = { connectDatabase };
