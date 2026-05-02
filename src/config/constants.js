/**
 * AfriQuote — Platform Constants
 * Currencies, VAT rates, payment methods, statuses, and roles.
 * Updated: Fix 1 (RWF), Fix 2 (SA payment methods), Fix 4 (payment terms),
 *          Fix 6 (pricing tiers)
 */

'use strict';

// ── VAT rates by country code ───────────────────────────────────────────────
const VAT_RATES = {
  NG: { rate: 7.5,  name: 'Nigeria VAT',       authority: 'FIRS', currency: 'NGN' },
  GH: { rate: 12.5, name: 'Ghana VAT',          authority: 'GRA',  currency: 'GHS' },
  KE: { rate: 16,   name: 'Kenya VAT',          authority: 'KRA',  currency: 'KES' },
  ZA: { rate: 15,   name: 'South Africa VAT',   authority: 'SARS', currency: 'ZAR' },
  RW: { rate: 18,   name: 'Rwanda VAT',         authority: 'RRA',  currency: 'RWF' },
  TZ: { rate: 18,   name: 'Tanzania VAT',       authority: 'TRA',  currency: 'TZS' },
  SN: { rate: 18,   name: 'Senegal VAT',        authority: 'DGID', currency: 'XOF' },
  EG: { rate: 14,   name: 'Egypt VAT',          authority: 'ETA',  currency: 'EGP' },
  ET: { rate: 15,   name: 'Ethiopia VAT',       authority: 'ERCA', currency: 'ETB' },
};

// ── Currencies — Fix 1: RWF confirmed present ──────────────────────────────
const CURRENCIES = {
  NGN: { symbol: '₦',    name: 'Nigerian Naira',        country: 'NG', decimals: 0 },
  GHS: { symbol: 'GH₵',  name: 'Ghanaian Cedi',         country: 'GH', decimals: 2 },
  KES: { symbol: 'KES ', name: 'Kenyan Shilling',        country: 'KE', decimals: 0 },
  ZAR: { symbol: 'R',    name: 'South African Rand',     country: 'ZA', decimals: 2 },
  RWF: { symbol: 'RF ',  name: 'Rwandan Franc',          country: 'RW', decimals: 0 },
  TZS: { symbol: 'TZS ', name: 'Tanzanian Shilling',     country: 'TZ', decimals: 0 },
  USD: { symbol: '$',    name: 'US Dollar',               country: null, decimals: 2 },
  GBP: { symbol: '£',    name: 'British Pound',           country: null, decimals: 2 },
  EUR: { symbol: '€',    name: 'Euro',                    country: null, decimals: 2 },
};

// ── Payment methods — Fix 2: Added SA methods (EFT, Ozow, PayFast, SnapScan)
const PAYMENT_METHODS = [
  // Pan-African
  'paystack',
  'flutterwave',
  // East Africa
  'mpesa',
  'airtel_money',
  // West Africa
  'mtn_momo',
  // South Africa — NEW
  'eft',            // Electronic Funds Transfer (generic SA bank-to-bank)
  'ozow',           // Ozow instant EFT
  'payfast',        // PayFast payment gateway
  'snapscan',       // SnapScan QR payments
  'zapper',         // Zapper QR payments
  // Universal
  'bank_transfer',
  'cash',
];

