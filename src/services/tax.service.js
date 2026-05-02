/**
 * AfriQuote — Tax Service
 * VAT rates, WHT rules, and filing deadlines for all 5 supported markets.
 * Fix: Added Rwanda (RW) filing deadlines — monthly VAT, RRA portal.
 */

'use strict';

/* ─── VAT configuration ──────────────────────────────────────────────────── */
const VAT_CONFIG = {
  NG: { rate: 7.5,  name: 'Nigeria VAT',      authority: 'FIRS', currency: 'RWF', portal: 'https://taxpromax.firs.gov.ng' },
  GH: { rate: 12.5, name: 'Ghana VAT',         authority: 'GRA',  currency: 'GHS', portal: 'https://taxpayerportal.gra.gov.gh' },
  KE: { rate: 16,   name: 'Kenya VAT',         authority: 'KRA',  currency: 'KES', portal: 'https://itax.kra.go.ke' },
  ZA: { rate: 15,   name: 'South Africa VAT',  authority: 'SARS', currency: 'ZAR', portal: 'https://efiling.sars.gov.za' },
  RW: { rate: 18,   name: 'Rwanda VAT',        authority: 'RRA',  currency: 'RWF', portal: 'https://etax.rra.gov.rw' },
};

/* ─── WHT configuration ──────────────────────────────────────────────────── */
const WHT_CONFIG = {
  NG: {
    services:    { rate: 10, name: 'WHT on services',    authority: 'FIRS' },
    rent:        { rate: 10, name: 'WHT on rent',         authority: 'FIRS' },
    dividends:   { rate: 10, name: 'WHT on dividends',    authority: 'FIRS' },
    construction:{ rate: 5,  name: 'WHT on construction', authority: 'FIRS' },
    interest:    { rate: 10, name: 'WHT on interest',     authority: 'FIRS' },
  },
  KE: {
    services:    { rate: 5,  name: 'WHT on services',    authority: 'KRA' },
    dividends:   { rate: 15, name: 'WHT on dividends',    authority: 'KRA' },
    interest:    { rate: 15, name: 'WHT on interest',     authority: 'KRA' },
    rent:        { rate: 30, name: 'WHT on rent',         authority: 'KRA' },
  },
  ZA: {
    services:    { rate: 15, name: 'PAYE / WHT on services', authority: 'SARS' },
    dividends:   { rate: 20, name: 'Dividends tax',           authority: 'SARS' },
    royalties:   { rate: 15, name: 'WHT on royalties',        authority: 'SARS' },
  },
  RW: {
    services:    { rate: 15, name: 'WHT on services',    authority: 'RRA' },
    dividends:   { rate: 15, name: 'WHT on dividends',    authority: 'RRA' },
    interest:    { rate: 15, name: 'WHT on interest',     authority: 'RRA' },
  },
  GH: {
    services:    { rate: 8,  name: 'WHT on services',    authority: 'GRA' },
    rent:        { rate: 8,  name: 'WHT on rent',         authority: 'GRA' },
    dividends:   { rate: 8,  name: 'WHT on dividends',    authority: 'GRA' },
  },
};

/* ─── Currency config ────────────────────────────────────────────────────── */
const CURRENCY_CONFIG = {
  NGN: { symbol: '₦',    name: 'Nigerian Naira',       country: 'NG', decimals: 0 },
  GHS: { symbol: 'GH₵',  name: 'Ghanaian Cedi',        country: 'GH', decimals: 2 },
  KES: { symbol: 'KES ', name: 'Kenyan Shilling',       country: 'KE', decimals: 0 },
  ZAR: { symbol: 'R',    name: 'South African Rand',    country: 'ZA', decimals: 2 },
  RWF: { symbol: 'RF ',  name: 'Rwandan Franc',         country: 'RW', decimals: 0 },
  USD: { symbol: '$',    name: 'US Dollar',              country: null, decimals: 2 },
  GBP: { symbol: '£',    name: 'British Pound',          country: null, decimals: 2 },
  EUR: { symbol: '€',    name: 'Euro',                   country: null, decimals: 2 },
};

