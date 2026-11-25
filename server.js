
'use strict';
// StreetSense 4.2 local backend: Node.js HTTP + built-in SQLite (Node 22+).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash
} = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { DatabaseSync } = require('node:sqlite');
const extractImageGps = require('./geotag-exif');
const { calculateSeverity } = require('./severity-scoring');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence');
const MODEL_PATH = process.env.STREETSENSE_MODEL || path.join(ROOT, 'models', 'road_defects.pt');
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(ROOT, '.venv-ai', 'Scripts', 'python.exe')
  : path.join(ROOT, '.venv-ai', 'bin', 'python');
const PYTHON = process.env.PYTHON || (
  fs.existsSync(VENV_PYTHON)
    ? VENV_PYTHON
    : (process.platform === 'win32' ? 'py' : 'python3')
);

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'streetsense.sqlite'));
const { createDuplicateService } = require('./duplicate-service');

const duplicateService = createDuplicateService(db);

db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS work_orders (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL, details TEXT);
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime_type TEXT NOT NULL, stored_name TEXT NOT NULL, lat REAL, lng REAL, review_status TEXT NOT NULL, created_at TEXT NOT NULL);`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','citizen')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS complaints_user_idx ON complaints(user_id);
`);

const seedIncidents = [
  {id:'SS-2048',type:'Pothole',severity:'Critical',location:'Lajpat Nagar II · Central Market Road',lat:28.5677,lng:77.2433,reported:'8 min ago',confidence:96.2,status:'Open',source:'Dashcam upload',description:'Large road-surface depression near a pedestrian crossing. Requires field verification and temporary barricading.',team:'Roads Unit 04',risk:94},
  {id:'SS-2047',type:'Damaged sign',severity:'High',location:'Connaught Place · Block B',lat:28.6315,lng:77.2167,reported:'21 min ago',confidence:91.4,status:'Assigned',source:'Mobile photo',description:'Bent and partially obstructed directional sign. Visibility may be reduced for approaching drivers.',team:'Signage Team 02',risk:82},
  {id:'SS-2046',type:'Broken streetlight',severity:'High',location:'Karol Bagh · Ajmal Khan Road',lat:28.6514,lng:77.1907,reported:'46 min ago',confidence:94.8,status:'In progress',source:'Field report',description:'Streetlight reported non-functional along a busy evening route. Electrical inspection required.',team:'Electrical Unit 01',risk:79},
  {id:'SS-2045',type:'Road crack',severity:'Medium',location:'Saket · Press Enclave Road',lat:28.5245,lng:77.2066,reported:'1 hr ago',confidence:88.7,status:'Open',source:'Dashcam upload',description:'Linear surface cracking visible across part of the carriageway. Monitor for progression.',team:'Unassigned',risk:56},
  {id:'SS-2044',type:'Pothole',severity:'Low',location:'India Gate · C-Hexagon',lat:28.6129,lng:77.2295,reported:'2 hr ago',confidence:86.1,status:'Resolved',source:'Mobile photo',description:'Small surface defect recorded for maintenance history. Repair marked complete in this sample.',team:'Roads Unit 03',risk:28}
];

const seedOrders = [
  {id:'WO-8041',title:'Repair deep road-surface defect',incident:'SS-2048',location:'Lajpat Nagar II',priority:'Critical',status:'New',team:'Unassigned',due:'Today'},
  {id:'WO-8040',title:'Replace damaged direction sign',incident:'SS-2047',location:'Connaught Place',priority:'High',status:'Assigned',team:'Signage Team 02',due:'Today'},
  {id:'WO-8039',title:'Inspect streetlight circuit',incident:'SS-2046',location:'Karol Bagh',priority:'High',status:'In progress',team:'Electrical Unit 01',due:'Nov 04'},
  {id:'WO-8038',title:'Assess road-surface cracking',incident:'SS-2045',location:'Saket',priority:'Medium',status:'New',team:'Unassigned',due:'Nov 05'},
  {id:'WO-8037',title:'Patch minor surface damage',incident:'SS-2044',location:'India Gate',priority:'Low',status:'Resolved',team:'Roads Unit 03',due:'Complete'},
  {id:'WO-8036',title:'Clear blocked drain inlet',incident:'SS-2039',location:'Greater Kailash',priority:'Medium',status:'In progress',team:'Drainage Unit 01',due:'Nov 04'},
  {id:'WO-8035',title:'Review faded lane marking',incident:'SS-2035',location:'Minto Road',priority:'Low',status:'Assigned',team:'Road Marking 03',due:'Nov 06'},
  {id:'WO-8034',title:'Secure loose utility cover',incident:'SS-2032',location:'Defence Colony',priority:'High',status:'Resolved',team:'Roads Unit 02',due:'Complete'}
];

const count = db.prepare('SELECT COUNT(*) AS n FROM incidents').get().n;
const seedOff = db.prepare("SELECT value FROM app_meta WHERE key='seed_disabled'").get();

if (!count && !seedOff) saveSnapshot(seedIncidents, seedOrders, false);

function saveSnapshot(incidents, orders, audit = true) {
  const insertI = db.prepare('INSERT OR REPLACE INTO incidents(id,data,updated_at) VALUES(?,?,?)');
  const insertW = db.prepare('INSERT OR REPLACE INTO work_orders(id,data,updated_at) VALUES(?,?,?)');
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM incidents; DELETE FROM work_orders;');

    for (const x of incidents) insertI.run(x.id, JSON.stringify(x), now);
    for (const x of orders) insertW.run(x.id, JSON.stringify(x), now);

    db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('last_updated',?)").run(now);

    if (audit) {
      db.prepare('INSERT INTO audit_log VALUES(?,?,?,?,?,?)')
        .run(randomUUID(),'snapshot_saved','workspace','all',now,
          JSON.stringify({incidents:incidents.length,workOrders:orders.length}));
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Safe workspace snapshot handling.
db.exec('CREATE TABLE IF NOT EXISTS snapshot_history (version TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)');

function canon(v) {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

function currentSnapshot() {
  return { incidents: readRows('incidents'), workOrders: readRows('work_orders') };
}

function snapshotVersion(s) {
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  return createHash('sha1')
    .update(canon({ i: [...s.incidents].sort(byId), w: [...s.workOrders].sort(byId) }))
    .digest('hex');
}

function rememberSnapshot(s) {
  const v = snapshotVersion(s);
  try {
    db.prepare('INSERT OR IGNORE INTO snapshot_history VALUES(?,?,?)')
      .run(v, JSON.stringify(s), new Date().toISOString());
    db.prepare('DELETE FROM snapshot_history WHERE version NOT IN (SELECT version FROM snapshot_history ORDER BY created_at DESC LIMIT 40)').run();
  } catch (_) {}
  return v;
}

function mergeSnapshots(base, client, server) {
  const out = {};

  for (const key of ['incidents', 'workOrders']) {
    const m = list => new Map(list.map(x => [x.id, x]));
    const b = m(base[key]), c = m(client[key]), s = m(server[key]), res = [];

    for (const id of new Set([...b.keys(), ...c.keys(), ...s.keys()])) {
      const bx = b.get(id), cx = c.get(id), sx = s.get(id);
      const clientChanged = canon(bx) !== canon(cx);
      const serverChanged = canon(bx) !== canon(sx);
      const pick = !clientChanged ? sx : (!serverChanged ? cx : cx);
      if (pick) res.push(pick);
    }

    out[key] = res;
  }

  return out;
}

function readRows(table) {
  return db.prepare(`SELECT data FROM ${table} ORDER BY updated_at DESC, rowid ASC`)
    .all().map(r => JSON.parse(r.data));
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Content-Length':Buffer.byteLength(body),
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  });
  res.end(body);
}

function audit(action, type, id, details = {}) {
  db.prepare('INSERT INTO audit_log VALUES(?,?,?,?,?,?)')
    .run(randomUUID(),action,type,id,new Date().toISOString(),JSON.stringify(details));
}

async function bodyJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12_000_000) throw new Error('Request body exceeds 12 MB');
  }
  return raw ? JSON.parse(raw) : {};
}

