/**
 * AfriQuote — Proposal Tracker Service
 *
 * A Proposal is a formal document sent to a prospect before any quote or
 * contract exists. It lives on its own pipeline:
 *
 *   draft → sent → viewed → meeting_scheduled → negotiating
 *        → won  (creates contract)
 *        → lost
 *        → stalled
 *        → expired
 *
 * Every stage change is logged to a timeline. Win probability is either
 * set manually or estimated from the current stage + activity signals.
 */

'use strict';

const db        = require('../utils/db');
const { newId } = require('../utils/auth');

/* ─── Stage configuration ──────────────────────────────────────── */
const STAGES = {
  draft:              { label: 'Draft',              order: 0, defaultProbability: 5  },
  sent:               { label: 'Sent',               order: 1, defaultProbability: 20 },
  viewed:             { label: 'Viewed',             order: 2, defaultProbability: 35 },
  meeting_scheduled:  { label: 'Meeting scheduled',  order: 3, defaultProbability: 55 },
  negotiating:        { label: 'Negotiating',        order: 4, defaultProbability: 75 },
  won:                { label: 'Won',                order: 5, defaultProbability: 100, terminal: true },
  lost:               { label: 'Lost',               order: 5, defaultProbability: 0,  terminal: true },
  stalled:            { label: 'Stalled',            order: 3, defaultProbability: 15 },
  expired:            { label: 'Expired',            order: 5, defaultProbability: 0,  terminal: true },
};

const ALLOWED_TRANSITIONS = {
  draft:             ['sent'],
  sent:              ['viewed','stalled','lost','expired'],
  viewed:            ['meeting_scheduled','negotiating','stalled','lost'],
  meeting_scheduled: ['negotiating','won','stalled','lost'],
  negotiating:       ['won','lost','stalled'],
  stalled:           ['sent','negotiating','lost','expired'],
  won:               [],
  lost:              [],
  expired:           [],
};

const PROPOSAL_TYPES  = ['services', 'construction', 'consulting', 'technology', 'creative', 'other'];
const FOLLOW_UP_TYPES = ['email', 'whatsapp', 'call', 'meeting', 'other'];
const ACTIVITY_TYPES  = ['note', 'follow_up', 'meeting', 'email_sent', 'whatsapp_sent', 'call', 'document_shared', 'stage_change'];

/* ─── Helpers ───────────────────────────────────────────────────── */
function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

function nextProposalNumber(userId) {
  const all  = db.find('proposals', p => p.userId === userId);
  const nums = all.map(p => parseInt((p.number || 'PRO-0').split('-')[1], 10)).filter(Boolean);
  return `PRO-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`;
}

function estimateProbability(proposal) {
  if (proposal.winProbabilityOverride !== null && proposal.winProbabilityOverride !== undefined) {
    return proposal.winProbabilityOverride;
  }
  const base    = STAGES[proposal.stage]?.defaultProbability || 0;
  const acts    = (proposal.activities || []);
  const days    = proposal.followUpDate
    ? Math.max(0, Math.ceil((new Date(proposal.followUpDate) - Date.now()) / 86400000))
    : 30;

  // Boost for engagement signals
  let boost = 0;
  if (acts.some(a => a.type === 'meeting'))           boost += 10;
  if (acts.some(a => a.type === 'document_shared'))   boost += 5;
  if (acts.filter(a => a.type === 'follow_up').length >= 2) boost += 5;
  if (proposal.viewCount >= 3)                        boost += 5;
  // Penalty for staleness (only when a follow-up was scheduled and missed)
  if (proposal.followUpDate && new Date(proposal.followUpDate) < new Date()) {
    if (days < -14)  boost -= 5;   // 2+ weeks overdue
    if (days < -30)  boost -= 10;  // 1+ month overdue
  }

  return Math.min(100, Math.max(0, base + boost));
}

function withDerivedFields(proposal) {
  if (!proposal) return null;
  return {
    ...proposal,
    estimatedProbability: estimateProbability(proposal),
    weightedValue: Math.round(((proposal.estimatedValue || 0) * estimateProbability(proposal)) / 100),
    isOverdue: proposal.followUpDate && new Date(proposal.followUpDate) < new Date() && !STAGES[proposal.stage]?.terminal,
    daysInStage: proposal.stageChangedAt
      ? Math.floor((Date.now() - new Date(proposal.stageChangedAt)) / 86400000)
      : 0,
    stageConfig: STAGES[proposal.stage] || null,
  };
}

/* ─── CRUD ─────────────────────────────────────────────────────── */