/* ─── Helper ──────────────────────────────────────────────────────────────── */
function monthName(m) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m];
}

/* ─── Filing Deadlines ───────────────────────────────────────────────────── */

/**
 * Generate upcoming tax deadlines for a given country.
 * Fix: Rwanda (RW) added — monthly VAT returns due 15th of following month.
 * @param {string} countryCode  'NG' | 'GH' | 'KE' | 'ZA' | 'RW'
 * @param {Date}   from         reference date (default: today)
 * @returns {Array}  sorted array of upcoming deadlines with daysRemaining
 */
function getDeadlines(countryCode, from = new Date()) {
  const year     = from.getFullYear();
  const deadlines = [];

  // ── Nigeria ──────────────────────────────────────────────────────────────
  if (countryCode === 'NG') {
    // Quarterly VAT — 21st of April, July, October, January
    [
      { label: 'Q1 VAT return (Jan–Mar)',  due: new Date(year,  3, 21) },
      { label: 'Q2 VAT return (Apr–Jun)',  due: new Date(year,  6, 21) },
      { label: 'Q3 VAT return (Jul–Sep)',  due: new Date(year,  9, 21) },
      { label: 'Q4 VAT return (Oct–Dec)',  due: new Date(year + 1, 0, 21) },
    ].forEach(q => deadlines.push({ ...q, type: 'VAT', authority: 'FIRS', country: 'NG' }));

    deadlines.push({ label: 'Annual income tax (PITA)',  due: new Date(year, 5, 30), type: 'INCOME', authority: 'LIRS', country: 'NG' });
    deadlines.push({ label: 'Company income tax (CITA)', due: new Date(year, 5, 30), type: 'CIT',    authority: 'FIRS', country: 'NG' });
  }

  // ── Ghana ─────────────────────────────────────────────────────────────────
  if (countryCode === 'GH') {
    // Quarterly VAT — last day of Jan, Apr, Jul, Oct
    [1, 4, 7, 10].forEach((m, i) => {
      const due = new Date(year, m, 0); // last day of that month
      deadlines.push({ label: `Q${i+1} VAT return`, due, type: 'VAT', authority: 'GRA', country: 'GH' });
    });
    deadlines.push({ label: 'Annual income tax', due: new Date(year, 3, 30), type: 'INCOME', authority: 'GRA', country: 'GH' });
  }

  // ── Kenya ─────────────────────────────────────────────────────────────────
  if (countryCode === 'KE') {
    // Monthly VAT — 20th of following month
    for (let m = 0; m < 12; m++) {
      deadlines.push({ label: `${monthName(m)} VAT return`, due: new Date(year, m + 1, 20), type: 'VAT', authority: 'KRA', country: 'KE' });
    }
    deadlines.push({ label: 'Annual income tax (IT1)', due: new Date(year, 5, 30), type: 'INCOME', authority: 'KRA', country: 'KE' });
  }

  // ── South Africa ──────────────────────────────────────────────────────────
  if (countryCode === 'ZA') {
    // Bi-monthly VAT — 25th of Feb, Apr, Jun, Aug, Oct, Dec
    [1, 3, 5, 7, 9, 11].forEach(m => {
      deadlines.push({
        label: `VAT return (${monthName(m-1)}/${monthName(m)})`,
        due:   new Date(year, m, 25),
        type: 'VAT', authority: 'SARS', country: 'ZA',
      });
    });
    deadlines.push({ label: 'Annual tax return (ITR12)', due: new Date(year, 10, 23), type: 'INCOME', authority: 'SARS', country: 'ZA' });
    deadlines.push({ label: 'Provisional tax (IRP6)',    due: new Date(year,  7, 31), type: 'PROV',   authority: 'SARS', country: 'ZA' });
  }

  // ── Rwanda — NEW (Fix: was missing entirely) ──────────────────────────────
  if (countryCode === 'RW') {
    // Monthly VAT — 15th of following month
    for (let m = 0; m < 12; m++) {
      deadlines.push({
        label: `${monthName(m)} VAT return`,
        due:   new Date(year, m + 1, 15),
        type: 'VAT', authority: 'RRA', country: 'RW',
      });
    }
    // Annual corporate income tax — March 31
    deadlines.push({ label: 'Corporate income tax (CIT)', due: new Date(year, 2, 31), type: 'INCOME', authority: 'RRA', country: 'RW' });
    // PAYE — 15th of following month
    for (let m = 0; m < 12; m++) {
      deadlines.push({
        label: `${monthName(m)} PAYE return`,
        due:   new Date(year, m + 1, 15),
        type: 'PAYE', authority: 'RRA', country: 'RW',
      });
    }
  }

  // Sort, filter future, attach days-remaining
  return deadlines
    .filter(d => d.due > from)
    .sort((a, b) => a.due - b.due)
    .slice(0, 12)
    .map(d => ({
      ...d,
      dueFormatted:  d.due.toISOString().split('T')[0],
      daysRemaining: Math.ceil((d.due - from) / (1000 * 60 * 60 * 24)),
      isUrgent:      Math.ceil((d.due - from) / (1000 * 60 * 60 * 24)) <= 14,
    }));
}

