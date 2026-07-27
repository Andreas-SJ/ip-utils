const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 80;
const TRUST_PROXY = process.env.TRUST_PROXY || '';
if (TRUST_PROXY) app.set('trust proxy', TRUST_PROXY);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PLANS_DIR = path.join(DATA_DIR, 'plans');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const VALID_MODES = new Set(['both', 'planner', 'netplan']);
const VALID_SKINS = new Set(['futuristic', 'enterprise']);
const MODE = VALID_MODES.has(process.env.MODE) ? process.env.MODE : 'both';
const HAS_PLANNER = MODE === 'both' || MODE === 'planner';
const HAS_NETPLAN = MODE === 'both' || MODE === 'netplan';
const DISABLE_LEGACY_PAGE_ROUTES = process.env.IP_UTILS_DISABLE_LEGACY_PAGE_ROUTES === '1';

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
if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ passwordManagerEnabled: false, skin: 'futuristic' }, null, 2));

const secretFile = path.join(DATA_DIR, 'session_secret.txt');
let sessionSecret;
try {
  sessionSecret = fs.readFileSync(secretFile, 'utf8').trim();
  if (!sessionSecret) throw new Error('empty');
} catch {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, sessionSecret, { mode: 0o600 });
}

const PM_KEY_FILE = path.join(DATA_DIR, 'password_manager_key.txt');
let passwordManagerSecret = String(process.env.PASSWORD_MANAGER_KEY || '').trim();
if (!passwordManagerSecret) {
  try {
    passwordManagerSecret = fs.readFileSync(PM_KEY_FILE, 'utf8').trim();
  } catch {
    passwordManagerSecret = crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(PM_KEY_FILE, passwordManagerSecret, { mode: 0o600 });
  }
}
const passwordManagerKey = crypto.createHash('sha256').update(passwordManagerSecret).digest();
const passwordManagerKeyId = crypto.createHash('sha256').update(passwordManagerKey).digest('hex').slice(0, 12);

function isEncryptedPasswordValue(value) {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}

function encryptPasswordValue(value) {
  if (typeof value !== 'string') return '';
  if (!value) return '';
  if (isEncryptedPasswordValue(value)) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', passwordManagerKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${passwordManagerKeyId}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptPasswordValue(value) {
  if (typeof value !== 'string') return '';
  if (!value) return '';
  if (!isEncryptedPasswordValue(value)) return value;

  const parts = value.split(':');
  if (parts.length !== 6) return value;
  const iv = Buffer.from(parts[3], 'base64');
  const tag = Buffer.from(parts[4], 'base64');
  const ciphertext = Buffer.from(parts[5], 'base64');

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', passwordManagerKey, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    // Keep ciphertext untouched if this instance does not have the matching key.
    return value;
  }
}

function normalizePasswordManager(raw, mode) {
  const source = (raw && typeof raw === 'object') ? raw : {};
  const output = {};

  for (const [ip, entries] of Object.entries(source)) {
    if (!Array.isArray(entries)) continue;
    const normIp = String(ip || '').trim();
    if (!normIp) continue;

    const normEntries = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const description = String(entry.description || '').trim();
      if (!description) continue;

      const id = String(entry.id || '').trim() || crypto.randomBytes(6).toString('hex');
      const username = String(entry.username || '').trim();
      const rawPassword = String(entry.password || '');
      const password = mode === 'decrypt'
        ? decryptPasswordValue(rawPassword)
        : encryptPasswordValue(rawPassword);

      normEntries.push({ id, username, password, description });
    }

    if (normEntries.length) output[normIp] = normEntries;
  }

  return output;
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

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const skin = VALID_SKINS.has(String(raw?.skin || '').trim()) ? String(raw.skin).trim() : 'futuristic';
    return {
      passwordManagerEnabled: !!raw?.passwordManagerEnabled,
      skin,
    };
  } catch {
    return { passwordManagerEnabled: false, skin: 'futuristic' };
  }
}

function saveSettings(settings) {
  const skinRaw = String(settings?.skin || '').trim();
  const out = {
    passwordManagerEnabled: !!settings?.passwordManagerEnabled,
    skin: VALID_SKINS.has(skinRaw) ? skinRaw : 'futuristic',
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(out, null, 2));
}

function isPasswordManagerEnabledGlobal() {
  return !!loadSettings().passwordManagerEnabled;
}

function readStoredEncryptedPasswordManager(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.passwordManager || typeof raw.passwordManager !== 'object') return null;
    const enc = normalizePasswordManager(raw.passwordManager, 'encrypt');
    return Object.keys(enc).length ? enc : null;
  } catch {
    return null;
  }
}

