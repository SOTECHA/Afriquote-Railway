# AfriQuote — Railway Deployment

Africa's all-in-one professional business platform for contractors, consultants,
and freelancers in Nigeria, Ghana, Kenya, South Africa, and Rwanda.

---

## Deploy to Railway in 5 minutes

### Option 1 — Railway CLI (fastest)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create a new project and deploy
railway init
railway up

# Set environment variables (see Variables section below)
railway variables set JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
railway variables set NODE_ENV=production
railway variables set APP_URL=https://$(railway domain)
```

### Option 2 — GitHub → Railway (recommended for teams)

1. Push this folder to a GitHub repository
2. Go to **railway.app** → New Project → Deploy from GitHub repo
3. Select your repository
4. Railway auto-detects Node.js and runs `node server.js`
5. Set environment variables in the Railway dashboard → Variables tab

---

## Required Environment Variables

Set these in **Railway Dashboard → Your Service → Variables**:

| Variable | Description | How to get |
|---|---|---|
| `JWT_SECRET` | 64-char random secret | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | Different 64-char secret | Same command — use a different value |
| `NODE_ENV` | Set to `production` | Type `production` |
| `APP_URL` | Your Railway URL | Copy from Railway → Settings → Domain |
| `ALLOWED_ORIGINS` | Your Railway URL | Same as APP_URL |
| `SMTP_HOST` | Email server | `smtp.postmarkapp.com` |
| `SMTP_USER` | Email API key | From postmark.com |
| `SMTP_PASS` | Email API key | Same as SMTP_USER for Postmark |
| `PAYSTACK_SECRET_KEY` | Paystack secret | From dashboard.paystack.com |

See `.env.example` for all variables.

---

## URLs after deployment

| URL | What it shows |
|---|---|
| `https://your-app.up.railway.app/` | Marketing website (afriquote-website.html) |
| `https://your-app.up.railway.app/app` | Full 8-module platform |
| `https://your-app.up.railway.app/pricing` | Sales page with plans |
| `https://your-app.up.railway.app/invoice` | Invoice MVP tool |
| `https://your-app.up.railway.app/quote` | Quote builder |
| `https://your-app.up.railway.app/tax` | Tax calculator |
| `https://your-app.up.railway.app/site-report` | Site log generator |
| `https://your-app.up.railway.app/health-score` | Business health score |
| `https://your-app.up.railway.app/health` | API health check (JSON) |
| `https://your-app.up.railway.app/api/auth/register` | Registration endpoint |
| `https://your-app.up.railway.app/assets/afriquote-logo.png` | Logo |

---

## Quick test after deployment

```bash
# 1. Health check
curl https://your-app.up.railway.app/health

# 2. Register an account
curl -X POST https://your-app.up.railway.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "full_name":     "Emeka Obi",
    "email":         "emeka@example.com",
    "password":      "SecurePass123",
    "business_name": "Emeka Consulting",
    "country":       "NG"
  }'

# 3. Login
curl -X POST https://your-app.up.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"emeka@example.com","password":"SecurePass123"}'

# 4. Use the token from login response
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-app.up.railway.app/api/auth/me
```

---

## Data storage on Railway

By default, AfriQuote saves data to JSON files in the `data/` folder.
On Railway, this folder is **ephemeral** — it resets on every deploy.

**For persistent data on Railway, use a Volume:**

1. Railway Dashboard → Your Service → Volumes
2. Add a volume → Mount path: `/app/data`
3. Railway will persist the `data/` folder across deploys

**Or use Railway's PostgreSQL plugin:**

1. Railway Dashboard → New → Database → PostgreSQL
2. Copy the `DATABASE_URL` from the PostgreSQL service
3. Add `DATABASE_URL` to your service's Variables
4. Run `npm run migrate` to create tables

---

## Seeding demo data

```bash
# Via Railway CLI
railway run node scripts/seed.js

# Or via Railway Dashboard → Your Service → Settings → Deploy → Custom commands
```

---

## Platform modules

| Module | Description |
|---|---|
| Finance | Quotes, invoices, VAT 7.5%, Paystack payments |
| Proposals | Pipeline board, win probability, follow-ups |
| Contracts | e-Sign, scope protection, change orders |
| Sites | GPS check-in, daily logs, budget vs. actual |
| Time | Timer, billing rate, utilisation |
| Tax | VAT/WHT/NTAA 2025, FIRS deadline countdown |
| Cash Flow | Forecast, expenses, runway |
| Health Score | Score/100 across 6 business dimensions |

## Countries & currencies

Nigeria (NGN, VAT 7.5%) · Ghana (GHS, VAT 12.5%) · Kenya (KES, VAT 16%) ·
South Africa (ZAR, VAT 15%) · Rwanda (RWF, VAT 18%)

