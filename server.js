// GROUPE EXPRESS V18.6.9 — serveur Node >= 22.13, SQLite intégré
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
try {
  for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !l.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const E = process.env;
const PORT = Number(E.PORT || 3000);
const PROD = E.NODE_ENV === 'production';
const VERSION = '18.7.0';
const EMERGENCY = E.EMERGENCY_PHONE || '0719480884';
const PICKUPS = [...new Set([...(E.PICKUP_POINTS || 'UTT LOKO ZONE4C|La Fontaine').split('|').map(x => x.trim()).filter(Boolean), 'HEGES'])];
const getAllPickupPoints=()=>{try{const row=db.prepare("SELECT value FROM app_settings WHERE key='pickup_points'").get();const saved=row?JSON.parse(row.value):null;return Array.isArray(saved)&&saved.length?saved:PICKUPS;}catch{return PICKUPS;}};
const getDisabledPickupPoints=()=>{try{return JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key='disabled_pickup_points'").get()?.value||'[]')}catch{return []}};
const getPickupPoints=()=>getAllPickupPoints().filter(x=>!getDisabledPickupPoints().includes(x));
const SESSION_DAYS = 30;

// ---------- Base de données ----------
const DB_FILE=path.resolve(E.DB_PATH || path.join(DATA, 'groupe-express.db')); fs.mkdirSync(path.dirname(DB_FILE),{recursive:true});
export const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, email TEXT, pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT NOT NULL DEFAULT (datetime('now')), profile_image TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS menu(id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL, description TEXT DEFAULT '', image TEXT DEFAULT '', tag TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1, stock INTEGER NOT NULL DEFAULT 999, promo_price INTEGER);
CREATE TABLE IF NOT EXISTS menu_categories(category TEXT PRIMARY KEY, icon_image TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, customer_name TEXT, phone TEXT, pickup TEXT NOT NULL, note TEXT DEFAULT '', items TEXT NOT NULL, total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'received', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), payment_method TEXT DEFAULT 'pickup', payment_phone TEXT DEFAULT '', promo_code TEXT DEFAULT '', discount INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS order_events(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, status TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id); CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), read_at TEXT);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, id DESC);
CREATE TABLE IF NOT EXISTS promo_codes(code TEXT PRIMARY KEY, discount_percent INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, expires_at TEXT, max_uses INTEGER DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS hero_images(id TEXT PRIMARY KEY, image TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS suppliers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS dish_suppliers(dish_id TEXT PRIMARY KEY REFERENCES menu(id) ON DELETE CASCADE, supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS whatsapp_webhook_events(message_id TEXT PRIMARY KEY, processed_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS supplier_orders(id INTEGER PRIMARY KEY, supplier_id INTEGER NOT NULL REFERENCES suppliers(id), category TEXT NOT NULL, items TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS gift_offers(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'approved', created_at TEXT NOT NULL DEFAULT (datetime('now')), read_at TEXT);
CREATE TABLE IF NOT EXISTS loyalty_awards(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, week_start TEXT NOT NULL, qualifying_orders INTEGER NOT NULL DEFAULT 5, status TEXT NOT NULL DEFAULT 'eligible', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id,week_start));
CREATE TABLE IF NOT EXISTS electronics(id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL, description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', stock INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS electronics_banners(id TEXT PRIMARY KEY,image TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,position INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS electronics_categories(category TEXT PRIMARY KEY,icon_image TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS electronics_orders(id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, product_id TEXT NOT NULL, product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS push_subscriptions(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE, subscription_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);
function ensureColumn(table, column, definition) { const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(x => x.name); if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
db.exec("INSERT OR IGNORE INTO menu_categories(category,icon_image) SELECT DISTINCT category,'' FROM menu WHERE trim(category)<>''");
ensureColumn('menu','stock','INTEGER NOT NULL DEFAULT 999'); ensureColumn('menu','promo_price','INTEGER'); ensureColumn('menu','ingredients',"TEXT NOT NULL DEFAULT ''"); ensureColumn('menu','long_description',"TEXT NOT NULL DEFAULT ''"); ensureColumn('menu','options_json',"TEXT NOT NULL DEFAULT '[]'");
ensureColumn('users','profile_image',"TEXT NOT NULL DEFAULT ''");
ensureColumn('reviews','item_type',"TEXT NOT NULL DEFAULT 'general'"); ensureColumn('reviews','item_id',"TEXT NOT NULL DEFAULT ''"); ensureColumn('reviews','item_name',"TEXT NOT NULL DEFAULT ''");
// Conserver les messages envoyés par l’équipe et un seul message de bienvenue par compte ; retirer les anciennes alertes automatiques de retrait.
db.prepare("DELETE FROM messages WHERE title='Votre commande est prête !'").run();
db.prepare("DELETE FROM messages WHERE title='Bienvenue chez GROUPE EXPRESS !' AND id NOT IN (SELECT MIN(id) FROM messages WHERE title='Bienvenue chez GROUPE EXPRESS !' GROUP BY user_id)").run();
ensureColumn('orders','pickup_notified_at','TEXT');
ensureColumn('electronics','gallery_json',"TEXT NOT NULL DEFAULT '[]'");
ensureColumn('electronics','colors_json',"TEXT NOT NULL DEFAULT '[]'");
ensureColumn('electronics','banner_enabled','INTEGER NOT NULL DEFAULT 1');
ensureColumn('electronics_orders','color',"TEXT NOT NULL DEFAULT ''");
ensureColumn('electronics_orders','product_image',"TEXT NOT NULL DEFAULT ''");
ensureColumn('supplier_orders','order_ref',"TEXT NOT NULL DEFAULT ''"); ensureColumn('supplier_orders','delivery_error',"TEXT NOT NULL DEFAULT ''");
ensureColumn('orders','payment_method',"TEXT DEFAULT 'pickup'"); ensureColumn('orders','payment_phone',"TEXT DEFAULT ''"); ensureColumn('orders','promo_code',"TEXT DEFAULT ''"); ensureColumn('orders','discount','INTEGER NOT NULL DEFAULT 0');
if (!db.prepare('SELECT 1 FROM menu LIMIT 1').get()) {
  const menuFile=path.join(DATA,'menu.json'); let seed=[];
  try { const parsed=JSON.parse(fs.readFileSync(menuFile,'utf8')); if(Array.isArray(parsed)) seed=parsed; else throw new Error('menu.json doit contenir un tableau'); }
  catch(err) { console.warn('Fichier data/menu.json absent ou invalide : démarrage avec un menu vide.',err.message); if(!fs.existsSync(menuFile)) fs.writeFileSync(menuFile,'[]\n','utf8'); }
  const ins = db.prepare('INSERT OR IGNORE INTO menu(id,name,category,price,description,image,tag,active,ingredients,long_description,options_json) VALUES(?,?,?,?,?,?,?,1,?,?,?)');
  for (const m of seed) { if(m?.id && m?.name && m?.category && Number(m.price)>=0) ins.run(String(m.id),String(m.name),String(m.category),Math.floor(Number(m.price)),m.description||'',m.image||'',m.tag||'',Array.isArray(m.ingredients)?m.ingredients.join(', '):(m.ingredients||''),m.longDescription||'',JSON.stringify(m.options||[])); }
}

// ---------- Outils ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const iso = s => (s ? s.replace(' ', 'T') + 'Z' : s);
const safeJson=(value,fallback)=>{try{return JSON.parse(value)||fallback}catch{return fallback}};
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = pw => { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
const checkPw = (pw, stored) => {
  const [s, h] = String(stored).split(':'); if (!s || !h) return false;
  const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const normPhone = p => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('225') && d.length === 13) d = d.slice(3); return /^\d{10}$/.test(d) ? d : null; };
const hits = new Map();
const limit = (key, max, ms) => {
  const now = Date.now(); const h = hits.get(key);
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + ms }); return; }
  if (++h.n > max) throw new HttpError(429, 'Trop de tentatives. Réessaie dans quelques minutes.');
};
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); db.prepare('DELETE FROM sessions WHERE expires<?').run(n); }, 600000).unref();
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
function saveDishImage(data) {
  if (!data) return '';
  const m=String(data).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if(!m) throw new HttpError(400,'Photo invalide. Formats acceptés : JPG, PNG ou WebP.');
  const buf=Buffer.from(m[2],'base64'); if(!buf.length||buf.length>4*1024*1024) throw new HttpError(400,'La photo du plat doit peser moins de 4 Mo.');
  const ext=m[1]==='jpeg'?'jpg':m[1],dir=path.join(PUBLIC,'uploads','dishes');fs.mkdirSync(dir,{recursive:true});
  const name=crypto.randomBytes(18).toString('hex')+'.'+ext;fs.writeFileSync(path.join(dir,name),buf,{flag:'wx'});return '/uploads/dishes/'+name;
}
function keepOrSaveDishImage(value) {
  const image=String(value||'');
  if(/^\/uploads\/dishes\/[A-Za-z0-9._-]+$/.test(image))return image;
  return saveDishImage(image);
}
function saveProfileImage(data) {
  if (!data) return '';
  const m = String(data).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, 'Photo invalide. Formats acceptés : JPG, PNG ou WebP.');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 2 * 1024 * 1024) throw new HttpError(400, 'La photo doit peser moins de 2 Mo.');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const dir = path.join(PUBLIC, 'uploads', 'profiles'); fs.mkdirSync(dir, {recursive:true});
  const name = crypto.randomBytes(18).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir, name), buf, {flag:'wx'});
  return '/uploads/profiles/' + name;
}
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const userOut = u => u && { id: u.id, name: u.name, phone: u.phone, email: u.email || '', role: u.role, profileImage: u.profile_image || '' };
const orderOut = (o, events) => ({ ref: o.ref, status: o.status, pickup: o.pickup, note: o.note, total: o.total, items: JSON.parse(o.items), customer: o.customer_name, phone: o.phone, paymentMethod:o.payment_method||'pickup', paymentPhone:o.payment_phone||'', promoCode:o.promo_code||'', discount:o.discount||0, createdAt: iso(o.created_at), updatedAt: iso(o.updated_at), ...(events ? { events: events.map(e => ({ status: e.status, at: iso(e.at) })) } : {}) });
const eventsOf = id => db.prepare('SELECT status, at FROM order_events WHERE order_id=? ORDER BY id').all(id);
async function evaluateWeeklyLoyalty(userId) {
  const rows=db.prepare("SELECT date(created_at) day FROM orders WHERE user_id=? AND status='picked_up' AND date(created_at)>=date('now','-6 day') ORDER BY created_at DESC").all(userId);
  if(rows.length<5)return {eligible:false,created:false};
  const monday=db.prepare("SELECT date('now','weekday 0','-6 day') week").get().week;
  const existing=db.prepare('SELECT id FROM loyalty_awards WHERE user_id=? AND week_start=?').get(userId,monday);
  if(existing)return {eligible:true,created:false};
  db.prepare("INSERT INTO loyalty_awards(user_id,week_start,qualifying_orders,status) VALUES(?,?,5,'eligible')").run(userId,monday);
  const title='Votre carte fidélité est activée !',body='Félicitations ! Vous avez effectué 5 commandes retirées en 7 jours. Votre avantage fidélité est maintenant éligible. Consultez votre carte dans Profil > Carte de fidélité.';
  db.prepare('INSERT INTO messages(user_id,title,body) VALUES(?,?,?)').run(userId,title,body);
  await sendUserPush(userId,{title,body,url:'/#/parametres/fidelite',tag:'loyalty-'+monday});
  return {eligible:true,created:true};
}
async function sendUserPush(userId,payload) {
  if(!E.VAPID_PUBLIC_KEY||!E.VAPID_PRIVATE_KEY)return {sent:0,configured:false};
  try { const webpush=await import('web-push');webpush.default.setVapidDetails(E.VAPID_SUBJECT||'mailto:admin@groupe-express.local',E.VAPID_PUBLIC_KEY,E.VAPID_PRIVATE_KEY);const subs=db.prepare('SELECT id,subscription_json FROM push_subscriptions WHERE user_id=?').all(userId);let sent=0;await Promise.all(subs.map(async x=>{try{await webpush.default.sendNotification(JSON.parse(x.subscription_json),JSON.stringify(payload));sent++;}catch(err){if(err.statusCode===404||err.statusCode===410)db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(x.id);}}));return {sent,configured:true};}catch(err){console.warn('Push client indisponible:',err.message);return {sent:0,configured:false};}
}
async function sendProductPush(payload) {
  if(!E.VAPID_PUBLIC_KEY||!E.VAPID_PRIVATE_KEY)return {sent:0,configured:false};
  try {
    const webpush=await import('web-push');
    webpush.default.setVapidDetails(E.VAPID_SUBJECT||'mailto:admin@groupe-express.local',E.VAPID_PUBLIC_KEY,E.VAPID_PRIVATE_KEY);
    const subs=db.prepare("SELECT ps.id,ps.subscription_json FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.role='customer'").all();let sent=0;
    await Promise.all(subs.map(async x=>{try{await webpush.default.sendNotification(JSON.parse(x.subscription_json),JSON.stringify(payload));sent++;}catch(err){if(err.statusCode===404||err.statusCode===410)db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(x.id);}}));
    return {sent,configured:true};
  } catch(err) { console.warn('Web Push indisponible:',err.message); return {sent:0,configured:false}; }
}

