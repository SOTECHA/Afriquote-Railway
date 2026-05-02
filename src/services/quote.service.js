/**
 * AfriQuote — Quote Service
 * Fix 1: RWF currency supported via tax.service
 * Fix 4: paymentTerms — expanded options + custom text + paymentDetails
 */

'use strict';

const db             = require('../utils/db');
const { newId }      = require('../utils/auth');
const { calculateVAT } = require('./tax.service');
const { PAYMENT_METHODS, PAYMENT_TERMS } = require('../config/constants');

/* ─── Status machine ─────────────────────────────────────────────────────── */
const ALLOWED_TRANSITIONS = {
  draft:    ['sent'],
  sent:     ['viewed', 'accepted', 'declined', 'expired'],
  viewed:   ['accepted', 'declined', 'expired'],
  accepted: ['invoiced'],
  declined: [],
  expired:  [],
  invoiced: [],
};

function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

/* ─── Payment terms validation ────────────────────────────────────────────── */
const VALID_TERM_VALUES = PAYMENT_TERMS.map(t => t.value);

/**
 * Fix 4: Resolve payment term to its display text.
 * If terms = 'custom', uses customTermsText field.
 */
function resolvePaymentTermsText(terms, customTermsText) {
  if (terms === 'custom') return customTermsText || 'As agreed per written agreement.';
  const found = PAYMENT_TERMS.find(t => t.value === terms);
  return found ? found.label : (terms || '50% upfront, 50% on delivery');
}

/* ─── Quote number ────────────────────────────────────────────────────────── */
function nextQuoteNumber(userId) {
  const quotes = db.find('quotes', q => q.userId === userId);
  const nums   = quotes.map(q => parseInt((q.number || 'QUO-0').split('-')[1], 10)).filter(Boolean);
  return `QUO-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`;
}

/* ─── Line-item totals ────────────────────────────────────────────────────── */
function calculateTotals(lines, vatCountry, discountPercent = 0) {
  const calculatedLines = lines.map(l => {
    const qty   = Number(l.qty)       || 0;
    const price = Number(l.unitPrice) || 0;
    return { ...l, qty, unitPrice: price, total: Math.round(qty * price * 100) / 100 };
  });
  const subtotal  = calculatedLines.reduce((s, l) => s + l.total, 0);
  const discount  = Math.round((subtotal * (discountPercent || 0)) / 100 * 100) / 100;
  const afterDisc = subtotal - discount;
  const vat       = calculateVAT(afterDisc, vatCountry);
  return { lines: calculatedLines, subtotal, discount, discountPercent: discountPercent || 0,
           vatRate: vat.rate, vatAmount: vat.vatAmount, total: vat.total };
}

/* ─── CRUD ────────────────────────────────────────────────────────────────── */

/**
 * Create a quote.
 * @param {string} userId
 * @param {object} payload
 * @param {string} [payload.paymentTerms]        - Fix 4: one of PAYMENT_TERMS values
 * @param {string} [payload.customTermsText]     - Fix 4: used when paymentTerms = 'custom'
 * @param {string} [payload.paymentMethod]       - Fix 2: method shown on quote footer
 * @param {object} [payload.paymentDetails]      - Fix 3: account/bank details for footer
 *   { accountNumber?, bankName?, accountName?, branchCode?, tillNumber?, merchantId?, ... }
 */
