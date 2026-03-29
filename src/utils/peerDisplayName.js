function trimStr(v) {
  const t = String(v ?? '').trim();
  return t || '';
}

/**
 * Inbox / listing label for the other party (same rules everywhere):
 * investor → brandName → User.name → "Match"
 * founder → startupName → User.name → "Match"
 */
function peerDisplayName(peer) {
  if (!peer) return 'Match';
  const userName = trimStr(peer.name);
  const role = peer.role;

  if (role === 'investor') {
    const brand = trimStr(peer.investorProfileId?.brandName);
    if (brand) return brand;
    if (userName) return userName;
    return 'Match';
  }

  if (role === 'founder') {
    const startup = trimStr(peer.founderProfileId?.startupName);
    if (startup) return startup;
    if (userName) return userName;
    return 'Match';
  }

  if (userName) return userName;
  return 'Match';
}

module.exports = { peerDisplayName };
