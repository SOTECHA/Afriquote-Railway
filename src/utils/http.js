/**
 * AfriQuote — HTTP Helpers
 * Lightweight request/response utilities for the vanilla Node HTTP server.
 */

'use strict';

const { URL } = require('url');

/** Parse JSON body from a request */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/** Parse URL query params */
function parseQuery(req) {
  try {
    const u = new URL(req.url, 'http://localhost');
    const out = {};
    u.searchParams.forEach((v, k) => { out[k] = v; });
    return out;
  } catch {
    return {};
  }
}

/** Parse URL path params from a pattern like /api/quotes/:id */
function matchRoute(pattern, pathname) {
  const patParts = pattern.split('/');
  const urlParts = pathname.split('/');
  if (patParts.length !== urlParts.length) return null;
  const params = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(':')) {
      params[patParts[i].slice(1)] = decodeURIComponent(urlParts[i]);
    } else if (patParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

/** Send a JSON response */
function send(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Convenience response helpers */
const ok       = (res, data)    => send(res, 200, { success: true,  ...data });
const created  = (res, data)    => send(res, 201, { success: true,  ...data });
const noContent= (res)          => { res.writeHead(204); res.end(); };
const badReq   = (res, msg)     => send(res, 400, { success: false, error: msg });
const unauth   = (res, msg='Unauthorized') => send(res, 401, { success: false, error: msg });
const forbidden= (res, msg='Forbidden')    => send(res, 403, { success: false, error: msg });
const notFound = (res, msg='Not found')    => send(res, 404, { success: false, error: msg });
const conflict = (res, msg)     => send(res, 409, { success: false, error: msg });
const serverErr= (res, msg='Internal server error') => send(res, 500, { success: false, error: msg });

/** Extract bearer token from Authorization header */
function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

module.exports = {
  parseBody, parseQuery, matchRoute,
  send, ok, created, noContent, badReq, unauth, forbidden, notFound, conflict, serverErr,
  bearerToken
};
