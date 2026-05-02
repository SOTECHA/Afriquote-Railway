/**
 * AfriQuote — Test Runner
 * Zero-dependency test suite. Runs with: node tests/test_runner.js
 */
'use strict';

process.env.JWT_SECRET = 'test-secret-afriquote-2026';
process.env.NODE_ENV   = 'test';

// ── Override data dir so tests use isolated /tmp storage ───────────
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'afriquote-test-'));

// Patch the db module to use the temp dir before requiring it
const dbModule = require('../src/utils/db');
// Monkey-patch DATA_DIR by overriding readCollection/writeCollection
const origRead  = dbModule.find.bind(dbModule);
// Actually we need to intercept at the file level — easiest: use env var
process.env.DATA_DIR = TEST_DATA_DIR;

// Re-require after setting env (db checks process.env.DATA_DIR)
// We need to patch db.js to use DATA_DIR env var — let's just copy & patch inline:
const crypto = require('crypto');

// ── Inline lightweight db for tests ────────────────────────────
const testDb = (() => {
  const store = {};
  const find    = (col, pred) => (store[col] || []).filter(pred || (() => true));
  const findOne = (col, pred) => find(col, pred)[0] || null;
  const insert  = (col, rec)  => { (store[col] = store[col] || []).push(rec); return rec; };
  const update  = (col, pred, patch) => {
    let updated = null;
    store[col] = (store[col] || []).map(r => {
      if (pred(r)) { updated = { ...r, ...patch, updatedAt: new Date().toISOString() }; return updated; }
      return r;
    });
    return updated;
  };
  const del     = (col, pred) => { const before = (store[col]||[]).length; store[col]=(store[col]||[]).filter(r=>!pred(r)); return before-(store[col]||[]).length; };
  const count   = (col, pred) => find(col, pred).length;
  const reset   = () => Object.keys(store).forEach(k => delete store[k]);
  return { find, findOne, insert, update, delete: del, count, reset };
})();

// Patch all services to use testDb
const Module = require('module');
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request.endsWith('/utils/db') || request.endsWith('\\utils\\db')) return testDb;
  return origLoad.apply(this, arguments);
};

// ── Import utils & services ────────────────────────────────────
const { hashPassword, verifyPassword, signToken, verifyToken, newId } = require('../src/utils/auth');
const quoteSvc    = require('../src/services/quote.service');
const invoiceSvc  = require('../src/services/invoice.service');
const contractSvc = require('../src/services/contract.service');
const siteSvc     = require('../src/services/site.service');
const timeSvc     = require('../src/services/time.service');
const taxSvc      = require('../src/services/tax.service');
const cashSvc     = require('../src/services/cashflow.service');

