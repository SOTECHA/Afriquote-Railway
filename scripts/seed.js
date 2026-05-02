/**
 * AfriQuote — Seed Script
 * Creates demo data for all 5 supported countries including Rwanda (Fix 1)
 * and demonstrates new payment methods + payment terms (Fixes 2, 3, 4).
 *
 * Run: node scripts/seed.js
 */

'use strict';

const db             = require('../src/utils/db');
const { newId }      = require('../src/utils/auth');
const quoteSvc       = require('../src/services/quote.service');
const invoiceSvc     = require('../src/services/invoice.service');
const siteSvc        = require('../src/services/site.service');
const { checkNTAAExemption, getDeadlines } = require('../src/services/tax.service');
const { PAYMENT_TERMS }                    = require('../src/config/constants');

/* ─── Demo user ──────────────────────────────────────────────────────────── */
const USER_ID = 'usr_demo_001';
db.insert('users', {
  id: USER_ID, email: 'demo@afriquote.africa', name: 'Demo User',
  plan: 'pro', country: 'NG', createdAt: new Date().toISOString(),
});

/* ─── Clients — one per country (Fix 1: Rwanda client added) ─────────────── */
const clients = [
  { name: 'BetaRide Lagos',       country: 'NG', currency: 'NGN', email: 'projects@betaride.ng',       phone: '+234 801 100 0001', isCorporate: true  },
  { name: 'TradaKo Ltd',          country: 'NG', currency: 'NGN', email: 'info@tradako.com',            phone: '+234 802 200 0002', isCorporate: true  },
  { name: 'AgroConnect GH',       country: 'GH', currency: 'GHS', email: 'design@agroconnect.gh',      phone: '+233 244 300 003',  isCorporate: true  },
  { name: 'NovaPay Kenya',        country: 'KE', currency: 'KES', email: 'ops@novapay.ke',             phone: '+254 722 400 004',  isCorporate: true  },
  { name: 'ShopLync Pty Ltd',     country: 'ZA', currency: 'ZAR', email: 'digital@shoplync.co.za',     phone: '+27 82 500 0005',   isCorporate: true  },
  // Fix 1: Rwanda client with RWF currency
  { name: 'KigaliTech Solutions', country: 'RW', currency: 'RWF', email: 'billing@kigalitech.rw',      phone: '+250 788 600 006',  isCorporate: true  },
];
const clientIds = clients.map(c => {
  const id = newId();
  db.insert('clients', { id, userId: USER_ID, ...c, createdAt: new Date().toISOString() });
  return id;
});
console.log(`✓ ${clients.length} clients seeded (NG×2, GH, KE, ZA, RW)`);

/* ─── Quotes — one per client, each with payment terms + details (Fixes 3, 4) */
const quoteSeeds = [
  {
    clientIdx: 0, title: 'Brand identity package', currency: 'NGN', vatCountry: 'NG', total: 320000,
    lines: [{ description: 'Brand identity design', qty: 1, unitPrice: 200000 },
            { description: 'Social media kit',       qty: 1, unitPrice: 100000 }],
    // Fix 4: structured payment terms
    paymentTerms: '50_50',
    // Fix 3: provider's payment details
    paymentMethod: 'paystack',
  },
  {
    clientIdx: 1, title: 'Website redesign — Phase 1', currency: 'NGN', vatCountry: 'NG', total: 850000,
    lines: [{ description: 'UI/UX design', qty: 1, unitPrice: 350000 },
            { description: 'Development',  qty: 1, unitPrice: 450000 }],
    paymentTerms: 'milestone',
    paymentMethod: 'bank_transfer',
    // Fix 3: bank account details on the quote
    paymentDetails: { accountNumber: '0123456789', bankName: 'GTBank', accountName: 'Demo User Ltd', branchCode: '058' },
  },
  {
    clientIdx: 2, title: 'Social media retainer 3mo', currency: 'GHS', vatCountry: 'GH', total: 4200,
    lines: [{ description: 'Monthly social media management', qty: 3, unitPrice: 1200 }],
    paymentTerms: 'retainer',
    paymentMethod: 'mtn_momo',
    paymentDetails: { phoneNumber: '0244000000', accountName: 'Demo User' },
  },
  {
    clientIdx: 3, title: 'IT audit & risk report', currency: 'KES', vatCountry: 'KE', total: 95000,
    lines: [{ description: 'Security audit', qty: 1, unitPrice: 75000 },
            { description: 'Risk report',    qty: 1, unitPrice: 18000 }],
    paymentTerms: 'net_14',
    paymentMethod: 'mpesa',
    paymentDetails: { tillNumber: '123456', businessName: 'Demo User Solutions' },
  },
  {
    clientIdx: 4, title: 'E-commerce strategy deck', currency: 'ZAR', vatCountry: 'ZA', total: 18500,
    lines: [{ description: 'Strategy consulting', qty: 1, unitPrice: 15000 },
            { description: 'Report design',        qty: 1, unitPrice: 3000 }],
    paymentTerms: 'net_30',
    // Fix 2: South Africa EFT payment method
    paymentMethod: 'eft',
    paymentDetails: { accountNumber: '62012345678', bankName: 'Nedbank', branchCode: '198765', accountName: 'Demo User SA' },
  },
  // Fix 1: Rwanda quote with RWF currency
  {
    clientIdx: 5, title: 'Digital transformation roadmap', currency: 'RWF', vatCountry: 'RW', total: 2800000,
    lines: [{ description: 'Discovery & planning', qty: 1, unitPrice: 1200000 },
            { description: 'Implementation guide',  qty: 1, unitPrice: 1400000 }],
    paymentTerms: '30_70',
    paymentMethod: 'bank_transfer',
    paymentDetails: { accountNumber: '400-123456789-01', bankName: 'Bank of Kigali', accountName: 'Demo User Ltd', branchCode: 'BK001' },
  },
];