async function notifyNewCatalogItem({kind,id,name,category,price,description,image}) {
  const title=kind==='dish'?'Nouveau plat au menu !':'Nouveau produit disponible !';
  const detail=[category,`${Number(price).toLocaleString('fr-FR')} FCFA`,description].filter(Boolean).join(' · ');
  const body=`${name} — ${detail}`.slice(0,220);
  const url=kind==='dish'?`/#/plat/${encodeURIComponent(id)}`:`/#/electronique/${encodeURIComponent(id)}`;
  const customers=db.prepare("SELECT id FROM users WHERE role='customer'").all();
  const insert=db.prepare('INSERT INTO messages(user_id,title,body) VALUES(?,?,?)');
  for(const customer of customers)insert.run(customer.id,title,body);
  const push=await sendProductPush({title,body,url,tag:`new-${kind}-${id}`,image:image||undefined});
  return {customers:customers.length,pushSent:push.sent,pushConfigured:push.configured};
}

async function sendWhatsAppText(to, body) {
  if(!E.WHATSAPP_ACCESS_TOKEN||!E.WHATSAPP_PHONE_NUMBER_ID||!to)return {sent:false,reason:'WhatsApp Cloud API non configurée.'};
  try { const version=E.WHATSAPP_API_VERSION||'v22.0';const digits=String(to).replace(/\D/g,'');const recipient=digits.length===10?'225'+digits:digits;if(!/^\d{11,15}$/.test(recipient))return {sent:false,reason:'Numéro WhatsApp invalide.'};const r=await fetch(`https://graph.facebook.com/${version}/${E.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${E.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:recipient,type:'text',text:{preview_url:false,body}})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||`WhatsApp API ${r.status}`);return {sent:true};}catch(err){console.warn('WhatsApp send failed:',err.message);return {sent:false,reason:clip(err.message,250)};}
}
function createOrderRecord({userId=null,customerName,phone,pickup,items,note=''}) {
  if(!getPickupPoints().includes(pickup))throw new HttpError(400,'Point de retrait invalide.');
  if(!Array.isArray(items)||!items.length||items.length>30)throw new HttpError(400,'Ajoute au moins un plat.');
  const get=db.prepare('SELECT id,name,price,stock,promo_price,image FROM menu WHERE id=? AND active=1');const lines=[];let total=0;
  for(const line of items){const item=get.get(String(line.id)),qty=Math.floor(Number(line.qty));if(!item)throw new HttpError(400,'Un plat est introuvable ou indisponible.');if(!(qty>=1&&qty<=20))throw new HttpError(400,'Quantité invalide.');if(item.stock<qty)throw new HttpError(409,`Stock insuffisant pour ${item.name}.`);const price=item.promo_price&&item.promo_price>0&&item.promo_price<item.price?item.promo_price:item.price;lines.push({id:item.id,name:item.name,price,qty});total+=price*qty;}
  const ref='GX-'+crypto.randomBytes(4).toString('hex').toUpperCase().slice(0,6);const r=db.prepare("INSERT INTO orders(ref,user_id,customer_name,phone,pickup,note,items,total) VALUES(?,?,?,?,?,?,?,?)").run(ref,userId,clip(customerName,80)||'Client WhatsApp',clip(phone,30),pickup,clip(note,200),JSON.stringify(lines),total);
  const deduct=db.prepare('UPDATE menu SET stock=stock-? WHERE id=? AND stock>=?');for(const line of lines)deduct.run(line.qty,line.id,line.qty);db.prepare("INSERT INTO order_events(order_id,status) VALUES(?, 'received')").run(r.lastInsertRowid);return db.prepare('SELECT * FROM orders WHERE id=?').get(r.lastInsertRowid);
}
async function processWhatsAppWebhook(payload) {
  let accepted=0,ignored=0,errors=0;
  for(const entry of payload.entry||[])for(const change of entry.changes||[])for(const message of change.value?.messages||[]){
    if(!message.id||db.prepare('SELECT 1 FROM whatsapp_webhook_events WHERE message_id=?').get(message.id)){ignored++;continue;}
    const from=String(message.from||'');const textBody=message.type==='text'?String(message.text?.body||'').trim():'';
    // Format attendu : GXORDER|Nom|Téléphone|Point de retrait|Plat x quantité;Plat x quantité
    const parts=textBody.split('|');
    if(parts.length!==5||parts[0].trim().toUpperCase()!=='GXORDER'){
      await sendWhatsAppText(from,'Pour passer une commande, envoie : GXORDER|Nom|Téléphone|Point de retrait|Plat x quantité;Autre plat x quantité');
      db.prepare('INSERT OR IGNORE INTO whatsapp_webhook_events(message_id) VALUES(?)').run(message.id);ignored++;continue;
    }
    try {
      const [,name,phone,pickup,rawItems]=parts;const rows=rawItems.split(';').map(x=>{const m=x.trim().match(/^(.+?)\s*(?:x|×)\s*(\d+)$/i);if(!m)throw new HttpError(400,'Format article invalide.');const wanted=m[1].trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const product=db.prepare('SELECT id,name FROM menu WHERE active=1').all().find(x=>x.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()===wanted);if(!product)throw new HttpError(400,`Plat inconnu : ${m[1]}`);return {id:product.id,qty:Number(m[2])};});
      const order=createOrderRecord({customerName:name,phone:phone||from,pickup:pickup.trim(),items:rows,note:'Commande reçue par WhatsApp'});const supplierDispatch=await dispatchOrderToSuppliers(order);await sendWhatsAppText(from,`Merci ${clip(name,60)} ! Ta commande ${order.ref} a été enregistrée. Total : ${order.total.toLocaleString('fr-FR')} FCFA. Retrait : ${order.pickup}.`);db.prepare('INSERT OR IGNORE INTO whatsapp_webhook_events(message_id) VALUES(?)').run(message.id);accepted++;console.log('Commande WhatsApp reçue',order.ref,supplierDispatch);
    }catch(err){errors++;await sendWhatsAppText(from,'Je n’ai pas pu enregistrer cette commande : '+clip(err.message,180)+'. Vérifie le format et les noms des plats.');db.prepare('INSERT OR IGNORE INTO whatsapp_webhook_events(message_id) VALUES(?)').run(message.id);}
  }
  return {ok:true,accepted,ignored,errors};
}

async function dispatchOrderToSuppliers(order) {
  const enabled = db.prepare("SELECT value FROM app_settings WHERE key='express_send_enabled'").get()?.value !== '0';
  const includePhone = db.prepare("SELECT value FROM app_settings WHERE key='include_customer_phone'").get()?.value === '1';
  if (!enabled) return {enabled:false,sent:0,reason:'ExpressSend désactivé dans les paramètres.'};
  const items = JSON.parse(order.items || '[]');
  const grouped = new Map();
  for (const item of items) {
    const supplier = db.prepare('SELECT s.* FROM dish_suppliers ds JOIN suppliers s ON s.id=ds.supplier_id WHERE ds.dish_id=? AND s.active=1').get(item.id);
    if (!supplier) continue;
    if (!grouped.has(supplier.id)) grouped.set(supplier.id,{supplier,items:[]});
    grouped.get(supplier.id).items.push(item);
  }
  if (!grouped.size) return {enabled:true,sent:0,unassigned:items.length,reason:'Aucun fournisseur actif associé aux plats de cette commande.'};
  const configured = !!(E.WHATSAPP_ACCESS_TOKEN && E.WHATSAPP_PHONE_NUMBER_ID);
  let sent=0, pending=0;
  for (const {supplier,items:lines} of grouped.values()) {
    const list=lines.map(x=>`• ${x.qty} x ${x.name}`).join('\n');
    const body=`GROUPE EXPRESS — Nouvelle commande ${order.ref}\nClient : ${order.customer_name||'Client'}${includePhone&&order.phone?'\nTéléphone client : '+order.phone:''}\nRetrait : ${order.pickup}\n\nArticles à préparer :\n${list}\n\nTotal commande : ${Number(order.total).toLocaleString('fr-FR')} FCFA`;
    let status='pending', error='';
    if (configured && supplier.phone) {
      try {
        const delivery=await sendWhatsAppText(supplier.phone,body);
        if(!delivery.sent) throw new Error(delivery.reason||'Échec WhatsApp');
        status='sent'; sent++;
      } catch(err) { status='failed'; error=clip(err.message,300); }
    } else { pending++; error=!configured?'API WhatsApp non configurée dans .env.':'Numéro WhatsApp fournisseur manquant.'; }
    db.prepare('INSERT INTO supplier_orders(supplier_id,category,items,status,order_ref,delivery_error) VALUES(?,?,?,?,?,?)').run(supplier.id,supplier.category,JSON.stringify(lines),status,order.ref,error);
  }
  return {enabled:true,configured,sent,pending,unassigned:items.filter(x=>!db.prepare('SELECT 1 FROM dish_suppliers WHERE dish_id=?').get(x.id)).length};
}

// ---------- Compte équipe initial ----------
{
  const ph = normPhone(E.ADMIN_PHONE), pw = E.ADMIN_PASSWORD || '';
  if (ph && pw.length >= 8 && pw !== 'change-this-password') {
    const u = db.prepare('SELECT id FROM users WHERE phone=?').get(ph);
    if (u) db.prepare("UPDATE users SET role='admin' WHERE id=?").run(u.id);
    else db.prepare("INSERT INTO users(name,phone,pass,role) VALUES('Équipe Groupe Express',?,?, 'admin')").run(ph, hashPw(pw));
  } else console.warn('ATTENTION : définis ADMIN_PHONE et ADMIN_PASSWORD (8 caractères minimum) dans .env pour créer le compte équipe.');
}

// ---------- Routes API ----------
const routes = [];
const route = (method, p, fn, o = {}) => routes.push({ method, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, ...o });
const STATUS_NEXT = { received: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['picked_up', 'cancelled'] };
const setStatus = (o, st) => {
  db.prepare("UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?").run(st, o.id);
  db.prepare('INSERT INTO order_events(order_id,status) VALUES(?,?)').run(o.id, st);
};

route('POST','/api/admin/pickups',({body})=>{const name=clip(body.name,100);if(name.length<3)throw new HttpError(400,'Le nom du point de retrait doit contenir au moins 3 caractères.');const list=getAllPickupPoints();if(list.some(x=>x.toLowerCase()===name.toLowerCase()))throw new HttpError(409,'Ce point de retrait existe déjà.');if(list.length>=30)throw new HttpError(400,'Limite de 30 points de retrait atteinte.');const next=[...list,name];db.prepare("INSERT INTO app_settings(key,value) VALUES('pickup_points',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));return {ok:true,pickups:next};},{admin:true,status:201});
route('GET','/api/admin/pickups',()=>({pickups:getPickupPoints(),disabled:getDisabledPickupPoints()}),{admin:true});
route('PATCH','/api/admin/pickups/:name',({params,body})=>{const name=decodeURIComponent(params.name),all=getAllPickupPoints();if(!all.includes(name))throw new HttpError(404,'Point de retrait introuvable.');let disabled=getDisabledPickupPoints();if(body.active===false){if(getPickupPoints().length<=1&& !disabled.includes(name))throw new HttpError(409,'Conserve au moins un point de retrait actif.');if(!disabled.includes(name))disabled.push(name);}else disabled=disabled.filter(x=>x!==name);db.prepare("INSERT INTO app_settings(key,value) VALUES('disabled_pickup_points',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(disabled));return {ok:true,pickups:getPickupPoints(),disabled};},{admin:true});
route('DELETE','/api/admin/pickups/:name',({params})=>{const name=decodeURIComponent(params.name);const current=getAllPickupPoints();if(!current.includes(name))throw new HttpError(404,'Point de retrait introuvable ou déjà désactivé.');const next=current.filter(x=>x!==name);if(!next.some(x=>!getDisabledPickupPoints().includes(x)))throw new HttpError(409,'Conserve au moins un point de retrait actif.');db.prepare("INSERT INTO app_settings(key,value) VALUES('pickup_points',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));db.prepare("INSERT INTO app_settings(key,value) VALUES('disabled_pickup_points',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(getDisabledPickupPoints().filter(x=>x!==name)));return {ok:true,pickups:getPickupPoints()};},{admin:true});
route('GET', '/api/health', () => ({ ok: true, version: VERSION }));
route('GET', '/api/config', () => ({ pickups: getPickupPoints(), emergency: EMERGENCY, version: VERSION }));
route('GET','/api/hero-images',()=>({images:db.prepare('SELECT id,image FROM hero_images WHERE active=1 ORDER BY rowid').all()}));
route('GET','/api/electronics',()=>({products:db.prepare('SELECT id,name,category,price,description,image,stock,gallery_json,colors_json,COALESCE((SELECT ROUND(AVG(r.rating),1) FROM reviews r WHERE r.status=\'approved\' AND r.item_type=\'electronic\' AND r.item_id=electronics.id),0) rating,(SELECT COUNT(*) FROM reviews r WHERE r.status=\'approved\' AND r.item_type=\'electronic\' AND r.item_id=electronics.id) review_count FROM electronics WHERE active=1 ORDER BY created_at DESC').all().map(p=>({...p,gallery:safeJson(p.gallery_json,[]),colors:safeJson(p.colors_json,[])})),banners:db.prepare('SELECT id,image FROM electronics_banners WHERE active=1 ORDER BY position,id').all(),categories:db.prepare('SELECT category,icon_image FROM electronics_categories ORDER BY category').all()}));
route('POST','/api/electronics/orders',({user,body})=>{const items=Array.isArray(body.items)?body.items:[{productId:body.productId,quantity:body.quantity,color:body.color}];if(!items.length||items.length>30)throw new HttpError(400,'Panier électronique invalide.');const created=[];db.exec('BEGIN IMMEDIATE');try{for(const item of items){const productId=clip(item.productId??item.id,40),quantity=Math.floor(Number(item.quantity??item.qty));if(!productId||!(quantity>=1&&quantity<=5))throw new HttpError(400,'Article ou quantité invalide.');const p=db.prepare('SELECT * FROM electronics WHERE id=? AND active=1').get(productId);if(!p)throw new HttpError(404,'Produit introuvable ou désactivé : '+productId);if(p.stock<quantity)throw new HttpError(409,`Stock insuffisant pour ${p.name} : ${p.stock} disponible(s), ${quantity} demandé(s).`);const upd=db.prepare('UPDATE electronics SET stock=stock-? WHERE id=? AND stock>=?').run(quantity,p.id,quantity);if(!upd.changes)throw new HttpError(409,'Le stock vient de changer. Actualise ton panier.');const ref='GE-E-'+crypto.randomBytes(4).toString('hex').toUpperCase();const color=clip(item.color,30),selectedColor=safeJson(p.colors_json,[]).find(c=>c.name===color),orderImage=selectedColor?.image||p.image;db.prepare('INSERT INTO electronics_orders(ref,user_id,product_id,product_name,quantity,unit_price,color,product_image) VALUES(?,?,?,?,?,?,?,?)').run(ref,user.id,p.id,p.name,quantity,p.price,color,orderImage);created.push({ref,name:p.name,quantity,price:p.price,color,image:orderImage});}db.exec('COMMIT');}catch(err){try{db.exec('ROLLBACK')}catch{}throw err;}return {ok:true,orders:created,ref:created[0]?.ref,status:'pending'};},{auth:true,status:201});
route('GET','/api/electronics/orders',({user})=>({orders:db.prepare('SELECT ref,product_id,product_name,quantity,unit_price,color,product_image,status,created_at FROM electronics_orders WHERE user_id=? ORDER BY id DESC').all(user.id)}),{auth:true});
route('POST','/api/electronics/orders/:ref/cancel',({user,params})=>{const o=db.prepare('SELECT * FROM electronics_orders WHERE ref=? AND user_id=?').get(params.ref,user.id);if(!o)throw new HttpError(404,'Commande électronique introuvable.');if(o.status!=='pending')throw new HttpError(409,'Cette commande ne peut plus être annulée depuis l’application. Contacte l’assistance.');db.exec('BEGIN IMMEDIATE');try{const upd=db.prepare("UPDATE electronics_orders SET status='cancelled' WHERE ref=? AND status='pending'").run(o.ref);if(!upd.changes)throw new HttpError(409,'La commande a déjà changé de statut.');db.prepare('UPDATE electronics SET stock=stock+? WHERE id=?').run(o.quantity,o.product_id);db.exec('COMMIT');}catch(err){try{db.exec('ROLLBACK')}catch{}throw err;}return {ok:true,ref:o.ref,status:'cancelled'};},{auth:true});
route('GET','/api/reviews',()=>({reviews:db.prepare("SELECT r.id,r.rating,r.comment,r.item_type,r.item_id,r.item_name,r.created_at,u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.status=\'approved\' ORDER BY r.id DESC LIMIT 60").all(),summary:db.prepare("SELECT COUNT(*) count,COALESCE(AVG(rating),0) average FROM reviews WHERE status='approved'").get()}));
route('POST','/api/reviews',({user,body})=>{const rating=Math.floor(Number(body.rating)),comment=clip(body.comment,800),itemType=['dish','electronic'].includes(body.itemType)?body.itemType:'general',itemId=clip(body.itemId,80);let itemName='';if(!(rating>=1&&rating<=5))throw new HttpError(400,'Choisis une note entre 1 et 5.');if(comment.length<3)throw new HttpError(400,'Écris un avis de 3 caractères minimum.');if(itemType==='dish'){const item=db.prepare('SELECT name FROM menu WHERE id=?').get(itemId);if(!item)throw new HttpError(404,'Plat introuvable.');itemName=item.name;}else if(itemType==='electronic'){const item=db.prepare('SELECT name FROM electronics WHERE id=?').get(itemId);if(!item)throw new HttpError(404,'Produit introuvable.');itemName=item.name;}const r=db.prepare("INSERT INTO reviews(user_id,rating,comment,status,item_type,item_id,item_name) VALUES(?,?,?,'pending',?,?,?)").run(user.id,rating,comment,itemType,itemId,itemName);return {ok:true,id:r.lastInsertRowid,message:'Merci ! Ton avis sera visible après validation.'};},{auth:true,status:201});
route('GET','/api/push/public-key',()=>({publicKey:E.VAPID_PUBLIC_KEY||''}));
route('GET', '/api/menu', () => {
  const products = db.prepare('SELECT id,name,category,price,description,image,tag,stock,promo_price,ingredients,long_description AS longDescription,options_json,COALESCE((SELECT ROUND(AVG(r.rating),1) FROM reviews r WHERE r.status=\'approved\' AND r.item_type=\'dish\' AND r.item_id=menu.id),0) rating,(SELECT COUNT(*) FROM reviews r WHERE r.status=\'approved\' AND r.item_type=\'dish\' AND r.item_id=menu.id) review_count FROM menu WHERE active=1 AND stock>0 ORDER BY rowid').all();
  const categories=[...new Set(products.map(p=>p.category))];
  const categoryIcons=Object.fromEntries(db.prepare('SELECT category,icon_image FROM menu_categories').all().map(x=>[x.category,x.icon_image]));
  return { products: products.map(p=>({...p,ingredients:p.ingredients?String(p.ingredients).split(',').map(x=>x.trim()).filter(Boolean):[],options:JSON.parse(p.options_json||'[]')})), categories, categoryIcons };
});

route('POST', '/api/auth/register', ({ body, ip, res }) => {
  limit('reg:' + ip, 10, 3600000);
  const name = clip(body.name, 60), phone = normPhone(body.phone), email = clip(body.email, 120).toLowerCase(), pw = String(body.password || ''), profileImage = saveProfileImage(body.profileImage || '');
  if (name.length < 2) throw new HttpError(400, 'Indique ton nom.');
  if (!profileImage) throw new HttpError(400, 'Ajoute une photo de profil pour créer ton compte.');
  if (!phone) throw new HttpError(400, 'Numéro invalide : 10 chiffres attendus (ex. 07 12 34 56 78).');
  if (email && !EMAIL.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
  if (pw.length < 8 || pw.length > 100) throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  if (!body.acceptTerms) throw new HttpError(400, 'Tu dois accepter les conditions d’utilisation.');
  if (db.prepare('SELECT 1 FROM users WHERE phone=?').get(phone)) throw new HttpError(409, 'Ce numéro a déjà un compte. Connecte-toi.');
  const r = db.prepare('INSERT INTO users(name,phone,email,pass,profile_image) VALUES(?,?,?,?,?)').run(name, phone, email, hashPw(pw), profileImage);
  db.prepare('INSERT INTO messages(user_id,title,body) VALUES(?,?,?)').run(r.lastInsertRowid,'Bienvenue chez GROUPE EXPRESS !',`Bonjour ${name}, bienvenue sur GROUPE EXPRESS. Nous sommes heureux de te compter parmi nous !`);
  return startSession(res, db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid));
});
route('POST', '/api/auth/login', ({ body, ip, res }) => {
  const phone = normPhone(body.phone);
  limit('login:' + ip, 20, 900000); limit('loginp:' + phone, 8, 900000);
  const u = phone && db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!u || !checkPw(String(body.password || ''), u.pass)) throw new HttpError(401, 'Numéro ou mot de passe incorrect.');
  return startSession(res, u);
});
route('POST', '/api/auth/logout', ({ req, res }) => {
  const t = cookies(req).gx_session; if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(sha(t));
  setCookie(res, '', 0); return { ok: true };
});
route('GET', '/api/me', ({ user }) => {
  if (!user) return { user: null };
  const done = db.prepare("SELECT COUNT(*) c FROM orders WHERE user_id=? AND status='picked_up'").get(user.id).c;
  const week=db.prepare("SELECT COUNT(*) c FROM orders WHERE user_id=? AND status='picked_up' AND date(created_at)>=date('now','-6 day')").get(user.id).c; const award=db.prepare("SELECT id FROM loyalty_awards WHERE user_id=? AND status IN ('eligible','approved') ORDER BY id DESC LIMIT 1").get(user.id); return { user: userOut(user), loyalty: { completed: done, goal: 10, weeklyCompleted:week, weeklyGoal:5, eligible:!!award, cardNumber:'GX-'+String(user.id).padStart(6,'0'), memberSince:user.created_at } };
});
route('PATCH', '/api/me', ({ user, body }) => {
  const name = clip(body.name, 60), email = clip(body.email, 120).toLowerCase();
  if (name.length < 2) throw new HttpError(400, 'Indique ton nom.');
  if (email && !EMAIL.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
  db.prepare('UPDATE users SET name=?, email=? WHERE id=?').run(name, email, user.id);
  return { user: userOut({ ...user, name, email }) };
}, { auth: true });
route('POST', '/api/me/password', ({ user, body, req }) => {
  limit('pw:' + user.id, 6, 900000);
  if (!checkPw(String(body.current || ''), user.pass)) throw new HttpError(401, 'Mot de passe actuel incorrect.');
  const next = String(body.next || ''); if (next.length < 8 || next.length > 100) throw new HttpError(400, 'Le nouveau mot de passe doit contenir au moins 8 caractères.');
  db.prepare('UPDATE users SET pass=? WHERE id=?').run(hashPw(next), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(user.id, sha(cookies(req).gx_session || ''));
  return { ok: true };
}, { auth: true });
route('DELETE', '/api/me', ({ user, body, res }) => {
  limit('del:' + user.id, 5, 900000);
  if (!checkPw(String(body.password || ''), user.pass)) throw new HttpError(401, 'Mot de passe incorrect.');
  db.prepare("UPDATE orders SET customer_name='Compte supprimé', phone='', note='' WHERE user_id=?").run(user.id);
  db.prepare('DELETE FROM users WHERE id=?').run(user.id); setCookie(res, '', 0); return { ok: true };
}, { auth: true });

route('POST', '/api/orders', async ({ user, body }) => {
  limit('order:' + user.id, 15, 3600000);
  const pickup = String(body.pickup || ''); if (!getPickupPoints().includes(pickup)) throw new HttpError(400, 'Choisis un point de retrait valide.');
  const lines = Array.isArray(body.items) ? body.items.slice(0, 30) : []; if (!lines.length) throw new HttpError(400, 'Ton panier est vide.');
  const get = db.prepare('SELECT id,name,price,stock,promo_price,image FROM menu WHERE id=? AND active=1'); const items = []; let subtotal = 0;
  for (const l of lines) {
    const p = get.get(String(l.id)), qty = Math.floor(Number(l.qty));
    if (!p) throw new HttpError(400, 'Un plat de ton panier n’est plus disponible. Recharge le menu.');
    if (!(qty >= 1 && qty <= 20)) throw new HttpError(400, 'Quantité invalide.');
    if (p.stock < qty) throw new HttpError(409, `Stock insuffisant pour ${p.name} (disponible : ${p.stock}).`);
    const price = p.promo_price && p.promo_price > 0 && p.promo_price < p.price ? p.promo_price : p.price;
    items.push({ id: p.id, name: p.name, image: p.image || '/assets/food-placeholder.svg', price, qty }); subtotal += price * qty;
  }
  let discount = 0, promoCode = clip(body.promoCode, 30).toUpperCase();
  if (promoCode) { const c = db.prepare('SELECT * FROM promo_codes WHERE code=? AND active=1').get(promoCode); if (!c || (c.expires_at && Date.parse(c.expires_at+'T23:59:59Z') < Date.now()) || (c.max_uses > 0 && c.uses >= c.max_uses)) throw new HttpError(400, 'Code promo invalide ou expiré.'); discount = Math.floor(subtotal * c.discount_percent / 100); db.prepare('UPDATE promo_codes SET uses=uses+1 WHERE code=?').run(promoCode); }
  const total = Math.max(0, subtotal - discount);
  const method = ['pickup','orange_money','mtn_money','moov_money','wave'].includes(body.paymentMethod) ? body.paymentMethod : 'pickup';
  const payPhone = normPhone(body.paymentPhone || '') || '';
  if (method !== 'pickup' && !payPhone) throw new HttpError(400, 'Indique le numéro Mobile Money à utiliser.');
  const ref = 'GX-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  const r = db.prepare('INSERT INTO orders(ref,user_id,customer_name,phone,pickup,note,items,total,payment_method,payment_phone,promo_code,discount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(ref, user.id, user.name, user.phone, pickup, clip(body.note, 200), JSON.stringify(items), total, method, payPhone, promoCode, discount);
  const deduct = db.prepare('UPDATE menu SET stock=stock-? WHERE id=? AND stock>=?'); for (const it of items) deduct.run(it.qty,it.id,it.qty);
  db.prepare("INSERT INTO order_events(order_id,status) VALUES(?, 'received')").run(r.lastInsertRowid);
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(r.lastInsertRowid);
  const supplierDispatch=await dispatchOrderToSuppliers(o);
  return { ...orderOut(o, eventsOf(o.id)), paymentMethod: method, paymentPhone: payPhone, discount, promoCode, supplierDispatch };
}, { auth: true, status: 201 });
route('POST', '/api/promo/validate', ({body}) => { const code=clip(body.code,30).toUpperCase(); const c=db.prepare('SELECT * FROM promo_codes WHERE code=? AND active=1').get(code); if(!c || (c.expires_at && Date.parse(c.expires_at+'T23:59:59Z')<Date.now()) || (c.max_uses>0&&c.uses>=c.max_uses)) throw new HttpError(404,'Code promo invalide ou expiré.'); return {code,discountPercent:c.discount_percent}; });
route('GET', '/api/orders', ({ user }) => ({ orders: db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 100').all(user.id).map(o => orderOut(o)) }), { auth: true });
route('GET', '/api/messages', ({ user }) => ({ messages: db.prepare('SELECT id,title,body,created_at,read_at FROM messages WHERE user_id=? ORDER BY id DESC LIMIT 100').all(user.id).map(m=>({...m,created_at:iso(m.created_at)})) }), { auth: true });
route('POST', '/api/messages/:id/read', ({ user, params }) => { db.prepare("UPDATE messages SET read_at=datetime('now') WHERE id=? AND user_id=?").run(Number(params.id),user.id); return {ok:true}; }, { auth: true });
route('GET','/api/gifts',({user})=>({gifts:db.prepare('SELECT id,title,description,status,created_at,read_at FROM gift_offers WHERE user_id=? ORDER BY id DESC').all(user.id),unread:db.prepare('SELECT COUNT(*) n FROM gift_offers WHERE user_id=? AND read_at IS NULL').get(user.id).n}),{auth:true});
route('POST','/api/gifts/:id/read',({user,params})=>{db.prepare("UPDATE gift_offers SET read_at=datetime('now') WHERE id=? AND user_id=?").run(Number(params.id),user.id);return {ok:true};},{auth:true});
route('POST','/api/push/subscribe',({user,body})=>{const sub=body.subscription;if(!sub||typeof sub.endpoint!=='string'||!sub.endpoint.startsWith('https://')||!sub.keys?.p256dh||!sub.keys?.auth)throw new HttpError(400,'Abonnement de notification invalide.');db.prepare('INSERT INTO push_subscriptions(user_id,endpoint,subscription_json) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json').run(user.id,sub.endpoint,JSON.stringify(sub));return {ok:true};},{auth:true});
route('DELETE','/api/push/subscribe',({user,body})=>{if(body.endpoint)db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(user.id,body.endpoint);else db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(user.id);return {ok:true};},{auth:true});
route('GET', '/api/orders/:ref', ({ user, params }) => {
  const o = db.prepare('SELECT * FROM orders WHERE ref=?').get(params.ref);
  if (!o || (o.user_id !== user.id && user.role !== 'admin')) throw new HttpError(404, 'Commande introuvable.');
  return orderOut(o, eventsOf(o.id));
}, { auth: true });
route('POST', '/api/orders/:ref/cancel', ({ user, params }) => {
  const o = db.prepare('SELECT * FROM orders WHERE ref=? AND user_id=?').get(params.ref, user.id);
  if (!o) throw new HttpError(404, 'Commande introuvable.');
  if (o.status !== 'received') throw new HttpError(409, 'La commande est déjà en préparation : appelle l’assistance pour l’annuler.');
  setStatus(o, 'cancelled'); return orderOut({ ...o, status: 'cancelled' }, eventsOf(o.id));
}, { auth: true });

// --- Espace équipe ---
route('POST', '/api/assistant', async ({ body, user }) => {
  const question = clip(body.message, 1200);
  if (question.length < 2) throw new HttpError(400, 'Écris une question.');
  limit('assistant:' + user.id, 30, 3600000);
  if (!E.OPENAI_API_KEY) return { configured:false, answer:'L’assistant GROUPE EXPRESS est prêt, mais sa clé OpenAI n’est pas encore configurée. L’équipe pourra l’activer en ajoutant OPENAI_API_KEY dans le fichier .env.' };
  const menu = db.prepare('SELECT name,category,price,description,stock FROM menu WHERE active=1 AND stock>0 ORDER BY category,name').all();
  const response = await fetch(E.OPENAI_BASE_URL || 'https://api.openai.com/v1/responses', { method:'POST', headers:{'Authorization':'Bearer '+E.OPENAI_API_KEY,'Content-Type':'application/json'}, body:JSON.stringify({model:E.OPENAI_MODEL||'gpt-4.1-mini',input:[{role:'system',content:'Tu es l’assistant officiel de GROUPE EXPRESS à Abidjan. Réponds en français, clairement et uniquement à partir des informations disponibles. Ne confirme jamais une commande ni un paiement. Pour modifier une commande, inviter à contacter l’équipe. Menu disponible: '+JSON.stringify(menu)},{role:'user',content:question}]}) });
  if (!response.ok) { console.error('OpenAI error', response.status); throw new HttpError(502,'L’assistant est momentanément indisponible. Réessaie plus tard.'); }
  const data = await response.json(); const answer = data.output_text || (data.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join(' ') || 'Je n’ai pas pu formuler de réponse. Contacte notre équipe.';
  return {configured:true,answer:String(answer).slice(0,5000)};
}, {auth:true});
route('GET','/api/admin/hero-images',()=>({images:db.prepare('SELECT id,image,active,created_at FROM hero_images ORDER BY rowid DESC').all()}),{admin:true});
route('POST','/api/admin/hero-images',({body})=>{const image=saveDishImage(body.image);if(!image)throw new HttpError(400,'Sélectionne une image.');const id='hero-'+crypto.randomBytes(8).toString('hex');db.prepare('INSERT INTO hero_images(id,image) VALUES(?,?)').run(id,image);return {ok:true,id,image};},{admin:true,status:201});
route('DELETE','/api/admin/hero-images/:id',({params})=>{const row=db.prepare('SELECT image FROM hero_images WHERE id=?').get(params.id);if(!row)throw new HttpError(404,'Image introuvable.');db.prepare('DELETE FROM hero_images WHERE id=?').run(params.id);const f=path.resolve(PUBLIC,'.'+row.image);if(f.startsWith(path.join(PUBLIC,'uploads','dishes')+path.sep)&&fs.existsSync(f))fs.rmSync(f,{force:true});return {ok:true};},{admin:true});
route('POST','/api/admin/uploads/dish',({body})=>({ok:true,image:saveDishImage(body.image)}),{admin:true,status:201});
route('GET','/api/admin/gifts',()=>({gifts:db.prepare('SELECT g.*,u.name customer_name,u.phone FROM gift_offers g JOIN users u ON u.id=g.user_id ORDER BY g.id DESC').all(),customers:db.prepare("SELECT id,name,phone FROM users WHERE role='customer' ORDER BY name").all()}),{admin:true});
route('POST','/api/admin/gifts',({body})=>{const userId=Number(body.userId),title=clip(body.title,100),description=clip(body.description,500);if(!db.prepare("SELECT id FROM users WHERE id=? AND role='customer'").get(userId)||title.length<2)throw new HttpError(400,'Client et intitulé du cadeau obligatoires.');const r=db.prepare("INSERT INTO gift_offers(user_id,title,description,status) VALUES(?,?,?,'approved')").run(userId,title,description);return {ok:true,id:r.lastInsertRowid};},{admin:true,status:201});
route('DELETE','/api/admin/gifts/:id',({params})=>{db.prepare('DELETE FROM gift_offers WHERE id=?').run(Number(params.id));return {ok:true};},{admin:true});
route('GET','/api/admin/loyalty',()=>({customers:db.prepare("SELECT u.id,u.name,u.phone,COUNT(o.id) weekly_orders,MAX(o.created_at) last_order,CASE WHEN COUNT(o.id)>=5 THEN 1 ELSE 0 END eligible FROM users u LEFT JOIN orders o ON o.user_id=u.id AND o.status='picked_up' AND date(o.created_at)>=date('now','-6 day') WHERE u.role='customer' GROUP BY u.id ORDER BY weekly_orders DESC,u.name").all(),awards:db.prepare('SELECT a.*,u.name,u.phone FROM loyalty_awards a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC').all()}),{admin:true});
route('PATCH','/api/admin/loyalty/:id',({params,body})=>{const status=['approved','redeemed','rejected'].includes(body.status)?body.status:null;if(!status)throw new HttpError(400,'Statut invalide.');db.prepare('UPDATE loyalty_awards SET status=? WHERE id=?').run(status,Number(params.id));return {ok:true};},{admin:true});
route('GET','/api/admin/electronics',()=>({products:db.prepare('SELECT * FROM electronics ORDER BY created_at DESC').all().map(p=>({...p,gallery:safeJson(p.gallery_json,[]),colors:safeJson(p.colors_json,[])})),categories:db.prepare('SELECT category,icon_image FROM electronics_categories ORDER BY category').all(),banners:db.prepare('SELECT * FROM electronics_banners ORDER BY position,id').all(),orders:db.prepare('SELECT eo.*,u.name customer_name,u.phone FROM electronics_orders eo JOIN users u ON u.id=eo.user_id ORDER BY eo.id DESC LIMIT 100').all()}),{admin:true});
route('PATCH','/api/admin/electronics/orders/:ref',({params,body})=>{const status=['confirmed','completed','cancelled'].includes(body.status)?body.status:null;if(!status)throw new HttpError(400,'Statut invalide.');const o=db.prepare('SELECT * FROM electronics_orders WHERE ref=?').get(params.ref);if(!o)throw new HttpError(404,'Commande introuvable.');db.exec('BEGIN IMMEDIATE');try{if(status==='cancelled'&&!['cancelled','completed'].includes(o.status))db.prepare('UPDATE electronics SET stock=stock+? WHERE id=?').run(o.quantity,o.product_id);db.prepare('UPDATE electronics_orders SET status=? WHERE ref=?').run(status,o.ref);db.exec('COMMIT');}catch(err){try{db.exec('ROLLBACK')}catch{}throw err;}return {ok:true};},{admin:true});
route('POST','/api/admin/electronics',async({body})=>{const name=clip(body.name,100),category=clip(body.category,60),price=Math.floor(Number(body.price)),stock=Math.max(0,Math.floor(Number(body.stock||0))),description=clip(body.description,1000),image=body.image?saveDishImage(body.image):'',gallery=Array.isArray(body.gallery)?[...new Set(body.gallery.filter(x=>x&&x!==body.image).slice(0,8))].map(saveDishImage).filter(Boolean):[],colors=Array.isArray(body.colors)?body.colors.slice(0,12).map(c=>({name:clip(c.name,30),hex:/^#[0-9a-f]{6}$/i.test(c.hex)?c.hex:'#777777',image:c.image?saveDishImage(c.image):''})):[];if(name.length<2||!category||price<50)throw new HttpError(400,'Nom, catégorie et prix valides obligatoires.');const id='elec-'+crypto.randomBytes(6).toString('hex');db.prepare('INSERT INTO electronics(id,name,category,price,description,image,stock,gallery_json,colors_json) VALUES(?,?,?,?,?,?,?,?,?)').run(id,name,category,price,description,image,stock,JSON.stringify([...new Set(gallery.filter(x=>x&&x!==image))]),JSON.stringify(colors));db.prepare('INSERT INTO electronics_categories(category,icon_image) VALUES(?,\'\') ON CONFLICT(category) DO NOTHING').run(category);const notification=await notifyNewCatalogItem({kind:'electronic',id,name,category,price,description,image});return {ok:true,id,notification};},{admin:true,status:201});
route('PATCH','/api/admin/electronics/:id',({params,body})=>{const p=db.prepare('SELECT * FROM electronics WHERE id=?').get(params.id);if(!p)throw new HttpError(404,'Produit introuvable.');const name=clip(body.name??p.name,100),category=clip(body.category??p.category,60),price=Math.floor(Number(body.price??p.price)),stock=Math.max(0,Math.floor(Number(body.stock??p.stock))),description=clip(body.description??p.description,1000),active=body.active===undefined?p.active:(body.active?1:0),image=body.image?saveDishImage(body.image):(body.image=== ''?'':p.image),gallery=Array.isArray(body.gallery)?[...new Set(body.gallery.filter(x=>x&&x!==body.image&&x!==p.image).slice(0,8))].map(keepOrSaveDishImage).filter(Boolean):safeJson(p.gallery_json,[]),colors=Array.isArray(body.colors)?body.colors.slice(0,12).map(c=>({name:clip(c.name,30),hex:/^#[0-9a-f]{6}$/i.test(c.hex)?c.hex:'#777777',image:c.image?keepOrSaveDishImage(c.image):''})):safeJson(p.colors_json,[]);if(name.length<2||!category||price<50)throw new HttpError(400,'Nom, catégorie et prix valides obligatoires.');db.prepare('UPDATE electronics SET name=?,category=?,price=?,description=?,image=?,stock=?,active=?,gallery_json=?,colors_json=? WHERE id=?').run(name,category,price,description,image,stock,active,JSON.stringify([...new Set(gallery.filter(x=>x&&x!==image))]),JSON.stringify(colors),params.id);db.prepare('INSERT INTO electronics_categories(category,icon_image) VALUES(?,\'\') ON CONFLICT(category) DO NOTHING').run(category);return {ok:true};},{admin:true});
route('DELETE','/api/admin/electronics/:id',({params})=>{
  const p=db.prepare('SELECT * FROM electronics WHERE id=?').get(params.id);
  if(!p)throw new HttpError(404,'Produit introuvable.');
  const images=[p.image,...safeJson(p.gallery_json,[]),...safeJson(p.colors_json,[]).map(c=>c.image)].filter(Boolean);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result=db.prepare('DELETE FROM electronics WHERE id=?').run(params.id);
    if(!result.changes)throw new HttpError(404,'Produit introuvable.');
    // Nettoyage de la catégorie dans la même transaction si elle ne contient plus de produit.
    db.prepare('DELETE FROM electronics_categories WHERE category=? AND NOT EXISTS (SELECT 1 FROM electronics WHERE category=?)').run(p.category,p.category);
    db.exec('COMMIT');
  } catch(err) { try { db.exec('ROLLBACK'); } catch {} throw err; }
  // Les commandes conservent leur nom, photo et prix historiques. Ne retirer que les fichiers devenus orphelins.
  const remaining=db.prepare('SELECT image,gallery_json,colors_json FROM electronics WHERE id<>?').all(params.id);
  const referenced=new Set(db.prepare('SELECT image FROM electronics_banners').all().map(x=>x.image));
  for(const row of remaining){referenced.add(row.image);for(const img of safeJson(row.gallery_json,[]))referenced.add(img);for(const c of safeJson(row.colors_json,[]))if(c.image)referenced.add(c.image);}
  for(const img of images){if(referenced.has(img))continue;const f=path.resolve(PUBLIC,'.'+img);if(f.startsWith(path.join(PUBLIC,'uploads','dishes')+path.sep)&&fs.existsSync(f))try{fs.rmSync(f,{force:true});}catch(err){console.warn('Nettoyage image produit différé:',err.message);}}
  return {ok:true,deletedId:params.id};
},{admin:true});
route('POST','/api/admin/electronics/categories',({body})=>{const category=clip(body.category,60);if(category.length<2)throw new HttpError(400,'Le nom de la catégorie doit contenir au moins 2 caractères.');const current=db.prepare('SELECT category,icon_image FROM electronics_categories WHERE category=?').get(category);let icon=current?.icon_image||'';if(body.image)icon=saveDishImage(body.image);db.prepare('INSERT INTO electronics_categories(category,icon_image) VALUES(?,?) ON CONFLICT(category) DO UPDATE SET icon_image=CASE WHEN length(excluded.icon_image)>0 THEN excluded.icon_image ELSE electronics_categories.icon_image END').run(category,icon);return {ok:true,category,icon};},{admin:true,status:201});
route('DELETE','/api/admin/electronics/categories/:name',({params})=>{const name=decodeURIComponent(params.name);if(db.prepare('SELECT 1 FROM electronics WHERE category=? LIMIT 1').get(name))throw new HttpError(409,'Cette catégorie contient encore des produits. Déplace ou supprime ses produits avant de la retirer.');const r=db.prepare('DELETE FROM electronics_categories WHERE category=?').run(name);if(!r.changes)throw new HttpError(404,'Catégorie introuvable.');return {ok:true};},{admin:true});
route('POST','/api/admin/electronics/category-icon',({body})=>{const category=clip(body.category,60),icon=saveDishImage(body.image);if(!category||!icon)throw new HttpError(400,'Catégorie et image d’icône obligatoires.');db.prepare('INSERT INTO electronics_categories(category,icon_image) VALUES(?,?) ON CONFLICT(category) DO UPDATE SET icon_image=excluded.icon_image').run(category,icon);return {ok:true,category,icon};},{admin:true,status:201});
route('GET','/api/admin/electronics/banners',()=>({banners:db.prepare('SELECT * FROM electronics_banners ORDER BY position,id').all()}),{admin:true});
route('POST','/api/admin/electronics/banners',({body})=>{const image=saveDishImage(body.image);if(!image)throw new HttpError(400,'Sélectionne une image.');const id='eb-'+crypto.randomBytes(7).toString('hex');db.prepare('INSERT INTO electronics_banners(id,image,position) VALUES(?,?,?)').run(id,image,Number(body.position)||0);return {ok:true,id};},{admin:true,status:201});
route('DELETE','/api/admin/electronics/banners/:id',({params})=>{const row=db.prepare('SELECT image FROM electronics_banners WHERE id=?').get(params.id);if(!row)throw new HttpError(404,'Bannière introuvable.');db.prepare('DELETE FROM electronics_banners WHERE id=?').run(params.id);const f=path.resolve(PUBLIC,'.'+row.image);if(f.startsWith(path.join(PUBLIC,'uploads','dishes')+path.sep)&&fs.existsSync(f))fs.rmSync(f,{force:true});return {ok:true};},{admin:true});
route('GET','/api/admin/push',()=>({subscribers:db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n,configured:!!(E.VAPID_PUBLIC_KEY&&E.VAPID_PRIVATE_KEY),assistantConfigured:!!E.OPENAI_API_KEY,whatsappConfigured:!!(E.WHATSAPP_ACCESS_TOKEN&&E.WHATSAPP_PHONE_NUMBER_ID)}),{admin:true});
route('GET','/api/admin/suppliers',()=>({suppliers:db.prepare('SELECT s.*,COUNT(ds.dish_id) dish_count FROM suppliers s LEFT JOIN dish_suppliers ds ON ds.supplier_id=s.id GROUP BY s.id ORDER BY s.category,s.name').all(),menu:db.prepare('SELECT id,name,category FROM menu WHERE active=1 ORDER BY category,name').all(),assignments:db.prepare('SELECT dish_id,supplier_id FROM dish_suppliers').all(),missing:db.prepare('SELECT m.id,m.name,m.category FROM menu m LEFT JOIN dish_suppliers ds ON ds.dish_id=m.id LEFT JOIN suppliers s ON s.id=ds.supplier_id AND s.active=1 WHERE m.active=1 AND s.id IS NULL ORDER BY m.category,m.name').all(),settings:{expressSend:db.prepare("SELECT value FROM app_settings WHERE key='express_send_enabled'").get()?.value!=='0',includeCustomerPhone:db.prepare("SELECT value FROM app_settings WHERE key='include_customer_phone'").get()?.value==='1',whatsappConfigured:!!(E.WHATSAPP_ACCESS_TOKEN&&E.WHATSAPP_PHONE_NUMBER_ID)}}),{admin:true});
route('POST','/api/admin/suppliers',({body})=>{const name=clip(body.name,100),category=clip(body.category,60),phone=clip(body.phone,30),email=clip(body.email,120),notes=clip(body.notes,500);if(name.length<2||!category)throw new HttpError(400,'Nom et catégorie obligatoires.');const r=db.prepare('INSERT INTO suppliers(name,category,phone,email,notes) VALUES(?,?,?,?,?)').run(name,category,phone,email,notes);return {ok:true,id:r.lastInsertRowid};},{admin:true,status:201});
route('PATCH','/api/admin/suppliers/:id',({params,body})=>{const id=Number(params.id),old=db.prepare('SELECT * FROM suppliers WHERE id=?').get(id);if(!old)throw new HttpError(404,'Fournisseur introuvable.');const name=clip(body.name??old.name,100),category=clip(body.category??old.category,60),phone=clip(body.phone??old.phone,30),email=clip(body.email??old.email,120),notes=clip(body.notes??old.notes,500),active=body.active===undefined?old.active:(body.active?1:0);if(name.length<2||!category)throw new HttpError(400,'Nom et catégorie obligatoires.');db.prepare('UPDATE suppliers SET name=?,category=?,phone=?,email=?,notes=?,active=? WHERE id=?').run(name,category,phone,email,notes,active,id);return {ok:true};},{admin:true});
route('DELETE','/api/admin/suppliers/:id',({params})=>{db.prepare('DELETE FROM supplier_orders WHERE supplier_id=?').run(Number(params.id));const r=db.prepare('DELETE FROM suppliers WHERE id=?').run(Number(params.id));if(!r.changes)throw new HttpError(404,'Fournisseur introuvable.');return {ok:true};},{admin:true});
route('POST','/api/admin/suppliers/:id/test',async({params})=>{const supplier=db.prepare('SELECT * FROM suppliers WHERE id=?').get(Number(params.id));if(!supplier)throw new HttpError(404,'Fournisseur introuvable.');if(!supplier.phone)throw new HttpError(400,'Ajoute d’abord le numéro WhatsApp du fournisseur.');const result=await sendWhatsAppText(supplier.phone,'GROUPE EXPRESS : message de test ExpressSend. Si tu reçois ce message, la liaison WhatsApp fonctionne.');if(!result.sent)throw new HttpError(503,result.reason||'Envoi WhatsApp impossible.');return {ok:true,message:'Message de test envoyé.'};},{admin:true});
route('PUT','/api/admin/suppliers/:id/dishes',({params,body})=>{const id=Number(params.id);if(!db.prepare('SELECT id FROM suppliers WHERE id=?').get(id))throw new HttpError(404,'Fournisseur introuvable.');const ids=[...new Set((Array.isArray(body.dishIds)?body.dishIds:[]).map(x=>clip(x,80)).filter(Boolean))];const valid=db.prepare(`SELECT id FROM menu WHERE id IN (${ids.length?ids.map(()=>'?').join(','):"''"})`).all(...ids);if(valid.length!==ids.length)throw new HttpError(400,'Un ou plusieurs plats sont introuvables.');db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM dish_suppliers WHERE supplier_id=?').run(id);const ins=db.prepare('INSERT INTO dish_suppliers(dish_id,supplier_id) VALUES(?,?) ON CONFLICT(dish_id) DO UPDATE SET supplier_id=excluded.supplier_id');for(const x of ids)ins.run(x,id);db.exec('COMMIT');}catch(err){db.exec('ROLLBACK');throw err;}return {ok:true,assigned:ids.length};},{admin:true});
route('PATCH','/api/admin/supplier-settings',({body})=>{const put=db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');put.run('express_send_enabled',body.expressSend===false?'0':'1');put.run('include_customer_phone',body.includeCustomerPhone?'1':'0');return {ok:true};},{admin:true});
route('GET','/api/admin/supplier-orders',()=>({orders:db.prepare('SELECT so.*,s.name supplier_name,s.phone supplier_phone FROM supplier_orders so JOIN suppliers s ON s.id=so.supplier_id ORDER BY so.id DESC LIMIT 100').all()}),{admin:true});
route('POST','/api/admin/supplier-orders/:id/send',async({params})=>{const so=db.prepare('SELECT so.*,s.name,s.phone FROM supplier_orders so JOIN suppliers s ON s.id=so.supplier_id WHERE so.id=?').get(Number(params.id));if(!so)throw new HttpError(404,'Commande fournisseur introuvable.');if(!so.phone)throw new HttpError(400,'Ajoute le numéro WhatsApp du fournisseur avant l’envoi.');if(!['draft','failed','pending'].includes(so.status))throw new HttpError(409,'Cette demande a déjà été envoyée ou clôturée.');const lines=safeJson(so.items,[]);if(!lines.length)throw new HttpError(400,'La commande fournisseur ne contient aucun article.');const body=`GROUPE EXPRESS — BON D’APPROVISIONNEMENT #${so.id}\nFournisseur : ${so.name}\nCatégorie : ${so.category}\n\n${lines.map(x=>`• ${Math.max(1,Number(x.quantity??x.qty)||1)} × ${clip(x.name,100)}`).join('\n')}\n\nMerci de confirmer la disponibilité et le délai.`;const result=await sendWhatsAppText(so.phone,body);if(!result.sent){db.prepare("UPDATE supplier_orders SET status='failed',delivery_error=? WHERE id=?").run(clip(result.reason||'Envoi impossible',300),so.id);throw new HttpError(503,result.reason||'Envoi fournisseur impossible.');}db.prepare("UPDATE supplier_orders SET status='sent',delivery_error='' WHERE id=?").run(so.id);return {ok:true,message:'Commande transmise au fournisseur par WhatsApp.'};},{admin:true});
route('POST','/api/admin/supplier-orders/:id/retry',async({params})=>{const so=db.prepare('SELECT so.*,s.name,s.phone FROM supplier_orders so JOIN suppliers s ON s.id=so.supplier_id WHERE so.id=?').get(Number(params.id));if(!so)throw new HttpError(404,'Envoi fournisseur introuvable.');const order=db.prepare('SELECT * FROM orders WHERE ref=?').get(so.order_ref);if(!order)throw new HttpError(404,'Commande client introuvable.');const result=await dispatchOrderToSuppliers({...order,items:JSON.stringify(JSON.parse(so.items).map(x=>({...x,id:x.id||''}))) });return {ok:true,result};},{admin:true});
route('POST','/api/admin/assistant/supplier-proposals',async()=>{
  const suppliers=db.prepare('SELECT id,name,category,phone,email FROM suppliers WHERE active=1 ORDER BY category').all();
  const lowStock=db.prepare('SELECT id,name,category,stock FROM menu WHERE active=1 AND stock<=10 ORDER BY category,stock').all();
  if(!suppliers.length)throw new HttpError(400,'Enregistre au moins un fournisseur avec sa catégorie.');
  if(!lowStock.length)return {configured:!!E.OPENAI_API_KEY,created:0,message:'Aucun stock bas détecté (seuil : 10 unités).'};
  if(!E.OPENAI_API_KEY)return {configured:false,created:0,message:'Ajoute OPENAI_API_KEY dans .env pour activer les propositions automatiques. Les articles à réapprovisionner sont disponibles dans le catalogue.'};
  const prompt='À partir des fournisseurs et des stocks faibles ci-dessous, répartis les propositions de réapprovisionnement par catégorie. Réponds uniquement en JSON valide sous la forme {"orders":[{"supplierId":1,"items":[{"name":"Article","quantity":10,"reason":"Stock faible"}]}]}. Utilise exclusivement les supplierId fournis. Fournisseurs: '+JSON.stringify(suppliers)+' Stocks: '+JSON.stringify(lowStock);
  const response=await fetch(E.OPENAI_BASE_URL||'https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+E.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:E.OPENAI_MODEL||'gpt-4.1-mini',input:[{role:'system',content:'Tu es un assistant d’approvisionnement. N’invente aucun fournisseur ni produit. Propose seulement des quantités raisonnables. JSON uniquement.'},{role:'user',content:prompt}]})});
  if(!response.ok)throw new HttpError(502,'Impossible de générer les propositions fournisseurs pour le moment.');
  const data=await response.json(),raw=data.output_text||'';let parsed;try{parsed=JSON.parse(raw.replace(/^```json\s*|```$/g,''));}catch{throw new HttpError(502,'La réponse IA n’a pas pu être convertie en propositions.');}
  let created=0;for(const item of (parsed.orders||[]).slice(0,20)){const supplier=suppliers.find(x=>x.id===Number(item.supplierId));const lines=Array.isArray(item.items)?item.items.slice(0,30).map(x=>({name:clip(x.name,100),quantity:Math.max(1,Math.min(500,Math.floor(Number(x.quantity)||1))),reason:clip(x.reason,200)})).filter(x=>x.name):[];if(supplier&&lines.length){db.prepare("INSERT INTO supplier_orders(supplier_id,category,items,status) VALUES(?,?,?,'draft')").run(supplier.id,supplier.category,JSON.stringify(lines));created++;}}
  return {configured:true,created,message:created+' brouillon(s) créé(s). Validation administrateur obligatoire avant tout envoi.'};
},{admin:true});
route('POST','/api/admin/supplier-orders/draft',({body})=>{const supplierId=Number(body.supplierId),supplier=db.prepare('SELECT * FROM suppliers WHERE id=? AND active=1').get(supplierId);if(!supplier)throw new HttpError(404,'Fournisseur introuvable.');const items=Array.isArray(body.items)?body.items.slice(0,50):[];if(!items.length)throw new HttpError(400,'Ajoute au moins un article.');const r=db.prepare("INSERT INTO supplier_orders(supplier_id,category,items,status) VALUES(?,?,?,'draft')").run(supplierId,supplier.category,JSON.stringify(items));return {ok:true,id:r.lastInsertRowid,status:'draft',message:'Brouillon créé. Validation administrateur obligatoire avant transmission.'};},{admin:true,status:201});
route('POST','/api/admin/orders/manual',async({body})=>{const order=createOrderRecord({customerName:body.customerName,phone:body.phone,pickup:clip(body.pickup,80),items:body.items,note:body.note||'Commande ajoutée par l’administration'});const supplierDispatch=await dispatchOrderToSuppliers(order);return {ok:true,...orderOut(order,eventsOf(order.id)),supplierDispatch};},{admin:true,status:201});
route('GET', '/api/admin/orders', ({ query }) => {
  const st = query.get('status');
  const rows = st ? db.prepare('SELECT * FROM orders WHERE status=? ORDER BY id DESC LIMIT 200').all(st) : db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 200').all();
  return { orders: rows.map(o => orderOut(o)) };
}, { admin: true });
route('PATCH', '/api/admin/orders/:ref', async ({ params, body }) => {
  const o = db.prepare('SELECT * FROM orders WHERE ref=?').get(params.ref); if (!o) throw new HttpError(404, 'Commande introuvable.');
  if (!(STATUS_NEXT[o.status] || []).includes(body.status)) throw new HttpError(409, 'Changement de statut impossible.');
  setStatus(o, body.status); let loyalty=null; if(body.status==='picked_up'&&o.user_id)loyalty=await evaluateWeeklyLoyalty(o.user_id); return { ok: true, loyalty };
}, { admin: true });
route('GET', '/api/admin/menu', () => ({ products: db.prepare('SELECT * FROM menu ORDER BY rowid').all() }), { admin: true });
route('POST', '/api/admin/menu', async ({body}) => { const name=clip(body.name,90), category=clip(body.category,40), description=clip(body.description,600), longDescription=clip(body.longDescription,1200), ingredients=clip(body.ingredients,1000), image=clip(body.image,500), tag=clip(body.tag,30), options=Array.isArray(body.options)?JSON.stringify(body.options.slice(0,20)): '[]', price=Math.floor(Number(body.price)), stock=Math.max(0,Math.floor(Number(body.stock ?? 999))), promo=body.promoPrice?Math.floor(Number(body.promoPrice)):null; if(name.length<2||!category||!(price>=50&&price<=100000)||stock<0||(promo!==null&&!(promo>=50&&promo<price))) throw new HttpError(400,'Nom, catégorie, prix, stock ou prix promotionnel invalide.'); if(image && !image.startsWith('/') && !/^https:\/\//i.test(image)) throw new HttpError(400,'Image : URL HTTPS ou chemin local attendu.'); const id='dish-'+crypto.randomBytes(6).toString('hex'); db.prepare('INSERT INTO menu(id,name,category,price,description,image,tag,active,stock,promo_price,ingredients,long_description,options_json) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?)').run(id,name,category,price,description,image,tag,stock,promo,ingredients,longDescription,options); db.prepare("INSERT OR IGNORE INTO menu_categories(category,icon_image) VALUES(?, '')").run(category); const notification=await notifyNewCatalogItem({kind:'dish',id,name,category,price,description,image}); return {ok:true,id,notification}; }, {admin:true,status:201});
route('PATCH', '/api/admin/menu/:id', ({ params, body }) => {
  const p = db.prepare('SELECT * FROM menu WHERE id=?').get(params.id); if (!p) throw new HttpError(404, 'Plat introuvable.');
  const price = body.price === undefined ? p.price : Math.floor(Number(body.price));
  if (!(price >= 50 && price <= 100000)) throw new HttpError(400, 'Prix invalide.');
  const name=body.name===undefined?p.name:clip(body.name,90), category=body.category===undefined?p.category:clip(body.category,40), description=body.description===undefined?p.description:clip(body.description,600), longDescription=body.longDescription===undefined?p.long_description:clip(body.longDescription,1200), ingredients=body.ingredients===undefined?p.ingredients:clip(body.ingredients,1000), options=body.options===undefined?p.options_json:JSON.stringify(Array.isArray(body.options)?body.options.slice(0,20):[]), image=body.image===undefined?p.image:clip(body.image,500), tag=body.tag===undefined?p.tag:clip(body.tag,30), stock=body.stock===undefined?p.stock:Math.max(0,Math.floor(Number(body.stock))), promo=body.promoPrice===undefined?p.promo_price:(body.promoPrice?Math.floor(Number(body.promoPrice)):null); if(!name||!category||stock<0||(promo!==null&&!(promo>=50&&promo<price))) throw new HttpError(400,'Nom, catégorie, stock ou promotion invalide.'); if(image && !image.startsWith('/') && !/^https:\/\//i.test(image)) throw new HttpError(400,'Image : URL HTTPS ou chemin local attendu.'); db.prepare('UPDATE menu SET name=?,category=?,description=?,long_description=?,ingredients=?,options_json=?,image=?,tag=?,price=?,active=?,stock=?,promo_price=? WHERE id=?').run(name,category,description,longDescription,ingredients,options,image,tag,price,body.active===undefined?p.active:(body.active?1:0),stock,promo,p.id); db.prepare("INSERT OR IGNORE INTO menu_categories(category,icon_image) VALUES(?, '')").run(category); return { ok: true }; 
}, { admin: true });
route('DELETE','/api/admin/menu/:id',({params})=>{const p=db.prepare('SELECT image,category FROM menu WHERE id=?').get(params.id);if(!p)throw new HttpError(404,'Plat introuvable.');db.exec('BEGIN IMMEDIATE');try{const r=db.prepare('DELETE FROM menu WHERE id=?').run(params.id);if(!r.changes)throw new HttpError(404,'Plat introuvable.');db.exec('COMMIT');}catch(err){try{db.exec('ROLLBACK')}catch{}throw err;}if(p.image&&!db.prepare('SELECT 1 FROM menu WHERE image=?').get(p.image)){const f=path.resolve(PUBLIC,'.'+p.image);if(f.startsWith(path.join(PUBLIC,'uploads','dishes')+path.sep)&&fs.existsSync(f))try{fs.rmSync(f,{force:true})}catch(err){console.warn('Nettoyage photo plat différé:',err.message)}}return {ok:true};},{admin:true});
route('GET','/api/admin/categories',()=>{db.exec("INSERT OR IGNORE INTO menu_categories(category,icon_image) SELECT DISTINCT category,'' FROM menu WHERE trim(category)<>''");return {categories:db.prepare("SELECT c.category,c.icon_image,COUNT(m.id) count FROM menu_categories c LEFT JOIN menu m ON m.category=c.category GROUP BY c.category ORDER BY c.category").all()};},{admin:true});
route('POST','/api/admin/categories',({body})=>{const category=clip(body.category,40);if(category.length<2)throw new HttpError(400,'Le nom de la catégorie doit contenir au moins 2 caractères.');const existing=db.prepare('SELECT category,icon_image FROM menu_categories WHERE lower(category)=lower(?)').get(category);if(existing)throw new HttpError(409,'Cette catégorie existe déjà.');const image=body.image?saveDishImage(body.image):'';if(!image)throw new HttpError(400,'Ajoute une photo pour l’icône de cette catégorie.');db.prepare('INSERT INTO menu_categories(category,icon_image) VALUES(?,?)').run(category,image);return {ok:true,category,image};},{admin:true,status:201});
route('PATCH','/api/admin/categories/:name',({params,body})=>{const name=decodeURIComponent(params.name),category=clip(body.category??name,40);let row=db.prepare('SELECT * FROM menu_categories WHERE category=?').get(name);if(!row&&db.prepare('SELECT 1 FROM menu WHERE category=? LIMIT 1').get(name)){db.prepare("INSERT OR IGNORE INTO menu_categories(category,icon_image) VALUES(?, '')").run(name);row=db.prepare('SELECT * FROM menu_categories WHERE category=?').get(name);}if(!row)throw new HttpError(404,'Catégorie introuvable.');if(category!==name&&db.prepare('SELECT 1 FROM menu_categories WHERE lower(category)=lower(?)').get(category))throw new HttpError(409,'Cette catégorie existe déjà.');const image=body.image?saveDishImage(body.image):row.icon_image;db.exec('BEGIN IMMEDIATE');try{if(category!==name)db.prepare('UPDATE menu SET category=? WHERE category=?').run(category,name);db.prepare('UPDATE menu_categories SET category=?,icon_image=? WHERE category=?').run(category,image,name);db.exec('COMMIT')}catch(err){try{db.exec('ROLLBACK')}catch{}throw err;}return {ok:true,category,image};},{admin:true});
route('DELETE','/api/admin/categories/:name',({params})=>{const name=decodeURIComponent(params.name);const row=db.prepare('SELECT icon_image FROM menu_categories WHERE category=?').get(name);const count=db.prepare('SELECT COUNT(*) count FROM menu WHERE category=?').get(name).count;if(!row&&!count)throw new HttpError(404,'Catégorie introuvable.');db.exec('BEGIN IMMEDIATE');try{const r=db.prepare('DELETE FROM menu WHERE category=?').run(name);db.prepare('DELETE FROM menu_categories WHERE category=?').run(name);db.exec('COMMIT');if(row?.icon_image){const f=path.resolve(PUBLIC,'.'+row.icon_image);if(f.startsWith(path.join(PUBLIC,'uploads','dishes')+path.sep)&&fs.existsSync(f))try{fs.rmSync(f,{force:true})}catch(err){console.warn('Nettoyage icône catégorie différé:',err.message)}}return {ok:true,deleted:r.changes};}catch(err){try{db.exec('ROLLBACK')}catch{}throw err;}},{admin:true});
route('GET', '/api/admin/stats', () => {
  const q = s => db.prepare(s).get();
  return {
    today: q("SELECT COUNT(*) orders, COALESCE(SUM(CASE WHEN status<>'cancelled' THEN total END),0) revenue FROM orders WHERE date(created_at)=date('now')"),
    open: q("SELECT COUNT(*) n FROM orders WHERE status IN ('received','preparing','ready')").n,
    users: q("SELECT COUNT(*) n FROM users WHERE role='customer'").n,
    top: db.prepare("SELECT json_extract(j.value,'$.name') name, SUM(json_extract(j.value,'$.qty')) qty FROM orders o, json_each(o.items) j WHERE o.status<>'cancelled' GROUP BY name ORDER BY qty DESC LIMIT 5").all()
  };
}, { admin: true });
route('GET', '/api/admin/trends', () => ({ days: db.prepare(`WITH RECURSIVE d(n,day) AS (SELECT 6,date('now','-6 day') UNION ALL SELECT n-1,date(day,'+1 day') FROM d WHERE n>0) SELECT day, COALESCE((SELECT COUNT(*) FROM orders o WHERE date(o.created_at)=d.day AND o.status<>'cancelled'),0) orders, COALESCE((SELECT SUM(total) FROM orders o WHERE date(o.created_at)=d.day AND o.status<>'cancelled'),0) revenue FROM d ORDER BY day`).all() }), {admin:true});
route('GET', '/api/admin/promos', () => ({promos:db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all()}), {admin:true});
route('POST', '/api/admin/promos', ({body}) => { const code=clip(body.code,30).toUpperCase(), pct=Math.floor(Number(body.discountPercent)), max=Math.max(0,Math.floor(Number(body.maxUses||0))), expires=clip(body.expiresAt,10)||null; if(!/^[A-Z0-9_-]{3,30}$/.test(code)||!(pct>=1&&pct<=80)) throw new HttpError(400,'Code invalide ou remise comprise entre 1 et 80 %.'); db.prepare('INSERT INTO promo_codes(code,discount_percent,active,expires_at,max_uses) VALUES(?,?,1,?,?)').run(code,pct,expires,max); return {ok:true}; }, {admin:true,status:201});
route('DELETE','/api/admin/promos/:code',({params})=>{const r=db.prepare('DELETE FROM promo_codes WHERE code=?').run(params.code.toUpperCase());if(!r.changes)throw new HttpError(404,'Code promo introuvable.');return {ok:true};},{admin:true});
route('PATCH', '/api/admin/promos/:code', ({params,body}) => { const active=body.active?1:0; const r=db.prepare('UPDATE promo_codes SET active=? WHERE code=?').run(active,params.code.toUpperCase()); if(!r.changes) throw new HttpError(404,'Code promo introuvable.'); return {ok:true}; }, {admin:true});
route('GET', '/api/admin/users', ({ query }) => {
  const q = '%' + clip(query.get('q'), 40) + '%';
  return { users: db.prepare('SELECT id,name,phone,email,role,created_at,profile_image FROM users WHERE name LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 100').all(q, q) };
}, { admin: true });
route('GET', '/api/admin/users/:id', ({params}) => { const u=db.prepare('SELECT id,name,phone,email,created_at,profile_image FROM users WHERE id=?').get(Number(params.id)); if(!u) throw new HttpError(404,'Client introuvable.'); return {user:u,orders:db.prepare('SELECT ref,total,status,created_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50').all(u.id),summary:db.prepare("SELECT COUNT(*) count,COALESCE(SUM(total),0) spent FROM orders WHERE user_id=? AND status<>'cancelled'").get(u.id)}; }, {admin:true});
route('POST', '/api/admin/messages', ({body}) => { const title=clip(body.title,100), message=clip(body.body,1000), target=body.userId==='all'?'all':Number(body.userId); if(title.length<2||message.length<2) throw new HttpError(400,'Titre et message obligatoires.'); const users=target==='all'?db.prepare("SELECT id FROM users WHERE role='customer'").all():db.prepare("SELECT id FROM users WHERE id=? AND role='customer'").all(target); if(!users.length) throw new HttpError(404,'Aucun client destinataire.'); const ins=db.prepare('INSERT INTO messages(user_id,title,body) VALUES(?,?,?)'); for(const u of users) ins.run(u.id,title,message); return {ok:true,sent:users.length}; }, {admin:true});
route('POST','/api/admin/messages/pickup-ready',async({})=>{const orders=db.prepare("SELECT * FROM orders WHERE status='ready' AND pickup_notified_at IS NULL ORDER BY id").all();if(!orders.length)return {ok:true,sent:0,whatsappSent:0,message:'Aucun client n’attend actuellement un retrait.'};const ins=db.prepare('INSERT INTO messages(user_id,title,body) VALUES(?,?,?)');let sent=0,whatsappSent=0;for(const o of orders){const title='Votre commande est prête !',body=`Bonjour ${o.customer_name||''}, votre commande ${o.ref} est prête. Vous pouvez la retirer au point ${o.pickup}. Merci pour votre confiance !`;if(o.user_id){ins.run(o.user_id,title,body);await sendUserPush(o.user_id,{title,body,url:'/#/commandes',tag:'pickup-'+o.ref});sent++;}if(o.phone){const delivery=await sendWhatsAppText(o.phone,body);if(delivery.sent)whatsappSent++;}db.prepare("UPDATE orders SET pickup_notified_at=datetime('now') WHERE id=? AND pickup_notified_at IS NULL").run(o.id);}return {ok:true,sent,whatsappSent,message:`Message de retrait enregistré pour ${sent} client(s) de l’application${whatsappSent?` et envoyé sur WhatsApp à ${whatsappSent} client(s)`:''}.`};},{admin:true});
route('GET','/api/admin/reviews',()=>({reviews:db.prepare('SELECT r.*,u.name customer_name,u.phone FROM reviews r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 200').all()}),{admin:true});
route('PATCH','/api/admin/reviews/:id',({params,body})=>{const status=['approved','rejected','pending'].includes(body.status)?body.status:null;if(!status)throw new HttpError(400,'Statut d’avis invalide.');const r=db.prepare('UPDATE reviews SET status=? WHERE id=?').run(status,Number(params.id));if(!r.changes)throw new HttpError(404,'Avis introuvable.');return {ok:true};},{admin:true});
route('DELETE','/api/admin/reviews/:id',({params})=>{const r=db.prepare('DELETE FROM reviews WHERE id=?').run(Number(params.id));if(!r.changes)throw new HttpError(404,'Avis introuvable.');return {ok:true};},{admin:true});
route('DELETE','/api/admin/users/:id',({params,user})=>{const id=Number(params.id);if(id===user.id)throw new HttpError(400,'Un administrateur ne peut pas supprimer son propre compte connecté.');const target=db.prepare('SELECT id,role FROM users WHERE id=?').get(id);if(!target)throw new HttpError(404,'Compte introuvable.');if(target.role==='admin')throw new HttpError(403,'Suppression d’un compte administrateur interdite depuis cette interface.');db.prepare('DELETE FROM users WHERE id=?').run(id);return {ok:true};},{admin:true});
route('POST', '/api/admin/users/:id/reset', ({ params, body }) => {
  const pw = String(body.password || ''); if (pw.length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum.');
  const r = db.prepare('UPDATE users SET pass=? WHERE id=?').run(hashPw(pw), Number(params.id));
  if (!r.changes) throw new HttpError(404, 'Client introuvable.');
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(Number(params.id)); return { ok: true };
}, { admin: true });

// ---------- Sessions & HTTP ----------
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split(/=(.*)/s).slice(0, 2)).filter(a => a[0]));
const setCookie = (res, token, days) => res.setHeader('Set-Cookie', `gx_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${days * 86400}${PROD ? '; Secure' : ''}`);
function startSession(res, u) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(sha(token), u.id, Date.now() + SESSION_DAYS * 864e5);
  setCookie(res, token, SESSION_DAYS); return { user: userOut(u) };
}
const sessionUser = req => {
  const t = cookies(req).gx_session; if (!t) return null;
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(sha(t), Date.now()) || null;
};
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  ...(PROD ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {})
};
const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(status, { 'Content-Type': type, ...SEC, ...extra }); res.end(body); };
const readBody = req => new Promise((ok, ko) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > 6000000) { ko(new HttpError(413, 'Requête trop volumineuse.')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { req.rawBody=Buffer.concat(chunks); ok(chunks.length ? JSON.parse(req.rawBody) : {}); } catch { ko(new HttpError(400, 'JSON invalide.')); } });
});
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  let f = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!f.startsWith(PUBLIC)) return send(res, 403, 'Interdit', 'text/plain');
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { if (path.extname(pathname)) return send(res, 404, 'Introuvable', 'text/plain'); f = path.join(PUBLIC, 'index.html'); }
  const ext = path.extname(f), mutable = /\.(html|js|css|webmanifest)$/.test(ext);
  send(res, 200, fs.readFileSync(f), MIME[ext] || 'application/octet-stream', { 'Cache-Control': mutable ? 'no-cache' : 'public, max-age=86400' });
}
// Diffusion temps réel (SSE) : les clients connectés reçoivent un signal après chaque écriture validée.
const realtimeClients = new Set();
let realtimeEventId = 0;
function publishRealtimeChange() {
  // Appelé uniquement après le retour réussi d'une route mutante : les transactions
  // SQLite de ces routes sont donc déjà validées avant la diffusion du signal.
  const id = ++realtimeEventId;
  const payload = `id: ${id}\nevent: data-change\ndata: ${JSON.stringify({ id, at: Date.now() })}\n\n`;
  for (const client of realtimeClients) { try { client.write(payload); } catch { realtimeClients.delete(client); } }
}

