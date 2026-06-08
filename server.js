const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 80;
const TRUST_PROXY = process.env.TRUST_PROXY || '';
if (TRUST_PROXY) app.set('trust proxy', TRUST_PROXY);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PLANS_DIR = path.join(DATA_DIR, 'plans');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const VALID_MODES = new Set(['both', 'planner', 'netplan']);
const MODE = VALID_MODES.has(process.env.MODE) ? process.env.MODE : 'both';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PLANS_DIR)) fs.mkdirSync(PLANS_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');

const secretFile = path.join(DATA_DIR, 'session_secret.txt');
let sessionSecret;
try {
  sessionSecret = fs.readFileSync(secretFile, 'utf8').trim();
  if (!sessionSecret) throw new Error('empty');
} catch {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, sessionSecret, { mode: 0o600 });
}

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function isJsonRequest(req) {
  return (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json')));
}

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: TRUST_PROXY ? 'auto' : false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    if (isJsonRequest(req)) return res.status(401).json({ error: 'Authentication required.' });
    return res.redirect('/login');
  }
  const users = loadUsers();
  if (!users[req.session.user.username]) {
    req.session.destroy(() => {});
    if (isJsonRequest(req)) return res.status(401).json({ error: 'Authentication required.' });
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.isAdmin) {
    if (isJsonRequest(req)) return res.status(403).json({ error: 'Admin access required.' });
    return res.redirect('/login');
  }
  next();
}

app.get('/', (req, res) => {
  if (MODE === 'planner') return res.redirect('/ip-planner');
  if (MODE === 'netplan') return res.redirect('/netplan-gen');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

if (MODE === 'both' || MODE === 'netplan') {
  app.get('/netplan-gen', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'netplan-gen.html'));
  });
}

if (MODE === 'both' || MODE === 'planner') {
  app.get('/ip-planner', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ip-planner.html'));
  });
}

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/config', (req, res) => {
  res.json({
    hasPlanner: MODE === 'both' || MODE === 'planner',
    hasNetplan: MODE === 'both' || MODE === 'netplan'
  });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }
  const users = loadUsers();
  const user = users[username];
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });
  req.session.user = { username: user.username, isAdmin: !!user.isAdmin };
  const returnTo = req.session.returnTo || (user.isAdmin ? '/admin' : '/');
  delete req.session.returnTo;
  res.json({ username: user.username, isAdmin: !!user.isAdmin, returnTo });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated.' });
  res.json({ username: req.session.user.username, isAdmin: req.session.user.isAdmin });
});

app.get('/api/plan', requireAuth, (req, res) => {
  const file = path.join(PLANS_DIR, req.session.user.username + '.json');
  if (!fs.existsSync(file)) return res.json(null);
  try {
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    res.json(null);
  }
});

