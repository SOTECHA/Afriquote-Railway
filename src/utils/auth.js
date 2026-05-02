/**
 * AfriQuote — Auth Utilities
 * HMAC-SHA256 signed tokens, bcrypt-style password hashing via crypto.
 */

'use strict';

const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'afriquote-secret-change-in-production-2026';
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

/* ─── Token ─── */

function signToken(payload) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = b64url(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL }));
  const sig     = b64url(crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest());
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp < Date.now()) return null; // expired
  return payload;
}

function b64url(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return buf.toString('base64url');
}

/* ─── Password hashing (PBKDF2 via crypto) ─── */

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plain, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.pbkdf2Sync(plain, salt, 100_000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
}

/* ─── ID generator ─── */
function newId() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = { signToken, verifyToken, hashPassword, verifyPassword, newId };
