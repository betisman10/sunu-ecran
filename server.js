import express from 'express';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { PAYTECH_API_KEY: KEY, PAYTECH_API_SECRET: SECRET, PAYTECH_ENV = 'test', BASE_URL, PORT = 3000 } = process.env;
const PLANS = [{ name: 'Accès 24 h', price: 500, hours: 24 }, { name: 'Mensuel', price: 2500, hours: 720 }, { name: 'Annuel', price: 25000, hours: 8760 }];
const METHODS = { wave: 'Wave', om: 'Orange Money', card: 'Carte Bancaire' };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const same = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(b); return a.length === b.length && crypto.timingSafeEqual(a, b) };

const db = new Database(process.env.DB_PATH || 'sunu.db');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS orders(ref TEXT PRIMARY KEY, plan INTEGER, amount INTEGER, phone TEXT, method TEXT, status TEXT DEFAULT 'pending', code TEXT, created_at INTEGER, paid_at INTEGER);
CREATE TABLE IF NOT EXISTS codes(code TEXT PRIMARY KEY, hours INTEGER, order_ref TEXT, created_at INTEGER, used_at INTEGER);`);

const newCode = () => 'SE-' + Array.from(crypto.randomBytes(8), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
const app = express();
app.use(express.json(), express.urlencoded({ extended: false }));
app.get('/', (_, res) => res.sendFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sunu-ecran.html')));

app.post('/api/checkout', async (req, res) => {
  const { plan, phone, method } = req.body || {};
  const p = PLANS[plan], num = String(phone || '').replace(/[\s.-]/g, '').replace(/^(\+|00)?221/, '');
  if (!p || !METHODS[method] || !/^7\d{8}$/.test(num)) return res.status(400).json({ error: 'Vérifiez le numéro (ex. 77 000 00 00) et le moyen de paiement.' });
  const ref = 'SE' + crypto.randomBytes(6).toString('hex');
  db.prepare('INSERT INTO orders(ref,plan,amount,phone,method,created_at) VALUES(?,?,?,?,?,?)').run(ref, plan, p.price, num, method, Date.now());
  try {
    const r = await fetch('https://paytech.sn/api/payment/request-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json', API_KEY: KEY, API_SECRET: SECRET },
      body: JSON.stringify({ item_name: `Sunu Écran - ${p.name}`, item_price: p.price, currency: 'XOF', ref_command: ref, command_name: `Sunu Écran - ${p.name}`,
        env: PAYTECH_ENV, ipn_url: `${BASE_URL}/api/ipn`, success_url: `${BASE_URL}/?ref=${ref}`, cancel_url: `${BASE_URL}/`, target_payment: METHODS[method] })
    });
    const d = await r.json();
    if (d.success !== 1 || !d.redirect_url) throw new Error(JSON.stringify(d));
    res.json({ url: d.redirect_url });
  } catch (e) { console.error('PayTech:', e.message); res.status(502).json({ error: 'Le service de paiement ne répond pas. Réessayez dans un instant.' }) }
});

// PayTech appelle cette route quand un paiement est validé.
app.post('/api/ipn', (req, res) => {
  const b = req.body || {};
  if (!same(b.api_key_sha256, sha(KEY)) || !same(b.api_secret_sha256, sha(SECRET))) return res.sendStatus(403);
  if (b.type_event !== 'sale_complete') return res.sendStatus(200);
  db.transaction(() => {
    const o = db.prepare("SELECT * FROM orders WHERE ref=? AND status='pending'").get(b.ref_command);
    if (!o || Number(b.item_price) !== o.amount) return;
    const code = newCode();
    db.prepare('INSERT INTO codes(code,hours,order_ref,created_at) VALUES(?,?,?,?)').run(code, PLANS[o.plan].hours, o.ref, Date.now());
    db.prepare("UPDATE orders SET status='paid',code=?,paid_at=? WHERE ref=?").run(code, Date.now(), o.ref);
  })();
  res.sendStatus(200);
});

app.get('/api/order/:ref', (req, res) => {
  const o = db.prepare('SELECT status,code FROM orders WHERE ref=?').get(req.params.ref);
  o ? res.json(o.status === 'paid' ? o : { status: o.status }) : res.status(404).json({ error: 'Commande introuvable' });
});

const hits = new Map();
app.post('/api/unlock', (req, res) => {
  const n = (hits.get(req.ip) || 0) + 1; hits.set(req.ip, n); setTimeout(() => hits.delete(req.ip), 60000).unref();
  if (n > 10) return res.status(429).json({ error: 'Trop d’essais, patientez une minute.' });
  const c = db.prepare('SELECT * FROM codes WHERE code=?').get(String(req.body?.code || '').trim().toUpperCase());
  if (!c) return res.status(404).json({ error: 'Code invalide' });
  const start = c.used_at || Date.now(), expires = start + c.hours * 3600000;
  if (expires < Date.now()) return res.status(410).json({ error: 'Code expiré' });
  if (!c.used_at) db.prepare('UPDATE codes SET used_at=? WHERE code=?').run(start, c.code);
  res.json({ expires });
});

app.listen(PORT, () => console.log(`Sunu Écran sur http://localhost:${PORT}`));
