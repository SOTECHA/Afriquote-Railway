'use strict';

const db  = require('../utils/db');
const { hashPassword, verifyPassword, signToken, newId } = require('../utils/auth');
const { parseBody, ok, created, badReq, unauth, conflict } = require('../utils/http');

async function register(req, res) {
  let body;
  try { body = await parseBody(req); } catch { return badReq(res, 'Invalid JSON'); }

  const { name, email, password, country, currency, businessName } = body;
  if (!name || !email || !password) return badReq(res, 'name, email and password are required');
  if (password.length < 8)          return badReq(res, 'Password must be at least 8 characters');
  if (db.findOne('users', u => u.email === email.toLowerCase())) {
    return conflict(res, 'Email already registered');
  }

  const user = db.insert('users', {
    id:           newId(),
    name,
    email:        email.toLowerCase(),
    passwordHash: hashPassword(password),
    country:      country   || 'NG',
    currency:     currency  || 'NGN',
    businessName: businessName || name,
    tin:          null,
    vatRegistered:false,
    createdAt:    new Date().toISOString(),
  });

  const token = signToken({ userId: user.id, email: user.email });
  return created(res, { token, user: safeUser(user) });
}

async function login(req, res) {
  let body;
  try { body = await parseBody(req); } catch { return badReq(res, 'Invalid JSON'); }

  const { email, password } = body;
  if (!email || !password) return badReq(res, 'email and password required');

  const user = db.findOne('users', u => u.email === email.toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return unauth(res, 'Invalid credentials');
  }

  const token = signToken({ userId: user.id, email: user.email });
  db.update('users', u => u.id === user.id, { lastLoginAt: new Date().toISOString() });
  return ok(res, { token, user: safeUser(user) });
}

function getProfile(req, res) {
  const user = db.findOne('users', u => u.id === req.user.userId);
  if (!user) return unauth(res);
  return ok(res, { user: safeUser(user) });
}

async function updateProfile(req, res) {
  let body;
  try { body = await parseBody(req); } catch { return badReq(res, 'Invalid JSON'); }
  const allowed = ['name','businessName','country','currency','tin','vatRegistered','phone'];
  const patch   = {};
  allowed.forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
  const updated = db.update('users', u => u.id === req.user.userId, patch);
  return ok(res, { user: safeUser(updated) });
}

function safeUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

module.exports = { register, login, getProfile, updateProfile };