function createProposal(userId, payload) {
  const now = new Date().toISOString();
  const proposal = {
    id:                   newId(),
    userId,
    number:               nextProposalNumber(userId),
    stage:                'draft',
    title:                payload.title,
    clientName:           payload.clientName,
    clientId:             payload.clientId             || null,
    clientEmail:          payload.clientEmail          || null,
    clientPhone:          payload.clientPhone          || null,
    clientWhatsapp:       payload.clientWhatsapp       || null,
    company:              payload.company              || null,
    country:              payload.country              || 'NG',
    currency:             payload.currency             || 'NGN',
    proposalType:         payload.proposalType         || 'services',
    estimatedValue:       Number(payload.estimatedValue) || 0,
    winProbabilityOverride: payload.winProbabilityOverride !== undefined
                            ? Number(payload.winProbabilityOverride) : null,
    description:          payload.description          || null,
    executiveSummary:     payload.executiveSummary     || null,
    scopeOfWork:          payload.scopeOfWork          || null,
    deliverables:         payload.deliverables         || [],
    timeline:             payload.timeline             || null,
    validUntil:           payload.validUntil           || null,
    followUpDate:         payload.followUpDate         || null,
    followUpMethod:       payload.followUpMethod       || 'email',
    quoteId:              payload.quoteId              || null,
    contractId:           payload.contractId           || null,
    tags:                 payload.tags                 || [],
    attachmentUrls:       payload.attachmentUrls       || [],
    viewCount:            0,
    lastViewedAt:         null,
    sentAt:               null,
    wonAt:                null,
    lostAt:               null,
    lostReason:           null,
    stageChangedAt:       now,
    activities:           [],
    createdAt:            now,
    updatedAt:            now,
  };
  const saved = db.insert('proposals', proposal);

  // Initial timeline entry
  _logActivity(saved.id, userId, {
    type:    'note',
    content: `Proposal ${saved.number} created.`,
    auto:    true,
  });

  // Re-fetch to include the auto-logged activity
  return withDerivedFields(db.findOne('proposals', p => p.id === saved.id));
}

function getProposal(id, userId) {
  const p = db.findOne('proposals', p => p.id === id);
  if (!p || p.userId !== userId) return null;
  return withDerivedFields(p);
}

function listProposals(userId, filters = {}) {
  let proposals = db.find('proposals', p => p.userId === userId);

  if (filters.stage)      proposals = proposals.filter(p => p.stage === filters.stage);
  if (filters.clientId)   proposals = proposals.filter(p => p.clientId === filters.clientId);
  if (filters.type)       proposals = proposals.filter(p => p.proposalType === filters.type);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    proposals = proposals.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.clientName.toLowerCase().includes(q) ||
      (p.company || '').toLowerCase().includes(q)
    );
  }

  // Sort: active first by estimated value, terminal last
  proposals.sort((a, b) => {
    const aT = STAGES[a.stage]?.terminal ? 1 : 0;
    const bT = STAGES[b.stage]?.terminal ? 1 : 0;
    if (aT !== bT) return aT - bT;
    return (b.estimatedValue || 0) - (a.estimatedValue || 0);
  });

  return proposals.map(withDerivedFields);
}

function updateProposal(id, userId, patch) {
  const existing = getProposal(id, userId);
  if (!existing) return null;

  // Don't allow direct stage change via update — use transitionProposal
  delete patch.stage;

  const updated = db.update('proposals', p => p.id === id, patch);
  return withDerivedFields(updated);
}

function deleteProposal(id, userId) {
  const p = getProposal(id, userId);
  if (!p) return null;
  if (!['draft', 'lost', 'expired'].includes(p.stage)) {
    return { error: 'Only draft, lost, or expired proposals can be deleted' };
  }
  db.delete('proposals', p => p.id === id);
  return { deleted: true };
}

/* ─── Stage transitions ─────────────────────────────────────────── */

