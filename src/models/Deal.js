const mongoose = require('mongoose');

const dealSchema = new mongoose.Schema(
  {
    founderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    investorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['open', 'negotiating', 'closed'],
      default: 'open',
    },
    milestones: [{ title: String, dueDate: Date, completed: { type: Boolean, default: false } }],
    expectedFunding: { type: Number, default: 0 },
    fundingTerms: { type: String, default: '' },
    notes: { type: String, default: '' },
    /** Investor-editable counterpart to founder ask; visible to both parties. */
    investorNotes: { type: String, default: '' },
    documents: [{ url: String, name: String }],
    activityLog: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        editorRole: { type: String, enum: ['founder', 'investor'], required: true },
        fields: [{ type: String }],
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

dealSchema.index({ founderId: 1, investorId: 1 });

module.exports = mongoose.model('Deal', dealSchema);
