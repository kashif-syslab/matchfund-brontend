const Redis = require('ioredis');

let client = null;

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!client) {
    client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true });
    client.on('error', (err) => {
      console.error('[redis]', err.message);
    });
  }
  return client;
}

module.exports = { getRedis };