// ── Test framework ─────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;
const results = [];

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    results.push({ name, ok: true });
  } catch(e) {
    failed++;
    results.push({ name, ok: false, error: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertNotNull(v, msg) {
  if (v == null) throw new Error(msg || 'Expected non-null value');
}

const USER_ID = newId();

// ─────────────────────────────────────────────────────────────────
// AUTH UTILS
// ─────────────────────────────────────────────────────────────────
test('hashPassword produces a valid hash', () => {
  const h = hashPassword('MyPass123!');
  assert(h.includes(':'), 'hash should contain salt separator');
});

test('verifyPassword accepts correct password', () => {
  const h = hashPassword('Correct99!');
  assert(verifyPassword('Correct99!', h), 'should match');
});

test('verifyPassword rejects wrong password', () => {
  const h = hashPassword('Correct99!');
  assert(!verifyPassword('Wrong!', h), 'should not match');
});

test('signToken and verifyToken round-trip', () => {
  const t = signToken({ userId: 'u1', email: 'a@b.com' });
  const p = verifyToken(t);
  assertEqual(p.userId, 'u1');
  assertEqual(p.email,  'a@b.com');
});

test('verifyToken rejects tampered token', () => {
  const t   = signToken({ userId: 'u1' });
  const bad = t.slice(0, -5) + 'xxxxx';
  assert(verifyToken(bad) === null, 'tampered token must be rejected');
});

test('verifyToken rejects manually expired token', () => {
  const b64url = d => Buffer.from(d).toString('base64url');
  const SECRET = process.env.JWT_SECRET;
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify({ userId: 'x', iat: 1000, exp: 1001 }));
  const sig    = b64url(require('crypto').createHmac('sha256', SECRET).update(`${header}.${body}`).digest());
  assert(verifyToken(`${header}.${body}.${sig}`) === null, 'expired token must return null');
});

// ─────────────────────────────────────────────────────────────────
// QUOTE SERVICE
// ─────────────────────────────────────────────────────────────────
test('createQuote stores a draft quote with correct totals', () => {
  testDb.reset();
  const q = quoteSvc.createQuote(USER_ID, {
    clientName: 'Test Client',
    title: 'Logo design',
    lines: [{ description: 'Logo', qty: 1, unitPrice: 100000 }],
    vatCountry: 'NG',
    currency: 'NGN',
  });
  assertEqual(q.status, 'draft');
  assertEqual(q.subtotal, 100000);
  assertEqual(q.vatRate, 7.5);
  assert(q.total > 100000, 'total must include VAT');
  assert(q.number.startsWith('QUO-'), 'must have quote number');
});

test('createQuote handles multiple line items', () => {
  testDb.reset();
  const q = quoteSvc.createQuote(USER_ID, {
    clientName: 'Client B',
    title: 'Web project',
    lines: [
      { description: 'Design', qty: 1, unitPrice: 200000 },
      { description: 'Dev',    qty: 2, unitPrice: 150000 },
    ],
    vatCountry: 'GH',
    currency: 'GHS',
  });
  assertEqual(q.subtotal, 500000);
  assertEqual(q.vatRate, 12.5);
  assert(Math.abs(q.vatAmount - 62500) < 1, `vatAmount should be ~62500, got ${q.vatAmount}`);
});

test('transitionQuote draft → sent is valid', () => {
  testDb.reset();
  const q   = quoteSvc.createQuote(USER_ID, { clientName:'C', title:'T', lines:[], vatCountry:'NG' });
  const res = quoteSvc.transitionQuote(q.id, USER_ID, 'sent');
  assertEqual(res.status, 'sent');
  assertNotNull(res.sentAt, 'sentAt must be set');
});

test('transitionQuote sent → draft is invalid', () => {
  testDb.reset();
  const q = quoteSvc.createQuote(USER_ID, { clientName:'C', title:'T', lines:[], vatCountry:'NG' });
  quoteSvc.transitionQuote(q.id, USER_ID, 'sent');
  const res = quoteSvc.transitionQuote(q.id, USER_ID, 'draft');
  assert(res?.error, 'should return error for invalid transition');
});

test('deleteQuote only allows deleting drafts', () => {
  testDb.reset();
  const q = quoteSvc.createQuote(USER_ID, { clientName:'C', title:'T', lines:[], vatCountry:'NG' });
  quoteSvc.transitionQuote(q.id, USER_ID, 'sent');
  const res = quoteSvc.deleteQuote(q.id, USER_ID);
  assert(res?.error, 'should not delete sent quote');
});

test('quoteStats returns correct counts', () => {
  testDb.reset();
  quoteSvc.createQuote(USER_ID, { clientName:'A', title:'Q1', lines:[], vatCountry:'NG' });
  const q2 = quoteSvc.createQuote(USER_ID, { clientName:'B', title:'Q2', lines:[], vatCountry:'NG' });
  quoteSvc.transitionQuote(q2.id, USER_ID, 'sent');
  quoteSvc.transitionQuote(q2.id, USER_ID, 'accepted');
  const stats = quoteSvc.quoteStats(USER_ID);
  assertEqual(stats.total, 2);
  assertEqual(stats.draft, 1);
  assertEqual(stats.accepted, 1);
});

test('updateQuote recalculates totals when lines change', () => {
  testDb.reset();
  const q = quoteSvc.createQuote(USER_ID, {
    clientName:'C', title:'T',
    lines:[{ description:'X', qty:1, unitPrice:50000 }],
    vatCountry:'NG',
  });
  const updated = quoteSvc.updateQuote(q.id, USER_ID, {
    lines:[{ description:'X', qty:2, unitPrice:50000 }],
  });
  assertEqual(updated.subtotal, 100000);
});

// ─────────────────────────────────────────────────────────────────
// INVOICE SERVICE
// ─────────────────────────────────────────────────────────────────
test('createInvoice stores a draft invoice', () => {
  testDb.reset();
  const inv = invoiceSvc.createInvoice(USER_ID, {
    clientName: 'ACME',
    title: 'Invoice #1',
    total: 50000,
    currency: 'NGN',
  });
  assertEqual(inv.status, 'draft');
  assertEqual(inv.amountPaid, 0);
  assert(inv.number.startsWith('INV-'), 'must have invoice number');
});

test('invoiceFromQuote requires accepted status', () => {
  testDb.reset();
  const q = quoteSvc.createQuote(USER_ID, {
    clientName:'C', title:'T',
    lines:[{ description:'X', qty:1, unitPrice:100000 }],
    vatCountry:'NG',
  });
  const result = invoiceSvc.invoiceFromQuote(USER_ID, q.id);
  assert(result?.error, 'should fail on non-accepted quote');
});

test('invoiceFromQuote creates invoice from accepted quote', () => {
  testDb.reset();
  const q = quoteSvc.createQuote(USER_ID, {
    clientName:'Lagos Corp', title:'Brand design',
    lines:[{ description:'Logo', qty:1, unitPrice:200000 }],
    vatCountry:'NG',
  });
  quoteSvc.transitionQuote(q.id, USER_ID, 'sent');
  quoteSvc.transitionQuote(q.id, USER_ID, 'accepted');
  const inv = invoiceSvc.invoiceFromQuote(USER_ID, q.id);
  assertNotNull(inv, 'invoice must be created');
  assertEqual(inv.quoteId, q.id);
  assertEqual(inv.subtotal, 200000);
});

test('recordPayment updates amountPaid and status', () => {
  testDb.reset();
  const inv = invoiceSvc.createInvoice(USER_ID, {
    clientName:'C', title:'Inv', total:100000, currency:'NGN',
  });
  const updated = invoiceSvc.recordPayment(inv.id, USER_ID, {
    amount: 100000, method: 'paystack', reference: 'REF001',
  });
  assertEqual(updated.status, 'paid');
  assertEqual(updated.amountPaid, 100000);
});

test('recordPayment partial payment sets status to partial', () => {
  testDb.reset();
  const inv = invoiceSvc.createInvoice(USER_ID, {
    clientName:'C', title:'Inv', total:100000, currency:'NGN',
  });
  const updated = invoiceSvc.recordPayment(inv.id, USER_ID, {
    amount: 50000, method: 'bank_transfer',
  });
  assertEqual(updated.status, 'partial');
  assertEqual(updated.amountPaid, 50000);
});

test('invoice auto-marks overdue when past due date', () => {
  testDb.reset();
  const past = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const inv  = invoiceSvc.createInvoice(USER_ID, {
    clientName:'C', title:'Inv', total:50000, currency:'NGN',
    status:'sent', dueDate: past,
  });
  const fetched = invoiceSvc.getInvoice(inv.id, USER_ID);
  assertEqual(fetched.status, 'overdue');
});

test('invoiceStats counts correctly', () => {
  testDb.reset();
  invoiceSvc.createInvoice(USER_ID, { clientName:'A', title:'I1', total:10000, currency:'NGN', status:'paid', amountPaid:10000 });
  const inv2 = invoiceSvc.createInvoice(USER_ID, { clientName:'B', title:'I2', total:20000, currency:'NGN' });
  const past = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  invoiceSvc.createInvoice(USER_ID, { clientName:'C', title:'I3', total:30000, currency:'NGN', status:'sent', dueDate:past });
  const stats = invoiceSvc.invoiceStats(USER_ID);
  assertEqual(stats.total, 3);
  assertEqual(stats.paid, 1);
  assertEqual(stats.overdue, 1);
});

// ─────────────────────────────────────────────────────────────────
// CONTRACT SERVICE
// ─────────────────────────────────────────────────────────────────
test('createContract stores a draft with revision defaults', () => {
  testDb.reset();
  const c = contractSvc.createContract(USER_ID, {
    title: 'Brand SOW',
    clientName: 'ACME',
    revisionRoundsAllowed: 2,
    body: 'Service agreement body',
    value: 320000,
    currency: 'NGN',
  });
  assertEqual(c.status, 'draft');
  assertEqual(c.revisionRoundsUsed, 0);
  assertEqual(c.revisionRoundsAllowed, 2);
  assert(c.signatureToken, 'must have signing token');
});

test('sendContract changes status to sent', () => {
  testDb.reset();
  const c = contractSvc.createContract(USER_ID, { title:'T', body:'B', clientName:'C' });
  const sent = contractSvc.sendContract(c.id, USER_ID);
  assertEqual(sent.status, 'sent');
  assertNotNull(sent.sentAt);
});

test('signContract via token changes status to signed', () => {
  testDb.reset();
  const c    = contractSvc.createContract(USER_ID, { title:'T', body:'B', clientName:'C' });
  contractSvc.sendContract(c.id, USER_ID);
  const fresh = contractSvc.getContract(c.id, USER_ID);
  const res   = contractSvc.signContract(fresh.signatureToken, 'John Doe', 'john@example.com');
  assertEqual(res.status, 'signed');
  assertEqual(res.signerName, 'John Doe');
  assertNotNull(res.signedAt);
});

test('signContract rejects invalid token', () => {
  testDb.reset();
  const res = contractSvc.signContract('invalid-token-xyz', 'John', 'j@j.com');
  assert(res === null, 'should return null for bad token');
});

test('signContract prevents double-signing', () => {
  testDb.reset();
  const c = contractSvc.createContract(USER_ID, { title:'T', body:'B', clientName:'C' });
  contractSvc.sendContract(c.id, USER_ID);
  const fresh = contractSvc.getContract(c.id, USER_ID);
  contractSvc.signContract(fresh.signatureToken, 'John', 'j@j.com');
  const res = contractSvc.signContract(fresh.signatureToken, 'Jane', 'jane@j.com');
  assert(res?.error === 'Already signed', 'should prevent double signing');
});

test('addScopeAlert appends to contract', () => {
  testDb.reset();
  const c     = contractSvc.createContract(USER_ID, { title:'T', body:'B', clientName:'C' });
  const alert = contractSvc.addScopeAlert(c.id, USER_ID, {
    description: 'Client requested extra feature',
    estimatedHours: 8,
  });
  assertNotNull(alert, 'alert must be returned');
  assertEqual(alert.status, 'open');
  const fresh = contractSvc.getContract(c.id, USER_ID);
  assertEqual(fresh.scopeAlerts.length, 1);
});

test('createChangeOrder appends to contract', () => {
  testDb.reset();
  const c  = contractSvc.createContract(USER_ID, { title:'T', body:'B', clientName:'C', currency:'NGN' });
  const co = contractSvc.createChangeOrder(c.id, USER_ID, {
    description: 'Additional feature scope', amount: 50000,
  });
  assertEqual(co.status, 'pending');
  assertEqual(co.amount, 50000);
});

test('logRevision increments counter and detects overflow', () => {
  testDb.reset();
  const c = contractSvc.createContract(USER_ID, {
    title:'T', body:'B', clientName:'C', revisionRoundsAllowed:2,
  });
  const r1 = contractSvc.logRevision(c.id, USER_ID);
  assertEqual(r1.revisionRoundsUsed, 1);
  assert(!r1.exceeded, 'should not be exceeded at 1/2');
  contractSvc.logRevision(c.id, USER_ID);
  const r3 = contractSvc.logRevision(c.id, USER_ID);
  assert(r3.exceeded, 'should be exceeded at 3/2');
});

// ─────────────────────────────────────────────────────────────────
// SITE SERVICE
// ─────────────────────────────────────────────────────────────────
test('createSite stores a new site', () => {
  testDb.reset();
  const s = siteSvc.createSite(USER_ID, {
    name: 'Lekki Phase 2',
    city: 'Lagos',
    country: 'NG',
    budget: 50000000,
    currency: 'NGN',
  });
  assertEqual(s.status, 'active');
  assertEqual(s.name, 'Lekki Phase 2');
  assert(Array.isArray(s.tasks), 'tasks must be array');
});

test('addTask to site and retrieve it', () => {
  testDb.reset();
  const s = siteSvc.createSite(USER_ID, { name:'Site A', country:'NG' });
  const t = siteSvc.addTask(s.id, USER_ID, {
    title: 'Foundation pour',
    priority: 'high',
    dueDate: new Date(Date.now() + 7*86400000).toISOString().split('T')[0],
  });
  assertNotNull(t, 'task must be created');
  assertEqual(t.status, 'todo');
  assertEqual(t.priority, 'high');
});

test('updateTask to done marks completedAt', () => {
  testDb.reset();
  const s = siteSvc.createSite(USER_ID, { name:'Site B', country:'NG' });
  const t = siteSvc.addTask(s.id, USER_ID, { title:'Task', priority:'medium' });
  const updated = siteSvc.updateTask(s.id, USER_ID, t.id, { status:'done' });
  assertEqual(updated.status, 'done');
  assertNotNull(updated.completedAt, 'completedAt must be set');
});

test('updateTask auto-marks overdue when past due date', () => {
  testDb.reset();
  const past = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const s = siteSvc.createSite(USER_ID, { name:'Site C', country:'NG' });
  const t = siteSvc.addTask(s.id, USER_ID, { title:'Overdue task', priority:'high', dueDate: past });
  const updated = siteSvc.updateTask(s.id, USER_ID, t.id, { title:'Overdue task' });
  assertEqual(updated.status, 'overdue');
});

test('addMilestone to site', () => {
  testDb.reset();
  const s = siteSvc.createSite(USER_ID, { name:'Site D', country:'NG' });
  const m = siteSvc.addMilestone(s.id, USER_ID, {
    title: 'Structural framing complete',
    phase: 2,
    dueDate: '2026-06-30',
  });
  assertNotNull(m, 'milestone must be created');
  assertEqual(m.status, 'upcoming');
});

test('checkIn and checkOut lifecycle', () => {
  testDb.reset();
  const s    = siteSvc.createSite(USER_ID, { name:'Site E', country:'NG' });
  const cin  = siteSvc.checkIn(USER_ID, { siteId: s.id, latitude: 6.43, longitude: 3.42 });
  assertNotNull(cin);
  assertNotNull(siteSvc.getActiveCheckIn(USER_ID), 'should have active check-in');
  const cout = siteSvc.checkOut(USER_ID);
  assertNotNull(cout.checkOutAt, 'must have checkout time');
  assert(siteSvc.getActiveCheckIn(USER_ID) === null, 'no active check-in after checkout');
});

test('addFieldLog creates log entry', () => {
  testDb.reset();
  const s   = siteSvc.createSite(USER_ID, { name:'Site F', country:'NG' });
  const log = siteSvc.addFieldLog(USER_ID, {
    siteId: s.id,
    type: 'progress',
    content: 'Foundation pour completed on Block D. 40 cubic metres.',
  });
  assertNotNull(log, 'log entry must be created');
  assertEqual(log.type, 'progress');
});

test('siteStats aggregates across all sites', () => {
  testDb.reset();
  siteSvc.createSite(USER_ID, { name:'S1', country:'NG', status:'on_track' });
  siteSvc.createSite(USER_ID, { name:'S2', country:'GH', status:'delayed' });
  siteSvc.createSite(USER_ID, { name:'S3', country:'KE', status:'at_risk' });
  const stats = siteSvc.siteStats(USER_ID);
  assertEqual(stats.total, 3);
  assertEqual(stats.delayed, 1);
  assertEqual(stats.atRisk,  1);
});

// ─────────────────────────────────────────────────────────────────
// TIME SERVICE
// ─────────────────────────────────────────────────────────────────
test('startTimer creates a running timer', () => {
  testDb.reset();
  const t = timeSvc.startTimer(USER_ID, { projectName: 'Brand identity', task: 'Logo design' });
  assertNotNull(t.startAt);
  assert(!t.endAt, 'should not have endAt yet');
});

test('stopTimer records duration', () => {
  testDb.reset();
  timeSvc.startTimer(USER_ID, { projectName:'P', task:'T' });
  const stopped = timeSvc.stopTimer(USER_ID);
  assertNotNull(stopped.endAt);
  assert(typeof stopped.durationSecs === 'number', 'must have durationSecs');
});

test('stopTimer returns error when no timer running', () => {
  testDb.reset();
  const result = timeSvc.stopTimer(USER_ID);
  assert(result?.error, 'should return error');
});

test('startTimer auto-stops any running timer', () => {
  testDb.reset();
  timeSvc.startTimer(USER_ID, { projectName:'P1', task:'T1' });
  timeSvc.startTimer(USER_ID, { projectName:'P2', task:'T2' }); // should stop P1 first
  const running = timeSvc.getRunningTimer(USER_ID);
  assertEqual(running.projectName, 'P2');
});

test('logTime creates manual entry with billable value', () => {
  testDb.reset();
  const entry = timeSvc.logTime(USER_ID, {
    projectName: 'TradaKo', task: 'Wireframes',
    hours: 2, minutes: 30,
    billable: true, hourlyRate: 75000, currency: 'NGN',
  });
  assertEqual(entry.durationSecs, 9000);
  assert(Math.abs(entry.billableValue - 187500) < 1, `billableValue should be 187500, got ${entry.billableValue}`);
});

test('timeReport calculates utilisation correctly', () => {
  testDb.reset();
  timeSvc.logTime(USER_ID, { projectName:'P1', task:'T', hours:3, billable:true,  hourlyRate:50000, currency:'NGN', date:'2026-04-01' });
  timeSvc.logTime(USER_ID, { projectName:'P2', task:'T', hours:1, billable:false, hourlyRate:null,  currency:'NGN', date:'2026-04-01' });
  const report = timeSvc.timeReport(USER_ID, '2026-04-01', '2026-04-07');
  assertEqual(report.totalHours, 4);
  assertEqual(report.billableHours, 3);
  assertEqual(report.utilisationRate, 75);
});

test('calculateMinRate returns minimum hourly rate', () => {
  testDb.reset();
  const result = timeSvc.calculateMinRate({
    targetMonthly: 500000, billableHours: 80, expenses: 80000, taxRate: 7.5,
  });
  assertNotNull(result);
  assert(result.minimumHourlyRate > 7000, 'hourly rate must be reasonable');
});

// ─────────────────────────────────────────────────────────────────
// TAX SERVICE
// ─────────────────────────────────────────────────────────────────
test('calculateVAT Nigeria at 7.5%', () => {
  const r = taxSvc.calculateVAT(100000, 'NG');
  assertEqual(r.rate, 7.5);
  assertEqual(r.vatAmount, 7500);
  assertEqual(r.total, 107500);
});

test('calculateVAT Ghana at 12.5%', () => {
  const r = taxSvc.calculateVAT(10000, 'GH');
  assertEqual(r.rate, 12.5);
  assertEqual(r.vatAmount, 1250);
  assertEqual(r.total, 11250);
});

test('calculateVAT Kenya at 16%', () => {
  const r = taxSvc.calculateVAT(50000, 'KE');
  assertEqual(r.rate, 16);
  assertEqual(r.vatAmount, 8000);
  assertEqual(r.total, 58000);
});

test('calculateVAT South Africa at 15%', () => {
  const r = taxSvc.calculateVAT(100, 'ZA');
  assertEqual(r.rate, 15);
  assertEqual(r.vatAmount, 15);
  assertEqual(r.total, 115);
});

test('calculateVAT unknown country returns zero', () => {
  const r = taxSvc.calculateVAT(100000, 'XX');
  assertEqual(r.rate, 0);
  assertEqual(r.vatAmount, 0);
});

test('calculateWHT Nigeria services at 10%', () => {
  const r = taxSvc.calculateWHT(320000, 'NG', 'services');
  assertEqual(r.rate, 10);
  assertEqual(r.whtAmount, 32000);
  assertEqual(r.netPayable, 288000);
});

test('calculateWHT Nigeria construction at 5%', () => {
  const r = taxSvc.calculateWHT(1000000, 'NG', 'construction');
  assertEqual(r.rate, 5);
  assertEqual(r.whtAmount, 50000);
});

test('getDeadlines returns sorted upcoming deadlines', () => {
  const deadlines = taxSvc.getDeadlines('NG');
  assert(deadlines.length > 0, 'must have deadlines');
  assert(deadlines[0].daysRemaining > 0, 'first deadline must be in future');
  assert(deadlines[0].daysRemaining <= deadlines[deadlines.length-1].daysRemaining,
    'deadlines must be sorted ascending');
});

test('getDeadlines for Kenya includes monthly VAT', () => {
  const deadlines = taxSvc.getDeadlines('KE');
  const vat = deadlines.filter(d => d.type === 'VAT');
  assert(vat.length > 0, 'Kenya must have VAT deadlines');
});

test('checkNTAAExemption: exempt when under threshold with TIN', () => {
  assert(taxSvc.checkNTAAExemption(1_500_000, true), 'should be exempt');
  assert(!taxSvc.checkNTAAExemption(1_500_000, false), 'no TIN = not exempt');
  assert(!taxSvc.checkNTAAExemption(3_000_000, true), 'over threshold = not exempt');
});

// ─────────────────────────────────────────────────────────────────
// CASH FLOW SERVICE
// ─────────────────────────────────────────────────────────────────
test('addExpense stores expense correctly', () => {
  testDb.reset();
  const e = cashSvc.addExpense(USER_ID, {
    description: 'Adobe CC', category: 'software', amount: 45000, currency: 'NGN', taxDeductible: true,
  });
  assertEqual(e.description, 'Adobe CC');
  assertEqual(e.amount, 45000);
  assert(e.taxDeductible, 'should be tax deductible');
});

test('expenseSummary calculates deductible correctly', () => {
  testDb.reset();
  const today = new Date().toISOString().split('T')[0];
  cashSvc.addExpense(USER_ID, { description:'A', amount:100000, currency:'NGN', taxDeductible:true,  category:'software',   date:today });
  cashSvc.addExpense(USER_ID, { description:'B', amount:50000,  currency:'NGN', taxDeductible:false, category:'operations', date:today });
  const summary = cashSvc.expenseSummary(USER_ID, today, today);
  assertEqual(summary.total, 150000);
  assertEqual(summary.deductible, 100000);
  assert(Math.abs(summary.deductibleRate - 67) < 1, `deductibleRate should be ~67, got ${summary.deductibleRate}`);
});

test('businessHealthScore returns score between 0 and 100', () => {
  testDb.reset();
  const health = cashSvc.businessHealthScore(USER_ID);
  assert(health.overall >= 0 && health.overall <= 100, `score ${health.overall} must be 0-100`);
  assert(typeof health.grade === 'string', 'must have a grade');
  assert(Array.isArray(health.recommendations), 'must have recommendations array');
});

test('cashFlowOverview returns structured result', () => {
  testDb.reset();
  const overview = cashSvc.cashFlowOverview(USER_ID);
  assert(overview, 'overview must exist');
  assertNotNull(overview.thisMonth, 'must have thisMonth');
});

test('cashFlowForecast returns weekly buckets', () => {
  testDb.reset();
  const q = quoteSvc.createQuote(USER_ID, {
    clientName:'C', title:'T',
    lines:[{ description:'X', qty:1, unitPrice:200000 }],
    vatCountry:'NG',
  });
  quoteSvc.transitionQuote(q.id, USER_ID, 'sent');
  quoteSvc.transitionQuote(q.id, USER_ID, 'accepted');
  invoiceSvc.invoiceFromQuote(USER_ID, q.id);
  const forecast = cashSvc.cashFlowForecast(USER_ID, 4);
  assert(Array.isArray(forecast), 'forecast must be array');
});

// PROPOSAL SERVICE
// ─────────────────────────────────────────────────────────────────
const proposalSvc = require('../src/services/proposal.service');

test('createProposal stores draft with correct defaults', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, {
    title:          'Digital transformation for BetaRide',
    clientName:     'BetaRide Lagos',
    estimatedValue: 850000,
    currency:       'NGN',
    proposalType:   'technology',
  });
  assertEqual(p.stage, 'draft');
  assertEqual(p.title, 'Digital transformation for BetaRide');
  assertEqual(p.estimatedValue, 850000);
  assert(p.number.startsWith('PRO-'), 'must have proposal number');
  assert(p.id, 'must have an id');
  assert(Array.isArray(p.activities), 'activities must be an array');
  assert(p.activities.length >= 1, 'creation activity must be auto-logged');
});

