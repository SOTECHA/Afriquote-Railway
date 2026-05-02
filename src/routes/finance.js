const router = require('express').Router();
const { body } = require('express-validator');
const { getDb } = require('../config/db');
const { auth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { uid, now, quoteNumber, invoiceNumber, getVatRate, paginate } = require('../utils/helpers');

router.use(auth);

// ── QUOTES ──────────────────────────────────────────

router.get('/quotes', (req, res) => {
  const db = getDb();
  const { status, client_id, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let where = 'WHERE q.org_id=?'; const p = [req.orgId];
  if (status) { where += ' AND q.status=?'; p.push(status); }
  if (client_id) { where += ' AND q.client_id=?'; p.push(client_id); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM quotes q ${where}`).get(...p).c;
  const rows = db.prepare(`
    SELECT q.*, c.name as client_name, c.country as client_country
    FROM quotes q LEFT JOIN clients c ON c.id=q.client_id
    ${where} ORDER BY q.created_at DESC LIMIT ? OFFSET ?
  `).all(...p, limit, offset);

  res.json({ success: true, data: rows, meta: paginate(total, +page, +limit) });
});

router.get('/quotes/:id', (req, res) => {
  const db = getDb();
  const q = db.prepare(`
    SELECT q.*, c.name as client_name, c.email as client_email, c.country as client_country
    FROM quotes q LEFT JOIN clients c ON c.id=q.client_id
    WHERE q.id=? AND q.org_id=?
  `).get(req.params.id, req.orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Quote not found' });
  const items = db.prepare(`SELECT * FROM quote_items WHERE quote_id=? ORDER BY sort_order`).all(req.params.id);
  res.json({ success: true, data: { ...q, items } });
});

router.post('/quotes', [
  body('client_id').notEmpty(),
  body('title').trim().notEmpty(),
  body('items').isArray({ min: 1 }),
  body('items.*.description').notEmpty(),
  body('items.*.quantity').isFloat({ min: 0.01 }),
  body('items.*.unit_price').isFloat({ min: 0 }),
], validate, (req, res) => {
  const db = getDb();
  const { client_id, title, items, currency, tax_rate, payment_terms, notes, valid_until } = req.body;

  const client = db.prepare(`SELECT * FROM clients WHERE id=? AND org_id=?`).get(client_id, req.orgId);
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

  const subtotal = items.reduce((s, i) => s + (i.quantity * i.unit_price), 0);
  const effectiveTax = tax_rate !== undefined ? +tax_rate : getVatRate(client.country);
  const tax_amount = subtotal * effectiveTax / 100;
  const total = subtotal + tax_amount;
  const qNum = quoteNumber(db, req.orgId);
  const id = uid();

  const insert = db.transaction(() => {
    db.prepare(`
      INSERT INTO quotes(id,org_id,client_id,quote_number,title,currency,subtotal,tax_rate,tax_amount,total,payment_terms,notes,valid_until,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, req.orgId, client_id, qNum, title, currency||client.currency||'NGN',
           subtotal, effectiveTax, tax_amount, total, payment_terms||null, notes||null,
           valid_until||null, req.user.id);

    items.forEach((item, idx) => {
      const lineTotal = item.quantity * item.unit_price;
      db.prepare(`INSERT INTO quote_items(id,quote_id,description,quantity,unit_price,total,sort_order) VALUES(?,?,?,?,?,?,?)`)
        .run(uid(), id, item.description, item.quantity, item.unit_price, lineTotal, idx);
    });
  });
  insert();

  const q = db.prepare(`SELECT * FROM quotes WHERE id=?`).get(id);
  const qItems = db.prepare(`SELECT * FROM quote_items WHERE quote_id=? ORDER BY sort_order`).all(id);
  res.status(201).json({ success: true, data: { ...q, items: qItems } });
});

router.patch('/quotes/:id', [
  body('status').optional().isIn(['draft','sent','accepted','declined','expired']),
], validate, (req, res) => {
  const db = getDb();
  const q = db.prepare(`SELECT * FROM quotes WHERE id=? AND org_id=?`).get(req.params.id, req.orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Not found' });

  const allowed = ['title','currency','payment_terms','notes','valid_until','status'];
  const upd = allowed.filter(f => req.body[f] !== undefined);
  if (upd.length) {
    const setSql = upd.map(f => `${f}=?`).join(',');
    const vals = upd.map(f => req.body[f]);
    // auto-timestamp state changes
    if (req.body.status === 'sent') vals.push(now()); else vals.push(q.sent_at);
    if (req.body.status === 'accepted') vals.push(now()); else vals.push(q.accepted_at);
    db.prepare(`UPDATE quotes SET ${setSql}, sent_at=?, accepted_at=?, updated_at=? WHERE id=?`)
      .run(...vals, now(), req.params.id);
  }
  res.json({ success: true, data: db.prepare(`SELECT * FROM quotes WHERE id=?`).get(req.params.id) });
});

// Convert quote → invoice
router.post('/quotes/:id/convert', (req, res) => {
  const db = getDb();
  const q = db.prepare(`SELECT * FROM quotes WHERE id=? AND org_id=?`).get(req.params.id, req.orgId);
  if (!q) return res.status(404).json({ success: false, error: 'Quote not found' });
  if (q.status !== 'accepted') return res.status(400).json({ success: false, error: 'Quote must be accepted first' });

  const items = db.prepare(`SELECT * FROM quote_items WHERE quote_id=? ORDER BY sort_order`).all(q.id);
  const iNum = invoiceNumber(db, req.orgId);
  const id = uid();
  const due = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const create = db.transaction(() => {
    db.prepare(`
      INSERT INTO invoices(id,org_id,client_id,quote_id,invoice_number,title,currency,subtotal,tax_rate,tax_amount,total,amount_due,due_date,payment_terms,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, req.orgId, q.client_id, q.id, iNum, q.title, q.currency,
           q.subtotal, q.tax_rate, q.tax_amount, q.total, q.total,
           req.body.due_date || due, q.payment_terms, req.user.id);

    items.forEach((item, idx) => {
      db.prepare(`INSERT INTO invoice_items(id,invoice_id,description,quantity,unit_price,total,sort_order) VALUES(?,?,?,?,?,?,?)`)
        .run(uid(), id, item.description, item.quantity, item.unit_price, item.total, idx);
    });
    db.prepare(`UPDATE quotes SET status='accepted', updated_at=? WHERE id=?`).run(now(), q.id);
  });
  create();

  const inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(id);
  const invItems = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sort_order`).all(id);
  res.status(201).json({ success: true, data: { ...inv, items: invItems } });
});

// ── INVOICES ─────────────────────────────────────────

router.get('/invoices', (req, res) => {
  const db = getDb();
  const { status, client_id, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let where = 'WHERE i.org_id=?'; const p = [req.orgId];
  if (status) { where += ' AND i.status=?'; p.push(status); }
  if (client_id) { where += ' AND i.client_id=?'; p.push(client_id); }

  // auto-mark overdue
  db.prepare(`UPDATE invoices SET status='overdue', updated_at=? WHERE org_id=? AND due_date < date('now') AND status='sent'`)
    .run(now(), req.orgId);

  const total = db.prepare(`SELECT COUNT(*) as c FROM invoices i ${where}`).get(...p).c;
  const rows = db.prepare(`
    SELECT i.*, c.name as client_name FROM invoices i
    LEFT JOIN clients c ON c.id=i.client_id ${where}
    ORDER BY i.created_at DESC LIMIT ? OFFSET ?
  `).all(...p, limit, offset);

  res.json({ success: true, data: rows, meta: paginate(total, +page, +limit) });
});

router.get('/invoices/:id', (req, res) => {
  const db = getDb();
  const inv = db.prepare(`
    SELECT i.*, c.name as client_name, c.email as client_email
    FROM invoices i LEFT JOIN clients c ON c.id=i.client_id
    WHERE i.id=? AND i.org_id=?
  `).get(req.params.id, req.orgId);
  if (!inv) return res.status(404).json({ success: false, error: 'Invoice not found' });
  const items = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sort_order`).all(inv.id);
  const payments = db.prepare(`SELECT * FROM payments WHERE invoice_id=? ORDER BY created_at DESC`).all(inv.id);
  res.json({ success: true, data: { ...inv, items, payments } });
});

router.post('/invoices', [
  body('client_id').notEmpty(),
  body('title').trim().notEmpty(),
  body('items').isArray({ min: 1 }),
  body('items.*.description').notEmpty(),
  body('items.*.quantity').isFloat({ min: 0.01 }),
  body('items.*.unit_price').isFloat({ min: 0 }),
], validate, (req, res) => {
  const db = getDb();
  const { client_id, title, items, currency, tax_rate, wht_rate = 0, payment_terms, notes, due_date } = req.body;
  const client = db.prepare(`SELECT * FROM clients WHERE id=? AND org_id=?`).get(client_id, req.orgId);
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const effectiveTax = tax_rate !== undefined ? +tax_rate : getVatRate(client.country);
  const tax_amount = subtotal * effectiveTax / 100;
  const wht_amount = subtotal * +wht_rate / 100;
  const total = subtotal + tax_amount;
  const amount_due = total - wht_amount;
  const iNum = invoiceNumber(db, req.orgId);
  const id = uid();
  const dueDefault = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

  const create = db.transaction(() => {
    db.prepare(`
      INSERT INTO invoices(id,org_id,client_id,invoice_number,title,currency,subtotal,tax_rate,tax_amount,wht_rate,wht_amount,total,amount_due,due_date,payment_terms,notes,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, req.orgId, client_id, iNum, title, currency||client.currency,
           subtotal, effectiveTax, tax_amount, +wht_rate, wht_amount, total, amount_due,
           due_date||dueDefault, payment_terms||null, notes||null, req.user.id);

    items.forEach((item, idx) => {
      db.prepare(`INSERT INTO invoice_items(id,invoice_id,description,quantity,unit_price,total,sort_order) VALUES(?,?,?,?,?,?,?)`)
        .run(uid(), id, item.description, item.quantity, item.unit_price, item.quantity * item.unit_price, idx);
    });
  });
  create();

  res.status(201).json({ success: true, data: db.prepare(`SELECT * FROM invoices WHERE id=?`).get(id) });
});

router.patch('/invoices/:id', (req, res) => {
  const db = getDb();
  const inv = db.prepare(`SELECT id FROM invoices WHERE id=? AND org_id=?`).get(req.params.id, req.orgId);
  if (!inv) return res.status(404).json({ success: false, error: 'Not found' });
  const allowed = ['title','status','due_date','payment_terms','notes','sent_at'];
  const upd = allowed.filter(f => req.body[f] !== undefined);
  if (upd.length) {
    const setSql = upd.map(f => `${f}=?`).join(',');
    const vals = upd.map(f => req.body[f]);
    db.prepare(`UPDATE invoices SET ${setSql}, updated_at=? WHERE id=?`).run(...vals, now(), req.params.id);
  }
  res.json({ success: true, data: db.prepare(`SELECT * FROM invoices WHERE id=?`).get(req.params.id) });
});

// POST /api/finance/invoices/:id/payments
router.post('/invoices/:id/payments', [
  body('amount').isFloat({ min: 0.01 }),
  body('method').isIn(['paystack','flutterwave','mpesa','mtn_momo','airtel_money','bank_transfer','cash','other']),
], validate, (req, res) => {
  const db = getDb();
  const inv = db.prepare(`SELECT * FROM invoices WHERE id=? AND org_id=?`).get(req.params.id, req.orgId);
  if (!inv) return res.status(404).json({ success: false, error: 'Invoice not found' });

  const { amount, method, reference, notes } = req.body;
  const pid = uid();

  const recordPayment = db.transaction(() => {
    db.prepare(`INSERT INTO payments(id,org_id,invoice_id,amount,currency,method,reference,status,notes,paid_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(pid, req.orgId, inv.id, amount, inv.currency, method, reference||null, 'completed', notes||null, now());

    const newPaid = inv.amount_paid + amount;
    const newDue = Math.max(0, inv.amount_due - amount);
    const newStatus = newDue <= 0 ? 'paid' : newPaid > 0 ? 'partial' : inv.status;

    db.prepare(`UPDATE invoices SET amount_paid=?, amount_due=?, status=?, paid_at=?, updated_at=? WHERE id=?`)
      .run(newPaid, newDue, newStatus, newStatus === 'paid' ? now() : inv.paid_at, now(), inv.id);

    if (newStatus === 'paid') {
      db.prepare(`UPDATE clients SET total_billed=total_billed+?, updated_at=? WHERE id=?`)
        .run(inv.total, now(), inv.client_id);
    }
  });
  recordPayment();

  res.status(201).json({
    success: true,
    data: {
      payment: db.prepare(`SELECT * FROM payments WHERE id=?`).get(pid),
      invoice: db.prepare(`SELECT * FROM invoices WHERE id=?`).get(inv.id)
    }
  });
});

// GET /api/finance/summary
router.get('/summary', (req, res) => {
  const db = getDb();
  const o = req.orgId;
  const month = new Date().toISOString().slice(0, 7);

  const revenue = db.prepare(`SELECT COALESCE(SUM(amount_paid),0) as v FROM invoices WHERE org_id=? AND paid_at LIKE ?`).get(o, month+'%').v;
  const outstanding = db.prepare(`SELECT COALESCE(SUM(amount_due),0) as v FROM invoices WHERE org_id=? AND status IN ('sent','partial','overdue')`).get(o).v;
  const overdue_count = db.prepare(`SELECT COUNT(*) as c FROM invoices WHERE org_id=? AND status='overdue'`).get(o).c;
  const active_quotes = db.prepare(`SELECT COUNT(*) as c FROM quotes WHERE org_id=? AND status IN ('sent','viewed')`).get(o).c;
  const draft_quotes = db.prepare(`SELECT COUNT(*) as c FROM quotes WHERE org_id=? AND status='draft'`).get(o).c;
  const total_clients = db.prepare(`SELECT COUNT(*) as c FROM clients WHERE org_id=?`).get(o).c;

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', paid_at) as month, COALESCE(SUM(amount_paid),0) as revenue
    FROM invoices WHERE org_id=? AND paid_at IS NOT NULL
    GROUP BY month ORDER BY month DESC LIMIT 6
  `).all(o).reverse();

  res.json({ success: true, data: { revenue, outstanding, overdue_count, active_quotes, draft_quotes, total_clients, monthly } });
});

module.exports = router;
