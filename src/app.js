require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const passport = require('passport');

const authRoutes = require('./routes/auth');
const oauthRoutes = require('./routes/oauth');
const profileRoutes = require('./routes/profiles');
const matchRoutes = require('./routes/matches');
const messageRoutes = require('./routes/messages');
const dealRoutes = require('./routes/deals');
const dashboardRoutes = require('./routes/dashboard');
const billingRoutes = require('./routes/billing');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/uploads');
const { errorHandler } = require('./middleware/errorHandler');
const { getUploadRoot } = require('./config/uploadPath');

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(passport.initialize());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use('/uploads', express.static(getUploadRoot()));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'matchfund-api' }));

app.use('/auth', authRoutes);
app.use('/auth', oauthRoutes);
app.use('/profiles', profileRoutes);
app.use('/matches', matchRoutes);
app.use('/messages', messageRoutes);
app.use('/deals', dealRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/billing', billingRoutes);
app.use('/notifications', notificationRoutes);
app.use('/admin', adminRoutes);
app.use('/uploads', uploadRoutes);

app.use(errorHandler);

module.exports = app;
