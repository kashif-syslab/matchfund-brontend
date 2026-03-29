const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { ensureUploadDir } = require('../config/uploadPath');

const router = express.Router();
router.use(requireAuth);

const uploadDir = ensureUploadDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post('/file', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const publicPath = `/uploads/${req.file.filename}`;
  res.json({ url: publicPath, name: req.file.originalname });
});

module.exports = router;
