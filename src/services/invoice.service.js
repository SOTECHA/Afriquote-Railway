/**
 * AfriQuote — Invoice Service
 * Fix 2: South Africa payment methods (eft, ozow, payfast, snapscan, zapper)
 * Fix 3: paymentDetails field — stores provider's bank/account info on invoice
 */

'use strict';

const db             = require('../utils/db');
const { newId }      = require('../utils/auth');
const { PAYMENT_METHODS, PAYMENT_METHOD_META } = require('../config/constants');

const INVOICE_STATUSES = ['draft','sent','viewed','partial','paid','overdue','cancelled'];

/* ─── Invoice number ──────────────────────────────────────────────────────── */
function nextInvoiceNumber(userId) {
  const invoices = db.find('invoices', i => i.userId === userId);
  const nums = invoices.map(i => parseInt((i.number || 'INV-0').split('-')[1], 10)).filter(Boolean);
  return `INV-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`;
}

/* ─── Validate payment details ────────────────────────────────────────────── */
/**
 * Validate that required payment detail fields are present for methods
 * that need them (bank_transfer, eft, mpesa, ozow, payfast, etc.)
 * Fix 3: New helper — ensures provider's account info is complete.
 */
function validatePaymentDetails(method, details) {
  const meta = PAYMENT_METHOD_META[method];
  if (!meta) return { valid: false, error: `Unknown payment method: ${method}` };
  if (!meta.requiresDetails) return { valid: true };
  if (!details || typeof details !== 'object') {
    return { valid: false, error: `Payment details required for ${meta.label}`, requiredFields: meta.detailFields };
  }
  const missing = meta.detailFields.filter(f => !details[f]);
  if (missing.length) {
    return { valid: false, error: `Missing payment detail fields: ${missing.join(', ')}`, requiredFields: meta.detailFields };
  }
  return { valid: true };
}

/* ─── Create invoice ──────────────────────────────────────────────────────── */
/**
 * @param {string} userId
 * @param {object} payload
 * @param {string} payload.paymentMethod     - one of PAYMENT_METHODS
 * @param {object} [payload.paymentDetails]  - Fix 3: bank/account info for provider
 *   For bank_transfer: { accountNumber, bankName, accountName, branchCode?, reference? }
 *   For eft:           { accountNumber, bankName, branchCode, accountName }
 *   For ozow:          { merchantId, displayName }
 *   For payfast:       { merchantId, merchantKey }
 *   For mpesa:         { tillNumber, businessName }
 *   For mtn_momo:      { phoneNumber, accountName }
 */
function createInvoice(userId, payload) {
  const { paymentMethod, paymentDetails, ...rest } = payload;

  // Validate payment method
  if (paymentMethod && !PAYMENT_METHODS.includes(paymentMethod)) {
    return { error: `Invalid payment method '${paymentMethod}'. Valid: ${PAYMENT_METHODS.join(', ')}` };
  }

  // Validate payment details if method requires them
  if (paymentMethod) {
    const check = validatePaymentDetails(paymentMethod, paymentDetails);
    if (!check.valid) return { error: check.error, requiredFields: check.requiredFields };
  }

  const now = new Date().toISOString();
  const invoice = {
    id:             newId(),
    userId,
    number:         nextInvoiceNumber(userId),
    status:         'draft',
    amountPaid:     0,
    payments:       [],
    reminders:      [],
    paymentMethod:  paymentMethod || null,
    paymentDetails: paymentDetails || null,   // Fix 3: persisted here
    createdAt:      now,
    updatedAt:      now,
    ...rest,
  };
  return db.insert('invoices', invoice);
}

/* ─── Invoice from quote ──────────────────────────────────────────────────── */
function invoiceFromQuote(userId, quoteId, overrides = {}) {
  const quote = db.findOne('quotes', q => q.id === quoteId && q.userId === userId);
  if (!quote) return null;
  if (quote.status !== 'accepted') return { error: 'Quote must be accepted before converting to invoice' };

  const invoice = createInvoice(userId, {
    quoteId:        quote.id,
    quoteNumber:    quote.number,
    clientId:       quote.clientId,
    clientName:     quote.clientName,
    lines:          quote.lines,
    subtotal:       quote.subtotal,
    discount:       quote.discount,
    vatRate:        quote.vatRate,
    vatAmount:      quote.vatAmount,
    total:          quote.total,
    currency:       quote.currency,
    vatCountry:     quote.vatCountry,
    paymentMethod:  quote.paymentMethod  || overrides.paymentMethod  || null,
    paymentDetails: quote.paymentDetails || overrides.paymentDetails || null,
    paymentTerms:   quote.paymentTerms   || overrides.paymentTerms   || 'net_14',
    dueDate:        quote.invoiceDueDate || overrides.dueDate        || null,
    notes:          quote.invoiceNotes   || overrides.notes          || null,
  });

  db.update('quotes', q => q.id === quoteId, { status: 'invoiced', invoiceId: invoice.id });
  return invoice;
}