test('createProposal computes estimatedProbability from stage', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, {
    title: 'Test', clientName: 'Client', estimatedValue: 100000,
  });
  assert(typeof p.estimatedProbability === 'number', 'must have estimatedProbability');
  assertEqual(p.estimatedProbability, proposalSvc.STAGES['draft'].defaultProbability);
});

test('createProposal computes weightedValue correctly', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, {
    title: 'Test', clientName: 'Client',
    estimatedValue: 1000000,
    winProbabilityOverride: 40,
  });
  assertEqual(p.weightedValue, 400000);
});

test('transitionProposal draft → sent is valid and sets sentAt', () => {
  testDb.reset();
  const p    = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  const sent = proposalSvc.transitionProposal(p.id, USER_ID, 'sent');
  assertEqual(sent.stage, 'sent');
  assertNotNull(sent.sentAt, 'sentAt must be set');
  assert(sent.activities.some(a => a.type === 'stage_change'), 'stage change must be logged');
});

test('transitionProposal auto-sets follow-up date for active stages', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  const sent = proposalSvc.transitionProposal(p.id, USER_ID, 'sent');
  assertNotNull(sent.followUpDate, 'followUpDate must be auto-set after sent');
  assert(sent.followUpDate > new Date().toISOString().split('T')[0], 'followUpDate must be in future');
});

