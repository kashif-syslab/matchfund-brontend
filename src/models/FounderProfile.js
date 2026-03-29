const mongoose = require('mongoose');

const founderProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    startupName: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
    bannerUrl: { type: String, default: '' },
    sector: { type: String, default: '' },
    stage: {
      type: String,
      enum: ['idea', 'pre-seed', 'seed', 'series-a', 'series-b', 'growth', 'other', ''],
      default: '',
    },
    pitchDeckURL: { type: String, default: '' },
    onePagerUrl: { type: String, default: '' },
    tractionMetrics: {
      users: { type: Number, default: 0 },
      revenue: { type: Number, default: 0 },
    },
    fundingRequested: { type: Number, default: 0 },
    location: { type: String, default: '' },
    teamInfo: { type: String, default: '' },
    techStack: { type: String, default: '' },
    targetInvestorTypes: { type: String, default: '' },
    adminApproved: { type: Boolean, default: false },
    flagged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FounderProfile', founderProfileSchema);
