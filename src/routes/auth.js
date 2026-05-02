const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const { getDb } = require('../config/db');
const { validate } = require('../middleware/validate');
const { auth } = require('../middleware/auth');
const { uid, now, randomToken, hashToken } = require('../utils/helpers');

function makeTokens(userId) {
  const access = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
  const refresh = randomToken(48);
  return { access, refresh };
}

// POST /api/auth/register
router.post('/register', [
  body('full_name').trim().notEmpty().withMessage('Full name required'),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be 8+ characters'),
  body('org_name').trim().notEmpty().withMessage('Organisation name required'),
  body('country').optional().isLength({ min: 2, max: 3 }),
], validate, async (req, res) => {
  const db = getDb();
  const { full_name, email, password, org_name, country = 'NG' } = req.body;

  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
    return res.status(409).json({ success: false, error: 'Email already registered' });
  }

  const orgId = uid();
  const userId = uid();
  const hash = await bcrypt.hash(password, 12);

  // Map country to currency
  const currencyMap = { NG:'NGN', GH:'GHS', KE:'KES', ZA:'ZAR', RW:'RWF' };
  const currency = currencyMap[country] || 'USD';

  const insertOrg = db.transaction(() => {
    db.prepare(
      `INSERT INTO organisations(id,name,country,currency) VALUES(?,?,?,?)`
    ).run(orgId, org_name, country, currency);

    db.prepare(
      `INSERT INTO users(id,org_id,email,password_hash,full_name,role) VALUES(?,?,?,?,?,'owner')`
    ).run(userId, orgId, email, hash, full_name);
  });

  insertOrg();

  const { access, refresh } = makeTokens(userId);
  const refreshHash = hashToken(refresh);
  const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)`)
    .run(uid(), userId, refreshHash, exp);

  return res.status(201).json({
    success: true,
    data: { access_token: access, refresh_token: refresh,
            user: { id: userId, full_name, email, role: 'owner', org_id: orgId } }
  });
});

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], validate, async (req, res) => {
  const db = getDb();
  const { email, password } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE email=? AND is_active=1`).get(email);
  if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ success: false, error: 'Invalid credentials' });

  db.prepare(`UPDATE users SET last_login_at=? WHERE id=?`).run(now(), user.id);

  const { access, refresh } = makeTokens(user.id);
  const refreshHash = hashToken(refresh);
  const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)`)
    .run(uid(), user.id, refreshHash, exp);

  return res.json({
    success: true,
    data: { access_token: access, refresh_token: refresh,
            user: { id: user.id, full_name: user.full_name, email: user.email,
                    role: user.role, org_id: user.org_id } }
  });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ success: false, error: 'No refresh token' });
  const db = getDb();
  const h = hashToken(refresh_token);
  const row = db.prepare(`SELECT * FROM refresh_tokens WHERE token_hash=? AND expires_at > datetime('now')`).get(h);
  if (!row) return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
  db.prepare(`DELETE FROM refresh_tokens WHERE id=?`).run(row.id);
  const { access, refresh: newRefresh } = makeTokens(row.user_id);
  const exp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)`)
    .run(uid(), row.user_id, hashToken(newRefresh), exp);
  return res.json({ success: true, data: { access_token: access, refresh_token: newRefresh } });
});

// POST /api/auth/logout
router.post('/logout', auth, (req, res) => {
  const { refresh_token } = req.body;
  if (refresh_token) {
    const db = getDb();
    db.prepare(`DELETE FROM refresh_tokens WHERE token_hash=?`).run(hashToken(refresh_token));
  }
  return res.json({ success: true, message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  const u = req.user;
  res.json({ success: true, data: {
    id: u.id, full_name: u.full_name, email: u.email,
    role: u.role, org_id: u.org_id, plan: u.plan,
    avatar_url: u.avatar_url, phone: u.phone
  }});
});

// PATCH /api/auth/me
router.patch('/me', auth, [
  body('full_name').optional().trim().notEmpty(),
  body('phone').optional().trim(),
], validate, (req, res) => {
  const db = getDb();
  const { full_name, phone } = req.body;
  db.prepare(`UPDATE users SET full_name=COALESCE(?,full_name), phone=COALESCE(?,phone), updated_at=? WHERE id=?`)
    .run(full_name, phone, now(), req.user.id);
  res.json({ success: true, message: 'Profile updated' });
});

// POST /api/auth/change-password
router.post('/change-password', auth, [
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 8 }),
], validate, async (req, res) => {
  const db = getDb();
  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  const ok = await bcrypt.compare(req.body.current_password, user.password_hash);
  if (!ok) return res.status(400).json({ success: false, error: 'Current password incorrect' });
  const hash = await bcrypt.hash(req.body.new_password, 12);
  db.prepare(`UPDATE users SET password_hash=?, updated_at=? WHERE id=?`).run(hash, now(), user.id);
  res.json({ success: true, message: 'Password updated' });
});

module.exports = router;