test('transitionProposal sent → draft is invalid', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  proposalSvc.transitionProposal(p.id, USER_ID, 'sent');
  const result = proposalSvc.transitionProposal(p.id, USER_ID, 'draft');
  assert(result?.error, 'should return error for invalid transition');
});

test('transitionProposal sent → viewed increments viewCount', () => {
  testDb.reset();
  const p    = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  proposalSvc.transitionProposal(p.id, USER_ID, 'sent');
  const viewed = proposalSvc.transitionProposal(p.id, USER_ID, 'viewed');
  assertEqual(viewed.stage, 'viewed');
  assertEqual(viewed.viewCount, 1);
  assertNotNull(viewed.lastViewedAt);
});

test('transitionProposal → won sets readyForContract flag', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  proposalSvc.transitionProposal(p.id, USER_ID, 'sent');
  proposalSvc.transitionProposal(p.id, USER_ID, 'viewed');
  proposalSvc.transitionProposal(p.id, USER_ID, 'meeting_scheduled');
  proposalSvc.transitionProposal(p.id, USER_ID, 'negotiating');
  const won = proposalSvc.transitionProposal(p.id, USER_ID, 'won');
  assertEqual(won.stage, 'won');
  assertNotNull(won.wonAt);
  assert(won.readyForContract, 'must flag readyForContract');
});