app.post('/api/plan', requireAuth, (req, res) => {
  const file = path.join(PLANS_DIR, req.session.user.username + '.json');
  try {
    fs.writeFileSync(file, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save plan.' });
  }
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = loadUsers();
  const result = Object.values(users).map(u => ({
    username: u.username,
    isAdmin: !!u.isAdmin,
    hasPlan: fs.existsSync(path.join(PLANS_DIR, u.username + '.json'))
  }));
  res.json(result);
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { username, password, isAdmin } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 1-32 characters (a-z, A-Z, 0-9, _, -).' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const users = loadUsers();
  if (users[username]) return res.status(409).json({ error: 'Username already taken.' });
  const hash = await bcrypt.hash(password, 10);
  users[username] = { username, passwordHash: hash, isAdmin: !!isAdmin };
  saveUsers(users);
  res.json({ ok: true });
});

app.put('/api/admin/users/:username/password', requireAdmin, async (req, res) => {
  const { username } = req.params;
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const users = loadUsers();
  if (!users[username]) return res.status(404).json({ error: 'User not found.' });
  const hash = await bcrypt.hash(password, 10);
  users[username].passwordHash = hash;
  saveUsers(users);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  if (username === req.session.user.username) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  const users = loadUsers();
  if (!users[username]) return res.status(404).json({ error: 'User not found.' });
  delete users[username];
  saveUsers(users);
  const planFile = path.join(PLANS_DIR, username + '.json');
  if (fs.existsSync(planFile)) fs.unlinkSync(planFile);
  res.json({ ok: true });
});

app.get('/api/admin/plans/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  if (!loadUsers()[username]) return res.status(404).json({ error: 'User not found.' });
  const file = path.join(PLANS_DIR, username + '.json');
  if (!fs.existsSync(file)) return res.json(null);
  try { res.json(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { res.json(null); }
});

app.post('/api/admin/plans/:username', requireAdmin, async (req, res) => {
  const { username } = req.params;
  if (!loadUsers()[username]) return res.status(404).json({ error: 'User not found.' });
  const file = path.join(PLANS_DIR, username + '.json');
  try {
    fs.writeFileSync(file, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Failed to save plan.' }); }
});

app.delete('/api/admin/plans/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  const planFile = path.join(PLANS_DIR, username + '.json');
  if (!fs.existsSync(planFile)) return res.status(404).json({ error: 'No plan found for this user.' });
  fs.unlinkSync(planFile);
  res.json({ ok: true });
});

function isValidIpv4(ip) {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return false;
  return ip.split('.').every(n => { const v = parseInt(n, 10); return v >= 0 && v <= 255; });
}

function getOutboundInterface(ip) {
  return new Promise(resolve => {
    exec('ip route get ' + ip, { timeout: 2000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const m = stdout.match(/\bdev\s+(\S+)/);
      resolve(m ? m[1] : null);
    });
  });
}

async function arpTest(ip) {
  const iface = await getOutboundInterface(ip);
  if (!iface) return null;
  return new Promise(resolve => {
    exec('arping -c 1 -w 1 -I ' + iface + ' ' + ip, { timeout: 3000 }, error => {
      if (error === null) resolve(true);
      else if (error.code === 1) resolve(false);
      else resolve(null);
    });
  });
}

app.get('/api/arp/:ip', requireAuth, async (req, res) => {
  const ip = req.params.ip;
  if (!isValidIpv4(ip)) return res.status(400).json({ error: 'Invalid IPv4 address.' });
  const up = await arpTest(ip);
  res.json({ ip, up });
});

app.post('/api/arp/scan', requireAuth, async (req, res) => {
  const { ips } = req.body;
  if (!Array.isArray(ips) || ips.length === 0) return res.json({});
  if (ips.length > 254) return res.status(400).json({ error: 'Too many IPs in one scan.' });
  const validIps = ips.filter(isValidIpv4);
  const results = {};
  const CONCURRENCY = 15;
  const queue = [...validIps];
  async function worker() {
    while (queue.length) {
      const ip = queue.shift();
      results[ip] = await arpTest(ip);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, validIps.length) }, worker));
  res.json(results);
});

const UPDATES_FILE = path.join(DATA_DIR, 'update_notifications.json');
const GITHUB_REPO = 'Andreas-SJ/ip-utils';
const UPDATE_TAGS = [
  { tag: '[security fix]', type: 'security fix' },
  { tag: '[bug fix]',      type: 'bug fix' },
  { tag: '[new feature]',  type: 'new feature' },
];

function loadUpdates() {
  try { return JSON.parse(fs.readFileSync(UPDATES_FILE, 'utf8')); }
  catch { return { lastCheckedSha: null, pending: [] }; }
}

function saveUpdates(state) {
  fs.writeFileSync(UPDATES_FILE, JSON.stringify(state, null, 2));
}

function fetchGithubCommits() {
  return new Promise(resolve => {
    const req = https.get({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/commits?per_page=30`,
      headers: { 'User-Agent': 'ip-utils-update-checker' },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) { resolve([]); return; }
        try { resolve(JSON.parse(data)); } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

async function checkForUpdates() {
  const state = loadUpdates();
  const commits = await fetchGithubCommits();
  if (!Array.isArray(commits) || !commits.length) return;

  const latestSha = commits[0].sha;

  if (!state.lastCheckedSha) {
    state.lastCheckedSha = latestSha;
    saveUpdates(state);
    return;
  }

  if (latestSha === state.lastCheckedSha) return;

  const newNotifications = [];
  for (const commit of commits) {
    if (commit.sha === state.lastCheckedSha) break;
    const msg = (commit.commit?.message || '').trim();
    const lower = msg.toLowerCase();
    for (const { tag, type } of UPDATE_TAGS) {
      if (lower.includes(tag)) {
        newNotifications.push({
          sha: commit.sha,
          type,
          message: msg.split('\n')[0],
          date: commit.commit?.author?.date || new Date().toISOString(),
        });
        break;
      }
    }
  }

  state.lastCheckedSha = latestSha;
  if (newNotifications.length) state.pending = [...(state.pending || []), ...newNotifications];
  saveUpdates(state);
}

app.get('/api/admin/updates', requireAdmin, (req, res) => {
  res.json(loadUpdates().pending || []);
});

app.post('/api/admin/updates/dismiss', requireAdmin, (req, res) => {
  const state = loadUpdates();
  state.pending = [];
  saveUpdates(state);
  res.json({ ok: true });
});

async function bootstrap() {
  const ADMIN_USER = process.env.ADMIN_USER;
  const ADMIN_PASS = process.env.ADMIN_PASS;
  if (ADMIN_USER && ADMIN_PASS) {
    const users = loadUsers();
    if (!users[ADMIN_USER]) {
      const hash = await bcrypt.hash(ADMIN_PASS, 10);
      users[ADMIN_USER] = { username: ADMIN_USER, passwordHash: hash, isAdmin: true };
      saveUsers(users);
      console.log('Admin user created: ' + ADMIN_USER);
    }
  }
  app.listen(PORT, () => {
    console.log('ip-utils listening on port ' + PORT + ' (mode: ' + MODE + ')');
  });

  checkForUpdates().catch(() => {});
  setInterval(() => checkForUpdates().catch(() => {}), 10 * 60 * 1000);
}

bootstrap().catch(err => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
