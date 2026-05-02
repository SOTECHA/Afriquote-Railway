/**
 * AfriQuote — Master Router
 * Pure Node.js HTTP router. Zero external dependencies.
 */
'use strict';

const { matchRoute, notFound, serverErr, unauth, ok, badReq, parseBody, bearerToken } = require('../utils/http');
const { verifyToken } = require('../utils/auth');

const auth        = require('./auth.routes');
const api         = require('./api.routes');
const contractSvc = require('../services/contract.service');

// ── Route table ─────────────────────────────────────────────────
// [METHOD, pattern, handler, requiresAuth]
const ROUTES = [
  // ── Auth (public) ──────────────────────────────────────────
  ['POST', '/api/auth/register',          auth.register,                  false],
  ['POST', '/api/auth/login',             auth.login,                     false],
  ['GET',  '/api/auth/me',                auth.getProfile,                true ],
  ['PUT',  '/api/auth/profile',           auth.updateProfile,             true ],

  // ── Clients ────────────────────────────────────────────────
  ['GET',  '/api/clients',                api.listClients,                true ],
  ['POST', '/api/clients',                api.createClient,               true ],
  ['GET',  '/api/clients/:id',            api.getClient,                  true ],
  ['PUT',  '/api/clients/:id',            api.updateClient,               true ],

  // ── Quotes ─────────────────────────────────────────────────
  ['GET',  '/api/quotes',                 api.listQuotes,                 true ],
  ['POST', '/api/quotes',                 api.createQuote,                true ],
  ['GET',  '/api/quotes/:id',             api.getQuote,                   true ],
  ['PUT',  '/api/quotes/:id',             api.updateQuote,                true ],
  ['POST', '/api/quotes/:id/status',      api.transitionQuote,            true ],
  ['DELETE','/api/quotes/:id',            api.deleteQuote,                true ],

  // ── Invoices ───────────────────────────────────────────────
  ['GET',  '/api/invoices',               api.listInvoices,               true ],
  ['POST', '/api/invoices',               api.createInvoice,              true ],
  ['GET',  '/api/invoices/:id',           api.getInvoice,                 true ],
  ['POST', '/api/invoices/:id/payment',   api.recordPayment,              true ],
  ['POST', '/api/invoices/:id/remind',    api.sendReminder,               true ],

  // ── Contracts ──────────────────────────────────────────────
  ['GET',  '/api/contracts/templates',    api.listContractTemplates,      true ],
  ['GET',  '/api/contracts',              api.listContracts,              true ],
  ['POST', '/api/contracts',              api.createContract,             true ],
  ['GET',  '/api/contracts/:id',          api.getContract,                true ],
  ['PUT',  '/api/contracts/:id',          api.updateContract,             true ],
  ['POST', '/api/contracts/:id/send',     api.sendContract,               true ],
  ['POST', '/api/contracts/:id/scope-alert',   api.addScopeAlert,         true ],
  ['POST', '/api/contracts/:id/change-order',  api.createChangeOrder,     true ],


  // ── Proposals ──────────────────────────────────────────────
  ['GET',  '/api/proposals/pipeline',          api.getPipeline,                true ],
  ['GET',  '/api/proposals/follow-ups',        api.getFollowUps,               true ],
  ['GET',  '/api/proposals',                   api.listProposals,              true ],
  ['POST', '/api/proposals',                   api.createProposal,             true ],
  ['GET',  '/api/proposals/:id',               api.getProposal,                true ],
  ['PUT',  '/api/proposals/:id',               api.updateProposal,             true ],
  ['DELETE','/api/proposals/:id',              api.deleteProposal,             true ],
  ['POST', '/api/proposals/:id/stage',         api.transitionProposalStage,    true ],
  ['POST', '/api/proposals/:id/activity',      api.addProposalActivity,        true ],
  ['POST', '/api/proposals/:id/convert',       api.convertProposalToContract,  true ],
  ['POST', '/api/proposals/:id/link-quote',    api.linkProposalQuote,          true ],
  ['POST', '/api/proposals/:id/view-link',     api.generateProposalViewLink,   true ],

  // ── Public proposal view (no auth) ──────────────────────────
  ['GET',  '/api/public/proposals/:token',     api.publicViewProposal,         false],
  // ── Public signing (no auth) ───────────────────────────────
  ['GET',  '/api/public/sign/:token',     publicGetContract,              false],
  ['POST', '/api/public/sign/:token',     publicSignContract,             false],

  // ── Sites ──────────────────────────────────────────────────
  ['GET',  '/api/sites',                  api.listSites,                  true ],
  ['POST', '/api/sites',                  api.createSite,                 true ],
  ['GET',  '/api/sites/:id',              api.getSite,                    true ],
  ['PUT',  '/api/sites/:id',              api.updateSite,                 true ],
  ['POST', '/api/sites/:id/tasks',        api.addTask,                    true ],
  ['PUT',  '/api/sites/:id/tasks/:taskId',api.updateTask,                 true ],
  ['POST', '/api/sites/:id/milestones',   api.addMilestone,               true ],
  ['POST', '/api/sites/:id/checkin',      api.checkIn,                    true ],
  ['POST', '/api/checkin/checkout',       api.checkOut,                   true ],
  ['GET',  '/api/checkin/active',         api.getActiveCheckIn,           true ],
  ['POST', '/api/sites/:id/field-log',    api.addFieldLog,                true ],
  ['GET',  '/api/sites/:id/field-log',    api.getFieldLog,                true ],

  // ── Time tracking ──────────────────────────────────────────
  ['POST', '/api/time/start',             api.startTimer,                 true ],
  ['POST', '/api/time/stop',              api.stopTimer,                  true ],
  ['GET',  '/api/time/running',           api.getRunningTimer,            true ],
  ['POST', '/api/time/log',               api.logTime,                    true ],
  ['GET',  '/api/time/logs',              api.listTimeLogs,               true ],
  ['GET',  '/api/time/report',            api.timeReport,                 true ],
  ['POST', '/api/time/rate-calc',         api.calcRate,                   true ],

  // ── Tax ────────────────────────────────────────────────────
  ['GET',  '/api/tax/config',             api.taxConfig,                  false],
  ['GET',  '/api/tax/deadlines',          api.taxDeadlines,               true ],
  ['POST', '/api/tax/calc-vat',           api.calcVAT,                    true ],
  ['POST', '/api/tax/calc-wht',           api.calcWHT,                    true ],

  // ── Cash flow & Expenses ───────────────────────────────────
  ['GET',  '/api/expenses',               api.listExpenses,               true ],
  ['POST', '/api/expenses',               api.addExpense,                 true ],
  ['GET',  '/api/cashflow',               api.cashFlowOverview,           true ],
  ['GET',  '/api/cashflow/forecast',      api.cashFlowForecast,           true ],

  // ── Health & Dashboard ─────────────────────────────────────
  ['GET',  '/api/health',                 api.healthScore,                true ],
  ['GET',  '/api/dashboard',              api.dashboard,                  true ],

  // ── Notifications ──────────────────────────────────────────
  ['GET',  '/api/notifications',          api.listNotifications,          true ],
  ['PUT',  '/api/notifications/:id/read', api.markNotificationRead,       true ],
  ['POST', '/api/notifications/read-all', api.markAllRead,                true ],
];

