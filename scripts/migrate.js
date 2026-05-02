require('dotenv').config();
const { pool } = require('../src/config/database');

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE IF NOT EXISTS businesses (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           VARCHAR(255) NOT NULL,
  country_code   CHAR(2) NOT NULL DEFAULT 'NG',
  currency       VARCHAR(3) NOT NULL DEFAULT 'NGN',
  vat_number     VARCHAR(50),
  tin            VARCHAR(50),
  phone          VARCHAR(30),
  email          VARCHAR(255),
  address        TEXT,
  logo_url       TEXT,
  plan           VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','team')),
  plan_expires_at TIMESTAMPTZ,
  settings       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email          VARCHAR(255) UNIQUE NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  phone          VARCHAR(30),
  role           VARCHAR(30) NOT NULL DEFAULT 'owner',
  avatar_url     TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  refresh_token  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS clients (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  company        VARCHAR(255),
  email          VARCHAR(255),
  phone          VARCHAR(30),
  whatsapp       VARCHAR(30),
  country_code   CHAR(2),
  currency       VARCHAR(3) NOT NULL DEFAULT 'NGN',
  address        TEXT,
  notes          TEXT,
  tags           TEXT[] DEFAULT '{}',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  total_billed   NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clients_business ON clients(business_id);

CREATE TABLE IF NOT EXISTS quotes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id),
  quote_number   VARCHAR(30) NOT NULL,
  title          VARCHAR(255) NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'draft',
  currency       VARCHAR(3) NOT NULL DEFAULT 'NGN',
  subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  vat_rate       NUMERIC(5,2) NOT NULL DEFAULT 0,
  vat_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total          NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_terms  VARCHAR(100),
  valid_until    DATE,
  notes          TEXT,
  internal_notes TEXT,
  sent_at        TIMESTAMPTZ,
  viewed_at      TIMESTAMPTZ,
  accepted_at    TIMESTAMPTZ,
  declined_at    TIMESTAMPTZ,
  send_via       VARCHAR(20) DEFAULT 'email',
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, quote_number)
);
CREATE INDEX IF NOT EXISTS idx_quotes_business ON quotes(business_id);
CREATE INDEX IF NOT EXISTS idx_quotes_client   ON quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status   ON quotes(status);

CREATE TABLE IF NOT EXISTS quote_items (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id       UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  description    TEXT NOT NULL,
  quantity       NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total          NUMERIC(15,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order     INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id),
  quote_id       UUID REFERENCES quotes(id),
  invoice_number VARCHAR(30) NOT NULL,
  title          VARCHAR(255) NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'draft',
  currency       VARCHAR(3) NOT NULL DEFAULT 'NGN',
  subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  vat_rate       NUMERIC(5,2) NOT NULL DEFAULT 0,
  vat_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  wht_rate       NUMERIC(5,2) NOT NULL DEFAULT 0,
  wht_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total          NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount_paid    NUMERIC(15,2) NOT NULL DEFAULT 0,
  due_date       DATE,
  payment_terms  VARCHAR(100),
  notes          TEXT,
  sent_at        TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  reminder_count INT NOT NULL DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client   ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id     UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description    TEXT NOT NULL,
  quantity       NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total          NUMERIC(15,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order     INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id     UUID NOT NULL REFERENCES invoices(id),
  amount         NUMERIC(15,2) NOT NULL,
  currency       VARCHAR(3) NOT NULL,
  method         VARCHAR(30) NOT NULL,
  reference      VARCHAR(100),
  gateway_ref    VARCHAR(100),
  gateway        VARCHAR(30),
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  paid_at        TIMESTAMPTZ,
  metadata       JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS contracts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id),
  quote_id         UUID REFERENCES quotes(id),
  title            VARCHAR(255) NOT NULL,
  contract_number  VARCHAR(30),
  status           VARCHAR(30) NOT NULL DEFAULT 'draft',
  template_type    VARCHAR(30),
  body             TEXT NOT NULL,
  value            NUMERIC(15,2),
  currency         VARCHAR(3) DEFAULT 'NGN',
  revision_rounds  INT NOT NULL DEFAULT 2,
  revisions_used   INT NOT NULL DEFAULT 0,
  oos_hourly_rate  NUMERIC(15,2),
  feedback_deadline_days INT NOT NULL DEFAULT 5,
  start_date       DATE,
  end_date         DATE,
  signed_at        TIMESTAMPTZ,
  client_signed_at TIMESTAMPTZ,
  client_ip        INET,
  portal_token     UUID DEFAULT uuid_generate_v4(),
  is_portal_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contracts_business ON contracts(business_id);
CREATE INDEX IF NOT EXISTS idx_contracts_client   ON contracts(client_id);

CREATE TABLE IF NOT EXISTS scope_alerts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contract_id    UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id),
  request_text   TEXT NOT NULL,
  estimated_hours NUMERIC(6,2),
  status         VARCHAR(20) NOT NULL DEFAULT 'open',
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_orders (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contract_id    UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  scope_alert_id UUID REFERENCES scope_alerts(id),
  title          VARCHAR(255) NOT NULL,
  description    TEXT,
  amount         NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency       VARCHAR(3) DEFAULT 'NGN',
  status         VARCHAR(20) NOT NULL DEFAULT 'draft',
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comms_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id),
  channel        VARCHAR(20) NOT NULL,
  summary        TEXT NOT NULL,
  follow_up      VARCHAR(100),
  logged_by      UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES clients(id),
  name           VARCHAR(255) NOT NULL,
  type           VARCHAR(100),
  address        TEXT,
  city           VARCHAR(100),
  country_code   CHAR(2) DEFAULT 'NG',
  latitude       NUMERIC(10,7),
  longitude      NUMERIC(10,7),
  status         VARCHAR(20) NOT NULL DEFAULT 'active',
  phase_current  INT NOT NULL DEFAULT 1,
  phase_total    INT NOT NULL DEFAULT 1,
  progress_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
  budget         NUMERIC(15,2),
  spent          NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency       VARCHAR(3) DEFAULT 'NGN',
  pm_user_id     UUID REFERENCES users(id),
  start_date     DATE,
  end_date       DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sites_business ON sites(business_id);

