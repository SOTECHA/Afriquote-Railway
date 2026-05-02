'use strict';

const { parseBody, parseQuery, ok, created, badReq, notFound, serverErr } = require('../utils/http');

const quoteSvc    = require('../services/quote.service');
const invoiceSvc  = require('../services/invoice.service');
const contractSvc = require('../services/contract.service');
const siteSvc     = require('../services/site.service');
const timeSvc     = require('../services/time.service');
const taxSvc      = require('../services/tax.service');
const cashSvc     = require('../services/cashflow.service');
const db          = require('../utils/db');
const { newId }   = require('../utils/auth');

/* ════════════════════════════
   CLIENTS
════════════════════════════ */
async function createClient(req, res) {
  const body = await parseBody(req);
  if (!body.name) return badReq(res, 'name is required');
  const client = db.insert('clients', { id: newId(), userId: req.user.userId, createdAt: new Date().toISOString(), ...body });
  return created(res, { client });
}
function listClients(req, res) {
  const clients = db.find('clients', c => c.userId === req.user.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return ok(res, { clients });
}
function getClient(req, res) {
  const client = db.findOne('clients', c => c.id === req.params.id && c.userId === req.user.userId);
  if (!client) return notFound(res);
  return ok(res, { client });
}
async function updateClient(req, res) {
  const body = await parseBody(req);
  const c = db.findOne('clients', c => c.id === req.params.id && c.userId === req.user.userId);
  if (!c) return notFound(res);
  const updated = db.update('clients', c => c.id === req.params.id, body);
  return ok(res, { client: updated });
}

/* ════════════════════════════
   QUOTES
════════════════════════════ */
async function createQuote(req, res) {
  const body = await parseBody(req);
  if (!body.clientName) return badReq(res, 'clientName is required');
  const quote = quoteSvc.createQuote(req.user.userId, body);
  return created(res, { quote });
}
function listQuotes(req, res) {
  const q = parseQuery(req);
  const quotes = quoteSvc.listQuotes(req.user.userId, q);
  return ok(res, { quotes, stats: quoteSvc.quoteStats(req.user.userId) });
}
function getQuote(req, res) {
  const quote = quoteSvc.getQuote(req.params.id, req.user.userId);
  if (!quote) return notFound(res);
  return ok(res, { quote });
}
async function updateQuote(req, res) {
  const body = await parseBody(req);
  const quote = quoteSvc.updateQuote(req.params.id, req.user.userId, body);
  if (!quote) return notFound(res);
  return ok(res, { quote });
}
async function transitionQuote(req, res) {
  const body = await parseBody(req);
  const result = quoteSvc.transitionQuote(req.params.id, req.user.userId, body.status);
  if (result?.error) return badReq(res, result.error);
  if (!result)       return notFound(res);
  return ok(res, { quote: result });
}
function deleteQuote(req, res) {
  const result = quoteSvc.deleteQuote(req.params.id, req.user.userId);
  if (result?.error) return badReq(res, result.error);
  if (!result)       return notFound(res);
  return ok(res, { message: 'Quote deleted' });
}

/* ════════════════════════════
   INVOICES
════════════════════════════ */
async function createInvoice(req, res) {
  const body = await parseBody(req);
  if (!body.clientName && !body.quoteId) return badReq(res, 'clientName or quoteId required');
  // Shortcut: create from quote
  if (body.quoteId) {
    const invoice = invoiceSvc.invoiceFromQuote(req.user.userId, body.quoteId);
    if (!invoice) return notFound(res, 'Quote not found or not accepted');
    if (invoice.error) return badReq(res, invoice.error);
    return created(res, { invoice });
  }
  const invoice = invoiceSvc.createInvoice(req.user.userId, body);
  return created(res, { invoice });
}
function listInvoices(req, res) {
  const q = parseQuery(req);
  const invoices = invoiceSvc.listInvoices(req.user.userId, q);
  return ok(res, { invoices, stats: invoiceSvc.invoiceStats(req.user.userId) });
}
function getInvoice(req, res) {
  const invoice = invoiceSvc.getInvoice(req.params.id, req.user.userId);
  if (!invoice) return notFound(res);
  return ok(res, { invoice });
}
async function recordPayment(req, res) {
  const body = await parseBody(req);
  if (!body.amount) return badReq(res, 'amount required');
  const invoice = invoiceSvc.recordPayment(req.params.id, req.user.userId, body);
  if (!invoice) return notFound(res);
  return ok(res, { invoice });
}
async function sendReminder(req, res) {
  const body = await parseBody(req);
  const result = invoiceSvc.logReminder(req.params.id, req.user.userId, body.channel || 'email');
  if (!result) return notFound(res);
  return ok(res, { message: 'Reminder logged', invoice: result });
}

/* ════════════════════════════
   CONTRACTS
════════════════════════════ */
function listContractTemplates(_req, res) {
  return ok(res, { templates: contractSvc.CONTRACT_TEMPLATES });
}
async function createContract(req, res) {
  const body = await parseBody(req);
  if (!body.title) return badReq(res, 'title required');
  const contract = contractSvc.createContract(req.user.userId, body);
  return created(res, { contract });
}
function listContracts(req, res) {
  const contracts = contractSvc.listContracts(req.user.userId, parseQuery(req));
  return ok(res, { contracts });
}
function getContract(req, res) {
  const contract = contractSvc.getContract(req.params.id, req.user.userId);
  if (!contract) return notFound(res);
  return ok(res, { contract });
}
async function updateContract(req, res) {
  const body = await parseBody(req);
  const c = contractSvc.updateContract(req.params.id, req.user.userId, body);
  if (!c) return notFound(res);
  return ok(res, { contract: c });
}
function sendContract(req, res) {
  const c = contractSvc.sendContract(req.params.id, req.user.userId);
  if (!c) return notFound(res);
  return ok(res, { contract: c, signingLink: `/api/public/sign/${c.signatureToken}` });
}
async function signContract(req, res) {
  const body = await parseBody(req);
  const c = contractSvc.signContract(req.params.token, body.signerName, body.signerEmail);
  if (!c) return notFound(res, 'Invalid or expired signing link');
  if (c.error) return badReq(res, c.error);
  return ok(res, { message: 'Contract signed successfully', contract: c });
}
async function addScopeAlert(req, res) {
  const body = await parseBody(req);
  const alert = contractSvc.addScopeAlert(req.params.id, req.user.userId, body);
  if (!alert) return notFound(res);
  return created(res, { alert });
}
async function createChangeOrder(req, res) {
  const body = await parseBody(req);
  const co = contractSvc.createChangeOrder(req.params.id, req.user.userId, body);
  if (!co) return notFound(res);
  return created(res, { changeOrder: co });
}

/* ════════════════════════════
   SITES
════════════════════════════ */
async function createSite(req, res) {
  const body = await parseBody(req);
  if (!body.name) return badReq(res, 'name required');
  return created(res, { site: siteSvc.createSite(req.user.userId, body) });
}
function listSites(req, res) {
  return ok(res, { sites: siteSvc.listSites(req.user.userId), stats: siteSvc.siteStats(req.user.userId) });
}
function getSite(req, res) {
  const site = siteSvc.getSite(req.params.id, req.user.userId);
  if (!site) return notFound(res);
  return ok(res, { site });
}
async function updateSite(req, res) {
  const body = await parseBody(req);
  const site = siteSvc.updateSite(req.params.id, req.user.userId, body);
  if (!site) return notFound(res);
  return ok(res, { site });
}
async function addTask(req, res) {
  const body = await parseBody(req);
  const task = siteSvc.addTask(req.params.id, req.user.userId, body);
  if (!task) return notFound(res);
  return created(res, { task });
}
async function updateTask(req, res) {
  const body = await parseBody(req);
  const task = siteSvc.updateTask(req.params.id, req.user.userId, req.params.taskId, body);
  if (!task) return notFound(res);
  return ok(res, { task });
}
async function addMilestone(req, res) {
  const body = await parseBody(req);
  const milestone = siteSvc.addMilestone(req.params.id, req.user.userId, body);
  if (!milestone) return notFound(res);
  return created(res, { milestone });
}
async function checkIn(req, res) {
  const body = await parseBody(req);
  const record = siteSvc.checkIn(req.user.userId, { siteId: req.params.id, ...body });
  return created(res, { checkIn: record });
}
function checkOut(req, res) {
  const result = siteSvc.checkOut(req.user.userId);
  if (result?.error) return badReq(res, result.error);
  return ok(res, { checkOut: result });
}
function getActiveCheckIn(req, res) {
  return ok(res, { activeCheckIn: siteSvc.getActiveCheckIn(req.user.userId) });
}
async function addFieldLog(req, res) {
  const body = await parseBody(req);
  const entry = siteSvc.addFieldLog(req.user.userId, { siteId: req.params.id, ...body });
  return created(res, { entry });
}
function getFieldLog(req, res) {
  const q   = parseQuery(req);
  const log = siteSvc.getFieldLog(req.user.userId, req.params.id, Number(q.limit) || 100);
  return ok(res, { log });
}

/* ════════════════════════════
   TIME TRACKING
════════════════════════════ */
async function startTimer(req, res) {
  const body = await parseBody(req);
  return created(res, { timer: timeSvc.startTimer(req.user.userId, body) });
}
function stopTimer(req, res) {
  const result = timeSvc.stopTimer(req.user.userId);
  if (result?.error) return badReq(res, result.error);
  return ok(res, { timer: result });
}
function getRunningTimer(req, res) {
  return ok(res, { timer: timeSvc.getRunningTimer(req.user.userId) });
}
async function logTime(req, res) {
  const body = await parseBody(req);
  return created(res, { entry: timeSvc.logTime(req.user.userId, body) });
}
function listTimeLogs(req, res) {
  const q = parseQuery(req);
  return ok(res, { logs: timeSvc.listTimeLogs(req.user.userId, q) });
}
function timeReport(req, res) {
  const { from, to } = parseQuery(req);
  const now = new Date();
  const report = timeSvc.timeReport(
    req.user.userId,
    from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
    to   || now.toISOString().split('T')[0]
  );
  return ok(res, { report });
}
async function calcRate(req, res) {
  const body = await parseBody(req);
  const result = timeSvc.calculateMinRate(body);
  if (!result) return badReq(res, 'targetMonthly and billableHours required');
  return ok(res, { result });
}

/* ════════════════════════════
   TAX
════════════════════════════ */
function taxConfig(req, res) {
  return ok(res, { vatConfig: taxSvc.VAT_CONFIG, whtConfig: taxSvc.WHT_CONFIG, currencies: taxSvc.CURRENCIES });
}
function taxDeadlines(req, res) {
  const { country } = parseQuery(req);
  const code = country || db.findOne('users', u => u.id === req.user.userId)?.country || 'NG';
  return ok(res, { deadlines: taxSvc.getDeadlines(code), country: code });
}
async function calcVAT(req, res) {
  const body = await parseBody(req);
  const { subtotal, country } = body;
  if (!subtotal || !country) return badReq(res, 'subtotal and country required');
  return ok(res, { calculation: taxSvc.calculateVAT(Number(subtotal), country) });
}
async function calcWHT(req, res) {
  const body = await parseBody(req);
  const { amount, country, serviceType } = body;
  if (!amount || !country) return badReq(res, 'amount and country required');
  return ok(res, { calculation: taxSvc.calculateWHT(Number(amount), country, serviceType) });
}

/* ════════════════════════════
   CASH FLOW & EXPENSES
════════════════════════════ */
async function addExpense(req, res) {
  const body = await parseBody(req);
  if (!body.description || !body.amount) return badReq(res, 'description and amount required');
  return created(res, { expense: cashSvc.addExpense(req.user.userId, body) });
}
function listExpenses(req, res) {
  const q = parseQuery(req);
  const expenses = cashSvc.listExpenses(req.user.userId, q);
  const now = new Date();
  const summary = cashSvc.expenseSummary(req.user.userId,
    q.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
    q.to   || now.toISOString().split('T')[0]
  );
  return ok(res, { expenses, summary });
}
function cashFlowOverview(req, res) {
  return ok(res, { overview: cashSvc.cashFlowOverview(req.user.userId) });
}
function cashFlowForecast(req, res) {
  const { weeks } = parseQuery(req);
  return ok(res, { forecast: cashSvc.cashFlowForecast(req.user.userId, Number(weeks) || 4) });
}
function healthScore(req, res) {
  return ok(res, { health: cashSvc.businessHealthScore(req.user.userId) });
}

/* ════════════════════════════
   DASHBOARD
════════════════════════════ */
function dashboard(req, res) {
  const userId = req.user.userId;
  return ok(res, {
    quotes:   quoteSvc.quoteStats(userId),
    invoices: invoiceSvc.invoiceStats(userId),
    sites:    siteSvc.siteStats(userId),
    cashFlow: cashSvc.cashFlowOverview(userId),
    health:   cashSvc.businessHealthScore(userId),
  });
}

module.exports = {
  // clients
  createClient, listClients, getClient, updateClient,
  // quotes
  createQuote, listQuotes, getQuote, updateQuote, transitionQuote, deleteQuote,
  // invoices
  createInvoice, listInvoices, getInvoice, recordPayment, sendReminder,
  // contracts
  listContractTemplates, createContract, listContracts, getContract, updateContract,
  sendContract, signContract, addScopeAlert, createChangeOrder,
  // sites
  createSite, listSites, getSite, updateSite,
  addTask, updateTask, addMilestone,
  checkIn, checkOut, getActiveCheckIn, addFieldLog, getFieldLog,
  // time
  startTimer, stopTimer, getRunningTimer, logTime, listTimeLogs, timeReport, calcRate,
  // tax
  taxConfig, taxDeadlines, calcVAT, calcWHT,
  // cashflow
  addExpense, listExpenses, cashFlowOverview, cashFlowForecast, healthScore,
  // dashboard
  dashboard,
};

/* ════════════════════════════
   NOTIFICATIONS
════════════════════════════ */
function listNotifications(req, res) {
  const db   = require('../utils/db');
  const q    = parseQuery(req);
  let notifs = db.find('notifications', n => n.userId === req.user.userId);
  if (q.unread === 'true') notifs = notifs.filter(n => !n.isRead);
  notifs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const unreadCount = db.find('notifications', n => n.userId === req.user.userId && !n.isRead).length;
  return ok(res, { notifications: notifs, unreadCount });
}

async function markNotificationRead(req, res) {
  const db = require('../utils/db');
  db.update('notifications', n => n.id === req.params.id && n.userId === req.user.userId,
    { isRead: true, readAt: new Date().toISOString() });
  return ok(res, { message: 'Notification marked as read' });
}

async function markAllRead(req, res) {
  const db = require('../utils/db');
  const notifs = db.find('notifications', n => n.userId === req.user.userId && !n.isRead);
  notifs.forEach(n => db.update('notifications', x => x.id === n.id,
    { isRead: true, readAt: new Date().toISOString() }));
  return ok(res, { message: `${notifs.length} notifications marked as read` });
}

Object.assign(module.exports, { listNotifications, markNotificationRead, markAllRead });

/* ════════════════════════════════════════════════
   PROPOSAL TRACKER
════════════════════════════════════════════════ */
const proposalSvc = require('../services/proposal.service');

/* GET /api/proposals — list + stats */
function listProposals(req, res) {
  const q         = parseQuery(req);
  const proposals = proposalSvc.listProposals(req.user.userId, q);
  const stats     = proposalSvc.pipelineStats(req.user.userId);
  const upcoming  = proposalSvc.upcomingFollowUps(req.user.userId, 7);
  return ok(res, { proposals, stats, upcomingFollowUps: upcoming });
}

/* GET /api/proposals/pipeline — kanban board data */
function getPipeline(req, res) {
  const stats     = proposalSvc.pipelineStats(req.user.userId);
  const proposals = proposalSvc.listProposals(req.user.userId, {});
  const byStage   = {};
  Object.keys(proposalSvc.STAGES).forEach(s => { byStage[s] = []; });
  proposals.forEach(p => { if (byStage[p.stage]) byStage[p.stage].push(p); });
  return ok(res, { pipeline: byStage, stages: proposalSvc.STAGES, stats });
}

/* GET /api/proposals/follow-ups — due in next N days */
function getFollowUps(req, res) {
  const { days } = parseQuery(req);
  const list = proposalSvc.upcomingFollowUps(req.user.userId, parseInt(days) || 7);
  return ok(res, { followUps: list, count: list.length });
}

/* POST /api/proposals — create */
async function createProposal(req, res) {
  const body = await parseBody(req);
  if (!body.title)      return badReq(res, 'title is required');
  if (!body.clientName) return badReq(res, 'clientName is required');
  const p = proposalSvc.createProposal(req.user.userId, body);
  return created(res, { proposal: p });
}

/* GET /api/proposals/:id — single */
function getProposal(req, res) {
  const p = proposalSvc.getProposal(req.params.id, req.user.userId);
  if (!p) return notFound(res);
  return ok(res, { proposal: p });
}

/* PUT /api/proposals/:id — update fields */
async function updateProposal(req, res) {
  const body = await parseBody(req);
  const p    = proposalSvc.updateProposal(req.params.id, req.user.userId, body);
  if (!p) return notFound(res);
  return ok(res, { proposal: p });
}

/* DELETE /api/proposals/:id */
function deleteProposal(req, res) {
  const result = proposalSvc.deleteProposal(req.params.id, req.user.userId);
  if (!result)         return notFound(res);
  if (result.error)    return badReq(res, result.error);
  return ok(res, { message: 'Proposal deleted' });
}

/* POST /api/proposals/:id/stage — transition stage */
async function transitionProposalStage(req, res) {
  const body   = await parseBody(req);
  if (!body.stage) return badReq(res, 'stage is required');
  const result = proposalSvc.transitionProposal(req.params.id, req.user.userId, body.stage, body);
  if (!result)       return notFound(res);
  if (result.error)  return badReq(res, result.error);
  return ok(res, { proposal: result });
}

/* POST /api/proposals/:id/activity — log activity / follow-up */
async function addProposalActivity(req, res) {
  const body = await parseBody(req);
  if (!body.content && !body.type) return badReq(res, 'content or type required');
  const entry = proposalSvc.addActivity(req.params.id, req.user.userId, body);
  if (!entry) return notFound(res);
  return created(res, { activity: entry });
}

/* POST /api/proposals/:id/convert — won proposal → contract */
async function convertProposalToContract(req, res) {
  const body   = await parseBody(req);
  const result = proposalSvc.convertToContract(req.params.id, req.user.userId, body);
  if (!result)      return notFound(res);
  if (result.error) return badReq(res, result.error);
  return created(res, result);
}

/* POST /api/proposals/:id/link-quote — link an existing quote */
async function linkProposalQuote(req, res) {
  const body   = await parseBody(req);
  if (!body.quoteId) return badReq(res, 'quoteId required');
  const result = proposalSvc.linkQuote(req.params.id, req.user.userId, body.quoteId);
  if (!result || result.error) return badReq(res, result?.error || 'Not found');
  return ok(res, { proposal: result });
}

/* POST /api/proposals/:id/view-link — generate shareable view link */
function generateProposalViewLink(req, res) {
  const result = proposalSvc.generateViewLink(req.params.id, req.user.userId);
  if (!result) return notFound(res);
  return ok(res, result);
}

/* GET /api/public/proposals/:token — client views proposal (no auth) */
function publicViewProposal(req, res) {
  const p = proposalSvc.recordView(req.params.token);
  if (!p) return notFound(res, 'Proposal not found or link has expired');
  // Return safe subset only
  const { userId, viewToken, activities, winProbabilityOverride, ...safe } = p;
  return ok(res, { proposal: safe });
}

Object.assign(module.exports, {
  listProposals, getPipeline, getFollowUps,
  createProposal, getProposal, updateProposal, deleteProposal,
  transitionProposalStage, addProposalActivity,
  convertProposalToContract, linkProposalQuote,
  generateProposalViewLink, publicViewProposal,
});