/* ─── VAT calculation ────────────────────────────────────────────────────── */
function calculateVAT(subtotal, countryCode) {
  const cfg = VAT_CONFIG[countryCode];
  if (!cfg) return { rate: 0, vatAmount: 0, total: subtotal, countryCode };
  const vatAmount = Math.round((subtotal * cfg.rate / 100) * 100) / 100;
  return {
    rate:       cfg.rate,
    vatAmount,
    total:      Math.round((subtotal + vatAmount) * 100) / 100,
    authority:  cfg.authority,
    countryCode,
  };
}

/* ─── WHT calculation ────────────────────────────────────────────────────── */
function calculateWHT(amount, countryCode, serviceType = 'services') {
  const cfg = WHT_CONFIG[countryCode]?.[serviceType];
  if (!cfg) return { rate: 0, whtAmount: 0, netPayable: amount, applicable: false };
  const whtAmount = Math.round((amount * cfg.rate / 100) * 100) / 100;
  return {
    rate:       cfg.rate,
    whtAmount,
    netPayable: Math.round((amount - whtAmount) * 100) / 100,
    name:       cfg.name,
    authority:  cfg.authority,
    applicable: true,
  };
}

/* ─── NTAA 2025 WHT exemption check (Nigeria) ───────────────────────────── */
function checkNTAAExemption(monthlyIncome, hasTIN) {
  const threshold  = 2_000_000;
  const qualifies  = monthlyIncome < threshold && hasTIN;
  return {
    qualifies,
    monthlyIncome,
    threshold,
    hasTIN,
    message: qualifies
      ? 'Qualifies: Corporate clients cannot legally deduct WHT. Present TIN certificate before invoicing.'
      : monthlyIncome >= threshold
        ? `Does not qualify: Monthly income (${monthlyIncome.toLocaleString()}) exceeds ₦${threshold.toLocaleString()} threshold.`
        : 'Does not qualify: An active, FIRS-registered TIN is required.',
  };
}

/* ─── Format currency ────────────────────────────────────────────────────── */
function formatCurrency(amount, currencyCode) {
  const cfg = CURRENCY_CONFIG[currencyCode];
  if (!cfg) return `${currencyCode} ${amount}`;
  const fixed = amount.toFixed(cfg.decimals);
  const formatted = parseFloat(fixed).toLocaleString('en-US', { minimumFractionDigits: cfg.decimals });
  return `${cfg.symbol}${formatted}`;
}

module.exports = {
  VAT_CONFIG, WHT_CONFIG, CURRENCY_CONFIG,
  getDeadlines, calculateVAT, calculateWHT,
  checkNTAAExemption, formatCurrency,
};
