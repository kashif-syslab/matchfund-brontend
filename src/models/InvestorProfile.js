const mongoose = require('mongoose');

const investorProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    brandName: { type: String, default: '' },
    investmentFocusStages: [{ type: String }],
    industries: [{ type: String }],
    checkSizeMin: { type: Number, default: 0 },
    checkSizeMax: { type: Number, default: 0 },
    geography: { type: String, default: '' },
    preferences: { type: String, default: '' },
    portfolioHighlights: { type: String, default: '' },
    website: { type: String, default: '' },
    socialLinks: { type: String, default: '' },
    adminApproved: { type: Boolean, default: false },
    flagged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('InvestorProfile', investorProfileSchema);