test('transitionProposal → lost captures reason', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  proposalSvc.transitionProposal(p.id, USER_ID, 'sent');
  const lost = proposalSvc.transitionProposal(p.id, USER_ID, 'lost', { reason: 'Client chose competitor' });
  assertEqual(lost.stage, 'lost');
  assertEqual(lost.lostReason, 'Client chose competitor');
  assertNotNull(lost.lostAt);
});

test('addActivity logs entry to proposal timeline', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  const entry = proposalSvc.addActivity(p.id, USER_ID, {
    type:    'follow_up',
    content: 'Called client. Interested — wants pricing breakdown.',
    outcome: 'positive',
    nextFollowUpDate: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
  });
  assertNotNull(entry, 'activity entry must be returned');
  assertEqual(entry.type, 'follow_up');
  assertEqual(entry.outcome, 'positive');

  const fresh = proposalSvc.getProposal(p.id, USER_ID);
  assert(fresh.activities.some(a => a.id === entry.id), 'activity must be in proposal timeline');
  assertNotNull(fresh.followUpDate, 'followUpDate must be updated');
});

test('addActivity supports meeting type', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  const entry = proposalSvc.addActivity(p.id, USER_ID, {
    type:    'meeting',
    content: 'Presentation meeting completed. Client very engaged.',
  });
  assertEqual(entry.type, 'meeting');
});