function validIncident(x) {
  return x && typeof x === 'object' &&
    typeof x.id === 'string' &&
    /^SS-[A-Za-z0-9-]{2,32}$/.test(x.id) &&
    ['Pothole','Damaged sign','Broken streetlight','Road crack','Blocked drain','Other'].includes(x.type) &&
    ['Critical','High','Medium','Low'].includes(x.severity) &&
    typeof x.location === 'string' && x.location.trim().length > 0 && x.location.length <= 240 &&
    ['Open','Assigned','In progress','Resolved'].includes(x.status) &&
    Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng)) &&
    Number(x.lat) >= -90 && Number(x.lat) <= 90 &&
    Number(x.lng) >= -180 && Number(x.lng) <= 180;
}

function validOrder(x) {
  return x && typeof x === 'object' &&
    typeof x.id === 'string' &&
    /^WO-[A-Za-z0-9-]{2,32}$/.test(x.id) &&
    typeof x.incident === 'string' &&
    typeof x.title === 'string' &&
    ['New','Assigned','In progress','Resolved'].includes(x.status) &&
    ['Critical','High','Medium','Low'].includes(x.priority);
}

// Image upload validation.
function decodeImageUpload(image) {
  if (!image || typeof image !== 'object' || typeof image.base64 !== 'string') {
    throw new Error('Upload a JPG, PNG or WebP photo.');
  }

  const allowed = {
    'image/jpeg': { ext: '.jpg', signature: [0xff,0xd8,0xff] },
    'image/png': { ext: '.png', signature: [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a] },
    'image/webp': { ext: '.webp', signature: [0x52,0x49,0x46,0x46] }
  };

  let mimeType = String(image.mimeType || '').toLowerCase().split(';')[0].trim();
  let base64 = image.base64.trim();

  const dataUrl = base64.match(/^data:(image\/(?:jpeg|png|webp));base64,(.*)$/is);

  if (dataUrl) {
    if (!mimeType) mimeType = dataUrl[1].toLowerCase();
    if (mimeType !== dataUrl[1].toLowerCase()) {
      throw new Error('Photo type does not match its data URL.');
    }
    base64 = dataUrl[2];
  }

  const spec = allowed[mimeType];
  if (!spec) throw new Error('Use a JPG, PNG or WebP photo.');

  base64 = base64.replace(/\s+/g, '');

  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
    throw new Error('The uploaded photo is not valid base64 data.');
  }

  const buffer = Buffer.from(base64, 'base64');

  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    throw new Error('Photo must be 8 MB or smaller.');
  }

  const canonical = buffer.toString('base64').replace(/=+$/, '');

  if (canonical !== base64.replace(/=+$/, '')) {
    throw new Error('The uploaded photo is not valid base64 data.');
  }

  const signatureOk = spec.signature.every((byte, i) => buffer[i] === byte);

  if (!signatureOk || (mimeType === 'image/webp' && buffer.toString('ascii', 8, 12) !== 'WEBP')) {
    throw new Error('The image content does not match its selected file type.');
  }

  return { buffer, mimeType, ext: spec.ext };
}

// Manual GPS takes priority over EXIF GPS.
function resolveImageGps(latValue, lngValue, buffer, mimeType) {
  const hasLat = latValue !== null && latValue !== undefined && latValue !== '';
  const hasLng = lngValue !== null && lngValue !== undefined && lngValue !== '';

  if (hasLat !== hasLng) {
    throw new Error('Enter both latitude and longitude coordinates.');
  }

  if (hasLat && hasLng) {
    const lat = Number(latValue);
    const lng = Number(lngValue);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Enter valid latitude and longitude coordinates.');
    }

    return { lat, lng, source: 'manual' };
  }

  if (!buffer || !mimeType) {
    return { lat: null, lng: null, source: 'unavailable' };
  }

  try {
    const gps = extractImageGps(buffer, mimeType);

    if (gps &&
        Number.isFinite(Number(gps.lat)) &&
        Number.isFinite(Number(gps.lng)) &&
        Number(gps.lat) >= -90 && Number(gps.lat) <= 90 &&
        Number(gps.lng) >= -180 && Number(gps.lng) <= 180) {
      return {
        lat: Number(gps.lat),
        lng: Number(gps.lng),
        source: 'image_exif'
      };
    }
  } catch (error) {
    console.warn('Image GPS extraction failed:', error.message || error);
  }

  return { lat: null, lng: null, source: 'unavailable' };
}

async function runYolo(imagePath) {
  if (!fs.existsSync(MODEL_PATH)) {
    return { status: 'model_not_configured', detections: [] };
  }

  try {
    const script = path.join(ROOT, 'ai', 'infer.py');
    const args = PYTHON === 'py'
      ? ['-3', script, '--weights', MODEL_PATH, '--image', imagePath]
      : [script, '--weights', MODEL_PATH, '--image', imagePath];

    const { stdout } = await execFileAsync(PYTHON, args, {
      cwd: ROOT,
      timeout: 90000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });

    const result = JSON.parse(stdout.trim());

    return result.ok
      ? result
      : {
          status: result.status || 'inference_error',
          message: result.message || 'YOLO inference failed.',
          detections: []
        };
  } catch (error) {
    return {
      status: error.killed ? 'inference_timeout' : 'inference_unavailable',
      message: String(error.message || error).slice(0, 300),
      detections: []
    };
  }
}

function classifyYolo(detections) {
  const d = detections?.[0];
  if (!d) return null;

  const n = String(d.className).toLowerCase().replace(/[_-]+/g, ' ');
  let type = 'Other';

  if (/^d40$/.test(n) || /pothole|hole/.test(n)) type = 'Pothole';
  else if (/^(d00|d01|d10|d11|d20)$/.test(n) || /crack|alligator|rut|surface defect/.test(n)) type = 'Road crack';
  else if (/^(road edge breakage|asphalt ravelling|failed repair patch|surface bleeding)$/.test(n)) type = 'Road crack';
  else if (/sign/.test(n)) type = 'Damaged sign';
  else if (/light|lamp/.test(n)) type = 'Broken streetlight';
  else if (/drain|utility cover/.test(n)) type = 'Blocked drain';

  return { type, confidence: d.confidence, className: d.className };
}