/* ─── CRUD ────────────────────────────────────────────────────────────────── */
function getInvoice(id, userId) {
  const inv = db.findOne('invoices', i => i.id === id);
  if (!inv || inv.userId !== userId) return null;
  return withOverdueCheck(inv);
}

function listInvoices(userId, filters = {}) {
  let invoices = db.find('invoices', i => i.userId === userId);
  if (filters.status)   invoices = invoices.filter(i => i.status === filters.status);
  if (filters.clientId) invoices = invoices.filter(i => i.clientId === filters.clientId);
  if (filters.currency) invoices = invoices.filter(i => i.currency === filters.currency);
  return invoices.map(withOverdueCheck).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function updateInvoice(id, userId, patch) {
  const existing = getInvoice(id, userId);
  if (!existing) return null;
  if (existing.status === 'paid') return { error: 'Cannot edit a paid invoice' };

  // If updating payment method, validate new details
  const method  = patch.paymentMethod  ?? existing.paymentMethod;
  const details = patch.paymentDetails ?? existing.paymentDetails;
  if (patch.paymentMethod) {
    const check = validatePaymentDetails(method, details);
    if (!check.valid) return { error: check.error, requiredFields: check.requiredFields };
  }

  return db.update('invoices', i => i.id === id, { ...patch, updatedAt: new Date().toISOString() });
}

function deleteInvoice(id, userId) {
  const inv = getInvoice(id, userId);
  if (!inv) return null;
  if (['paid','partial'].includes(inv.status)) return { error: 'Cannot delete an invoice with recorded payments' };
  return db.delete('invoices', i => i.id === id);
}

/* ─── Payment recording ───────────────────────────────────────────────────── */
function recordPayment(id, userId, { amount, method, reference, paidAt }) {
  if (!PAYMENT_METHODS.includes(method)) {
    return { error: `Invalid payment method '${method}'. Valid: ${PAYMENT_METHODS.join(', ')}` };
  }
  const inv = getInvoice(id, userId);
  if (!inv) return null;
  const payment  = { id: newId(), amount: Number(amount), method, reference, paidAt: paidAt || new Date().toISOString() };
  const newPaid  = (inv.amountPaid || 0) + payment.amount;
  const newStatus = newPaid >= inv.total ? 'paid' : newPaid > 0 ? 'partial' : inv.status;
  const payments  = [...(inv.payments || []), payment];
  return db.update('invoices', i => i.id === id, { payments, amountPaid: newPaid, status: newStatus, updatedAt: new Date().toISOString() });
}

/* ─── Send reminder ───────────────────────────────────────────────────────── */
function sendReminder(id, userId) {
  const inv = getInvoice(id, userId);
  if (!inv) return null;
  const reminder = { id: newId(), sentAt: new Date().toISOString() };
  const reminders = [...(inv.reminders || []), reminder];
  return db.update('invoices', i => i.id === id, { reminders, updatedAt: new Date().toISOString() });
}

/* ─── Overdue check ───────────────────────────────────────────────────────── */
function withOverdueCheck(inv) {
  if (inv.status === 'sent' && inv.dueDate && new Date(inv.dueDate) < new Date()) {
    return { ...inv, status: 'overdue' };
  }
  return inv;
}

/* ─── Summary stats ───────────────────────────────────────────────────────── */
function getSummary(userId) {
  const invoices = db.find('invoices', i => i.userId === userId).map(withOverdueCheck);
  const total     = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const paid      = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0);
  const overdue   = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.total, 0);
  const outstanding = invoices.filter(i => ['sent','partial','overdue'].includes(i.status)).reduce((s, i) => s + ((i.total || 0) - (i.amountPaid || 0)), 0);
  return { total, paid, overdue, outstanding, count: invoices.length };
}

module.exports = {
  createInvoice, invoiceFromQuote,
  getInvoice, listInvoices, updateInvoice, deleteInvoice,
  recordPayment, sendReminder,
  getSummary, validatePaymentDetails,
};
