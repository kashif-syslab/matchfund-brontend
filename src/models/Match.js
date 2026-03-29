const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema(
  {
    founderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    investorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    factors: {
      industryFit: { type: Number, default: 0 },
      stageFit: { type: Number, default: 0 },
      tractionStrength: { type: Number, default: 0 },
      geographyFit: { type: Number, default: 0 },
      socialTrustScore: { type: Number, default: 0 },
      aiSemanticSimilarity: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['suggested', 'intro_requested', 'connected', 'declined'],
      default: 'suggested',
    },
  },
  { timestamps: true }
);

matchSchema.index({ founderId: 1, investorId: 1 }, { unique: true });

module.exports = mongoose.model('Match', matchSchema);