// ── Payment methods metadata — labels and countries ──────────────────────────
const PAYMENT_METHOD_META = {
  paystack:      { label: 'Paystack',             countries: ['NG','GH'],       requiresDetails: false },
  flutterwave:   { label: 'Flutterwave',          countries: ['NG','GH','KE'],  requiresDetails: false },
  mpesa:         { label: 'M-Pesa',               countries: ['KE','TZ'],       requiresDetails: true,
                   detailFields: ['tillNumber','businessName'] },
  airtel_money:  { label: 'Airtel Money',         countries: ['KE','GH','TZ'],  requiresDetails: true,
                   detailFields: ['phoneNumber','accountName'] },
  mtn_momo:      { label: 'MTN MoMo',             countries: ['GH','NG'],       requiresDetails: true,
                   detailFields: ['phoneNumber','accountName'] },
  eft:           { label: 'EFT (South Africa)',   countries: ['ZA'],            requiresDetails: true,
                   detailFields: ['accountNumber','bankName','branchCode','accountName'] },
  ozow:          { label: 'Ozow',                 countries: ['ZA'],            requiresDetails: true,
                   detailFields: ['merchantId','displayName'] },
  payfast:       { label: 'PayFast',              countries: ['ZA'],            requiresDetails: true,
                   detailFields: ['merchantId','merchantKey'] },
  snapscan:      { label: 'SnapScan',             countries: ['ZA'],            requiresDetails: true,
                   detailFields: ['snapCode','displayName'] },
  zapper:        { label: 'Zapper',               countries: ['ZA'],            requiresDetails: true,
                   detailFields: ['merchantCode','displayName'] },
  bank_transfer:  { label: 'Bank Transfer',       countries: null,              requiresDetails: true,
                   detailFields: ['accountNumber','bankName','accountName','reference'] },
  cash:          { label: 'Cash',                 countries: null,              requiresDetails: false },
};

// ── Payment terms — Fix 4: Expanded options ──────────────────────────────────
const PAYMENT_TERMS = [
  { value: '50_50',       label: '50% upfront, 50% on delivery' },
  { value: '30_70',       label: '30% upfront, 70% on delivery' },
  { value: '100_upfront', label: '100% upfront before work begins' },
  { value: 'on_delivery', label: '100% on delivery / completion' },
  { value: 'net_7',       label: 'Full payment within 7 days of invoice' },
  { value: 'net_14',      label: 'Full payment within 14 days of invoice' },
  { value: 'net_30',      label: 'Full payment within 30 days of invoice' },
  { value: 'net_60',      label: 'Full payment within 60 days of invoice' },
  { value: 'milestone',   label: 'Milestone-based payments (as agreed)' },
  { value: 'retainer',    label: 'Monthly retainer (payable in advance)' },
  { value: 'custom',      label: 'Custom terms (see notes)' },
];

// ── Pricing tiers — Fix 6: Updated prices ────────────────────────────────────
const PRICING_TIERS = {
  free: {
    name: 'Free', priceNGN: 0, pricePeriod: 'forever',
    limits: { quotesPerMonth: 5, activeClients: 3, activeSites: 1, invoicesPerMonth: 5 },
  },
  lite: {
    name: 'Lite', priceNGN: 10000, pricePeriod: 'month',
    limits: { quotesPerMonth: null, activeClients: null, activeSites: 3, invoicesPerMonth: null },
  },
  pro: {
    name: 'Pro', priceNGN: 20000, pricePeriod: 'month',
    limits: { quotesPerMonth: null, activeClients: null, activeSites: null, invoicesPerMonth: null },
  },
  team: {
    name: 'Team', priceNGN: 50000, pricePeriod: 'month',
    limits: { quotesPerMonth: null, activeClients: null, activeSites: null, invoicesPerMonth: null,
              teamMembers: 10 },
  },
};

// ── Status enums ──────────────────────────────────────────────────────────────
const QUOTE_STATUSES     = ['draft','sent','viewed','accepted','declined','expired','invoiced'];
const INVOICE_STATUSES   = ['draft','sent','viewed','partial','paid','overdue','cancelled'];
const CONTRACT_STATUSES  = ['draft','sent','awaiting_signature','signed','expired','terminated'];
const SITE_STATUSES      = ['planning','active','on_hold','completed','cancelled'];
const TASK_PRIORITIES    = ['low','medium','high','critical'];
const TASK_STATUSES      = ['todo','in_progress','blocked','done'];
const ENTRY_TYPES        = ['progress','issue','delivery','inspection','weather_hold','visitor'];
const USER_ROLES         = ['owner','admin','project_manager','supervisor','field_worker','client'];

module.exports = {
  VAT_RATES, CURRENCIES,
  PAYMENT_METHODS, PAYMENT_METHOD_META,
  PAYMENT_TERMS,
  PRICING_TIERS,
  QUOTE_STATUSES, INVOICE_STATUSES, CONTRACT_STATUSES,
  SITE_STATUSES, TASK_PRIORITIES, TASK_STATUSES,
  ENTRY_TYPES, USER_ROLES,
};