function transitionProposal(id, userId, newStage, meta = {}) {
  const p = getProposal(id, userId);
  if (!p)                              return { error: 'Proposal not found' };
  if (!canTransition(p.stage, newStage))
    return { error: `Cannot move from "${p.stage}" to "${newStage}"` };

  const now   = new Date().toISOString();
  const patch = {
    stage:          newStage,
    stageChangedAt: now,
  };

  if (newStage === 'sent')   patch.sentAt  = now;
  if (newStage === 'viewed') {
    patch.viewCount    = (p.viewCount || 0) + 1;
    patch.lastViewedAt = now;
  }
  if (newStage === 'won') {
    patch.wonAt = now;
    // Auto-suggest: proposal pipeline → contract
    patch.readyForContract = true;
  }
  if (newStage === 'lost') {
    patch.lostAt     = now;
    patch.lostReason = meta.reason || null;
  }
  if (newStage === 'expired') patch.expiredAt = now;

  // Auto-set follow-up date for active stages
  if (['sent','viewed','meeting_scheduled','negotiating'].includes(newStage) && !meta.followUpDate) {
    const followUpDays = { sent: 3, viewed: 2, meeting_scheduled: 1, negotiating: 2 };
    const d = new Date(Date.now() + (followUpDays[newStage] || 3) * 86400000);
    patch.followUpDate = d.toISOString().split('T')[0];
  }
  if (meta.followUpDate) patch.followUpDate = meta.followUpDate;

  db.update('proposals', p => p.id === id, patch);

  // Log stage change to activity timeline
  _logActivity(id, userId, {
    type:      'stage_change',
    content:   `Stage moved from "${STAGES[p.stage]?.label}" to "${STAGES[newStage]?.label}"${meta.reason ? `. Reason: ${meta.reason}` : ''}.`,
    fromStage: p.stage,
    toStage:   newStage,
    auto:      false,
  });

  // Re-fetch to get fully merged state including logged activity
  return withDerivedFields(db.findOne('proposals', p => p.id === id));
}

/* ─── Activity / timeline log ───────────────────────────────────── */

function addActivity(id, userId, payload) {
  const p = getProposal(id, userId);
  if (!p) return null;

  const entry = {
    id:        newId(),
    type:      payload.type     || 'note',
    content:   payload.content  || '',
    followUpDate: payload.followUpDate || null,
    followUpMethod: payload.followUpMethod || null,
    outcome:   payload.outcome  || null,
    auto:      false,
    createdAt: new Date().toISOString(),
  };

  const activities = [...(p.activities || []), entry];
  db.update('proposals', p => p.id === id, { activities });

  // If a follow-up is logged, update the next follow-up date
  if (payload.nextFollowUpDate) {
    db.update('proposals', p => p.id === id, {
      followUpDate:   payload.nextFollowUpDate,
      followUpMethod: payload.nextFollowUpMethod || p.followUpMethod,
    });
  }

  return entry;
}

function _logActivity(proposalId, userId, data) {
  const p = db.findOne('proposals', p => p.id === proposalId);
  if (!p) return;
  const entry = {
    id:        newId(),
    type:      data.type || 'note',
    content:   data.content,
    fromStage: data.fromStage || null,
    toStage:   data.toStage   || null,
    auto:      data.auto !== false,
    createdAt: new Date().toISOString(),
  };
  const activities = [...(p.activities || []), entry];
  db.update('proposals', p => p.id === proposalId, { activities });
}

/* ─── Convert won proposal → contract ──────────────────────────── */

function convertToContract(id, userId, contractPayload = {}) {
  const p = getProposal(id, userId);
  if (!p) return { error: 'Proposal not found' };
  if (p.stage !== 'won') return { error: 'Only won proposals can be converted to contracts' };
  if (p.contractId) return { error: 'Proposal already has a linked contract' };

  const contractSvc = require('./contract.service');
  const contract    = contractSvc.createContract(userId, {
    title:                contractPayload.title || p.title,
    clientName:           p.clientName,
    clientId:             p.clientId,
    body:                 contractPayload.body || `This agreement formalises the proposal: ${p.title}.\n\n${p.scopeOfWork || ''}`,
    value:                contractPayload.value || p.estimatedValue,
    currency:             p.currency,
    revisionRoundsAllowed: contractPayload.revisionRoundsAllowed || 2,
    proposalId:           p.id,
    proposalNumber:       p.number,
    template:             contractPayload.template || 'freelance-soa',
    ...contractPayload,
  });

  // Link contract back to proposal
  db.update('proposals', p => p.id === id, { contractId: contract.id });
  _logActivity(id, userId, {
    type:    'note',
    content: `Converted to contract ${contract.id}. Ready for signature.`,
    auto:    true,
  });

  return { proposal: withDerivedFields(db.findOne('proposals', p => p.id === id)), contract };
}

/* ─── Link to quote ─────────────────────────────────────────────── */

function linkQuote(id, userId, quoteId) {
  const p = getProposal(id, userId);
  if (!p) return { error: 'Proposal not found' };
  db.update('proposals', p => p.id === id, { quoteId });
  _logActivity(id, userId, {
    type:    'note',
    content: `Linked to quote ${quoteId}.`,
    auto:    true,
  });
  return withDerivedFields(db.findOne('proposals', p => p.id === id));
}

/* ─── Mark as viewed (public link) ─────────────────────────────── */

