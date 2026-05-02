const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const uid = () => uuidv4();

const now = () => new Date().toISOString();

// Generate sequential numbers like QT-2026-0001
function nextNumber(db, orgId, prefix) {
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM (
      SELECT id FROM quotes WHERE org_id=? AND quote_number LIKE ?
      UNION ALL
      SELECT id FROM invoices WHERE org_id=? AND invoice_number LIKE ?
    )`
  ).get(orgId, prefix + '%', orgId, prefix + '%');
  const n = (row ? row.cnt : 0) + 1;
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

function quoteNumber(db, orgId) {
  const yr = new Date().getFullYear();
  const row = db.prepare(`SELECT COUNT(*) as c FROM quotes WHERE org_id=?`).get(orgId);
  return `QT-${yr}-${String((row.c || 0) + 1).padStart(4, '0')}`;
}

function invoiceNumber(db, orgId) {
  const yr = new Date().getFullYear();
  const row = db.prepare(`SELECT COUNT(*) as c FROM invoices WHERE org_id=?`).get(orgId);
  return `INV-${yr}-${String((row.c || 0) + 1).padStart(4, '0')}`;
}

// VAT rates by country
const VAT_RATES = {
  NG: 7.5, GH: 12.5, KE: 16, ZA: 15, RW: 18,
  TZ: 18, UG: 18, ET: 15, SN: 18, CI: 18
};

function getVatRate(country) {
  return VAT_RATES[country] || 0;
}

// Currencies by country
const CURRENCIES = {
  NG: 'NGN', GH: 'GHS', KE: 'KES', ZA: 'ZAR',
  RW: 'RWF', TZ: 'TZS', UG: 'UGX', ET: 'ETB',
  SN: 'XOF', CI: 'XOF', EG: 'EGP'
};

function getCurrency(country) {
  return CURRENCIES[country] || 'USD';
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function paginate(total, page, limit) {
  const pages = Math.ceil(total / limit);
  return { total, page, limit, pages, hasNext: page < pages, hasPrev: page > 1 };
}

module.exports = {
  uid, now, quoteNumber, invoiceNumber,
  getVatRate, getCurrency,
  randomToken, hashToken, paginate
};
