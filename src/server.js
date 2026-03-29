const http = require('http');
const app = require('./app');
const { connectDatabase } = require('./config/database');
const { getRedis } = require('./config/redis');
const { initRealtime } = require('./realtime');

const port = Number(process.env.PORT) || 5000;

async function start() {
  await connectDatabase();
  if (getRedis()) console.log('[redis] REDIS_URL set — client will connect on first use');

  const server = http.createServer(app);
  initRealtime(server);

  server.listen(port, () => {
    console.log(`MatchFund API listening on :${port} (HTTP + Socket.IO)`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
