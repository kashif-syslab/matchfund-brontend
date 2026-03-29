/**
 * Who may edit which fields on a Deal (enforced in PATCH /deals/:id).
 * Change here only — not stored in the database.
 */
const FOUNDER_ONLY = new Set(['expectedFunding']);
const INVESTOR_ONLY = new Set(['investorNotes']);
const BOTH = new Set(['status', 'fundingTerms', 'notes', 'milestones', 'documents']);

function roleMayEditField(role, field) {
  if (BOTH.has(field)) return true;
  if (role === 'founder' && FOUNDER_ONLY.has(field)) return true;
  if (role === 'investor' && INVESTOR_ONLY.has(field)) return true;
  return false;
}

/** For API responses / UI hints */
function permissionMatrix() {
  return {
    founderOnly: [...FOUNDER_ONLY],
    investorOnly: [...INVESTOR_ONLY],
    both: [...BOTH],
  };
}

module.exports = {
  FOUNDER_ONLY,
  INVESTOR_ONLY,
  BOTH,
  roleMayEditField,
  permissionMatrix,
};