const quoteIds = quoteSeeds.map((seed) => {
  const { clientIdx, ...qData } = seed;
  const client  = clients[clientIdx];
  const clientId = clientIds[clientIdx];
  const result  = quoteSvc.createQuote(USER_ID, {
    clientId,
    clientName:  client.name,
    status:      'accepted',
    vatCountry:  qData.vatCountry,
    discountPercent: 0,
    expiresAt:   new Date(Date.now() + 30 * 86400000).toISOString(),
    ...qData,
  });
  return result?.id || null;
});
console.log(`✓ ${quoteSeeds.length} quotes seeded (NG×2, GH, KE, ZA, RW)`);

/* ─── Invoices — convert quotes to invoices ────────────────────────────────── */
const invoiceSeeds = [
  { quoteIdx: 0, status: 'paid',    amountPaid: 320000, paymentRef: 'PSK_20260115_001' },
  { quoteIdx: 1, status: 'sent',    amountPaid: 0 },
  { quoteIdx: 2, status: 'partial', amountPaid: 1400, paymentRef: 'MOMO_20260108_003' },
  { quoteIdx: 3, status: 'overdue', amountPaid: 0 },
  // Fix 2: South Africa invoice with EFT + Ozow options
  { quoteIdx: 4, status: 'sent',    amountPaid: 0, altPaymentMethod: 'ozow',
    altPaymentDetails: { merchantId: 'ozow_demo_001', displayName: 'Demo User SA' } },
  // Fix 1: Rwanda invoice in RWF
  { quoteIdx: 5, status: 'draft',   amountPaid: 0 },
];

invoiceSeeds.forEach(seed => {
  const qId = quoteIds[seed.quoteIdx];
  if (!qId) return;
  const inv = invoiceSvc.invoiceFromQuote(USER_ID, qId);
  if (!inv || inv.error) return;

  const patches = {
    status:    seed.status,
    amountPaid: seed.amountPaid || 0,
    dueDate:   new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0],
  };
  if (seed.amountPaid > 0 && seed.paymentRef) {
    patches.payments = [{ id: newId(), amount: seed.amountPaid, method: inv.paymentMethod || 'paystack', reference: seed.paymentRef, paidAt: new Date().toISOString() }];
  }
  if (seed.altPaymentMethod) {
    patches.paymentMethod  = seed.altPaymentMethod;
    patches.paymentDetails = seed.altPaymentDetails;
  }
  db.update('invoices', i => i.id === inv.id, patches);
});
console.log(`✓ ${invoiceSeeds.length} invoices seeded`);

/* ─── Demo: Tax deadlines for all 5 countries ─────────────────────────────── */
console.log('\n  Tax filing deadlines (next 3 per country):');
['NG','GH','KE','ZA','RW'].forEach(cc => {
  const deadlines = getDeadlines(cc).slice(0, 3);
  const flag = { NG:'🇳🇬', GH:'🇬🇭', KE:'🇰🇪', ZA:'🇿🇦', RW:'🇷🇼' }[cc];
  deadlines.forEach(d => {
    const urgent = d.isUrgent ? ' ⚠️' : '';
    console.log(`  ${flag}  ${d.dueFormatted}  ${d.label} (${d.daysRemaining}d)${urgent}`);
  });
});

/* ─── Demo: NTAA 2025 WHT exemption check ─────────────────────────────────── */
console.log('\n  NTAA 2025 WHT exemption check:');
[{ income: 1500000, tin: true }, { income: 2500000, tin: true }, { income: 1000000, tin: false }]
  .forEach(t => {
    const r = checkNTAAExemption(t.income, t.tin);
    console.log(`  ₦${(t.income/1000).toFixed(0)}K/mo + TIN:${t.tin} → ${r.qualifies ? '✓ EXEMPT' : '✗ WHT applies'}`);
  });

/* ─── Demo: Payment terms options ────────────────────────────────────────── */
console.log('\n  Available payment terms:');
PAYMENT_TERMS.forEach(t => console.log(`  · ${t.value.padEnd(15)} ${t.label}`));

console.log('\n✅ Seed complete. Start server: node server.js\n');