export const server = http.createServer(async (req, res) => {
  const ip = (E.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/events' && req.method === 'GET') {
      // Flux public limité à un signal générique : aucune donnée client ou commande n'est diffusée.
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform, no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n');
      res.write(`event: connected\ndata: ${JSON.stringify({ at: Date.now(), version: VERSION })}\n\n`);
      realtimeClients.add(res);
      const heartbeat = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch { clearInterval(heartbeat); realtimeClients.delete(res); } }, 20000);
      res.on('close', () => { clearInterval(heartbeat); realtimeClients.delete(res); });
      return;
    }
    if(url.pathname==='/api/whatsapp/webhook'&&req.method==='GET'){
      const mode=url.searchParams.get('hub.mode'),token=url.searchParams.get('hub.verify_token'),challenge=url.searchParams.get('hub.challenge');
      if(mode==='subscribe'&&E.WHATSAPP_WEBHOOK_VERIFY_TOKEN&&token===E.WHATSAPP_WEBHOOK_VERIFY_TOKEN)return send(res,200,String(challenge||''),'text/plain; charset=utf-8');
      return send(res,403,'Vérification WhatsApp refusée.','text/plain; charset=utf-8');
    }
    if(url.pathname==='/api/whatsapp/webhook'&&req.method==='POST'){
      const payload=await readBody(req);const signature=String(req.headers['x-hub-signature-256']||'');
      if(!E.WHATSAPP_APP_SECRET||!signature.startsWith('sha256='))throw new HttpError(401,'Signature WhatsApp manquante ou configuration webhook incomplète.');
      const expected='sha256='+crypto.createHmac('sha256',E.WHATSAPP_APP_SECRET).update(req.rawBody||Buffer.alloc(0)).digest('hex');
      const a=Buffer.from(signature),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw new HttpError(401,'Signature WhatsApp invalide.');
      const result=await processWhatsAppWebhook(payload);return send(res,200,JSON.stringify(result),undefined,{'Cache-Control':'no-store'});
    }
    if (!url.pathname.startsWith('/api/')) { if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée'); return serveStatic(req, res, url.pathname); }
    limit('ip:' + ip, 300, 60000);
    const hit = routes.map(r => ({ r, m: url.pathname.match(r.re) })).find(x => x.m && x.r.method === req.method);
    if (!hit) throw new HttpError(404, 'Introuvable.');
    const { r, m } = hit; const mutating = req.method !== 'GET';
    if (mutating) {
      const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Origine refusée.');
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'JSON attendu.');
    }
    const user = sessionUser(req);
    if ((r.auth || r.admin) && !user) throw new HttpError(401, 'Connecte-toi pour continuer.');
    if (r.admin && user.role !== 'admin') throw new HttpError(403, 'Accès réservé à l’équipe.');
    const body = mutating ? await readBody(req) : {};
    const out = await r.fn({ req, res, body, user, ip, params: m.groups || {}, query: url.searchParams });
    if (mutating) publishRealtimeChange();
    send(res, r.status || 200, JSON.stringify(out), undefined, { 'Cache-Control': 'no-store' });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.status || 500, JSON.stringify({ error: e.status ? e.message : 'Erreur serveur. Réessaie dans un instant.' }), undefined, { 'Cache-Control': 'no-store' });
  }
});
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const backupDir=path.join(path.dirname(DB_FILE),'backups');
  const backupNow=()=>{try{fs.mkdirSync(backupDir,{recursive:true});const target=path.join(backupDir,'ge-auto-'+new Date().toISOString().replace(/[:.]/g,'-')+'.db');db.exec(`VACUUM INTO '${target.replace(/'/g,"''")}'`);const uploadDir=path.join(PUBLIC,'uploads');if(fs.existsSync(uploadDir))fs.cpSync(uploadDir,path.join(backupDir,path.basename(target,'.db')+'-uploads'),{recursive:true});const old=fs.readdirSync(backupDir).filter(x=>x.endsWith('.db')).map(x=>({x,t:fs.statSync(path.join(backupDir,x)).mtimeMs})).sort((a,b)=>b.t-a.t);for(const item of old.slice(14)){fs.rmSync(path.join(backupDir,item.x),{force:true});fs.rmSync(path.join(backupDir,item.x.replace(/\.db$/,'-uploads')),{recursive:true,force:true});}console.log('Sauvegarde automatique créée :',target);}catch(err){console.error('Sauvegarde automatique impossible :',err.message);}};
  server.listen(PORT, () => { console.log(`GROUPE EXPRESS ${VERSION} — http://localhost:${PORT}`); backupNow(); });
  const backupTimer=setInterval(backupNow,24*60*60*1000);backupTimer.unref();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearInterval(backupTimer); server.close(); db.close(); process.exit(0); });
}
