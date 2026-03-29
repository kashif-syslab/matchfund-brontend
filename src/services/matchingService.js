const OpenAI = require('openai');
const Match = require('../models/Match');
const User = require('../models/User');
const FounderProfile = require('../models/FounderProfile');
const InvestorProfile = require('../models/InvestorProfile');

const WEIGHTS = {
  industryFit: 0.25,
  stageFit: 0.2,
  tractionStrength: 0.15,
  geographyFit: 0.15,
  socialTrustScore: 0.1,
  aiSemanticSimilarity: 0.15,
};

function normalize(s) {
  return (s || '').toLowerCase().trim();
}

function overlapScore(a, b) {
  if (!a?.length || !b?.length) return 50;
  const setB = new Set(b.map(normalize));
  const hits = a.filter((x) => setB.has(normalize(x))).length;
  return Math.min(100, Math.round((hits / Math.max(a.length, 1)) * 100));
}

function stringOverlap(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 40;
  if (na.includes(nb) || nb.includes(na)) return 90;
  const aw = new Set(na.split(/[\s,]+/).filter(Boolean));
  const bw = new Set(nb.split(/[\s,]+/).filter(Boolean));
  let c = 0;
  aw.forEach((w) => {
    if (bw.has(w)) c += 1;
  });
  const j = c / Math.max(aw.size + bw.size - c, 1);
  return Math.round(Math.min(1, j * 2) * 100);
}

function stageFit(founderStage, investorStages) {
  if (!founderStage || !investorStages?.length) return 55;
  return investorStages.map(normalize).includes(normalize(founderStage)) ? 95 : 45;
}

function tractionScore(metrics) {
  const u = metrics?.users || 0;
  const r = metrics?.revenue || 0;
  const t = Math.min(100, Math.log10(u + 10) * 25 + Math.min(40, r / 1e5));
  return Math.round(t);
}

function geographyFit(fLoc, iGeo) {
  return stringOverlap(fLoc, iGeo);
}

function socialTrustScore(founder, investor) {
  const fDeck = founder.pitchDeckURL || founder.onePagerUrl;
  const iWeb = investor.website;
  let s = 50;
  if (fDeck) s += 25;
  if (iWeb) s += 25;
  return Math.min(100, s);
}

async function aiSemanticSimilarity(founderText, investorText) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return 60;
  try {
    const client = new OpenAI({ apiKey: key });
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You score semantic fit between a startup summary and an investor thesis. Reply with a single integer 0-100 only.',
        },
        {
          role: 'user',
          content: `Startup:\n${founderText.slice(0, 4000)}\n\nInvestor:\n${investorText.slice(0, 4000)}`,
        },
      ],
      max_tokens: 8,
    });
    const raw = res.choices[0]?.message?.content?.trim() || '50';
    const n = parseInt(raw.replace(/\D/g, ''), 10);
    if (Number.isNaN(n)) return 50;
    return Math.max(0, Math.min(100, n));
  } catch (e) {
    console.warn('[matching] OpenAI fallback:', e.message);
    return 55;
  }
}

function weightedTotal(factors) {
  let t = 0;
  for (const k of Object.keys(WEIGHTS)) {
    t += (factors[k] || 0) * WEIGHTS[k];
  }
  return Math.round(Math.min(100, Math.max(0, t)));
}

async function computePairScore(founderUser, investorUser, founderProfile, investorProfile) {
  const industryFit = overlapScore(
    founderProfile.sector ? [founderProfile.sector] : [],
    investorProfile.industries || []
  );
  const stage = stageFit(founderProfile.stage, investorProfile.investmentFocusStages);
  const traction = tractionScore(founderProfile.tractionMetrics);
  const geo = geographyFit(founderProfile.location, investorProfile.geography);
  const trust = socialTrustScore(founderProfile, investorProfile);
  const founderText = [
    founderProfile.startupName,
    founderProfile.sector,
    founderProfile.teamInfo,
    founderProfile.techStack,
    founderProfile.targetInvestorTypes,
  ].join('\n');
  const investorText = [
    investorProfile.brandName,
    (investorProfile.industries || []).join(', '),
    investorProfile.preferences,
    investorProfile.portfolioHighlights,
  ].join('\n');
  const aiSemanticSimilarityScore = await aiSemanticSimilarity(founderText, investorText);
  const factors = {
    industryFit,
    stageFit: stage,
    tractionStrength: traction,
    geographyFit: geo,
    socialTrustScore: trust,
    aiSemanticSimilarity: aiSemanticSimilarityScore,
  };
  return { score: weightedTotal(factors), factors };
}

