const router = require('express').Router();
const { body, query } = require('express-validator');
const { getDb } = require('../config/db');
const { auth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { uid, now, randomToken, paginate } = require('../utils/helpers');

router.use(auth);

// GET /api/clients
router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  const where = `WHERE org_id=? AND (name LIKE ? OR email LIKE ? OR company_name LIKE ?)`;
  const params = [req.orgId, `%${search}%`, `%${search}%`, `%${search}%`];

  const total = db.prepare(`SELECT COUNT(*) as c FROM clients ${where}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM clients ${where} ORDER BY name LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  res.json({ success: true, data: rows, meta: paginate(total, page, limit) });
});

// POST /api/clients
router.post('/', [
  body('name').trim().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
  body('country').optional().isLength({ min: 2, max: 3 }),
], validate, (req, res) => {
  const db = getDb();
  const id = uid();
  const { name, email, phone, country, currency, address, company_name, tin, notes } = req.body;
  const portal_token = randomToken(24);

  db.prepare(`
    INSERT INTO clients(id,org_id,name,email,phone,country,currency,address,company_name,tin,notes,portal_token)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, req.orgId, name, email||null, phone||null, country||'NG',
         currency||'NGN', address||null, company_name||null, tin||null, notes||null, portal_token);

  const client = db.prepare(`SELECT * FROM clients WHERE id=?`).get(id);
  res.status(201).json({ success: true, data: client });
});

// GET /api/clients/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const client = db.prepare(`SELECT * FROM clients WHERE id=? AND org_id=?`).get(req.params.id, req.orgId);
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

  // Attach summary stats
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM quotes WHERE client_id=? AND org_id=?) as total_quotes,
      (SELECT COUNT(*) FROM invoices WHERE client_id=? AND org_id=?) as total_invoices,
      (SELECT COALESCE(SUM(amount_paid),0) FROM invoices WHERE client_id=? AND org_id=?) as total_paid,
      (SELECT COALESCE(SUM(amount_due),0) FROM invoices WHERE client_id=? AND org_id=? AND status='overdue') as overdue_amount
  `).get(req.params.id, req.orgId, req.params.id, req.orgId,
         req.params.id, req.orgId, req.params.id, req.orgId);

  res.json({ success: true, data: { ...client, stats } });
});

// PATCH /api/clients/:id
router.patch('/:id', [
  body('name').optional().trim().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
], validate, (req, res) => {
  const db = getDb();
  const client = db.prepare(`SELECT id FROM clients WHERE id=? AND org_id=?`).get(req.params.id, req.orgId);
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });
  const fields = ['name','email','phone','country','currency','address','company_name','tin','notes'];
  const updates = fields.filter(f => req.body[f] !== undefined).map(f => `${f}=?`).join(',');
  const values = fields.filter(f => req.body[f] !== undefined).map(f => req.body[f]);
  if (updates) {
    db.prepare(`UPDATE clients SET ${updates}, updated_at=? WHERE id=?`).run(...values, now(), req.params.id);
  }
  res.json({ success: true, data: db.prepare(`SELECT * FROM clients WHERE id=?`).get(req.params.id) });
});

// DELETE /api/clients/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const client = db.prepare(`SELECT id FROM clients WHERE id=? AND org_id=?`).get(req.params.id, req.orgId);
  if (!client) return res.status(404).json({ success: false, error: 'Not found' });
  db.prepare(`DELETE FROM clients WHERE id=?`).run(req.params.id);
  res.json({ success: true, message: 'Client deleted' });
});

// POST /api/clients/:id/portal/toggle
router.post('/:id/portal/toggle', (req, res) => {
  const db = getDb();
  const client = db.prepare(`SELECT * FROM clients WHERE id=? AND org_id=?`).get(req.params.id, req.orgId);
  if (!client) return res.status(404).json({ success: false, error: 'Not found' });
  const newState = client.portal_active ? 0 : 1;
  const token = newState ? (client.portal_token || randomToken(24)) : client.portal_token;
  db.prepare(`UPDATE clients SET portal_active=?, portal_token=?, updated_at=? WHERE id=?`)
    .run(newState, token, now(), client.id);
  res.json({ success: true, data: { portal_active: newState, portal_token: newState ? token : null } });
});

module.exports = router;