function mime(file) {
  return ({
    '.html':'text/html; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.js':'text/javascript; charset=utf-8',
    '.json':'application/json; charset=utf-8',
    '.svg':'image/svg+xml',
    '.png':'image/png',
    '.jpg':'image/jpeg',
    '.jpeg':'image/jpeg',
    '.ico':'image/x-icon'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// Account security.
const sessions = new Map();
const SESSION_TTL = 12 * 60 * 60 * 1000;
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
const HOST = process.env.HOST || '127.0.0.1';

db.exec('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)');

const tokenHash = token => createHash('sha256').update(String(token)).digest('hex');

function dropSession(token) {
  sessions.delete(token);
  try {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
  } catch (_) {}
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function passwordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const actual = scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

function sessionUser(req) {
  const raw = String(req.headers.cookie || '')
    .split(';')
    .map(x => x.trim())
    .find(x => x.startsWith('ss_session='));

  if (!raw) return null;

  const token = decodeURIComponent(raw.slice('ss_session='.length));
  let session = sessions.get(token);

  if (!session) {
    const r = db.prepare('SELECT user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token_hash=?')
      .get(tokenHash(token));

    if (r) {
      session = { userId: r.userId, expiresAt: r.expiresAt };
      sessions.set(token, session);
    }
  }

  if (!session || session.expiresAt < Date.now()) {
    dropSession(token);
    return null;
  }

  const user = db.prepare('SELECT id,email,display_name AS displayName,role,active,created_at AS createdAt FROM users WHERE id=?')
    .get(session.userId);

  if (!user || !user.active) {
    dropSession(token);
    return null;
  }

  return user;
}

function setSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL;

  sessions.set(token, { userId, expiresAt });

  try {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)')
      .run(tokenHash(token), userId, expiresAt);
  } catch (_) {}

  res.setHeader('Set-Cookie',
    `ss_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL/1000)}${COOKIE_SECURE}`);
}

function clearSession(req, res) {
  const raw = String(req.headers.cookie || '')
    .split(';')
    .map(x => x.trim())
    .find(x => x.startsWith('ss_session='));

  if (raw) dropSession(decodeURIComponent(raw.slice('ss_session='.length)));

  res.setHeader('Set-Cookie',
    'ss_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' + COOKIE_SECURE);
}

function publicUser(user) {
  return {
    id:user.id,
    email:user.email,
    displayName:user.display_name,
    role:user.role,
    active:Boolean(user.active),
    createdAt:user.created_at
  };
}

function validPassword(p) {
  return typeof p === 'string' && p.length >= 10 && p.length <= 128;
}

function safeComplaint(row) {
  return JSON.parse(row.data);
}

const insights = require('./insights')({
  db, json, bodyJson, audit, readRows, EVIDENCE_DIR, randomUUID,
  fs, path,
  spawn: require('node:child_process').spawn,
  PYTHON, MODEL_PATH, ROOT, classifyYolo, sessionUser
});

const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = decodeURIComponent(url.pathname);

  try {
    if (p.startsWith('/api/')) {

      if (req.method === 'GET' && p === '/api/auth/status') {
        const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
        return json(res,200,{setupRequired:count===0});
      }

      if (req.method === 'POST' && p === '/api/auth/setup') {
        if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n !== 0) {
          return json(res,409,{error:'Administrator setup has already been completed.'});
        }

        const data = await bodyJson(req);
        const email = normalizeEmail(data.email);
        const name = String(data.name||'').trim();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            !name || name.length>80 || !validPassword(data.password)) {
          return json(res,400,{error:'Enter a valid name, email and password (at least 10 characters).'});
        }

        const pw = passwordRecord(data.password);
        const id = randomUUID();
        const now = new Date().toISOString();

        db.prepare('INSERT INTO users(id,email,display_name,password_hash,password_salt,role,active,created_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(id,email,name,pw.hash,pw.salt,'admin',1,now);

        setSession(res,id);
        audit('administrator_created','user',id,{email});

        return json(res,201,{
          user:{id,email,displayName:name,role:'admin',active:true,createdAt:now}
        });
      }

      if (req.method === 'POST' && p === '/api/auth/register') {
        if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
          return json(res,403,{error:'Administrator setup must be completed from /admin.html before citizen registration.'});
        }

        const data = await bodyJson(req);
        const email = normalizeEmail(data.email);
        const name = String(data.name||'').trim();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            !name || name.length>80 || !validPassword(data.password)) {
          return json(res,400,{error:'Enter a valid name, email and password (at least 10 characters).'});
        }

        const pw = passwordRecord(data.password);
        const id = randomUUID();
        const now = new Date().toISOString();

        try {
          db.prepare('INSERT INTO users(id,email,display_name,password_hash,password_salt,role,active,created_at) VALUES(?,?,?,?,?,?,?,?)')
            .run(id,email,name,pw.hash,pw.salt,'citizen',1,now);
        } catch (_) {
          return json(res,409,{error:'An account with this email already exists.'});
        }

        setSession(res,id);
        audit('citizen_registered','user',id,{email});

        return json(res,201,{
          user:{id,email,displayName:name,role:'citizen',active:true,createdAt:now}
        });
      }

      if (req.method === 'POST' && p === '/api/auth/login') {
        const data = await bodyJson(req);
        const email = normalizeEmail(data.email);
        const user = db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(email);

        if (!user || !user.active ||
            !verifyPassword(data.password || '',user.password_salt,user.password_hash)) {
          return json(res,401,{error:'Email or password is incorrect.'});
        }

        setSession(res,user.id);
        audit('user_login','user',user.id,{});

        return json(res,200,{
          user:{
            id:user.id,email:user.email,displayName:user.display_name,
            role:user.role,active:true,createdAt:user.created_at
          }
        });
      }

      if (req.method === 'POST' && p === '/api/auth/logout') {
        clearSession(req,res);
        return json(res,200,{ok:true});
      }

      if (req.method === 'GET' && p === '/api/auth/me') {
        const user = sessionUser(req);

        return json(res,200,{
          user:user?{
            id:user.id,email:user.email,displayName:user.displayName,
            role:user.role,active:true,createdAt:user.createdAt
          }:null,
          setupRequired:db.prepare('SELECT COUNT(*) AS n FROM users').get().n===0
        });
      }

      const currentUser = sessionUser(req);

      if (req.method === 'GET' && p === '/api/users') {
        if (!currentUser || currentUser.role !== 'admin') {
          return json(res,403,{error:'Administrator access required.'});
        }

        const users = db.prepare('SELECT id,email,display_name AS displayName,role,active,created_at AS createdAt FROM users ORDER BY created_at DESC').all();

        return json(res,200,{items:users.map(u=>({...u,active:Boolean(u.active)}))});
      }

      if (req.method === 'POST' && p === '/api/users') {
        if (!currentUser || currentUser.role !== 'admin') {
          return json(res,403,{error:'Administrator access required.'});
        }

        const data=await bodyJson(req);
        const email=normalizeEmail(data.email);
        const name=String(data.name||'').trim();
        const role=data.role==='admin'?'admin':'citizen';

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            !name || name.length>80 || !validPassword(data.password)) {
          return json(res,400,{error:'Enter a valid name, email and temporary password (at least 10 characters).'});
        }

        const pw=passwordRecord(data.password);
        const id=randomUUID();
        const now=new Date().toISOString();

        try {
          db.prepare('INSERT INTO users(id,email,display_name,password_hash,password_salt,role,active,created_at) VALUES(?,?,?,?,?,?,?,?)')
            .run(id,email,name,pw.hash,pw.salt,role,1,now);
        } catch (_) {
          return json(res,409,{error:'An account with this email already exists.'});
        }

        audit('account_created','user',id,{email,role,by:currentUser.id});

        return json(res,201,{
          user:{id,email,displayName:name,role,active:true,createdAt:now}
        });
      }

      const userMatch=p.match(/^\/api\/users\/([^/]+)$/);

      if (userMatch && req.method === 'PATCH') {
        if (!currentUser || currentUser.role !== 'admin') {
          return json(res,403,{error:'Administrator access required.'});
        }

        const target=db.prepare('SELECT * FROM users WHERE id=?').get(userMatch[1]);

        if (!target) return json(res,404,{error:'Account not found.'});

        const data=await bodyJson(req);

        if (target.id===currentUser.id && data.active===false) {
          return json(res,400,{error:'You cannot deactivate your own administrator account.'});
        }

        if (data.password !== undefined && !validPassword(data.password)) {
          return json(res,400,{error:'Temporary password must contain at least 10 characters.'});
        }

        if (data.password !== undefined) {
          const pw=passwordRecord(data.password);
          db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?')
            .run(pw.hash,pw.salt,target.id);
        }

        if (data.active !== undefined) {
          db.prepare('UPDATE users SET active=? WHERE id=?').run(data.active?1:0,target.id);
        }

        if (data.role === 'admin' || data.role === 'citizen') {
          db.prepare('UPDATE users SET role=? WHERE id=?').run(data.role,target.id);
        }

        audit('account_updated','user',target.id,{by:currentUser.id});

        const updated=db.prepare('SELECT id,email,display_name AS displayName,role,active,created_at AS createdAt FROM users WHERE id=?').get(target.id);

        return json(res,200,{user:{...updated,active:Boolean(updated.active)}});
      }

      // Delete citizen accounts only when no complaints are associated.
      if (userMatch && req.method === 'DELETE') {
        if (!currentUser || currentUser.role !== 'admin') {
          return json(res,403,{error:'Administrator access required.'});
        }

        const target = db.prepare('SELECT id,email,role FROM users WHERE id=?').get(userMatch[1]);

        if (!target) return json(res,404,{error:'Account not found.'});
        if (target.role !== 'citizen') {
          return json(res,403,{error:'Administrator accounts cannot be deleted here.'});
        }

        const complaintCount = db.prepare('SELECT COUNT(*) AS n FROM complaints WHERE user_id=?').get(target.id).n;

        if (complaintCount > 0) {
          return json(res,409,{
            error:`This account has ${complaintCount} complaint(s). Disable it instead to preserve its reports.`
          });
        }

        db.exec('BEGIN IMMEDIATE');

        try {
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);

          for (const [token, session] of sessions) {
            if (session.userId === target.id) sessions.delete(token);
          }

          db.prepare('DELETE FROM users WHERE id=? AND role=?').run(target.id,'citizen');

          audit('citizen_account_deleted','user',target.id,{
            email:target.email,
            by:currentUser.id
          });

          db.exec('COMMIT');
          return json(res,200,{deleted:target.id});
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }

      // Citizen complaint submission with manual/EXIF GPS support.
      if (req.method === 'POST' && p === '/api/complaints') {
        if (!currentUser) {
          return json(res,401,{error:'Please sign in to submit a complaint.'});
        }

        const data=await bodyJson(req);

        const category=String(data.category||'').trim();
        const location=String(data.location||'').trim();
        const description=String(data.description||'').trim();

        if (!category || category.length>80 ||
            !location || location.length>240 ||
            description.length<10 || description.length>2000) {
          return json(res,400,{error:'Add a category, location and description of at least 10 characters.'});
        }

        let upload = null;

        if (data.image) {
          try {
            upload = decodeImageUpload(data.image);
          } catch (error) {
            return json(res,400,{error:error.message});
          }
        }

        let gps;

        try {
          gps = resolveImageGps(
            data.lat,
            data.lng,
            upload?.buffer || null,
            upload?.mimeType || null
          );
        } catch (error) {
          return json(res,400,{error:error.message});
        }

        const id='SS-'+randomBytes(4).toString('hex').toUpperCase();
        const now=new Date().toISOString();
        let imageName=null;

        if (upload) {
          imageName=randomUUID()+upload.ext;

          try {
            fs.writeFileSync(path.join(EVIDENCE_DIR,imageName),upload.buffer,{flag:'wx'});
          } catch (_) {
            return json(res,500,{error:'Could not save the uploaded photo.'});
          }
        }

        let aiAnalysis = {
          status:'not_run',
          model:null,
          detections:[],
          prediction:null,
          message:imageName ? null : 'No photo was uploaded.'
        };

        if (imageName) {
          const analysis = await runYolo(path.join(EVIDENCE_DIR,imageName));
          const prediction = analysis.status === 'inference_complete'
            ? classifyYolo(analysis.detections)
            : null;

          aiAnalysis = {
            status:analysis.status,
            model:analysis.model||null,
            detections:analysis.detections||[],
            prediction,
            message:analysis.message||null,
            scene:analysis.scene||null
          };

          if (prediction) {
            audit('yolo_inference_completed','complaint',id,{
              className:prediction.className,
              confidence:prediction.confidence
            });
          }
        }

        const complaint = {
          id,
          category,
          location,
          lat:gps.lat,
          lng:gps.lng,
          gps:{
            available:gps.lat!==null,
            source:gps.source
          },
          description,
          status:'Submitted',
          priority:'Awaiting review',
          image:imageName?`/api/complaint-image/${imageName}`:null,
          reporter:{
            id:currentUser.id,
            email:currentUser.email,
            name:currentUser.displayName
          },
          createdAt:now,
          updatedAt:now,
          adminNote:'',
          aiAnalysis
        };

               // Calculate severity recommendation
        const severity = calculateSeverity(complaint);

        try {
          db.exec('BEGIN IMMEDIATE');

          // Save complaint
          db.prepare(
            'INSERT INTO complaints(id,user_id,data,created_at,updated_at) VALUES(?,?,?,?,?)'
          ).run(
            id,
            currentUser.id,
            JSON.stringify(complaint),
            now,
            now
          );

          // Save severity recommendation
          db.prepare(`
            INSERT INTO complaint_severity
            (id,complaint_id,score,recommendation,explanation,reviewed_by)
            VALUES(?,?,?,?,?,?)
          `).run(
            randomBytes(16).toString('hex'),
            id,
            severity.score,
            severity.recommendation,
            JSON.stringify(severity.explanation),
            null
          );

          db.exec('COMMIT');

        } catch (error) {
          try {
            db.exec('ROLLBACK');
          } catch (_) {}

          if (imageName) {
            try {
              fs.rmSync(path.join(EVIDENCE_DIR,imageName),{force:true});
            } catch (_) {}
          }

          throw error;
        }

        audit('citizen_complaint_submitted','complaint',id,{
          category,
          userId:currentUser.id,
          gpsSource:gps.source,
          hasGps:gps.lat!==null
        });
// Check for nearby complaints in the same category.
let potentialDuplicates = [];

try {
  potentialDuplicates = duplicateService.checkComplaint(complaint);
  console.log(
    `[Duplicate Detection] ${id}: ${potentialDuplicates.length} potential match(es)`
  );
} catch (error) {
  console.error('[Duplicate Detection] Check failed:', error);
}

        insights.autoApproveComplaint(id);

        const fresh=db.prepare('SELECT data,user_id FROM complaints WHERE id=?').get(id);

        return json(res,201,{
          item:fresh?JSON.parse(fresh.data):complaint
        });
      }