CREATE TABLE IF NOT EXISTS milestones (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id        UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title          VARCHAR(255) NOT NULL,
  description    TEXT,
  phase_number   INT NOT NULL DEFAULT 1,
  status         VARCHAR(20) NOT NULL DEFAULT 'upcoming',
  due_date       DATE,
  completed_at   TIMESTAMPTZ,
  completed_by   UUID REFERENCES users(id),
  blocked_reason TEXT,
  invoice_id     UUID REFERENCES invoices(id),
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_milestones_site ON milestones(site_id);

CREATE TABLE IF NOT EXISTS tasks (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  site_id        UUID REFERENCES sites(id) ON DELETE CASCADE,
  milestone_id   UUID REFERENCES milestones(id),
  assigned_to    UUID REFERENCES users(id),
  title          VARCHAR(255) NOT NULL,
  description    TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'todo',
  priority       VARCHAR(10) NOT NULL DEFAULT 'medium',
  due_date       DATE,
  completed_at   TIMESTAMPTZ,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_business ON tasks(business_id);
CREATE INDEX IF NOT EXISTS idx_tasks_site     ON tasks(site_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to);

CREATE TABLE IF NOT EXISTS checkins (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id),
  site_id        UUID NOT NULL REFERENCES sites(id),
  checked_in_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_out_at TIMESTAMPTZ,
  latitude       NUMERIC(10,7),
  longitude      NUMERIC(10,7),
  location_name  VARCHAR(255),
  notes          TEXT,
  is_remote      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(user_id);
CREATE INDEX IF NOT EXISTS idx_checkins_site ON checkins(site_id);

CREATE TABLE IF NOT EXISTS field_logs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  site_id        UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  logged_by      UUID NOT NULL REFERENCES users(id),
  entry_type     VARCHAR(30) NOT NULL,
  content        TEXT NOT NULL,
  attachments    JSONB DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_logs_site ON field_logs(site_id);

CREATE TABLE IF NOT EXISTS documents (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  site_id        UUID REFERENCES sites(id),
  uploaded_by    UUID REFERENCES users(id),
  name           VARCHAR(255) NOT NULL,
  file_type      VARCHAR(20),
  file_url       TEXT NOT NULL,
  file_size_kb   INT,
  is_expired     BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at     DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS time_entries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id),
  client_id      UUID REFERENCES clients(id),
  site_id        UUID REFERENCES sites(id),
  description    TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ,
  hourly_rate    NUMERIC(15,2),
  currency       VARCHAR(3) DEFAULT 'NGN',
  billable_amount NUMERIC(15,2),
  is_billable    BOOLEAN NOT NULL DEFAULT TRUE,
  invoice_id     UUID REFERENCES invoices(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_entries_user   ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_client ON time_entries(client_id);

CREATE TABLE IF NOT EXISTS expenses (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  site_id        UUID REFERENCES sites(id),
  logged_by      UUID REFERENCES users(id),
  description    VARCHAR(255) NOT NULL,
  category       VARCHAR(50),
  amount         NUMERIC(15,2) NOT NULL,
  currency       VARCHAR(3) NOT NULL DEFAULT 'NGN',
  is_tax_deductible BOOLEAN NOT NULL DEFAULT TRUE,
  receipt_url    TEXT,
  expense_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_business ON expenses(business_id);

CREATE TABLE IF NOT EXISTS tax_records (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  country_code   CHAR(2) NOT NULL,
  tax_type       VARCHAR(20) NOT NULL,
  period         VARCHAR(20) NOT NULL,
  amount_collected NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount_payable   NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount_credited  NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency       VARCHAR(3) NOT NULL,
  due_date       DATE,
  filed_at       TIMESTAMPTZ,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  reference      VARCHAR(100),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wht_deductions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id     UUID NOT NULL REFERENCES invoices(id),
  client_id      UUID NOT NULL REFERENCES clients(id),
  invoice_amount NUMERIC(15,2) NOT NULL,
  wht_rate       NUMERIC(5,2) NOT NULL,
  wht_amount     NUMERIC(15,2) NOT NULL,
  net_amount     NUMERIC(15,2) NOT NULL,
  currency       VARCHAR(3) NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id),
  type           VARCHAR(50) NOT NULL,
  title          VARCHAR(255) NOT NULL,
  body           TEXT,
  severity       VARCHAR(10) NOT NULL DEFAULT 'info',
  entity_type    VARCHAR(30),
  entity_id      UUID,
  is_read        BOOLEAN NOT NULL DEFAULT FALSE,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    await client.query(SCHEMA);
    console.log('All migrations applied successfully');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
