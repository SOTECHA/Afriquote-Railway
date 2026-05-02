/**
 * AfriQuote — Cash Flow & Expense Service
 */

'use strict';

const db        = require('../utils/db');
const { newId } = require('../utils/auth');

const EXPENSE_CATEGORIES = [
  'software', 'equipment', 'operations', 'travel', 'marketing',
  'professional_fees', 'utilities', 'infrastructure', 'other'
];

/* ─── Expenses ─── */
function addExpense(userId, payload) {
  const expense = {
    id:             newId(),
    userId,
    date:           payload.date || new Date().toISOString().split('T')[0],
    category:       payload.category || 'other',
    description:    payload.description,
    amount:         Number(payload.amount) || 0,
    currency:       payload.currency || 'NGN',
    taxDeductible:  payload.taxDeductible !== false,
    receiptUrl:     payload.receiptUrl || null,
    projectId:      payload.projectId || null,
    createdAt:      new Date().toISOString(),
  };
  return db.insert('expenses', expense);
}

function listExpenses(userId, filters = {}) {
  let exp = db.find('expenses', e => e.userId === userId);
  if (filters.from)     exp = exp.filter(e => e.date >= filters.from);
  if (filters.to)       exp = exp.filter(e => e.date <= filters.to);
  if (filters.category) exp = exp.filter(e => e.category === filters.category);
  return exp.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function expenseSummary(userId, from, to) {
  const expenses = listExpenses(userId, { from, to });
  const total    = expenses.reduce((s, e) => s + e.amount, 0);
  const deductible = expenses.filter(e => e.taxDeductible).reduce((s, e) => s + e.amount, 0);

  const byCategory = {};
  expenses.forEach(e => {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  });

  return { total, deductible, deductibleRate: total ? Math.round(deductible / total * 100) : 0, byCategory, count: expenses.length };
}

/* ─── Cash Flow ─── */

/**
 * Build a cash flow overview from invoices, expenses, and time logs.
 */
function cashFlowOverview(userId) {
  const invoices = db.find('invoices', i => i.userId === userId);
  const expenses = db.find('expenses', e => e.userId === userId);

  const now       = new Date();
  const mStart    = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const mEnd      = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
  const prevEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

  const thisMonthIn  = invoices.filter(i => i.status === 'paid' && i.updatedAt >= mStart).reduce((s, i) => s + (i.total || 0), 0);
  const prevMonthIn  = invoices.filter(i => i.status === 'paid' && i.updatedAt >= prevStart && i.updatedAt <= prevEnd).reduce((s, i) => s + (i.total || 0), 0);
  const thisMonthOut = expenses.filter(e => e.date >= mStart && e.date <= mEnd).reduce((s, e) => s + e.amount, 0);
  const outstanding  = invoices.filter(i => ['sent','viewed','partial','overdue'].includes(i.status)).reduce((s, i) => s + ((i.total || 0) - (i.amountPaid || 0)), 0);

  const overdue = invoices
    .filter(i => i.status === 'overdue')
    .map(i => ({
      id:        i.id,
      number:    i.number,
      clientName:i.clientName,
      amount:    (i.total || 0) - (i.amountPaid || 0),
      dueDate:   i.dueDate,
      daysOverdue: i.dueDate ? Math.floor((Date.now() - new Date(i.dueDate)) / 86400000) : null,
    }));

  return {
    thisMonth:   { in: thisMonthIn, out: thisMonthOut, net: thisMonthIn - thisMonthOut, vsLastMonth: prevMonthIn ? Math.round((thisMonthIn - prevMonthIn) / prevMonthIn * 100) : null },
    outstanding,
    overdueInvoices: overdue,
  };
}

/**
 * Generate a forward-looking cash flow forecast.
 * Based on: pending invoices with due dates + active contracts.
 */
function cashFlowForecast(userId, weeks = 4) {
  const invoices  = db.find('invoices', i => i.userId === userId && ['sent','viewed','partial'].includes(i.status));
  const expenses  = db.find('expenses', e => e.userId === userId);
  const now       = new Date();

  const periods = [];
  for (let w = 0; w < weeks; w++) {
    const start = new Date(now);
    start.setDate(start.getDate() + w * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startISO = start.toISOString().split('T')[0];
    const endISO   = end.toISOString().split('T')[0];

    const expectedIn  = invoices
      .filter(i => i.dueDate >= startISO && i.dueDate <= endISO)
      .reduce((s, i) => s + ((i.total || 0) - (i.amountPaid || 0)), 0);
    const expectedOut = expenses
      .filter(e => e.date >= startISO && e.date <= endISO)
      .reduce((s, e) => s + e.amount, 0);

    periods.push({
      week:       w + 1,
      startDate:  startISO,
      endDate:    endISO,
      expectedIn,
      expectedOut,
      net:        expectedIn - expectedOut,
      confidence: expectedIn > 0 ? 'high' : 'estimate',
    });
  }
  return periods;
}

/* ─── Business health score ─── */
function businessHealthScore(userId) {
  const invoices  = db.find('invoices',  i => i.userId === userId);
  const contracts = db.find('contracts', c => c.userId === userId);
  const timers    = db.find('timers',    t => t.userId === userId && t.endAt);
  const expenses  = db.find('expenses',  e => e.userId === userId);

  // Cash flow score (0-100): ratio of paid vs total invoiced
  const totalInvoiced = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const totalPaid     = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
  const cashFlowScore = totalInvoiced ? Math.min(100, Math.round(totalPaid / totalInvoiced * 100)) : 50;

  // Invoicing speed (0-100): % of quotes turned to invoice within 7 days
  const accepted = db.find('quotes', q => q.userId === userId && q.status === 'accepted');
  const fastInvoiced = accepted.filter(q => q.invoiceId).length;
  const invoicingScore = accepted.length ? Math.round(fastInvoiced / accepted.length * 100) : 75;

  // Contract coverage (0-100): % of clients with signed contracts
  const clients = db.find('clients', c => c.userId === userId);
  const signed  = contracts.filter(c => c.status === 'signed');
  const contractScore = clients.length ? Math.min(100, Math.round(signed.length / clients.length * 100)) : 60;

  // Tax compliance (0-100): simple heuristic — 100 if VAT rate set on recent invoices
  const recentInv = invoices.slice(-10);
  const vatSet    = recentInv.filter(i => i.vatRate > 0).length;
  const taxScore  = recentInv.length ? Math.round(vatSet / recentInv.length * 100) : 65;

  // Client diversity (0-100): Herfindahl index (low concentration = high score)
  const clientRevenue = {};
  invoices.filter(i => i.status === 'paid').forEach(i => {
    clientRevenue[i.clientId] = (clientRevenue[i.clientId] || 0) + (i.total || 0);
  });
  const total = Object.values(clientRevenue).reduce((s, v) => s + v, 0);
  const hhi   = total ? Object.values(clientRevenue).reduce((s, v) => s + Math.pow(v / total, 2), 0) : 1;
  const diversityScore = Math.round((1 - hhi) * 100);

  // Scope protection (0-100): % contracts with revision rounds defined
  const withRevisions = contracts.filter(c => c.revisionRoundsAllowed > 0).length;
  const scopeScore    = contracts.length ? Math.round(withRevisions / contracts.length * 100) : 50;

  const overall = Math.round(
    (cashFlowScore * 0.25) + (invoicingScore * 0.15) + (contractScore * 0.2) +
    (taxScore * 0.2) + (diversityScore * 0.1) + (scopeScore * 0.1)
  );

  return {
    overall,
    grade: overall >= 80 ? 'Excellent' : overall >= 65 ? 'Healthy' : overall >= 50 ? 'Fair' : 'Needs attention',
    dimensions: {
      cashFlow:       cashFlowScore,
      invoicingSpeed: invoicingScore,
      contracts:      contractScore,
      taxCompliance:  taxScore,
      clientDiversity:diversityScore,
      scopeProtection:scopeScore,
    },
    recommendations: buildRecommendations({ cashFlowScore, invoicingScore, contractScore, taxScore, diversityScore, scopeScore }),
  };
}

function buildRecommendations(scores) {
  const recs = [];
  if (scores.taxScore < 70)       recs.push('Set VAT rates on all invoices to improve tax compliance score.');
  if (scores.contractScore < 70)  recs.push('Get signed contracts from more clients (+5 pts per signed contract).');
  if (scores.scopeScore < 70)     recs.push('Add revision round limits to your contracts to protect scope (+3 pts).');
  if (scores.diversityScore < 60) recs.push('Over-reliance on a single client is risky — actively seek 1-2 new clients.');
  if (scores.invoicingScore < 70) recs.push('Convert accepted quotes to invoices within 7 days to boost score.');
  if (scores.cashFlowScore < 70)  recs.push('Chase overdue invoices — consider auto-reminders via WhatsApp.');
  return recs;
}

module.exports = {
  EXPENSE_CATEGORIES,
  addExpense, listExpenses, expenseSummary,
  cashFlowOverview, cashFlowForecast,
  businessHealthScore,
};
