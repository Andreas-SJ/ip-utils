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
const HAS_PLANNER = MODE === 'both' || MODE === 'planner';
const HAS_NETPLAN = MODE === 'both' || MODE === 'netplan';

function getInstalledVersion() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8'));
    if (manifest && typeof manifest.current === 'string' && manifest.current.trim()) {
      return manifest.current.trim();
    }
  } catch {}

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    if (pkg && typeof pkg.version === 'string' && pkg.version.trim()) {
      return `v${pkg.version.trim()}`;
    }
  } catch {}

  return null;
}

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

function sendToolNotInstalled(res, toolLabel) {
  const encodedTool = encodeURIComponent(toolLabel || 'unknown');
  return res.redirect(302, `/tool-not-installed?tool=${encodedTool}`);
}

app.get('/tool-not-installed', (req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'tool-not-installed.html'));
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/netplan-gen', (req, res) => {
  if (!HAS_NETPLAN) return sendToolNotInstalled(res, 'netplan-gen');
  res.sendFile(path.join(__dirname, 'public', 'netplan-gen.html'));
});

app.get('/ip-planner', (req, res, next) => {
  if (!HAS_PLANNER) return sendToolNotInstalled(res, 'ip-planner');
  return requireAuth(req, res, () => {
    res.sendFile(path.join(__dirname, 'public', 'ip-planner.html'));
  });
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/config', (req, res) => {
  res.json({
    hasPlanner: HAS_PLANNER,
    hasNetplan: HAS_NETPLAN
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
const VERSION_MANIFEST_URL = 'https://raw.githubusercontent.com/Andreas-SJ/ip-utils/refs/heads/main/version.json';
const UPDATE_REQUEST_FILE = path.join(DATA_DIR, 'update-request.env');
const UPDATE_STATUS_FILE = path.join(DATA_DIR, 'update-status.env');
const UPDATE_STATUS_LOG = path.join(DATA_DIR, 'update-status.log');
const UPDATE_HEARTBEAT_FILE = path.join(DATA_DIR, 'update-heartbeat');
const UPDATE_HEARTBEAT_MAX_AGE_MS = 15000;

function normalizeBranchName(branch) {
  const b = String(branch || '').trim() || 'main';
  return /^[A-Za-z0-9._/-]+$/.test(b) ? b : null;
}

function isValidProxyIp(ip) {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(ip || ''));
}

function sanitizeJob(job) {
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    exitCode: job.exitCode,
    branch: job.branch,
    error: job.error,
    output: job.output,
    daemonAlive: !!job.daemonAlive,
    daemonLastSeenAt: job.daemonLastSeenAt,
    daemonStaleSeconds: job.daemonStaleSeconds,
  };
}

function readDaemonHeartbeat() {
  try {
    const stat = fs.statSync(UPDATE_HEARTBEAT_FILE);
    const lastSeenAt = new Date(stat.mtimeMs).toISOString();
    const staleMs = Math.max(0, Date.now() - stat.mtimeMs);
    return {
      daemonAlive: staleMs <= UPDATE_HEARTBEAT_MAX_AGE_MS,
      daemonLastSeenAt: lastSeenAt,
      daemonStaleSeconds: Math.floor(staleMs / 1000),
    };
  } catch {
    return {
      daemonAlive: false,
      daemonLastSeenAt: null,
      daemonStaleSeconds: null,
    };
  }
}

function parseEnvFile(filePath) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    const out = {};
    for (const line of lines) {
      if (!line || !line.includes('=')) continue;
      const i = line.indexOf('=');
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      if (!key) continue;
      out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}

function writeEnvFile(filePath, values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${String(v ?? '').replace(/[\r\n]/g, ' ')}`);
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

function readLogTail(filePath, maxBytes = 50000) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.length > maxBytes ? text.slice(-maxBytes) : text;
  } catch {
    return '';
  }
}

function readUpdateJobStatus() {
  const heartbeat = readDaemonHeartbeat();
  const raw = parseEnvFile(UPDATE_STATUS_FILE);
  if (!raw) {
    return sanitizeJob({
      id: null,
      status: 'idle',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      branch: null,
      error: null,
      output: '',
      ...heartbeat,
    });
  }

  return sanitizeJob({
    id: raw.id || null,
    status: raw.status || 'idle',
    startedAt: raw.started_at || null,
    endedAt: raw.ended_at || null,
    exitCode: raw.exit_code ? Number(raw.exit_code) : null,
    branch: raw.branch || null,
    error: raw.error || null,
    output: readLogTail(raw.output_file || UPDATE_STATUS_LOG),
    ...heartbeat,
  });
}

function queueUpdateJobRequest(options) {
  const { id, branch, proxyMode, proxyIp } = options;
  writeEnvFile(UPDATE_REQUEST_FILE, {
    id,
    branch,
    proxy_mode: proxyMode,
    proxy_ip: proxyMode === 'set' ? proxyIp : '',
    requested_at: new Date().toISOString(),
  });

  writeEnvFile(UPDATE_STATUS_FILE, {
    id,
    status: 'queued',
    started_at: '',
    ended_at: '',
    exit_code: '',
    branch,
    error: '',
    output_file: UPDATE_STATUS_LOG,
  });
}

function loadUpdates() {
  try {
    const state = JSON.parse(fs.readFileSync(UPDATES_FILE, 'utf8'));
    return normalizeUpdatesState(state);
  } catch {
    return { lastSeenVersion: null, pending: [] };
  }
}

function saveUpdates(state) {
  fs.writeFileSync(UPDATES_FILE, JSON.stringify(normalizeUpdatesState(state), null, 2));
}

function normalizeUpdatesState(state) {
  const pending = Array.isArray(state?.pending) ? state.pending : [];
  const installedVersion = getInstalledVersion();
  const seen = new Set();
  const normalizedPending = [];

  for (const entry of pending) {
    const version = String(entry?.version || '').trim();
    if (!version || seen.has(version)) continue;

    if (
      installedVersion &&
      versionToComparableParts(version) &&
      versionToComparableParts(installedVersion) &&
      compareVersions(version, installedVersion) <= 0
    ) {
      continue;
    }

    seen.add(version);
    normalizedPending.push({
      version,
      type: entry.type || 'bug fix',
      message: entry.message || version,
      date: entry.date || new Date().toISOString(),
    });
  }

  return {
    lastSeenVersion: state?.lastSeenVersion || null,
    pending: normalizedPending,
  };
}

function fetchVersionManifest() {
  return new Promise(resolve => {
    const req = https.get(VERSION_MANIFEST_URL, {
      headers: { 'User-Agent': 'ip-utils-update-checker' },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) { resolve(null); return; }
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function versionToComparableParts(version) {
  const match = String(version || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

function compareVersions(a, b) {
  const left = versionToComparableParts(a);
  const right = versionToComparableParts(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function toNotification(entry) {
  return {
    version: entry.version,
    type: entry.security ? 'security fix' : (entry.type === 'feature' ? 'new feature' : 'bug fix'),
    message: entry.summary || entry.version,
    date: entry.date || new Date().toISOString(),
  };
}

async function checkForUpdates() {
  const state = loadUpdates();
  const manifest = await fetchVersionManifest();
  if (!manifest || !Array.isArray(manifest.history) || !manifest.current) return;

  const installedVersion = getInstalledVersion();
  if (
    installedVersion &&
    versionToComparableParts(installedVersion) &&
    (!state.lastSeenVersion || compareVersions(installedVersion, state.lastSeenVersion) > 0)
  ) {
    state.lastSeenVersion = installedVersion;
  }

  if (!state.lastSeenVersion) {
    state.lastSeenVersion = manifest.current;
    saveUpdates(state);
    return;
  }

  if (compareVersions(manifest.current, state.lastSeenVersion) <= 0) return;

  const history = manifest.history;
  const lastSeenIndex = history.findIndex(entry => entry.version === state.lastSeenVersion);
  if (lastSeenIndex < 0) {
    state.lastSeenVersion = manifest.current;
    saveUpdates(state);
    return;
  }

  const existingVersions = new Set((state.pending || []).map(entry => String(entry.version || '').trim()).filter(Boolean));

  const baselineVersion = state.lastSeenVersion;
  const newNotifications = history
    .slice(lastSeenIndex + 1)
    .map(toNotification)
    .filter(entry => {
      if (!entry.version || existingVersions.has(entry.version)) return false;
      if (
        baselineVersion &&
        versionToComparableParts(entry.version) &&
        versionToComparableParts(baselineVersion) &&
        compareVersions(entry.version, baselineVersion) <= 0
      ) {
        return false;
      }
      return true;
    });

  state.lastSeenVersion = manifest.current;
  if (newNotifications.length) state.pending = [...(state.pending || []), ...newNotifications];
  saveUpdates(state);
}

app.get('/api/admin/updates', requireAdmin, (req, res) => {
  res.json(loadUpdates().pending || []);
});

app.get('/api/admin/version', requireAdmin, (req, res) => {
  res.json({ version: getInstalledVersion() });
});

app.get('/api/admin/update/status', requireAdmin, (req, res) => {
  res.json(readUpdateJobStatus());
});

app.post('/api/admin/update/start', requireAdmin, async (req, res) => {
  const currentJob = readUpdateJobStatus();
  if (currentJob.status === 'running' || currentJob.status === 'queued') {
    return res.status(409).json({ error: 'An update is already running.', job: currentJob });
  }
  if (!currentJob.daemonAlive) {
    return res.status(503).json({
      error: 'Updater daemon is offline. Run installer once to install/repair ip-utils-updater.service and retry.',
      job: currentJob,
    });
  }

  const branch = normalizeBranchName(req.body?.branch);
  if (!branch) return res.status(400).json({ error: 'Invalid branch name.' });

  const proxyMode = String(req.body?.proxyMode || 'keep').trim();
  if (!['keep', 'remove', 'set'].includes(proxyMode)) {
    return res.status(400).json({ error: 'Invalid proxy mode.' });
  }

  const proxyIp = String(req.body?.proxyIp || '').trim();
  if (proxyMode === 'set' && !isValidProxyIp(proxyIp)) {
    return res.status(400).json({ error: 'Valid proxy IP is required when proxy mode is set.' });
  }

  const adminPassword = String(req.body?.adminPassword || '');
  if (!adminPassword) return res.status(400).json({ error: 'Admin password confirmation is required.' });

  const users = loadUsers();
  const sessionUser = req.session?.user?.username;
  const user = sessionUser ? users[sessionUser] : null;
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const ok = await bcrypt.compare(adminPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid admin password.' });

  const id = crypto.randomBytes(8).toString('hex');
  queueUpdateJobRequest({ id, branch, proxyMode, proxyIp });
  return res.json({ ok: true, id, job: readUpdateJobStatus() });
});

app.post('/api/admin/updates/check', requireAdmin, async (req, res) => {
  try {
    await checkForUpdates();
    res.json({ ok: true, pending: loadUpdates().pending || [] });
  } catch {
    res.status(500).json({ error: 'Failed to check for updates.' });
  }
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