// Get repair progress timeline for a complaint.
const timelineMatch = p.match(/^\/api\/complaints\/([^/]+)\/updates$/);

if (req.method === 'GET' && timelineMatch) {
  if (!currentUser) {
    return json(res,401,{error:'Please sign in.'});
  }

  let complaintId;

  try {
    complaintId = decodeURIComponent(timelineMatch[1]);
  } catch (_) {
    return json(res,400,{error:'Invalid complaint ID.'});
  }

  // Verify complaint exists and belongs to the requesting citizen.
  const complaintRow = currentUser.role === 'admin'
    ? db.prepare('SELECT id FROM complaints WHERE id=?').get(complaintId)
    : db.prepare('SELECT id FROM complaints WHERE id=? AND user_id=?')
        .get(complaintId,currentUser.id);

  if (!complaintRow) {
    return json(res,404,{error:'Complaint not found.'});
  }

  // Retrieve chronological repair history.
  const updates = db.prepare(`
    SELECT status,note,created_at
    FROM repair_updates
    WHERE complaint_id=?
    ORDER BY created_at ASC
  `).all(complaintId);

  return json(res,200,{
    complaintId,
    updates:updates.map(update => ({
      status:update.status,
      note:update.note,
      createdAt:update.created_at
    }))
  });
}
// Get notifications for the signed-in user.
if (req.method === 'GET' && p === '/api/notifications') {
  if (!currentUser) {
    return json(res, 401, { error: 'Please sign in.' });
  }

  const notifications = db.prepare(`
    SELECT id, title, message, notification_type,
           related_complaint_id, is_read, created_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(currentUser.id);

  const unreadCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM notifications
    WHERE user_id = ? AND is_read = 0
  `).get(currentUser.id).count;

  return json(res, 200, {
    notifications: notifications.map(item => ({
      id: item.id,
      title: item.title,
      message: item.message,
      type: item.notification_type,
      complaintId: item.related_complaint_id,
      isRead: Boolean(item.is_read),
      createdAt: item.created_at
    })),
    unreadCount
  });
}