function createQuote(userId, payload) {
  const { lines, vatCountry, discountPercent, paymentTerms, customTermsText,
          paymentMethod, paymentDetails, ...rest } = payload;

  // Validate payment method if provided
  if (paymentMethod && !PAYMENT_METHODS.includes(paymentMethod)) {
    return { error: `Invalid payment method '${paymentMethod}'. Valid: ${PAYMENT_METHODS.join(', ')}` };
  }

  // Validate payment terms
  const terms = paymentTerms || '50_50';
  if (!VALID_TERM_VALUES.includes(terms)) {
    return { error: `Invalid paymentTerms '${terms}'. Valid: ${VALID_TERM_VALUES.join(', ')}` };
  }

  const totals = calculateTotals(lines || [], vatCountry, discountPercent);
  const now    = new Date().toISOString();

  const quote = {
    id:               newId(),
    userId,
    number:           nextQuoteNumber(userId),
    status:           'draft',
    viewCount:        0,
    vatCountry:       vatCountry || null,
    // Fix 4: structured payment terms
    paymentTerms:     terms,
    paymentTermsText: resolvePaymentTermsText(terms, customTermsText),
    customTermsText:  terms === 'custom' ? (customTermsText || '') : null,
    // Fix 2 & 3: payment method and provider account details
    paymentMethod:    paymentMethod    || null,
    paymentDetails:   paymentDetails   || null,
    createdAt:        now,
    updatedAt:        now,
    expiresAt:        rest.expiresAt   || null,
    ...rest,
    ...totals,
  };
  return db.insert('quotes', quote);
}

function getQuote(id, userId) {
  const q = db.findOne('quotes', q => q.id === id);
  if (!q || q.userId !== userId) return null;
  return q;
}

function listQuotes(userId, filters = {}) {
  let quotes = db.find('quotes', q => q.userId === userId);
  if (filters.status)   quotes = quotes.filter(q => q.status === filters.status);
  if (filters.clientId) quotes = quotes.filter(q => q.clientId === filters.clientId);
  if (filters.currency) quotes = quotes.filter(q => q.currency === filters.currency);
  return quotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function updateQuote(id, userId, patch) {
  const existing = getQuote(id, userId);
  if (!existing) return null;
  if (['accepted','invoiced'].includes(existing.status)) {
    return { error: `Cannot edit a quote with status '${existing.status}'` };
  }

  // Recalculate totals if lines changed
  let totals = {};
  if (patch.lines || patch.vatCountry || patch.discountPercent !== undefined) {
    totals = calculateTotals(
      patch.lines          || existing.lines,
      patch.vatCountry     ?? existing.vatCountry,
      patch.discountPercent ?? existing.discountPercent,
    );
  }

  // Resolve payment terms text if updated
  let termsUpdate = {};
  if (patch.paymentTerms || patch.customTermsText) {
    const terms = patch.paymentTerms || existing.paymentTerms;
    const customText = patch.customTermsText || existing.customTermsText;
    termsUpdate = {
      paymentTerms:     terms,
      paymentTermsText: resolvePaymentTermsText(terms, customText),
      customTermsText:  terms === 'custom' ? customText : null,
    };
  }

  return db.update('quotes', q => q.id === id, {
    ...patch, ...totals, ...termsUpdate,
    updatedAt: new Date().toISOString(),
  });
}

function deleteQuote(id, userId) {
  const q = getQuote(id, userId);
  if (!q) return null;
  if (['invoiced','accepted'].includes(q.status)) return { error: `Cannot delete a quote with status '${q.status}'` };
  return db.delete('quotes', q => q.id === id);
}

/* ─── Status transition ───────────────────────────────────────────────────── */
function transitionQuote(id, userId, newStatus) {
  const q = getQuote(id, userId);
  if (!q) return null;
  if (!canTransition(q.status, newStatus)) {
    return { error: `Cannot transition from '${q.status}' to '${newStatus}'` };
  }
  return db.update('quotes', quote => quote.id === id, { status: newStatus, updatedAt: new Date().toISOString() });
}

/* ─── Record view ─────────────────────────────────────────────────────────── */
function recordView(id) {
  const q = db.findOne('quotes', q => q.id === id);
  if (!q) return null;
  const viewCount = (q.viewCount || 0) + 1;
  const patch     = { viewCount, lastViewedAt: new Date().toISOString() };
  if (q.status === 'sent') patch.status = 'viewed';
  return db.update('quotes', quote => quote.id === id, patch);
}

/* ─── Helper: payment terms list ─────────────────────────────────────────── */
function getPaymentTermsOptions() {
  return PAYMENT_TERMS;
}

module.exports = {
  createQuote, getQuote, listQuotes, updateQuote, deleteQuote,
  transitionQuote, recordView,
  calculateTotals, resolvePaymentTermsText, getPaymentTermsOptions,
  ALLOWED_TRANSITIONS,
};