// ── Public contract signing ──────────────────────────────────────
function publicGetContract(req, res) {
  const c = contractSvc.getContractByToken(req.params.token);
  if (!c) return badReq(res, 'Invalid or expired signing link');
  const { signatureToken, userId, ...safe } = c;
  return ok(res, { contract: safe });
}

async function publicSignContract(req, res) {
  const body   = await parseBody(req);
  if (!body.signerName) return badReq(res, 'signerName required');
  const result = contractSvc.signContract(req.params.token, body.signerName, body.signerEmail);
  if (!result)        return badReq(res, 'Invalid or expired signing link');
  if (result.error)   return badReq(res, result.error);
  return ok(res, { message: 'Contract signed successfully' });
}

// ── CORS headers ─────────────────────────────────────────────────
function corsHeaders() {
  const origin = process.env.ALLOWED_ORIGINS || '*';
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
  };
}

// ── Main dispatcher ──────────────────────────────────────────────
async function dispatch(req, res) {
  const method   = req.method.toUpperCase();
  const pathname = req.url.split('?')[0].replace(/\/$/, '') || '/';

  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  // Health check
  if (method === 'GET' && pathname === '/health') {
    return ok(res, { status: 'ok', service: 'afriquote-api', ts: new Date().toISOString() });
  }

  for (const [m, pattern, handler, needsAuth] of ROUTES) {
    if (m !== method) continue;
    const params = matchRoute(pattern, pathname);
    if (params === null) continue;

    req.params = params;

    if (needsAuth) {
      const token   = bearerToken(req);
      const payload = token ? verifyToken(token) : null;
      if (!payload) return unauth(res, 'Authentication required');
      req.user = payload;
    }

    try {
      await handler(req, res);
    } catch (err) {
      console.error(`[ERROR] ${method} ${pathname}:`, err.message);
      if (process.env.NODE_ENV === 'development') console.error(err.stack);
      serverErr(res, process.env.NODE_ENV === 'development' ? err.message : 'Internal server error');
    }
    return;
  }

  notFound(res, `${method} ${pathname} not found`);
}

module.exports = { dispatch, corsHeaders };