async function upsertMatch(founderId, investorId, score, factors) {
  return Match.findOneAndUpdate(
    { founderId, investorId },
    { score, factors, status: 'suggested' },
    { upsert: true, new: true }
  ).lean();
}

async function refreshMatchesForFounder(founderUserId, filters = {}) {
  const founder = await User.findById(founderUserId);
  if (!founder || founder.role !== 'founder') throw Object.assign(new Error('Founder only'), { status: 400 });
  const fp = await FounderProfile.findOne({ userId: founderUserId });
  if (!fp) throw Object.assign(new Error('Complete founder profile first'), { status: 400 });

  let investors = await User.find({ role: 'investor', isBanned: false }).lean();
  const results = [];
  for (const inv of investors) {
    const ip = await InvestorProfile.findOne({ userId: inv._id });
    if (!ip) continue;
    if (filters.sector && ip.industries?.length && !ip.industries.map(normalize).includes(normalize(filters.sector))) {
      continue;
    }
    if (filters.stage && ip.investmentFocusStages?.length) {
      if (!ip.investmentFocusStages.map(normalize).includes(normalize(filters.stage))) continue;
    }
    if (filters.checkMin != null && ip.checkSizeMax > 0 && ip.checkSizeMax < Number(filters.checkMin)) continue;
    if (filters.checkMax != null && ip.checkSizeMin > Number(filters.checkMax)) continue;

    const { score, factors } = await computePairScore(founder, inv, fp, ip);
    const doc = await upsertMatch(founder._id, inv._id, score, factors);
    results.push(doc);
  }
  return results.sort((a, b) => b.score - a.score);
}

async function refreshMatchesForInvestor(investorUserId, filters = {}) {
  const investor = await User.findById(investorUserId);
  if (!investor || investor.role !== 'investor') throw Object.assign(new Error('Investor only'), { status: 400 });
  const ip = await InvestorProfile.findOne({ userId: investorUserId });
  if (!ip) throw Object.assign(new Error('Complete investor profile first'), { status: 400 });

  const founders = await User.find({ role: 'founder', isBanned: false }).lean();
  const results = [];
  for (const f of founders) {
    const fp = await FounderProfile.findOne({ userId: f._id });
    if (!fp) continue;
    if (filters.sector && normalize(fp.sector) !== normalize(filters.sector)) continue;
    if (filters.stage && normalize(fp.stage) !== normalize(filters.stage)) continue;

    const { score, factors } = await computePairScore(f, investor, fp, ip);
    const doc = await upsertMatch(f._id, investor._id, score, factors);
    results.push(doc);
  }
  return results.sort((a, b) => b.score - a.score);
}

async function listMatchesForUser(userId, role) {
  const q = role === 'founder' ? { founderId: userId } : { investorId: userId };
  const rows = await Match.find(q).sort({ score: -1 }).populate('founderId investorId').lean();
  return enrichMatchRows(rows);
}

async function enrichMatchRows(rows) {
  const out = [];
  for (const m of rows) {
    const fId = m.founderId?._id;
    const iId = m.investorId?._id;
    const founderProfile = fId ? await FounderProfile.findOne({ userId: fId }).lean() : null;
    const investorProfile = iId ? await InvestorProfile.findOne({ userId: iId }).lean() : null;
    out.push({ ...m, founderProfile, investorProfile });
  }
  return out;
}

module.exports = {
  refreshMatchesForFounder,
  refreshMatchesForInvestor,
  listMatchesForUser,
  computePairScore,
};
