'use strict';

const { verifyToken } = require('../utils/auth');
const { unauth, forbidden } = require('../utils/http');

/**
 * Authenticate a request using the Bearer token.
 * Attaches `req.user = { userId, email }` on success.
 */
function authenticate(req, res, next) {
  const h = req.headers['authorization'] || '';
  if (!h.startsWith('Bearer ')) return unauth(res, 'Authentication required');
  const token   = h.slice(7);
  const payload = verifyToken(token);
  if (!payload) return unauth(res, 'Invalid or expired token');
  req.user = payload; // { userId, email, iat, exp }
  next();
}

/**
 * Role-based access. Roles stored on the user record in the DB.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    const db   = require('../utils/db');
    const user = db.findOne('users', u => u.id === req.user.userId);
    if (!user) return unauth(res);
    if (!roles.includes(user.role)) return forbidden(res, 'Insufficient permissions');
    req.userRecord = user;
    next();
  };
}

module.exports = { authenticate, requireRole };