test('convertToContract fails on non-won proposal', () => {
  testDb.reset();
  const p      = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  const result = proposalSvc.convertToContract(p.id, USER_ID, {});
  assert(result?.error, 'should fail — proposal not won');
});

test('convertToContract creates contract and links it', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, {
    title: 'ERP implementation',
    clientName: 'FinTech Lagos',
    estimatedValue: 2000000,
    currency: 'NGN',
    scopeOfWork: 'Full ERP deployment including training.',
  });
  // Walk through to won
  proposalSvc.transitionProposal(p.id, USER_ID, 'sent');
  proposalSvc.transitionProposal(p.id, USER_ID, 'viewed');
  proposalSvc.transitionProposal(p.id, USER_ID, 'meeting_scheduled');
  proposalSvc.transitionProposal(p.id, USER_ID, 'negotiating');
  proposalSvc.transitionProposal(p.id, USER_ID, 'won');

  const result = proposalSvc.convertToContract(p.id, USER_ID, {
    revisionRoundsAllowed: 3,
  });
  assertNotNull(result.contract, 'contract must be created');
  assertEqual(result.contract.value, 2000000);
  assertNotNull(result.proposal.contractId, 'contractId must be linked to proposal');
  assertEqual(result.proposal.contractId, result.contract.id);
});