// Mark one notification as read.
const notificationReadMatch =
  p.match(/^\/api\/notifications\/([^/]+)\/read$/);

if (req.method === 'PATCH' && notificationReadMatch) {
  if (!currentUser) {
    return json(res, 401, { error: 'Please sign in.' });
  }

  let notificationId;

  try {
    notificationId = decodeURIComponent(notificationReadMatch[1]);
  } catch (_) {
    return json(res, 400, { error: 'Invalid notification ID.' });
  }

  const result = db.prepare(`
    UPDATE notifications
    SET is_read = 1
    WHERE id = ? AND user_id = ?
  `).run(notificationId, currentUser.id);

  if (result.changes === 0) {
    return json(res, 404, { error: 'Notification not found.' });
  }

  return json(res, 200, { success: true });
}

// Mark all notifications as read for the signed-in user.
if (req.method === 'PATCH' && p === '/api/notifications/read-all') {
  if (!currentUser) {
    return json(res, 401, { error: 'Please sign in.' });
  }

  const result = db.prepare(`
    UPDATE notifications
    SET is_read = 1
    WHERE user_id = ? AND is_read = 0
  `).run(currentUser.id);

  return json(res, 200, {
    success: true,
    updated: result.changes
  });
}
      if (req.method === 'GET' && p === '/api/complaints') {
        if (!currentUser) return json(res,401,{error:'Please sign in.'});

        insights.syncComplaints();

        const rows=currentUser.role==='admin'
          ? db.prepare('SELECT data FROM complaints ORDER BY created_at DESC').all()
          : db.prepare('SELECT data FROM complaints WHERE user_id=? ORDER BY created_at DESC').all(currentUser.id);

        return json(res,200,{items:rows.map(safeComplaint)});
      }

      if (req.method === 'GET' && p === '/api/admin/complaints') {
        if (!currentUser || currentUser.role!=='admin') {
          return json(res,403,{error:'Administrator access required.'});
        }

        insights.syncComplaints();

        return json(res,200,{
          items:db.prepare('SELECT data FROM complaints ORDER BY created_at DESC').all().map(safeComplaint)
        });
      }

      const complaintMatch=p.match(/^\/api\/admin\/complaints\/([^/]+)$/);

      if (complaintMatch && req.method==='PATCH') {
        if (!currentUser || currentUser.role!=='admin') {
          return json(res,403,{error:'Administrator access required.'});
        }

        const row=db.prepare('SELECT data,user_id FROM complaints WHERE id=?').get(complaintMatch[1]);

        if (!row) return json(res,404,{error:'Complaint not found.'});

        const item=JSON.parse(row.data);
        const data=await bodyJson(req);
        const statuses=['Submitted','Under review','Assigned','In progress','Resolved','Rejected'];

        if (data.status && !statuses.includes(data.status)) {
          return json(res,400,{error:'Invalid complaint status.'});
        }

        const previousStatus = item.status;

        if (data.status) {
          item.status=data.status;
          insights.onComplaintStatus(item,data.status);
        }

        if (data.adminNote !== undefined) {
          item.adminNote=String(data.adminNote).slice(0,1000);
        }

        item.updatedAt=new Date().toISOString();

        db.prepare('UPDATE complaints SET data=?,updated_at=? WHERE id=?')
          .run(JSON.stringify(item),item.updatedAt,item.id);
          // Record complaint status history
if (data.status && data.status !== previousStatus) {
  db.prepare(`
    INSERT INTO repair_updates
    (id, complaint_id, work_order_id, status, note, updated_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomBytes(16).toString('hex'),
    item.id,
    null,
    data.status,
    String(data.adminNote || '').slice(0, 1000),
    currentUser.id,
    item.updatedAt
  );
}


// Notify the citizen when their complaint status changes.
if (data.status && data.status !== previousStatus) {
  const owner = db.prepare(
    'SELECT user_id FROM complaints WHERE id=?'
  ).get(item.id);

  if (!owner || !owner.user_id) {
    throw new Error(
      `Cannot create notification: complaint owner not found for ${item.id}`
    );
  }

  db.prepare(`
    INSERT INTO notifications
    (id, user_id, title, message, notification_type,
     related_complaint_id, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomBytes(16).toString('hex'),
    owner.user_id,
    'Complaint status updated',
    `Your complaint ${item.id} has changed from ${previousStatus || 'Unknown'} to ${data.status}.`,
    'status_update',
    item.id,
    0,
    item.updatedAt
  );
}



        audit('complaint_updated','complaint',item.id,{
          status:item.status,
          by:currentUser.id
        });

        return json(res,200,{item});
      }
      // Admin: list potential duplicate complaints
      if (req.method === 'GET' && p === '/api/admin/duplicates') {
        if (!currentUser || currentUser.role !== 'admin') {
          return json(res,403,{error:'Administrator access required.'});
        }

        const rows = db.prepare(`
          SELECT
            d.id,
            d.complaint_id,
            d.possible_duplicate_id,
            d.similarity_score,
            d.review_status,
            d.created_at,
            c.data AS complaint_data,
            pc.data AS possible_duplicate_data
          FROM complaint_duplicates d
          LEFT JOIN complaints c ON c.id = d.complaint_id
          LEFT JOIN complaints pc ON pc.id = d.possible_duplicate_id
          WHERE d.review_status = 'pending'
          ORDER BY d.created_at DESC
          LIMIT 200
        `).all();

        return json(res,200,{
          items:rows.map(row => ({
            id:row.id,
            complaintId:row.complaint_id,
            possibleDuplicateId:row.possible_duplicate_id,
            similarityScore:row.similarity_score,
            reviewStatus:row.review_status,
            createdAt:row.created_at,
            complaint:row.complaint_data
              ? safeComplaint({data:row.complaint_data})
              : null,
            possibleDuplicate:row.possible_duplicate_data
              ? safeComplaint({data:row.possible_duplicate_data})
              : null
          }))
        });
      }

      // Admin: confirm or reject a duplicate match
      const duplicateMatch = p.match(/^\/api\/admin\/duplicates\/([^/]+)$/);

      if (duplicateMatch && req.method === 'PATCH') {
        if (!currentUser || currentUser.role !== 'admin') {
          return json(res,403,{error:'Administrator access required.'});
        }

        const data = await bodyJson(req);
        const reviewStatus = data.reviewStatus;

        if (!['confirmed','rejected'].includes(reviewStatus)) {
          return json(res,400,{
            error:'Review status must be confirmed or rejected.'
          });
        }

        const result = db.prepare(`
          UPDATE complaint_duplicates
          SET review_status = ?
          WHERE id = ? AND review_status = 'pending'
        `).run(reviewStatus,duplicateMatch[1]);

        if (!result.changes) {
          return json(res,404,{
            error:'Pending duplicate record not found.'
          });
        }

        audit('duplicate_reviewed','complaint_duplicate',duplicateMatch[1],{
          reviewStatus,
          by:currentUser.id
        });

        return json(res,200,{
          success:true,
          id:duplicateMatch[1],
          reviewStatus
        });
      }
      const delMatch=p.match(/^\/api\/complaints\/([^/]+)$/);

      if (delMatch && req.method==='DELETE') {
        if (!currentUser) return json(res,401,{error:'Sign in required.'});

        const row=db.prepare('SELECT user_id,data FROM complaints WHERE id=?').get(delMatch[1]);

        if (!row) return json(res,404,{error:'Report not found.'});

        const isAdmin=currentUser.role==='admin';
        const item=JSON.parse(row.data);

        if (!isAdmin && row.user_id!==currentUser.id) {
          return json(res,404,{error:'Report not found.'});
        }

        if (!isAdmin && !['Submitted','Under review','Rejected'].includes(item.status)) {
          return json(res,409,{error:'This report is already being handled. Ask an administrator to remove it.'});
        }

        const img=path.basename(String(item.imagePath||item.image||''));

        if (img && /^[a-f0-9-]+\.(jpg|png|webp)$/i.test(img)) {
          try {
            fs.rmSync(path.join(EVIDENCE_DIR,img),{force:true});
          } catch (_) {}
        }

        db.prepare('DELETE FROM complaints WHERE id=?').run(item.id);
        audit('complaint_deleted','complaint',item.id,{by:currentUser.id,admin:isAdmin});

        return json(res,200,{deleted:item.id});
      }

      const imageMatch=p.match(/^\/api\/complaint-image\/([a-f0-9-]+\.(?:jpg|png|webp))$/i);

      if (imageMatch && req.method==='GET') {
        if (!currentUser) return json(res,401,{error:'Sign in required.'});

        const imagePath=path.join(EVIDENCE_DIR,path.basename(imageMatch[1]));
        const row=db.prepare('SELECT user_id,data FROM complaints WHERE data LIKE ?').get(`%${imageMatch[1]}%`);

        if (!row ||
            (currentUser.role!=='admin' && row.user_id!==currentUser.id) ||
            !fs.existsSync(imagePath)) {
          return json(res,404,{error:'Image not found.'});
        }

        const ext=path.extname(imagePath);
        const type=({'.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'})[ext];

        res.writeHead(200,{
          'Content-Type':type,
          'Cache-Control':'private, max-age=300',
          'X-Content-Type-Options':'nosniff'
        });

        return fs.createReadStream(imagePath).pipe(res);
      }

      // Citizens: view verification records for their own complaint.
      const citizenVerificationMatch =
        p.match(/^\/api\/complaints\/([^/]+)\/verifications$/);

      if (citizenVerificationMatch && req.method === 'GET') {
        if (!currentUser) {
          return json(res,401,{error:'Sign in required.'});
        }

        const complaintId = decodeURIComponent(
          citizenVerificationMatch[1]
        );

        const complaint = db.prepare(
          'SELECT id,user_id FROM complaints WHERE id=?'
        ).get(complaintId);

        if (!complaint ||
            (currentUser.role !== 'admin' &&
             complaint.user_id !== currentUser.id)) {
          return json(res,404,{error:'Complaint not found.'});
        }

        const orders = readRows('work_orders')
          .filter(order => order.incident === complaintId);

        const items = [];

        for (const order of orders) {
          const records = db.prepare(`
            SELECT id,work_order_id AS workOrderId,
                   kind,note,status,created_at AS createdAt,
                   reviewed_at AS reviewedAt,
                   review_note AS reviewNote
            FROM verifications
            WHERE work_order_id=?
            ORDER BY created_at ASC
          `).all(order.id);

          for (const record of records) {
            items.push({
              ...record,
              imageUrl:
                `/api/verifications/${encodeURIComponent(record.id)}/image`
            });
          }
        }

        return json(res,200,{items});
      }

      // Secure verification image access for admins and complaint owners.
      const secureVerificationImageMatch =
        p.match(/^\/api\/verifications\/([^/]+)\/image$/);

      if (secureVerificationImageMatch && req.method === 'GET') {
        if (!currentUser) {
          return json(res,401,{error:'Sign in required.'});
        }

        const verificationId = decodeURIComponent(
          secureVerificationImageMatch[1]
        );

        const row = db.prepare(`
          SELECT v.stored_name,w.data AS work_order_data
          FROM verifications v
          JOIN work_orders w ON w.id=v.work_order_id
          WHERE v.id=?
        `).get(verificationId);

        if (!row) {
          return json(res,404,{error:'Verification photo not found.'});
        }

        let order;

        try {
          order = JSON.parse(row.work_order_data);
        } catch (_) {
          return json(res,404,{error:'Work order not found.'});
        }

        if (currentUser.role !== 'admin') {
          const complaint = db.prepare(
            'SELECT user_id FROM complaints WHERE id=?'
          ).get(order.incident);

          if (!complaint || complaint.user_id !== currentUser.id) {
            return json(res,404,{error:'Verification photo not found.'});
          }
        }

        const storedName = path.basename(row.stored_name);

        if (!/^[a-f0-9-]+\.(jpg|png|webp)$/i.test(storedName)) {
          return json(res,404,{error:'Invalid verification image.'});
        }

        const imagePath = path.join(EVIDENCE_DIR,storedName);

        if (!fs.existsSync(imagePath)) {
          return json(res,404,{error:'Verification image not found.'});
        }

        const ext = path.extname(imagePath).toLowerCase();
        const type = ({
          '.jpg':'image/jpeg',
          '.png':'image/png',
          '.webp':'image/webp'
        })[ext];

        res.writeHead(200,{
          'Content-Type':type,
          'Cache-Control':'private, no-store',
          'X-Content-Type-Options':'nosniff'
        });

        return fs.createReadStream(imagePath).pipe(res);
      }

      if (await insights.pub(req,res,p,url)) return;

      if (p !== '/api/health' && p.startsWith('/api/')) {
        if (!currentUser) return json(res,401,{error:'Sign in required.'});
        if (currentUser.role !== 'admin') {
          return json(res,403,{error:'Administrator access required.'});
        }
      }

      if (await insights.admin(req,res,p,url)) return;

      if (req.method === 'GET' && p === '/api/health') {
        return json(res,200,{
          ok:true,
          build:'20',
          service:'StreetSense API',
          database:'SQLite',
          mode:'local-city operations',
          evidenceStorage:true,
          aiModel:fs.existsSync(MODEL_PATH)?'yolo-weights-present':'not-configured',
          time:new Date().toISOString()
        });
      }

      if (req.method === 'GET' && p === '/api/snapshot') {
        const snap=currentSnapshot();

        return json(res,200,{
          version:rememberSnapshot(snap),
          incidents:snap.incidents,
          workOrders:snap.workOrders,
          lastUpdated:db.prepare("SELECT value FROM app_meta WHERE key='last_updated'").get()?.value || null
        });
      }

      if (req.method === 'PUT' && p === '/api/snapshot') {
        const data=await bodyJson(req);
        const incidents=data.incidents;
        const orders=data.workOrders;

        if (!Array.isArray(incidents) || !Array.isArray(orders) ||
            incidents.length>5000 || orders.length>5000 ||
            !incidents.every(validIncident) || !orders.every(validOrder)) {
          return json(res,400,{error:'Invalid workspace data. Check incident and work-order fields.'});
        }

        const cur=currentSnapshot();
        const curVersion=snapshotVersion(cur);
        const baseVersion=typeof data.baseVersion==='string'?data.baseVersion:null;

        if (!baseVersion || baseVersion===curVersion) {
          saveSnapshot(incidents,orders,true);
          const v=rememberSnapshot(currentSnapshot());

          return json(res,200,{
            ok:true,
            version:v,
            merged:false,
            savedAt:new Date().toISOString(),
            incidents:incidents.length,
            workOrders:orders.length
          });
        }

        const baseRow=db.prepare('SELECT data FROM snapshot_history WHERE version=?').get(baseVersion);

        if (!baseRow) {
          return json(res,200,{
            ok:false,
            conflict:true,
            version:rememberSnapshot(cur),
            incidents:cur.incidents,
            workOrders:cur.workOrders
          });
        }

        const merged=mergeSnapshots(JSON.parse(baseRow.data),{incidents,workOrders:orders},cur);

        saveSnapshot(merged.incidents,merged.workOrders,true);

        db.prepare('INSERT INTO audit_log VALUES(?,?,?,?,?,?)')
          .run(randomUUID(),'snapshot_merged','workspace','all',new Date().toISOString(),
            JSON.stringify({incidents:merged.incidents.length,workOrders:merged.workOrders.length}));

        return json(res,200,{
          ok:true,
          merged:true,
          version:rememberSnapshot(currentSnapshot()),
          incidents:merged.incidents,
          workOrders:merged.workOrders
        });
      }

      // Evidence uploads now support EXIF geotagging too.
      if (req.method === 'POST' && p === '/api/evidence') {
        const data = await bodyJson(req);

        if (!data || typeof data.filename !== 'string' ||
            data.filename.length > 180 || typeof data.base64 !== 'string') {
          return json(res,400,{error:'Upload a JPG, PNG, or WebP image.'});
        }

        let upload;

        try {
          upload = decodeImageUpload({
            base64:data.base64,
            mimeType:data.mimeType
          });
        } catch (error) {
          return json(res,400,{error:error.message});
        }

        let gps;

        try {
          gps = resolveImageGps(data.lat,data.lng,upload.buffer,upload.mimeType);
        } catch (error) {
          return json(res,400,{error:error.message});
        }

        const id = randomUUID();
        const storedName = `${id}${upload.ext}`;

        try {
          fs.writeFileSync(path.join(EVIDENCE_DIR,storedName),upload.buffer,{flag:'wx'});
        } catch (_) {
          return json(res,500,{error:'Could not save the evidence image.'});
        }

        const now = new Date().toISOString();

        try {
          db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?)')
            .run(
              id,
              path.basename(data.filename),
              upload.mimeType,
              storedName,
              gps.lat,
              gps.lng,
              'pending_human_review',
              now
            );
        } catch (error) {
          try {
            fs.rmSync(path.join(EVIDENCE_DIR,storedName),{force:true});
          } catch (_) {}
          throw error;
        }

        audit('evidence_uploaded','evidence',id,{
          filename:path.basename(data.filename),
          hasGps:gps.lat!==null,
          gpsSource:gps.source
        });

        const analysis = await runYolo(path.join(EVIDENCE_DIR,storedName));
        const prediction = analysis.status === 'inference_complete'
          ? classifyYolo(analysis.detections)
          : null;

        if (prediction) {
          audit('yolo_inference_completed','evidence',id,{
            type:prediction.type,
            confidence:prediction.confidence
          });
        }

        return json(res,201,{
          id,
          filename:path.basename(data.filename),
          lat:gps.lat,
          lng:gps.lng,
          gps:{
            available:gps.lat!==null,
            source:gps.source
          },
          reviewStatus:'pending_human_review',
          createdAt:now,
          modelStatus:analysis.status,
          analysis:{
            status:analysis.status,
            model:analysis.model||null,
            detections:analysis.detections||[],
            prediction,
            message:analysis.message||null
          }
        });
      }

      if (req.method === 'GET' && p === '/api/evidence') {
        return json(res,200,{
          items:db.prepare('SELECT id,filename,mime_type AS mimeType,lat,lng,review_status AS reviewStatus,created_at AS createdAt FROM evidence ORDER BY created_at DESC LIMIT 100').all()
        });
      }

      if (req.method === 'GET' && p === '/api/incidents') {
        return json(res,200,{items:readRows('incidents')});
      }

      if (req.method === 'POST' && p === '/api/incidents') {
        const x=await bodyJson(req);

        if (!validIncident(x)) {
          return json(res,400,{error:'Invalid incident payload'});
        }

        const now=new Date().toISOString();

        db.prepare('INSERT INTO incidents VALUES(?,?,?)')
          .run(x.id,JSON.stringify(x),now);

        audit('incident_created','incident',x.id,{source:x.source});

        return json(res,201,{item:x});
      }

      const incidentMatch=p.match(/^\/api\/incidents\/([^/]+)$/);

      if (incidentMatch && req.method === 'PATCH') {
        const id=incidentMatch[1];
        const old=db.prepare('SELECT data FROM incidents WHERE id=?').get(id);

        if (!old) return json(res,404,{error:'Incident not found'});

        const next={...JSON.parse(old.data),...(await bodyJson(req))};

        if (!validIncident(next)) {
          return json(res,400,{error:'Invalid incident update'});
        }

        db.prepare('UPDATE incidents SET data=?,updated_at=? WHERE id=?')
          .run(JSON.stringify(next),new Date().toISOString(),id);

        audit('incident_updated','incident',id);

        return json(res,200,{item:next});
      }

      if (req.method === 'GET' && p === '/api/work-orders') {
        return json(res,200,{items:readRows('work_orders')});
      }

      if (req.method === 'POST' && p === '/api/work-orders') {
        const x=await bodyJson(req);

        if (!validOrder(x)) {
          return json(res,400,{error:'Invalid work-order payload'});
        }

        const now=new Date().toISOString();

        db.prepare('INSERT INTO work_orders VALUES(?,?,?)')
          .run(x.id,JSON.stringify(x),now);

        audit('work_order_created','work_order',x.id,{incident:x.incident});

        return json(res,201,{item:x});
      }

      const orderMatch=p.match(/^\/api\/work-orders\/([^/]+)$/);

      if (orderMatch && req.method === 'PATCH') {
        const id=orderMatch[1];
        const old=db.prepare('SELECT data FROM work_orders WHERE id=?').get(id);

        if (!old) return json(res,404,{error:'Work order not found'});

        const next={...JSON.parse(old.data),...(await bodyJson(req))};

        if (!validOrder(next)) {
          return json(res,400,{error:'Invalid work-order update'});
        }

        db.prepare('UPDATE work_orders SET data=?,updated_at=? WHERE id=?')
          .run(JSON.stringify(next),new Date().toISOString(),id);
        audit('work_order_updated','work_order',id,{status:next.status});

        return json(res,200,{item:next});
      }
        
      // Before/after repair verification photo upload.
      if (req.method === 'POST' && p === '/api/verifications') {
        if (!currentUser || currentUser.role !== 'admin') {
          return json(res,403,{error:'Administrator access required.'});
        }

        const data = await bodyJson(req);

        if (
          typeof data.workOrderId !== 'string' ||
          !['before_repair','after_repair'].includes(data.kind) ||
          typeof data.filename !== 'string' ||
          data.filename.length > 180 ||
          typeof data.base64 !== 'string'
        ) {
          return json(res,400,{error:'Invalid verification upload details.'});
        }

        const workOrderRow = db.prepare(
          'SELECT id,data FROM work_orders WHERE id=?'
        ).get(data.workOrderId);

        if (!workOrderRow) {
          return json(res,404,{error:'Work order not found.'});
        }

        const workOrder = JSON.parse(workOrderRow.data);

        const complaint = db.prepare(
          'SELECT id FROM complaints WHERE id=?'
        ).get(workOrder.incident);

        if (!complaint) {
          return json(res,404,{error:'Linked citizen complaint not found.'});
        }

        let upload;

        try {
          upload = decodeImageUpload({
            base64:data.base64,
            mimeType:data.mimeType
          });
        } catch (error) {
          return json(res,400,{error:error.message});
        }

        const id = randomUUID();
        const storedName = `${id}${upload.ext}`;
        const imagePath = path.join(EVIDENCE_DIR,storedName);

        try {
          fs.writeFileSync(imagePath,upload.buffer,{flag:'wx'});
        } catch (_) {
          return json(res,500,{error:'Could not save verification photo.'});
        }

        const now = new Date().toISOString();
        const note = typeof data.note === 'string'
          ? data.note.trim().slice(0,1000)
          : '';

        try {
          db.prepare(`
            INSERT INTO verifications
            (id,work_order_id,kind,stored_name,note,created_at)
            VALUES(?,?,?,?,?,?)
          `).run(
            id,
            workOrder.id,
            data.kind,
            storedName,
            note,
            now
          );
        } catch (error) {
          try {
            fs.rmSync(imagePath,{force:true});
          } catch (_) {}
          throw error;
        }

        audit('repair_verification_uploaded','verification',id,{
          workOrderId:workOrder.id,
          incident:workOrder.incident,
          kind:data.kind,
          by:currentUser.id
        });

        return json(res,201,{
          item:{
            id,
            workOrderId:workOrder.id,
            kind:data.kind,
            note,
            status:'Pending',
            createdAt:now
          }
        });
      }

      // Admin: list repair verification submissions.
      if (req.method === 'GET' && p === '/api/verifications') {
        const items = db.prepare(`
          SELECT
            v.id,
            v.work_order_id AS workOrderId,
            v.kind,
            v.stored_name AS storedName,
            v.note,
            v.status,
            v.created_at AS createdAt,
            v.reviewed_by AS reviewedBy,
            v.reviewed_at AS reviewedAt,
            v.review_note AS reviewNote,
            w.data AS workOrderData
          FROM verifications v
          LEFT JOIN work_orders w ON w.id = v.work_order_id
          ORDER BY v.created_at DESC
        `).all().map(item => {
          let workOrder = null;
          try {
            workOrder = item.workOrderData
              ? JSON.parse(item.workOrderData)
              : null;
          } catch (_) {}

          delete item.workOrderData;

          return {
            ...item,
            workOrder,
            imageUrl: `/api/verifications/${encodeURIComponent(item.id)}/image`
          };
        });

        return json(res,200,{items});
      }

      // Admin: approve or reject a verification submission.
      const verificationReviewMatch =
        p.match(/^\/api\/verifications\/([^/]+)\/review$/);

      if (verificationReviewMatch && req.method === 'PATCH') {
        const id = decodeURIComponent(verificationReviewMatch[1]);
        const data = await bodyJson(req);

        if (!['Approved','Rejected'].includes(data.status)) {
          return json(res,400,{error:'Status must be Approved or Rejected.'});
        }

        const reviewNote = typeof data.reviewNote === 'string'
          ? data.reviewNote.trim().slice(0,1000)
          : '';

        if (data.status === 'Rejected' && !reviewNote) {
          return json(res,400,{error:'Provide a reason for rejection.'});
        }

        const existing = db.prepare(
          'SELECT id FROM verifications WHERE id=?'
        ).get(id);

        if (!existing) {
          return json(res,404,{error:'Verification submission not found.'});
        }

        const reviewedAt = new Date().toISOString();

        db.prepare(`
          UPDATE verifications
          SET status=?,
              reviewed_by=?,
              reviewed_at=?,
              review_note=?
          WHERE id=?
        `).run(
          data.status,
          currentUser.id,
          reviewedAt,
          reviewNote,
          id
        );

        audit('repair_verification_reviewed','verification',id,{
          status:data.status,
          by:currentUser.id
        });

        return json(res,200,{
          id,
          status:data.status,
          reviewedAt,
          reviewNote
        });
      }

      // Serve repair verification photos to administrators.
      const verificationImageMatch =
        p.match(/^\/api\/verifications\/([^/]+)\/image$/);

      if (verificationImageMatch && req.method === 'GET') {
        if (!currentUser || currentUser.role !== 'admin') {
          return json(res,403,{error:'Administrator access required.'});
        }

        const id = decodeURIComponent(verificationImageMatch[1]);

        const row = db.prepare(
          'SELECT stored_name FROM verifications WHERE id=?'
        ).get(id);

        if (!row) {
          return json(res,404,{error:'Verification photo not found.'});
        }

        const storedName = path.basename(row.stored_name);

        if (!/^[a-f0-9-]+\.(jpg|png|webp)$/i.test(storedName)) {
          return json(res,404,{error:'Invalid verification image.'});
        }

        const imagePath = path.join(EVIDENCE_DIR,storedName);

        if (!fs.existsSync(imagePath)) {
          return json(res,404,{error:'Verification image file not found.'});
        }

        const ext = path.extname(imagePath).toLowerCase();
        const type = ({
          '.jpg':'image/jpeg',
          '.png':'image/png',
          '.webp':'image/webp'
        })[ext];

        res.writeHead(200,{
          'Content-Type':type,
          'Cache-Control':'private, no-store',
          'X-Content-Type-Options':'nosniff'
        });

        return fs.createReadStream(imagePath).pipe(res);
      }




      if (req.method === 'GET' && p === '/api/analytics') {
        const items=readRows('incidents');
        const counts={};

        for (const x of items) {
          counts[x.type]=(counts[x.type]||0)+1;
        }

        return json(res,200,{
          total:items.length,
          open:items.filter(x=>x.status!=='Resolved').length,
          critical:items.filter(x=>x.severity==='Critical'&&x.status!=='Resolved').length,
          resolved:items.filter(x=>x.status==='Resolved').length,
          byType:counts
        });
      }

      if (req.method === 'GET' && p === '/api/audit') {
        return json(res,200,{
          items:db.prepare('SELECT action,entity_type AS entityType,entity_id AS entityId,created_at AS createdAt,details FROM audit_log ORDER BY created_at DESC LIMIT 100')
            .all()
            .map(x=>({...x,details:x.details?JSON.parse(x.details):{}}))
        });
      }

      return json(res,404,{error:'API route not found'});
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end('Method Not Allowed');
    }

    if (p === '/about.html') {
      res.writeHead(301,{Location:'/introduction.html'});
      return res.end();
    }

    const target = p === '/' ? '/index.html' : p;
    const file = path.resolve(ROOT,`.${target}`);

    const relParts = path.relative(ROOT,file).split(path.sep);
    const hiddenDirs = new Set([
      'deploy','data','ai','models','backups','dataset',
      '.venv-ai','node_modules','powershell','.git'
    ]);
    const hiddenFiles = new Set([
      'server.js','insights.js','patch-admin-ai.js',
      'contribute.html','contribute.js','about.js'
    ]);
    const publicExt = new Set([
      '.html','.css','.js','.svg','.png','.jpg','.jpeg',
      '.gif','.webp','.ico','.woff','.woff2'
    ]);

    let realParts = relParts;

    try {
      if (fs.existsSync(file)) {
        realParts = path.relative(
          fs.realpathSync.native(ROOT),
          fs.realpathSync.native(file)
        ).split(path.sep);
      }
    } catch (_) {}

    const hiddenNow = [relParts[0],realParts[0]].some(n =>
      hiddenDirs.has(String(n).toLowerCase()) ||
      hiddenFiles.has(String(n).toLowerCase())
    );

    const outside = realParts[0] === '..' ||
      path.isAbsolute(realParts[0] || '');

    const realExt = path.extname(
      realParts[realParts.length - 1] || ''
    ).toLowerCase();

    if (!file.startsWith(ROOT + path.sep) ||
        hiddenNow ||
        outside ||
        !publicExt.has(path.extname(file).toLowerCase()) ||
        !publicExt.has(realExt) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end('Not Found');
    }

    res.writeHead(200,{
      'Content-Type':mime(file),
      'Cache-Control':['.html','.js','.css','.svg'].includes(path.extname(file))
        ? 'no-cache'
        : 'public, max-age=3600'
    });

    if (req.method==='HEAD') return res.end();

    fs.createReadStream(file).pipe(res);

  } catch (err) {
    console.error(err);
    json(res,400,{
      error:err instanceof SyntaxError
        ? 'Malformed JSON'
        : err.message||'Request failed'
    });
  }
});

const PORT=Number(process.env.PORT)||8000;

server.listen(PORT,HOST,()=>console.log(
  `StreetSense 4.2 running at http://${HOST}:${PORT}\nSQLite database: ${path.join(DATA_DIR,'streetsense.sqlite')}`
));

process.on('SIGINT',()=>{
  db.close();
  server.close(()=>process.exit(0));
});