function normalizePlanPayload(raw, options = {}) {
  const allowPasswordManager = !!options.allowPasswordManager;
  const passwordMode = options.passwordMode === 'decrypt' ? 'decrypt' : 'encrypt';
  const input = (raw && typeof raw === 'object') ? raw : {};
  const out = {
    subnets: Array.isArray(input.subnets) ? input.subnets : [],
    selectedId: (typeof input.selectedId === 'number' || input.selectedId === null) ? input.selectedId : null,
    hypervisors: (input.hypervisors && typeof input.hypervisors === 'object') ? input.hypervisors : {},
    guests: (input.guests && typeof input.guests === 'object') ? input.guests : {},
    routers: (input.routers && typeof input.routers === 'object') ? input.routers : {},
    routerInterfaces: (input.routerInterfaces && typeof input.routerInterfaces === 'object') ? input.routerInterfaces : {},
  };

  if (allowPasswordManager && input.passwordManager && typeof input.passwordManager === 'object') {
    out.passwordManager = normalizePasswordManager(input.passwordManager, passwordMode);
  }

  return out;
}

function isJsonRequest(req) {
  return (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json')));
}

function shouldRememberReturnTo(req) {
  if (isJsonRequest(req)) return false;
  if (typeof req.originalUrl !== 'string') return false;
  return !req.originalUrl.startsWith('/api/');
}

function normalizeReturnTo(value, fallback) {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  if (value.startsWith('/api/')) return fallback;
  if (value.startsWith('//')) return fallback;
  return value;
}

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));
app.use('/icons', express.static(path.join(__dirname, 'public', 'icons')));
app.use('/skins', express.static(path.join(__dirname, 'public', 'skins')));
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: TRUST_PROXY ? 'auto' : false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    if (shouldRememberReturnTo(req)) req.session.returnTo = req.originalUrl;
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

if (!DISABLE_LEGACY_PAGE_ROUTES) {
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
}

