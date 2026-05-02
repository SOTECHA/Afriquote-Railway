'use strict';

const { verifyToken } = require('../utils/auth');
const { unauth, bearerToken } = require('../utils/http');

function requireAuth(req, res, next) {
  const token = bearerToken(req);
  const payload = verifyToken(token);
  if (!payload) return unauth(res);
  req.user = payload;
  next();
}

module.exports = { requireAuth };