test('convertToContract cannot be called twice', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 500000 });
  proposalSvc.transitionProposal(p.id, USER_ID, 'sent');
  proposalSvc.transitionProposal(p.id, USER_ID, 'viewed');
  proposalSvc.transitionProposal(p.id, USER_ID, 'meeting_scheduled');
  proposalSvc.transitionProposal(p.id, USER_ID, 'negotiating');
  proposalSvc.transitionProposal(p.id, USER_ID, 'won');
  proposalSvc.convertToContract(p.id, USER_ID, {});
  const second = proposalSvc.convertToContract(p.id, USER_ID, {});
  assert(second?.error, 'second conversion must be prevented');
});

test('pipelineStats returns correct funnel counts', () => {
  testDb.reset();
  proposalSvc.createProposal(USER_ID, { title: 'A', clientName: 'C1', estimatedValue: 100000 });
  const p2 = proposalSvc.createProposal(USER_ID, { title: 'B', clientName: 'C2', estimatedValue: 200000 });
  proposalSvc.transitionProposal(p2.id, USER_ID, 'sent');
  const p3 = proposalSvc.createProposal(USER_ID, { title: 'C', clientName: 'C3', estimatedValue: 300000 });
  proposalSvc.transitionProposal(p3.id, USER_ID, 'sent');
  proposalSvc.transitionProposal(p3.id, USER_ID, 'viewed');
  proposalSvc.transitionProposal(p3.id, USER_ID, 'meeting_scheduled');
  proposalSvc.transitionProposal(p3.id, USER_ID, 'negotiating');
  proposalSvc.transitionProposal(p3.id, USER_ID, 'won');

  const stats = proposalSvc.pipelineStats(USER_ID);
  assertEqual(stats.total,  3);
  assertEqual(stats.active, 2);
  assertEqual(stats.won,    1);
  assertEqual(stats.winRate,100); // 1 won, 0 lost = 100%
  assertNotNull(stats.funnel);
  assert(stats.funnel.length > 0, 'funnel must have entries');

  const sentStage = stats.funnel.find(f => f.stage === 'sent');
  assertNotNull(sentStage);
  assertEqual(sentStage.count, 1);
});

