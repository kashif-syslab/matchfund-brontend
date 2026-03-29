const path = require('path');
const fs = require('fs');

/**
 * Writable upload root. On Vercel serverless only /tmp is writable (and is ephemeral).
 * For durable files in production, use object storage (S3, etc.) and set UPLOAD_DIR if needed.
 */
function getUploadRoot() {
  if (process.env.UPLOAD_DIR) {
    return path.resolve(process.env.UPLOAD_DIR);
  }
  if (process.env.VERCEL === '1') {
    return '/tmp/uploads';
  }
  return path.join(__dirname, '../../uploads');
}

function ensureUploadDir() {
  const dir = getUploadRoot();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

module.exports = { getUploadRoot, ensureUploadDir };