app.get('/api/config', (req, res) => {
  const settings = loadSettings();
  res.json({
    hasPlanner: HAS_PLANNER,
    hasNetplan: HAS_NETPLAN,
    skin: settings.skin
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
  const defaultReturnTo = user.isAdmin ? '/admin' : '/';
  const returnTo = normalizeReturnTo(req.session.returnTo, defaultReturnTo);
  delete req.session.returnTo;
  res.json({
    username: user.username,
    isAdmin: !!user.isAdmin,
    passwordManagerEnabled: isPasswordManagerEnabledGlobal(),
    returnTo
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated.' });
  const users = loadUsers();
  const user = users[req.session.user.username];
  if (!user) return res.status(401).json({ error: 'Not authenticated.' });
  res.json({
    username: req.session.user.username,
    isAdmin: req.session.user.isAdmin,
    passwordManagerEnabled: isPasswordManagerEnabledGlobal()
  });
});

app.get('/api/plan', requireAuth, (req, res) => {
  const allowPasswordManager = isPasswordManagerEnabledGlobal();
  const file = path.join(PLANS_DIR, req.session.user.username + '.json');
  if (!fs.existsSync(file)) return res.json(null);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json(normalizePlanPayload(raw, { allowPasswordManager, passwordMode: 'decrypt' }));
  } catch {
    res.json(null);
  }
});

app.post('/api/plan', requireAuth, (req, res) => {
  const allowPasswordManager = isPasswordManagerEnabledGlobal();
  const file = path.join(PLANS_DIR, req.session.user.username + '.json');
  try {
    const payload = normalizePlanPayload(req.body, { allowPasswordManager, passwordMode: 'encrypt' });
    if (!allowPasswordManager) {
      const preserved = readStoredEncryptedPasswordManager(file);
      if (preserved) payload.passwordManager = preserved;
    }
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
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
  users[username] = {
    username,
    passwordHash: hash,
    isAdmin: !!isAdmin
  };
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
  const users = loadUsers();
  if (!users[username]) return res.status(404).json({ error: 'User not found.' });
  const allowPasswordManager = isPasswordManagerEnabledGlobal();
  const file = path.join(PLANS_DIR, username + '.json');
  if (!fs.existsSync(file)) return res.json(null);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json(normalizePlanPayload(raw, { allowPasswordManager, passwordMode: 'decrypt' }));
  }
  catch { res.json(null); }
});

app.post('/api/admin/plans/:username', requireAdmin, async (req, res) => {
  const { username } = req.params;
  const users = loadUsers();
  if (!users[username]) return res.status(404).json({ error: 'User not found.' });
  const allowPasswordManager = isPasswordManagerEnabledGlobal();
  const file = path.join(PLANS_DIR, username + '.json');
  try {
    const payload = normalizePlanPayload(req.body, { allowPasswordManager, passwordMode: 'encrypt' });
    if (!allowPasswordManager) {
      const preserved = readStoredEncryptedPasswordManager(file);
      if (preserved) payload.passwordManager = preserved;
    }
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Failed to save plan.' }); }
});

app.get('/api/admin/options', requireAdmin, (req, res) => {
  const settings = loadSettings();
  res.json({
    passwordManagerEnabled: !!settings.passwordManagerEnabled,
    skin: settings.skin
  });
});

app.put('/api/admin/options', requireAdmin, (req, res) => {
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'passwordManagerEnabled')) {
    return res.status(400).json({ error: 'passwordManagerEnabled is required.' });
  }
  const rawSkin = String(req.body?.skin || '').trim() || 'futuristic';
  if (!VALID_SKINS.has(rawSkin)) {
    return res.status(400).json({ error: 'skin must be one of: futuristic, enterprise.' });
  }
  const settings = loadSettings();
  settings.passwordManagerEnabled = !!req.body.passwordManagerEnabled;
  settings.skin = rawSkin;
  saveSettings(settings);
  res.json({
    ok: true,
    passwordManagerEnabled: !!settings.passwordManagerEnabled,
    skin: settings.skin
  });
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
const INSTALLER_PATH = path.join(__dirname, 'installer.sh');

let updateJob = {
  id: null,
  status: 'idle',
  startedAt: null,
  endedAt: null,
  exitCode: null,
  branch: null,
  output: '',
  error: null,
};

function appendJobOutput(chunk) {
  const text = String(chunk || '');
  updateJob.output += text;
  if (updateJob.output.length > 50000) {
    updateJob.output = updateJob.output.slice(-50000);
  }
}

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
  };
}

function startUpdateJob(options) {
  const { branch, proxyMode, proxyIp } = options;
  const args = [INSTALLER_PATH, '--branch', branch, '--update-now', '--proxy-mode', proxyMode];
  if (proxyMode === 'set') args.push('--proxy-ip', proxyIp);

  const id = crypto.randomBytes(8).toString('hex');
  updateJob = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    branch,
    output: `Starting update job ${id} on branch '${branch}'...\n`,
    error: null,
  };

  const child = spawn('bash', args, {
    cwd: __dirname,
    env: { ...process.env, IP_UTILS_SKIP_STDIN_BOOTSTRAP: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', appendJobOutput);
  child.stderr.on('data', appendJobOutput);
  child.on('error', err => {
    updateJob.status = 'failed';
    updateJob.endedAt = new Date().toISOString();
    updateJob.exitCode = -1;
    updateJob.error = err.message || 'Failed to start update process.';
    appendJobOutput(`\n[error] ${updateJob.error}\n`);
  });
  child.on('close', code => {
    updateJob.endedAt = new Date().toISOString();
    updateJob.exitCode = code;
    updateJob.status = code === 0 ? 'succeeded' : 'failed';
    if (code !== 0 && !updateJob.error) updateJob.error = `Installer exited with code ${code}`;
    appendJobOutput(`\n[done] update job completed with exit code ${code}\n`);
  });

  return id;
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
  res.json(sanitizeJob(updateJob));
});

app.post('/api/admin/update/start', requireAdmin, async (req, res) => {
  if (updateJob.status === 'running') {
    return res.status(409).json({ error: 'An update is already running.', job: sanitizeJob(updateJob) });
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

  const id = startUpdateJob({ branch, proxyMode, proxyIp });
  return res.json({ ok: true, id, job: sanitizeJob(updateJob) });
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

async function bootstrap(serverApp = app) {
  const ADMIN_USER = process.env.ADMIN_USER;
  const ADMIN_PASS = process.env.ADMIN_PASS;
  if (ADMIN_USER && ADMIN_PASS) {
    const users = loadUsers();
    if (!users[ADMIN_USER]) {
      const hash = await bcrypt.hash(ADMIN_PASS, 10);
      users[ADMIN_USER] = {
        username: ADMIN_USER,
        passwordHash: hash,
        isAdmin: true
      };
      saveUsers(users);
      console.log('Admin user created: ' + ADMIN_USER);
    }
  }
  serverApp.listen(PORT, () => {
    console.log('ip-utils listening on port ' + PORT + ' (mode: ' + MODE + ')');
  });

  checkForUpdates().catch(() => {});
  setInterval(() => checkForUpdates().catch(() => {}), 10 * 60 * 1000);
}

module.exports = { app, bootstrap };

if (require.main === module) {
  bootstrap().catch(err => {
    console.error('Fatal error during bootstrap:', err);
    process.exit(1);
  });
}
