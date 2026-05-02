/**
 * AfriQuote — Contract Service
 */

'use strict';

const db     = require('../utils/db');
const { newId } = require('../utils/auth');

const CONTRACT_TEMPLATES = [
  {
    id: 'freelance-soa',
    name: 'Freelance Service Agreement',
    description: 'Scope, deliverables, revisions, IP ownership, payment terms, termination.',
    jurisdictions: ['NG', 'GH', 'KE', 'ZA', 'RW'],
    clauses: [
      'scope_of_work', 'deliverables', 'revisions', 'payment_terms',
      'ip_ownership', 'confidentiality', 'termination', 'governing_law'
    ],
  },
  {
    id: 'construction-subcontract',
    name: 'Construction Subcontract',
    description: 'Site obligations, material supply, delay penalties, variation orders, retention.',
    jurisdictions: ['NG', 'GH', 'KE', 'ZA'],
    clauses: [
      'scope_of_works', 'site_obligations', 'materials', 'delay_penalties',
      'variation_orders', 'retention', 'insurance', 'governing_law'
    ],
  },
  {
    id: 'retainer',
    name: 'Retainer Agreement',
    description: 'Monthly hours cap, rollover policy, priority access, auto-renewal.',
    jurisdictions: ['NG', 'GH', 'KE', 'ZA', 'RW'],
    clauses: [
      'monthly_hours', 'rollover_policy', 'priority_access',
      'payment_terms', 'auto_renewal', 'exit_notice', 'governing_law'
    ],
  },
  {
    id: 'nda',
    name: 'Non-Disclosure Agreement',
    description: 'Mutual or one-way NDA covering confidential information and IP.',
    jurisdictions: ['NG', 'GH', 'KE', 'ZA', 'RW', 'TZ', 'EG'],
    clauses: ['definition_confidential', 'obligations', 'exclusions', 'term', 'governing_law'],
  },
];

/* ─── Contracts ─── */
function createContract(userId, payload) {
  const now = new Date().toISOString();
  const contract = {
    id:            newId(),
    userId,
    status:        'draft',
    scopeAlerts:   [],
    changeOrders:  [],
    signatureToken: newId(), // used in signing link
    createdAt:     now,
    updatedAt:     now,
    ...payload,
    revisionRoundsUsed: 0,
  };
  return db.insert('contracts', contract);
}

function listContracts(userId, filters = {}) {
  let contracts = db.find('contracts', c => c.userId === userId);
  if (filters.status)   contracts = contracts.filter(c => c.status === filters.status);
  if (filters.clientId) contracts = contracts.filter(c => c.clientId === filters.clientId);
  return contracts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getContract(id, userId) {
  const c = db.findOne('contracts', c => c.id === id);
  if (!c || c.userId !== userId) return null;
  return c;
}

function updateContract(id, userId, patch) {
  if (!getContract(id, userId)) return null;
  return db.update('contracts', c => c.id === id, patch);
}

/** Mark contract as sent — generate public signing URL token */
function sendContract(id, userId) {
  const c = getContract(id, userId);
  if (!c) return null;
  const token = newId() + newId(); // long random token for signing link
  return db.update('contracts', c => c.id === id, {
    status: 'sent', sentAt: new Date().toISOString(), signatureToken: token
  });
}

/** Client signs via token (public endpoint) */
function signContract(token, signerName, signerEmail) {
  const c = db.findOne('contracts', c => c.signatureToken === token);
  if (!c) return null;
  if (c.status === 'signed') return { error: 'Already signed' };
  return db.update('contracts', c => c.signatureToken === token, {
    status:     'signed',
    signedAt:   new Date().toISOString(),
    signerName, signerEmail,
  });
}

/* ─── Scope Alerts ─── */
function addScopeAlert(contractId, userId, { description, estimatedHours, source }) {
  const c = getContract(contractId, userId);
  if (!c) return null;
  const alert = {
    id:             newId(),
    description,
    estimatedHours: estimatedHours || null,
    source:         source || 'manual',
    status:         'open',
    createdAt:      new Date().toISOString(),
  };
  const alerts = [...(c.scopeAlerts || []), alert];
  db.update('contracts', c => c.id === contractId, { scopeAlerts: alerts });
  return alert;
}

function resolveScopeAlert(contractId, userId, alertId, resolution) {
  const c = getContract(contractId, userId);
  if (!c) return null;
  const alerts = (c.scopeAlerts || []).map(a =>
    a.id === alertId ? { ...a, status: resolution, resolvedAt: new Date().toISOString() } : a
  );
  return db.update('contracts', c => c.id === contractId, { scopeAlerts: alerts });
}

/* ─── Change Orders ─── */
function createChangeOrder(contractId, userId, { description, amount, currency }) {
  const c = getContract(contractId, userId);
  if (!c) return null;
  const co = {
    id:          newId(),
    description,
    amount:      Number(amount) || 0,
    currency:    currency || c.currency,
    status:      'pending',
    createdAt:   new Date().toISOString(),
  };
  const changeOrders = [...(c.changeOrders || []), co];
  db.update('contracts', c => c.id === contractId, { changeOrders });
  return co;
}

function acceptChangeOrder(contractId, userId, changeOrderId) {
  const c = getContract(contractId, userId);
  if (!c) return null;
  const cos = (c.changeOrders || []).map(co =>
    co.id === changeOrderId ? { ...co, status: 'accepted', acceptedAt: new Date().toISOString() } : co
  );
  return db.update('contracts', c => c.id === contractId, { changeOrders: cos });
}

/** Increment revision counter */
function logRevision(contractId, userId) {
  const c = getContract(contractId, userId);
  if (!c) return null;
  const used = (c.revisionRoundsUsed || 0) + 1;
  const exceeded = c.revisionRoundsAllowed && used > c.revisionRoundsAllowed;
  db.update('contracts', c => c.id === contractId, { revisionRoundsUsed: used });
  return { revisionRoundsUsed: used, exceeded, revisionRoundsAllowed: c.revisionRoundsAllowed };
}

module.exports = {
  CONTRACT_TEMPLATES,
  createContract, listContracts, getContract, updateContract,
  sendContract, signContract,
  addScopeAlert, resolveScopeAlert,
  createChangeOrder, acceptChangeOrder,
  logRevision,
};

/** Look up contract by its public signing token (used in public endpoint) */
function getContractByToken(token) {
  return db.findOne('contracts', c => c.signatureToken === token) || null;
}

// Re-export (append to existing module.exports)
Object.assign(module.exports, { getContractByToken });