function recordView(viewToken) {
  const p = db.findOne('proposals', p => p.viewToken === viewToken);
  if (!p) return null;
  const now = new Date().toISOString();
  db.update('proposals', px => px.id === p.id, {
    viewCount:    (p.viewCount || 0) + 1,
    lastViewedAt: now,
  });
  // Auto-advance draft/sent → viewed
  if (['sent', 'draft'].includes(p.stage)) {
    db.update('proposals', px => px.id === p.id, { stage: 'viewed', stageChangedAt: now });
    _logActivity(p.id, p.userId, {
      type:    'stage_change',
      content: 'Proposal viewed by client — stage auto-advanced to "Viewed".',
      fromStage: p.stage, toStage: 'viewed', auto: true,
    });
  }
  return withDerivedFields(db.findOne('proposals', px => px.id === p.id));
}

/* ─── Pipeline stats ────────────────────────────────────────────── */

function pipelineStats(userId) {
  const proposals = db.find('proposals', p => p.userId === userId).map(withDerivedFields);
  const now       = new Date();
  const mStart    = new Date(now.getFullYear(), now.getMonth(), 1);

  // Stage funnel
  const funnel = Object.entries(STAGES).map(([key, cfg]) => ({
    stage:       key,
    label:       cfg.label,
    count:       proposals.filter(p => p.stage === key).length,
    totalValue:  proposals.filter(p => p.stage === key).reduce((s, p) => s + (p.estimatedValue || 0), 0),
    weightedValue: proposals.filter(p => p.stage === key).reduce((s, p) => s + (p.weightedValue || 0), 0),
    order:       cfg.order,
  })).sort((a, b) => a.order - b.order);

  const active     = proposals.filter(p => !STAGES[p.stage]?.terminal);
  const won        = proposals.filter(p => p.stage === 'won');
  const lost       = proposals.filter(p => p.stage === 'lost');
  const overdue    = active.filter(p => p.isOverdue);
  const thisMonthWon = won.filter(p => p.wonAt && new Date(p.wonAt) >= mStart);

  // Win rate (of all decided proposals)
  const decided    = won.length + lost.length;
  const winRate    = decided > 0 ? Math.round((won.length / decided) * 100) : 0;

  // Avg days to close (won proposals)
  const avgDaysToClose = won.length
    ? Math.round(won.reduce((s, p) => {
        const days = p.wonAt && p.createdAt
          ? (new Date(p.wonAt) - new Date(p.createdAt)) / 86400000 : 0;
        return s + days;
      }, 0) / won.length)
    : null;

  // Total weighted pipeline value
  const totalWeightedValue = active.reduce((s, p) => s + (p.weightedValue || 0), 0);

  return {
    total:              proposals.length,
    active:             active.length,
    won:                won.length,
    lost:               lost.length,
    overdue:            overdue.length,
    winRate,
    avgDaysToClose,
    totalPipelineValue: active.reduce((s, p) => s + (p.estimatedValue || 0), 0),
    totalWeightedValue,
    thisMonthWonValue:  thisMonthWon.reduce((s, p) => s + (p.estimatedValue || 0), 0),
    funnel,
    overdueProposals:   overdue.map(p => ({ id: p.id, number: p.number, title: p.title, clientName: p.clientName, followUpDate: p.followUpDate, stage: p.stage })),
  };
}

/* ─── Upcoming follow-ups ────────────────────────────────────────── */

function upcomingFollowUps(userId, days = 7) {
  const cutoff = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
  const today  = new Date().toISOString().split('T')[0];

  return db.find('proposals', p =>
    p.userId === userId &&
    p.followUpDate &&
    p.followUpDate >= today &&
    p.followUpDate <= cutoff &&
    !STAGES[p.stage]?.terminal
  )
  .map(withDerivedFields)
  .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
}

/* ─── Send view link (generate token) ───────────────────────────── */

function generateViewLink(id, userId) {
  const p = getProposal(id, userId);
  if (!p) return null;
  const viewToken = newId() + newId();
  db.update('proposals', p => p.id === id, { viewToken });
  return { viewToken, link: `/api/public/proposals/${viewToken}` };
}

module.exports = {
  STAGES, ALLOWED_TRANSITIONS, PROPOSAL_TYPES, FOLLOW_UP_TYPES, ACTIVITY_TYPES,
  createProposal, getProposal, listProposals, updateProposal, deleteProposal,
  transitionProposal, addActivity,
  convertToContract, linkQuote,
  recordView, generateViewLink,
  pipelineStats, upcomingFollowUps,
  withDerivedFields,
};