test('pipelineStats winRate is 0 when no decisions made', () => {
  testDb.reset();
  proposalSvc.createProposal(USER_ID, { title: 'A', clientName: 'C', estimatedValue: 100000 });
  const stats = proposalSvc.pipelineStats(USER_ID);
  assertEqual(stats.winRate, 0);
});

test('upcomingFollowUps returns proposals due within window', () => {
  testDb.reset();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 8 * 86400000).toISOString().split('T')[0];

  const p1 = proposalSvc.createProposal(USER_ID, { title: 'Due soon',  clientName: 'A', estimatedValue: 0, followUpDate: tomorrow });
  const p2 = proposalSvc.createProposal(USER_ID, { title: 'Due later', clientName: 'B', estimatedValue: 0, followUpDate: nextWeek });

  const due = proposalSvc.upcomingFollowUps(USER_ID, 7);
  assert(due.some(p => p.id === p1.id), 'tomorrow follow-up must be in 7-day window');
  assert(!due.some(p => p.id === p2.id), 'next week must not be in 7-day window');
});

test('deleteProposal allows deleting draft', () => {
  testDb.reset();
  const p      = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  const result = proposalSvc.deleteProposal(p.id, USER_ID);
  assert(result?.deleted, 'draft proposal must be deletable');
  assert(!proposalSvc.getProposal(p.id, USER_ID), 'proposal must be gone');
});

test('deleteProposal blocks deleting active proposal', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  proposalSvc.transitionProposal(p.id, USER_ID, 'sent');
  const result = proposalSvc.deleteProposal(p.id, USER_ID);
  assert(result?.error, 'sent proposal must not be deletable');
});

test('listProposals filters by stage', () => {
  testDb.reset();
  proposalSvc.createProposal(USER_ID, { title: 'Draft one', clientName: 'C', estimatedValue: 0 });
  const p2 = proposalSvc.createProposal(USER_ID, { title: 'Sent one', clientName: 'C', estimatedValue: 0 });
  proposalSvc.transitionProposal(p2.id, USER_ID, 'sent');

  const drafts = proposalSvc.listProposals(USER_ID, { stage: 'draft' });
  assertEqual(drafts.length, 1);
  assertEqual(drafts[0].title, 'Draft one');
});

test('listProposals search filters by title and clientName', () => {
  testDb.reset();
  proposalSvc.createProposal(USER_ID, { title: 'ERP system', clientName: 'FinTech Lagos', estimatedValue: 0 });
  proposalSvc.createProposal(USER_ID, { title: 'Brand identity', clientName: 'BetaRide', estimatedValue: 0 });

  const results = proposalSvc.listProposals(USER_ID, { search: 'erp' });
  assertEqual(results.length, 1);
  assertEqual(results[0].title, 'ERP system');
});

test('generateViewLink creates viewToken', () => {
  testDb.reset();
  const p      = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  const result = proposalSvc.generateViewLink(p.id, USER_ID);
  assertNotNull(result?.viewToken, 'viewToken must be generated');
  assert(result.link.includes(result.viewToken), 'link must include token');
});

test('recordView increments viewCount and auto-advances sent → viewed', () => {
  testDb.reset();
  const p = proposalSvc.createProposal(USER_ID, { title: 'T', clientName: 'C', estimatedValue: 0 });
  proposalSvc.transitionProposal(p.id, USER_ID, 'sent');
  const { viewToken } = proposalSvc.generateViewLink(p.id, USER_ID);

  const viewed = proposalSvc.recordView(viewToken);
  assertNotNull(viewed);
  assertEqual(viewed.stage, 'viewed');
  assertEqual(viewed.viewCount, 1);
});

// ─────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log('  AfriQuote — Test Results');
console.log('═'.repeat(60));

results.forEach(r => {
  const icon = r.ok ? '  ✓' : '  ✗';
  const msg  = r.ok ? `\x1b[32m${icon}  ${r.name}\x1b[0m` : `\x1b[31m${icon}  ${r.name}\n      → ${r.error}\x1b[0m`;
  console.log(msg);
});

console.log('\n' + '─'.repeat(60));
const pct = Math.round((passed / total) * 100);
if (failed === 0) {
  console.log(`\x1b[32m  ✓  All ${total} tests passed (100%)\x1b[0m`);
} else {
  console.log(`\x1b[31m  ✗  ${failed} test(s) failed\x1b[0m  |  \x1b[32m${passed} passed\x1b[0m  |  ${total} total  |  ${pct}%`);
}
console.log('─'.repeat(60) + '\n');

if (failed > 0) process.exit(1);

// ─────────────────────────────────────────────────────────────────
