import { parseCidr, intToIpv4, ipv4ToInt, bigToIpv6, ipv6ToBig } from '$lib/planner/ip';
import { buildPlannerNavHtml } from '$lib/planner/nav';
import { confirmDialog as openConfirmDialog, createToastController, cssEsc, downloadJson, esc, highlightMatch } from '$lib/planner/ui';
import { applyTheme as applySharedTheme, bootSkinFromStorage, preferredModeForSkin, sanitizeSkin, toggleTheme } from '$lib/theme';

if (!window.__ipPlannerBooted) {
  window.__ipPlannerBooted = true;
const MAX_ENUM = 65536;

const state = {
  subnets: [],
  selectedId: null,
  hypervisors: {},
  guests: {},
  routers: {},
  routerInterfaces: {},
  passwordManager: {}
};
const userCapabilities = { passwordManagerEnabled: false };
let uiTheme = applySharedTheme(bootSkinFromStorage(), preferredModeForSkin(bootSkinFromStorage()));

function applyTheme(skin, mode) {
  uiTheme = applySharedTheme(skin, mode);
}
let nextId = 1;
let renamingId = null;
const arpState = {};
let otherUserView = null;
let otherPlansData = [];
let otherPlansSectionOpen = false;
const otherUserOpen = {};

function enumerable(sn) { return sn.version === 4 && sn.total <= MAX_ENUM; }

function roleOf(sn, int) {
  if (sn.prefix === 32) return 'host';
  if (sn.prefix === 31) return 'host';
  if (int === sn.networkInt) return 'net';
  if (int === sn.broadcastInt) return 'bcast';
  return 'host';
}
function roleLabel(r) {
  return { net: 'net', bcast: 'bcast', host: 'host', gw: 'gw' }[r] || r;
}

function planApiUrl() { return '/api/plan'; }

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 350);
}
async function saveState() {
  try {
    if (otherUserView && !otherUserView.readOnly) {
      await fetch('/api/admin/plans/' + encodeURIComponent(otherUserView.username), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subnets: otherUserView.subnets,
          selectedId: otherUserView.selectedId,
          passwordManager: otherUserView.passwordManager || {}
        })
      });
    } else {
      await fetch(planApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subnets: state.subnets,
          selectedId: state.selectedId,
          hypervisors: state.hypervisors,
          guests: state.guests,
          routers: state.routers,
          routerInterfaces: state.routerInterfaces,
          passwordManager: state.passwordManager
        })
      });
    }
  } catch (e) {}
}
async function loadState() {
  try {
    const r = await fetch(planApiUrl());
    if (!r.ok) return false;
    const d = await r.json();
    if (d && Array.isArray(d.subnets)) {
      state.subnets = d.subnets;
      state.hypervisors = d.hypervisors || {};
      state.guests = d.guests || {};
      state.routers = d.routers || {};
      state.routerInterfaces = d.routerInterfaces || {};
      state.passwordManager = d.passwordManager || {};
      state.selectedId = null;
      nextId = state.subnets.reduce((m, s) => Math.max(m, s.id), 0) + 1;
      return true;
    }
  } catch (e) {}
  return false;
}

const elCidr = document.getElementById('in-cidr');
const elLabel = document.getElementById('in-label');
const elAddErr = document.getElementById('add-err');

function addSubnet() {
  const parsed = parseCidr(elCidr.value);
  if (parsed.error) { elAddErr.textContent = parsed.error; return; }
  if (parsed.cidr === '0.0.0.0/0') {
    showToast('nice try ;)');
    return;
  }
  if (state.subnets.some(s => s.cidr === parsed.cidr)) {
    elAddErr.textContent = 'Subnet ' + parsed.cidr + ' is already in the plan.';
    return;
  }
  const sn = {
    id: nextId++,
    label: elLabel.value.trim() || parsed.cidr,
    cidr: parsed.cidr,
    version: parsed.version,
    prefix: parsed.prefix,
    comments: {}
  };
  if (parsed.version === 4) {
    sn.networkInt = parsed.networkInt;
    sn.broadcastInt = parsed.broadcastInt;
    sn.total = parsed.total;
    sn.maskStr = parsed.maskStr;
  } else {
    sn.networkBig = parsed.networkBig.toString();
  }
  state.subnets.push(sn);
  state.selectedId = sn.id;
  elCidr.value = ''; elLabel.value = ''; elAddErr.textContent = '';
  renderSubnetList();
  renderPlan();
  scheduleSave();
}

document.getElementById('btn-add').addEventListener('click', addSubnet);
elCidr.addEventListener('keydown', e => { if (e.key === 'Enter') addSubnet(); });
elLabel.addEventListener('keydown', e => { if (e.key === 'Enter') addSubnet(); });
elCidr.addEventListener('input', () => { elAddErr.textContent = ''; });

const listEl = document.getElementById('subnet-list');
const listEmptyEl = document.getElementById('subnet-empty');

function annoCount(sn) { return Object.values(sn.comments).filter(v => v && v.trim()).length; }

function renderSubnetList() {
  listEl.innerHTML = '';
  listEmptyEl.style.display = (state.subnets.length || currentLeftTab !== 'subnets') ? 'none' : 'block';

  state.subnets.forEach(sn => {
    const card = document.createElement('div');
    card.className = 'subnet' + (sn.id === state.selectedId ? ' selected' : '');
    card.dataset.id = sn.id;

    let usable;
    if (sn.version === 4) {
      if (sn.prefix >= 31) usable = (sn.prefix === 32 ? 1 : 2);
      else usable = sn.total - 2;
      usable = usable.toLocaleString();
    } else {
      usable = '2^' + (128 - sn.prefix);
    }
    const n = annoCount(sn);

    if (sn.id === renamingId) {
      card.innerHTML = `
        <div class="subnet-body">
          <div class="subnet-main">
            <input class="subnet-rename-input" type="text" value="${esc(sn.label)}" maxlength="64" />
            <div class="subnet-cidr">${esc(sn.cidr)}</div>
          </div>
          <div class="subnet-stats">
            <div><b>v${sn.version}</b> &middot; ${usable} usable</div>
          </div>
          <div class="subnet-actions">
            <button class="ghost" data-act="rename-cancel" style="font-size:11px;padding:4px 8px">cancel</button>
          </div>
        </div>`;
      const input = card.querySelector('.subnet-rename-input');
      setTimeout(() => { input.focus(); input.select(); }, 0);
      const commit = () => {
        sn.label = input.value.trim() || sn.cidr;
        renamingId = null;
        renderSubnetList();
        scheduleSave();
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') { renamingId = null; renderSubnetList(); }
      });
      input.addEventListener('blur', () => { if (renamingId === sn.id) commit(); });
    } else {
      card.innerHTML = `
        <div class="subnet-body">
          <div class="subnet-main">
            <div class="subnet-label">${esc(sn.label)}</div>
            <div class="subnet-cidr">${esc(sn.cidr)}</div>
          </div>
          <div class="subnet-stats">
            <div><b>v${sn.version}</b> &middot; ${usable} usable</div>
            <div class="subnet-anno ${n ? '' : 'zero'}">&bull; ${n} note${n === 1 ? '' : 's'}</div>
          </div>
          <div class="subnet-actions">
            <button class="ghost" data-act="rename" style="font-size:11px;padding:4px 8px">rename</button>
            <button class="danger" data-act="remove">remove</button>
          </div>
        </div>`;
    }

    card.addEventListener('click', e => {
      if (e.target.dataset.act === 'rename') {
        e.stopPropagation();
        renamingId = sn.id;
        renderSubnetList();
        return;
      }
      if (e.target.dataset.act === 'rename-cancel') {
        e.stopPropagation();
        renamingId = null;
        renderSubnetList();
        return;
      }
      if (e.target.dataset.act === 'remove') {
        e.stopPropagation();
        const had = annoCount(sn);
        (async () => {
          if (had) {
            const go = await confirmDialog(
              'Delete subnet',
              'This will irreversibly delete all of the data in "' + sn.label + '" (' + sn.cidr + ') — ' + had + ' note' + (had === 1 ? '' : 's') + '.\n\nThis cannot be undone.',
              'Delete subnet');
            if (!go) return;
          }
          state.subnets = state.subnets.filter(x => x.id !== sn.id);
          removePasswordEntriesForSubnet(sn);
          if (state.selectedId === sn.id) state.selectedId = state.subnets[0]?.id || null;
          renderSubnetList(); renderPlan(); rebuildSearchIndex(); scheduleSave();
        })();
        return;
      }
      if (sn.id === renamingId) return;
      otherUserView = null;
      state.selectedId = sn.id;
      Object.keys(arpState).forEach(k => delete arpState[k]);
      renderSubnetList(); renderPlan();
      if (otherPlansData.length) renderOtherPlansSection();
      scheduleSave();
      triggerArpScan(sn);
    });

    listEl.appendChild(card);
  });
}

const planTitle = document.getElementById('plan-title');
const planCidr = document.getElementById('plan-cidr');
const planFacts = document.getElementById('plan-facts');
const planRegion = document.getElementById('plan-region');

let planFilter = { text: '', onlyAnno: false };
let pendingScrollIp = null;

function selectedSubnet() { return state.subnets.find(s => s.id === state.selectedId) || null; }

function renderPlan() {
  const readOnly = otherUserView ? !!otherUserView.readOnly : false;
  const sn = otherUserView
    ? (otherUserView.subnets.find(s => s.id === otherUserView.selectedId) || null)
    : selectedSubnet();
  planRegion.innerHTML = '';
  planFacts.innerHTML = '';

  if (!sn) {
    planCidr.textContent = '';
    planRegion.innerHTML = `<div class="plan-empty">&larr; Select a subnet from the list<br><span style="font-size:11px;color:var(--ink-faint)">or add one above to get started</span></div>`;
    return;
  }

  planCidr.textContent = '· ' + sn.label;

  if (sn.version === 4) {
    const first = sn.prefix <= 30 ? intToIpv4((sn.networkInt + 1) >>> 0) : intToIpv4(sn.networkInt);
    const last = sn.prefix <= 30 ? intToIpv4((sn.broadcastInt - 1) >>> 0) : intToIpv4(sn.broadcastInt);
    const usable = sn.prefix >= 31 ? (sn.prefix === 32 ? 1 : 2) : sn.total - 2;
    planFacts.innerHTML = `
      <div class="f"><b>cidr</b><span>${esc(sn.cidr)}</span></div>
      <div class="f"><b>netmask</b><span>${esc(sn.maskStr)}</span></div>
      <div class="f"><b>network</b><span>${intToIpv4(sn.networkInt)}</span></div>
      <div class="f"><b>broadcast</b><span>${intToIpv4(sn.broadcastInt)}</span></div>
      <div class="f"><b>range</b><span>${first} – ${last}</span></div>
      <div class="f"><b>usable</b><span>${usable.toLocaleString()}</span></div>
      <div class="f"><b>total</b><span>${sn.total.toLocaleString()}</span></div>`;
  } else {
    planFacts.innerHTML = `
      <div class="f"><b>cidr</b><span>${esc(sn.cidr)}</span></div>
      <div class="f"><b>network</b><span>${esc(sn.cidr.split('/')[0])}</span></div>
      <div class="f"><b>addresses</b><span>2^${128 - sn.prefix}</span></div>`;
  }

  if (otherUserView) {
    const ro = document.createElement('div');
    ro.className = 'notice';
    ro.style.cssText = 'margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:16px';
    const linkStyle = 'font-family:var(--mono);font-size:11px;color:var(--accent);white-space:nowrap;text-transform:uppercase;letter-spacing:0.05em';
    if (readOnly) {
      ro.innerHTML = '<span>Viewing ' + esc(otherUserView.username) + '&apos;s plan &mdash; read-only</span>';
      const editBtn = document.createElement('a');
      editBtn.href = '#';
      editBtn.style.cssText = linkStyle;
      editBtn.textContent = 'edit plan →';
      editBtn.addEventListener('click', e => { e.preventDefault(); otherUserView.readOnly = false; renderPlan(); });
      ro.appendChild(editBtn);
    } else {
      ro.innerHTML = '<span>Editing plan for <b>' + esc(otherUserView.username) + '</b></span>';
      const backBtn = document.createElement('a');
      backBtn.href = '#';
      backBtn.style.cssText = linkStyle;
      backBtn.textContent = 'back to read-only';
      backBtn.addEventListener('click', e => { e.preventDefault(); otherUserView.readOnly = true; renderPlan(); });
      ro.appendChild(backBtn);
    }
    planRegion.appendChild(ro);
  }
  if (enumerable(sn)) renderEnumPlan(sn, readOnly);
  else renderRegistryPlan(sn, readOnly);
}

function tagClass(role, ip) {
  if (role !== 'host') return role;
  const s = arpState[ip];
  return s ? 'host arp-' + s : 'host';
}

function refreshArpTags() {
  document.querySelectorAll('.addr-row[data-ip] .a-tag .t').forEach(tag => {
    const row = tag.closest('.addr-row');
    if (!row) return;
    const ip = row.dataset.ip;
    if (!tag.classList.contains('host') && !tag.classList.contains('arp-up') &&
        !tag.classList.contains('arp-down') && !tag.classList.contains('arp-pending') &&
        !tag.classList.contains('arp-up-manual') && !tag.classList.contains('arp-down-manual')) return;
    tag.className = 't role-tag ' + tagClass('host', ip);
  });
}

const MAX_AUTO_SCAN = 510;

async function triggerArpScan(sn) {
  let ips;
  if (sn.version === 4 && sn.total <= MAX_AUTO_SCAN) {
    ips = [];
    for (let i = 0; i < sn.total; i++) {
      const int = (sn.networkInt + i) >>> 0;
      const role = roleOf(sn, int);
      if (role === 'net' || role === 'bcast') continue;
      ips.push(intToIpv4(int));
    }
  } else {
    ips = Object.keys(sn.comments).filter(ip => (sn.comments[ip] || '').trim());
  }
  if (!ips.length) return;

  ips.forEach(ip => { arpState[ip] = 'pending'; });
  refreshArpTags();

  const BATCH = 30;
  for (let i = 0; i < ips.length; i += BATCH) {
    const batch = ips.slice(i, i + BATCH);
    try {
      const r = await fetch('/api/arp/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ips: batch })
      });
      if (!r.ok) continue;
      const results = await r.json();
      Object.entries(results).forEach(([ip, up]) => {
        const hasComment = !!(sn.comments[ip] && (sn.comments[ip] || '').trim());
        if (up === true)       arpState[ip] = hasComment ? 'up'   : 'up-manual';
        else if (up === false) arpState[ip] = hasComment ? 'down' : 'down-manual';
        else                   delete arpState[ip];
      });
      refreshArpTags();
    } catch {}
  }
}

async function triggerSingleArp(ip, sn) {
  arpState[ip] = 'pending';
  refreshArpTags();
  try {
    const r = await fetch('/api/arp/' + encodeURIComponent(ip));
    if (!r.ok) { delete arpState[ip]; refreshArpTags(); return; }
    const d = await r.json();
    const hasComment = !!(sn.comments[ip] && (sn.comments[ip] || '').trim());
    if (d.up === true)       arpState[ip] = hasComment ? 'up'   : 'up-manual';
    else if (d.up === false) arpState[ip] = hasComment ? 'down' : 'down-manual';
    else                     delete arpState[ip];
  } catch { delete arpState[ip]; }
  refreshArpTags();
}

function setComment(sn, ip, val) {
  if (val && val.trim()) sn.comments[ip] = val;
  else delete sn.comments[ip];
}

function canUsePasswordManager() {
  return !!userCapabilities.passwordManagerEnabled;
}

function isPasswordManagerReadOnly() {
  return !!(otherUserView && otherUserView.readOnly);
}

function activePasswordManagerStore() {
  if (otherUserView) {
    if (!otherUserView.passwordManager || typeof otherUserView.passwordManager !== 'object') {
      otherUserView.passwordManager = {};
    }
    return otherUserView.passwordManager;
  }
  return state.passwordManager;
}

function getPasswordEntries(ip) {
  const list = activePasswordManagerStore()[ip];
  return Array.isArray(list) ? list : [];
}

function upsertPasswordEntry(ip, entry) {
  const cur = getPasswordEntries(ip);
  const next = [...cur, entry];
  activePasswordManagerStore()[ip] = next;
}

function removePasswordEntry(ip, id) {
  const cur = getPasswordEntries(ip);
  const next = cur.filter(e => e.id !== id);
  const store = activePasswordManagerStore();
  if (next.length) store[ip] = next;
  else delete store[ip];
}

function removePasswordEntriesForSubnet(sn) {
  for (const ip of Object.keys(state.passwordManager || {})) {
    if (ipBelongsToSubnet(ip, sn)) delete state.passwordManager[ip];
  }
}

function openPasswordMenu(ip, x, y) {
  if (!canUsePasswordManager()) return;
  closeAddrDropdown();

  const readOnly = isPasswordManagerReadOnly();

  const dropdown = document.createElement('div');
  dropdown.className = 'addr-dropdown pw-dropdown';
  dropdown.style.left = x + 'px';
  dropdown.style.top = y + 'px';

  const entries = getPasswordEntries(ip);
  const passwordById = new Map(entries.map(e => [String(e.id || ''), String(e.password || '')]));
  function maskPassword(value) {
    const len = Math.max(8, Math.min(16, String(value || '').length || 8));
    return '\u2022'.repeat(len);
  }
  const entriesHtml = entries.length
    ? entries.map(e => `
      <div class="pw-item" data-pw-id="${esc(e.id)}">
        <div class="pw-main">
          <div class="pw-desc" title="${esc(e.description || '')}">${esc(e.description || '')}</div>
          <div class="pw-meta-row">
            <div class="pw-meta">${esc(e.username || '(no username)')}</div>
            <button class="pw-eye" data-pw-eye="${esc(e.id)}" title="Show password" aria-label="Show password"><img class="icon-svg" src="/icons/eye-icon.svg" alt="" /></button>
          </div>
          <div class="pw-secret" data-pw-secret="${esc(e.id)}">${maskPassword(e.password)}</div>
        </div>
        ${readOnly ? '' : `<button class="pw-del" data-pw-del="${esc(e.id)}">delete</button>`}
      </div>`).join('')
    : '<div class="pw-none">No documented logins for this host yet.</div>';

  dropdown.innerHTML = `
    <div class="pw-head">Password manager · ${esc(ip)}</div>
    <div class="pw-list">${entriesHtml}</div>
    ${readOnly ? '<div class="pw-none" style="padding-top:10px">Viewing stored logins in read-only mode.</div>' : `<div class="pw-form">
      <div class="pw-form-grid">
        <div>
          <span class="lbl">Username</span>
          <input type="text" id="pw-user" placeholder="svc-vpn" autocomplete="off" />
        </div>
        <div>
          <span class="lbl">Password</span>
          <input type="password" id="pw-pass" placeholder="password" autocomplete="new-password" />
        </div>
        <div class="full">
          <span class="lbl">Description <span style="color:var(--accent)">*</span></span>
          <input type="text" id="pw-desc" placeholder="Required: what this login is used for" autocomplete="off" />
        </div>
      </div>
      <div class="pw-form-err" id="pw-form-err"></div>
      <div class="pw-form-actions">
        <button class="primary" id="pw-save-btn">save login</button>
      </div>
    </div>`}`;

  dropdown.addEventListener('click', e => {
    const eyeBtn = e.target.closest('[data-pw-eye]');
    if (eyeBtn) {
      e.preventDefault();
      const eyeId = eyeBtn.dataset.pwEye;
      const secretEl = dropdown.querySelector('[data-pw-secret="' + cssEsc(eyeId) + '"]');
      if (!secretEl) return;
      const plain = passwordById.get(String(eyeId)) || '';
      const isRevealed = secretEl.classList.contains('revealed');
      if (isRevealed) {
        secretEl.textContent = maskPassword(plain);
        secretEl.classList.remove('revealed');
        const icon = eyeBtn.querySelector('img');
        if (icon) icon.src = '/icons/eye-icon.svg';
        eyeBtn.title = 'Show password';
        eyeBtn.setAttribute('aria-label', 'Show password');
      } else {
        secretEl.textContent = plain || '(empty password)';
        secretEl.classList.add('revealed');
        const icon = eyeBtn.querySelector('img');
        if (icon) icon.src = '/icons/eye-blind-icon.svg';
        eyeBtn.title = 'Hide password';
        eyeBtn.setAttribute('aria-label', 'Hide password');
      }
      return;
    }

    const delId = e.target.dataset.pwDel;
    if (!delId) return;
    e.preventDefault();
    if (readOnly) return;
    removePasswordEntry(ip, delId);
    scheduleSave();
    rebuildSearchIndex();
    openPasswordMenu(ip, x, y);
  });

  const saveBtn = dropdown.querySelector('#pw-save-btn');
  const userEl = dropdown.querySelector('#pw-user');
  const passEl = dropdown.querySelector('#pw-pass');
  const descEl = dropdown.querySelector('#pw-desc');
  const errEl = dropdown.querySelector('#pw-form-err');

  function submitPwEntry() {
    if (readOnly) return;
    const username = userEl.value.trim();
    const password = passEl.value;
    const description = descEl.value.trim();
    errEl.textContent = '';

    if (!description) {
      errEl.textContent = 'Description is required.';
      descEl.focus();
      return;
    }

    upsertPasswordEntry(ip, {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      username,
      password,
      description
    });

    scheduleSave();
    rebuildSearchIndex();
    openPasswordMenu(ip, x, y);
  }

  if (saveBtn) saveBtn.addEventListener('click', e => {
    e.preventDefault();
    submitPwEntry();
  });
  dropdown.addEventListener('keydown', e => {
    if (!readOnly && e.key === 'Enter' && (e.target.id === 'pw-user' || e.target.id === 'pw-pass' || e.target.id === 'pw-desc')) {
      e.preventDefault();
      submitPwEntry();
    }
  });

  document.body.appendChild(dropdown);
  activeDropdown = dropdown;
  requestAnimationFrame(() => {
    const rect = dropdown.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) dropdown.style.left = Math.max(8, x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight - 8) dropdown.style.top = Math.max(8, y - rect.height - 8) + 'px';
    if (!readOnly) dropdown.querySelector('#pw-user')?.focus();
  });
}

function enableHypervisor(ip) {
  delete state.guests[ip];
  state.hypervisors[ip] = true;
}
function disableHypervisor(ip) {
  delete state.hypervisors[ip];
  for (const g of Object.keys(state.guests)) {
    if (state.guests[g] === ip) delete state.guests[g];
  }
}
function assignGuest(guestIp, hvIp) {
  state.guests[guestIp] = hvIp;
}
function removeGuest(ip) {
  delete state.guests[ip];
}
function enableRouter(ip) {
  delete state.routerInterfaces[ip];
  state.routers[ip] = true;
}
function disableRouter(ip) {
  delete state.routers[ip];
  for (const intf of Object.keys(state.routerInterfaces)) {
    if (state.routerInterfaces[intf] === ip) delete state.routerInterfaces[intf];
  }
}
function assignInterface(ifaceIp, routerIp) {
  state.routerInterfaces[ifaceIp] = routerIp;
}
function removeInterface(ip) {
  delete state.routerInterfaces[ip];
}

function buildDisplayRows(ipList) {
  const hvIps = state.hypervisors;
  const guestOf = state.guests;
  const routerIps = state.routers;
  const ifaceOf = state.routerInterfaces;
  const guestSet = new Set(Object.keys(guestOf));
  const ifaceSet = new Set(Object.keys(ifaceOf));
  const guestsByHv = {};
  const ifacesByRouter = {};
  const mainIps = [];
  for (const ip of ipList) {
    if (guestSet.has(ip)) {
      const hv = guestOf[ip];
      if (!guestsByHv[hv]) guestsByHv[hv] = [];
      guestsByHv[hv].push(ip);
    } else if (ifaceSet.has(ip)) {
      const rtr = ifaceOf[ip];
      if (!ifacesByRouter[rtr]) ifacesByRouter[rtr] = [];
      ifacesByRouter[rtr].push(ip);
    } else {
      mainIps.push(ip);
    }
  }
  const rows = [];
  for (const ip of mainIps) {
    const isHv = !!hvIps[ip];
    const isRtr = !!routerIps[ip];
    rows.push({ ip, isGuest: false, isHypervisor: isHv, isInterface: false, isRouter: isRtr });
    if (isHv && guestsByHv[ip]) {
      for (const g of guestsByHv[ip]) rows.push({ ip: g, isGuest: true, isHypervisor: false, isInterface: false, isRouter: false, hvIp: ip });
    }
    if (isRtr && ifacesByRouter[ip]) {
      for (const intf of ifacesByRouter[ip]) rows.push({ ip: intf, isGuest: false, isHypervisor: false, isInterface: true, isRouter: false, routerIp: ip });
    }
  }
  for (const [hvIp, guests] of Object.entries(guestsByHv)) {
    if (!mainIps.includes(hvIp)) {
      for (const g of guests) rows.push({ ip: g, isGuest: true, isHypervisor: false, isInterface: false, isRouter: false, hvIp });
    }
  }
  for (const [rtrIp, intfs] of Object.entries(ifacesByRouter)) {
    if (!mainIps.includes(rtrIp)) {
      for (const intf of intfs) rows.push({ ip: intf, isGuest: false, isHypervisor: false, isInterface: true, isRouter: false, routerIp: rtrIp });
    }
  }
  return rows;
}

let activeDropdown = null;
function closeAddrDropdown() {
  if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; }
}
document.addEventListener('mousedown', e => {
  if (activeDropdown && !e.target.closest('.addr-dropdown')) closeAddrDropdown();
});

function showAddrMenu(ip, x, y) {
  closeAddrDropdown();
  const hvIps = state.hypervisors;
  const guestOf = state.guests;
  const routerIps = state.routers;
  const ifaceOf = state.routerInterfaces;
  const isHv = !!hvIps[ip];
  const isGst = !!guestOf[ip];
  const isRtr = !!routerIps[ip];
  const isIface = !!ifaceOf[ip];

  const dropdown = document.createElement('div');
  dropdown.className = 'addr-dropdown';
  dropdown.style.left = x + 'px';
  dropdown.style.top = y + 'px';

  function addItem(text, cls, onClick) {
    const btn = document.createElement('button');
    btn.className = 'addr-dropdown-item' + (cls ? ' ' + cls : '');
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    dropdown.appendChild(btn);
  }

  if (isHv) {
    addItem('Disable hypervisor', 'item-danger', () => {
      disableHypervisor(ip); closeAddrDropdown(); renderOrganizedView(); scheduleSave();
    });
    addItem('Add guest ▸', '', () => showSubList(dropdown, ip, 'add-guest'));
  } else if (isGst) {
    addItem('Remove from hypervisor — ' + guestOf[ip], 'item-danger', () => {
      removeGuest(ip); closeAddrDropdown(); renderOrganizedView(); scheduleSave();
    });
    addItem('Enable hypervisor', '', () => {
      removeGuest(ip); enableHypervisor(ip); closeAddrDropdown(); renderOrganizedView(); scheduleSave();
    });
  } else if (isRtr) {
    addItem('Disable router', 'item-danger', () => {
      disableRouter(ip); closeAddrDropdown(); renderOrganizedView(); scheduleSave();
    });
    addItem('Add interface ▸', '', () => showSubList(dropdown, ip, 'add-interface'));
  } else if (isIface) {
    addItem('Remove from router — ' + ifaceOf[ip], 'item-danger', () => {
      removeInterface(ip); closeAddrDropdown(); renderOrganizedView(); scheduleSave();
    });
    addItem('Enable router', '', () => {
      removeInterface(ip); enableRouter(ip); closeAddrDropdown(); renderOrganizedView(); scheduleSave();
    });
  } else {
    addItem('Enable hypervisor', '', () => {
      enableHypervisor(ip); closeAddrDropdown(); renderOrganizedView(); scheduleSave();
    });
    if (Object.keys(hvIps).length) {
      addItem('Assign to hypervisor ▸', '', () => showSubList(dropdown, ip, 'assign-to-hv'));
    }
    addItem('Enable router', '', () => {
      enableRouter(ip); closeAddrDropdown(); renderOrganizedView(); scheduleSave();
    });
    if (Object.keys(routerIps).length) {
      addItem('Assign to router ▸', '', () => showSubList(dropdown, ip, 'assign-to-router'));
    }
  }

  document.body.appendChild(dropdown);
  activeDropdown = dropdown;
  requestAnimationFrame(() => {
    const rect = dropdown.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) dropdown.style.left = Math.max(8, x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight - 8) dropdown.style.top = Math.max(8, y - rect.height - 8) + 'px';
  });
}

function showSubList(dropdown, ip, mode) {
  dropdown.querySelector('.hv-sub-list')?.remove();
  const hvIps = state.hypervisors;
  const guestOf = state.guests;
  const routerIps = state.routers;
  const ifaceOf = state.routerInterfaces;
  function commentForIp(ip2) {
    for (const s of state.subnets) { if ((s.comments[ip2] || '').trim()) return s.comments[ip2]; }
    return '';
  }
  let items = [];
  if (mode === 'assign-to-hv') {
    items = Object.keys(hvIps).map(h => ({
      label: h + (commentForIp(h) ? '  — ' + commentForIp(h).slice(0, 24) : ''),
      action: () => { assignGuest(ip, h); closeAddrDropdown(); renderOrganizedView(); scheduleSave(); }
    }));
  } else if (mode === 'add-guest') {
    const pool = [];
    for (const subnet of state.subnets) {
      for (const [ip2, comment] of Object.entries(subnet.comments)) {
        if (!comment || !comment.trim()) continue;
        if (ip2 === ip || hvIps[ip2] || guestOf[ip2] || routerIps[ip2] || ifaceOf[ip2]) continue;
        pool.push({ ip: ip2, comment });
      }
    }
    items = pool.slice(0, 60).map(({ ip: ip2, comment }) => ({
      label: ip2 + (comment ? '  — ' + comment.slice(0, 24) : ''),
      action: () => { assignGuest(ip2, ip); closeAddrDropdown(); renderOrganizedView(); scheduleSave(); }
    }));
  } else if (mode === 'assign-to-router') {
    items = Object.keys(routerIps).map(r => ({
      label: r + (commentForIp(r) ? '  — ' + commentForIp(r).slice(0, 24) : ''),
      action: () => { assignInterface(ip, r); closeAddrDropdown(); renderOrganizedView(); scheduleSave(); }
    }));
  } else if (mode === 'add-interface') {
    const pool = [];
    for (const subnet of state.subnets) {
      for (const [ip2, comment] of Object.entries(subnet.comments)) {
        if (!comment || !comment.trim()) continue;
        if (ip2 === ip || hvIps[ip2] || guestOf[ip2] || routerIps[ip2] || ifaceOf[ip2]) continue;
        pool.push({ ip: ip2, comment });
      }
    }
    items = pool.slice(0, 60).map(({ ip: ip2, comment }) => ({
      label: ip2 + (comment ? '  — ' + comment.slice(0, 24) : ''),
      action: () => { assignInterface(ip2, ip); closeAddrDropdown(); renderOrganizedView(); scheduleSave(); }
    }));
  }
  const sub = document.createElement('div');
  sub.className = 'hv-sub-list';
  if (!items.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:8px 14px;color:var(--ink-faint);font-family:var(--mono);font-size:11px;';
    msg.textContent = mode === 'add-guest' ? 'No available addresses' : 'No hypervisors defined';
    sub.appendChild(msg);
  } else {
    items.forEach(({ label, action }) => {
      const btn = document.createElement('button');
      btn.className = 'addr-dropdown-item addr-dropdown-sub';
      btn.textContent = label;
      btn.addEventListener('click', action);
      sub.appendChild(btn);
    });
  }
  dropdown.appendChild(sub);
  requestAnimationFrame(() => {
    const rect = dropdown.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 8)
      dropdown.style.top = Math.max(8, parseInt(dropdown.style.top) - (rect.bottom - window.innerHeight + 8)) + 'px';
  });
}

function renderEnumPlan(sn, readOnly) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.flex = '1';
  wrap.style.minHeight = '0';

  const filter = document.createElement('div');
  filter.className = 'plan-filter';
  filter.innerHTML = `
    <input type="text" id="pf-text" placeholder="filter addresses or notes within this subnet…" value="${esc(planFilter.text)}" />
    <label class="check">
      <input type="checkbox" id="pf-anno" ${planFilter.onlyAnno ? 'checked' : ''} />
      <span class="box"></span><span class="lbl-text">only annotated</span>
    </label>`;
  wrap.appendChild(filter);

  const q = planFilter.text.trim().toLowerCase();
  let indices = null;
  if (q || planFilter.onlyAnno) {
    indices = [];
    for (let i = 0; i < sn.total; i++) {
      const ip = intToIpv4((sn.networkInt + i) >>> 0);
      const note = sn.comments[ip] || '';
      if (planFilter.onlyAnno && !note.trim()) continue;
      if (q && !(ip.includes(q) || note.toLowerCase().includes(q))) continue;
      indices.push(i);
    }
  }
  const count = indices ? indices.length : sn.total;

  if (count === 0) {
    const head = thead();
    wrap.appendChild(head);
    const empty = document.createElement('div');
    empty.className = 'plan-empty';
    empty.style.borderTop = '0';
    empty.style.borderRadius = '0 0 3px 3px';
    empty.textContent = 'no addresses match this filter';
    wrap.appendChild(empty);
    planRegion.appendChild(wrap);
    wireFilter(sn);
    return;
  }

  wrap.appendChild(thead());

  const scroll = document.createElement('div');
  scroll.className = 'plan-scroll';
  const sizer = document.createElement('div');
  sizer.className = 'plan-sizer';
  const rowH = 36;
  sizer.style.height = (count * rowH) + 'px';
  scroll.appendChild(sizer);
  wrap.appendChild(scroll);
  planRegion.appendChild(wrap);

  if (!readOnly) scroll.addEventListener('input', e => {
    if (e.target.classList.contains('a-cm')) {
      const ip = e.target.dataset.ip;
      setComment(sn, ip, e.target.value);
      e.target.classList.toggle('has', !!e.target.value.trim());
      scheduleSave();
      rebuildSearchIndex();
    }
  });

  scroll.addEventListener('click', e => {
    const keyBtn = e.target.closest('.addr-key-btn');
    if (keyBtn) {
      e.stopPropagation();
      const kip = keyBtn.dataset.keyIp;
      const rect = keyBtn.getBoundingClientRect();
      openPasswordMenu(kip, rect.left, rect.bottom + 4);
      return;
    }

    const menuBtn = e.target.closest('.addr-menu-btn');
    if (menuBtn) {
      e.stopPropagation();
      const mip = menuBtn.dataset.menuIp;
      const rect = menuBtn.getBoundingClientRect();
      showAddrMenu(mip, rect.left, rect.bottom + 4);
      return;
    }
    const tag = e.target.closest('.t.host, .t.arp-up, .t.arp-down, .t.arp-pending, .t.arp-up-manual, .t.arp-down-manual');
    if (!tag) return;
    const row = tag.closest('.addr-row');
    if (!row || !row.dataset.ip) return;
    triggerSingleArp(row.dataset.ip, sn);
  });

  let lastStart = -1, lastEnd = -1;
  function draw(force) {
    const scrollTop = scroll.scrollTop;
    const vh = scroll.clientHeight || 400;
    const over = 6;
    let start = Math.max(0, Math.floor(scrollTop / rowH) - over);
    let end = Math.min(count, Math.ceil((scrollTop + vh) / rowH) + over);
    if (!force && start === lastStart && end === lastEnd) return;
    lastStart = start; lastEnd = end;

    let html = '';
    for (let r = start; r < end; r++) {
      const i = indices ? indices[r] : r;
      const int = (sn.networkInt + i) >>> 0;
      const ip = intToIpv4(int);
      const role = roleOf(sn, int);
      const note = sn.comments[ip] || '';
      const dim = (role === 'net' || role === 'bcast') ? ' dim' : '';
      const isHost = role === 'host';
      const actionButtons = isHost ? `
          <div class="addr-actions">
            ${canUsePasswordManager() ? `<button class="addr-key-btn" data-key-ip="${esc(ip)}" title="Password manager" aria-label="Password manager"><img class="icon-svg" src="/icons/key-black-icon.svg" alt="" /></button>` : ''}
            <button class="addr-menu-btn" data-menu-ip="${esc(ip)}" title="Address options">&#8942;</button>
          </div>` : '';
      html += `
        <div class="addr-row" style="top:${r * rowH}px" data-ip="${ip}">
          <div class="a-tag"><span class="t role-tag ${tagClass(role, ip)}">${roleLabel(role)}</span></div>
          <div class="a-ip${dim}">${ip}</div>
          <input class="a-cm${note.trim() ? ' has' : ''}" type="text" data-ip="${ip}"
                 value="${esc(note)}" placeholder="add a note…"${readOnly ? ' readonly' : ''} />
          ${actionButtons}
        </div>`;
    }
    sizer.innerHTML = html;

    if (pendingScrollIp) {
      const target = sizer.querySelector('.addr-row[data-ip="' + cssEsc(pendingScrollIp) + '"]');
      if (target) {
        target.classList.add('flash');
        pendingScrollIp = null;
      }
    }
  }

  scroll.addEventListener('scroll', () => requestAnimationFrame(() => draw(false)));

  if (pendingScrollIp) {
    const tInt = ipv4ToInt(pendingScrollIp);
    if (tInt !== null && tInt >= sn.networkInt && tInt <= sn.broadcastInt) {
      let r;
      if (indices) { r = indices.indexOf(tInt - sn.networkInt); }
      else { r = tInt - sn.networkInt; }
      if (r >= 0) {
        requestAnimationFrame(() => {
          scroll.scrollTop = Math.max(0, r * rowH - (scroll.clientHeight / 2) + rowH);
          draw(true);
        });
      } else { draw(true); }
    } else { pendingScrollIp = null; draw(true); }
  } else {
    draw(true);
  }

  wireFilter(sn);
}

function thead() {
  const h = document.createElement('div');
  h.className = 'plan-thead';
  h.innerHTML = `<div class="th-tag">role</div><div class="th-ip">address</div><div class="th-cm">comment</div>`;
  return h;
}

function wireFilter(sn) {
  const tx = document.getElementById('pf-text');
  const an = document.getElementById('pf-anno');
  if (tx) tx.addEventListener('input', () => {
    planFilter.text = tx.value;
    const pos = tx.selectionStart;
    renderPlan();
    const nt = document.getElementById('pf-text');
    if (nt) { nt.focus(); try { nt.setSelectionRange(pos, pos); } catch(e){} }
  });
  if (an) an.addEventListener('change', () => { planFilter.onlyAnno = an.checked; renderPlan(); });
}

function renderRegistryPlan(sn, readOnly) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex'; wrap.style.flexDirection = 'column'; wrap.style.flex = '1'; wrap.style.minHeight = '0';

  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.textContent = sn.version === 6
    ? 'IPv6 block — too large to enumerate. Add the specific addresses you want to track below.'
    : 'Block larger than /16 — too large to enumerate. Add specific addresses to track below.';
  wrap.appendChild(notice);

  wrap.appendChild(thead());

  const scroll = document.createElement('div');
  scroll.className = 'plan-scroll';
  const ips = Object.keys(sn.comments).sort(sortIps(sn.version));

  const q = planFilter.text.trim().toLowerCase();
  const filtered = ips.filter(ip => {
    if (planFilter.onlyAnno && !(sn.comments[ip] || '').trim()) return false;
    if (q && !(ip.toLowerCase().includes(q) || (sn.comments[ip]||'').toLowerCase().includes(q))) return false;
    return true;
  });

  let rows = '';
  filtered.forEach(ip => {
    const note = sn.comments[ip] || '';
    rows += `
      <div class="addr-row reg" data-ip="${esc(ip)}">
        <div class="a-tag"><span class="t role-tag ${tagClass('host', ip)}">host</span></div>
        <div class="a-ip">${esc(ip)}</div>
        <input class="a-cm${note.trim() ? ' has' : ''}" type="text" data-ip="${esc(ip)}" value="${esc(note)}" placeholder="add a note…"${readOnly ? ' readonly' : ''} />
        <div class="addr-actions">
          ${canUsePasswordManager() ? `<button class="addr-key-btn" data-key-ip="${esc(ip)}" title="Password manager" aria-label="Password manager"><img class="icon-svg" src="/icons/key-black-icon.svg" alt="" /></button>` : ''}
          <button class="addr-menu-btn" data-menu-ip="${esc(ip)}" title="Address options">&#8942;</button>
        </div>
        ${!readOnly ? `<button class="danger a-del" data-del="${esc(ip)}">&times;</button>` : ''}
      </div>`;
  });
  if (!filtered.length) {
    rows = `<div style="padding:24px;text-align:center;color:var(--ink-faint);font-family:var(--mono);font-size:12px">no tracked addresses yet</div>`;
  }
  scroll.innerHTML = rows;

  if (!readOnly) {
    const add = document.createElement('div');
    add.className = 'reg-add';
    add.innerHTML = `
      <input type="text" id="reg-ip" placeholder="${sn.version === 6 ? '2001:db8::10' : '10.5.0.42'}" />
      <button id="reg-add-btn" class="primary">+ track address</button>`;
    scroll.appendChild(add);
  }
  wrap.appendChild(scroll);
  planRegion.appendChild(wrap);

  if (!readOnly) scroll.addEventListener('input', e => {
    if (e.target.classList.contains('a-cm')) {
      setComment(sn, e.target.dataset.ip, e.target.value);
      e.target.classList.toggle('has', !!e.target.value.trim());
      scheduleSave(); rebuildSearchIndex();
    }
  });
  scroll.addEventListener('click', e => {
    const keyBtn = e.target.closest('.addr-key-btn');
    if (keyBtn) {
      const rect = keyBtn.getBoundingClientRect();
      openPasswordMenu(keyBtn.dataset.keyIp, rect.left, rect.bottom + 4);
      return;
    }
    const menuBtn = e.target.closest('.addr-menu-btn');
    if (menuBtn) {
      const rect = menuBtn.getBoundingClientRect();
      showAddrMenu(menuBtn.dataset.menuIp, rect.left, rect.bottom + 4);
      return;
    }
    if (!readOnly && e.target.dataset.del) {
      delete sn.comments[e.target.dataset.del];
      renderPlan(); renderSubnetList(); scheduleSave(); rebuildSearchIndex();
      return;
    }
    const tag = e.target.closest('.t.host, .t.arp-up, .t.arp-down, .t.arp-pending, .t.arp-up-manual, .t.arp-down-manual');
    if (tag) {
      const row = tag.closest('.addr-row');
      if (row && row.dataset.ip) triggerSingleArp(row.dataset.ip, sn);
    }
  });

  if (!readOnly) {
    const regIp = document.getElementById('reg-ip');
    const addAddr = () => {
      const val = regIp.value.trim();
      if (!val) return;
      let ok = false, norm = val;
      if (sn.version === 6) {
        const b = ipv6ToBig(val);
        if (b !== null) { ok = true; norm = bigToIpv6(b); }
      } else {
        const v = ipv4ToInt(val);
        if (v !== null && v >= sn.networkInt && v <= sn.broadcastInt) { ok = true; norm = intToIpv4(v); }
      }
      if (!ok) { regIp.style.borderColor = 'var(--danger)'; return; }
      if (!(norm in sn.comments)) sn.comments[norm] = '';
      planFilter.text = ''; planFilter.onlyAnno = false;
      renderPlan(); renderSubnetList(); scheduleSave(); rebuildSearchIndex();
      requestAnimationFrame(() => {
        const inp = planRegion.querySelector('.a-cm[data-ip="' + cssEsc(norm) + '"]');
        if (inp) inp.focus();
      });
    };
    document.getElementById('reg-add-btn').addEventListener('click', addAddr);
    regIp.addEventListener('keydown', e => { if (e.key === 'Enter') addAddr(); });
    regIp.addEventListener('input', () => { regIp.style.borderColor = ''; });
  }
}

function sortIps(version) {
  if (version === 4) return (a, b) => (ipv4ToInt(a) - ipv4ToInt(b));
  return (a, b) => { const x = ipv6ToBig(a), y = ipv6ToBig(b); return x < y ? -1 : x > y ? 1 : 0; };
}

async function loadOtherPlans(currentUsername) {
  const r = await fetch('/api/admin/users');
  if (!r.ok) return;
  const users = await r.json();
  const others = users
    .filter(u => !u.isAdmin && u.username !== currentUsername)
    .map(u => u.username)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  if (!others.length) return;

  otherPlansData = await Promise.all(others.map(async u => {
    try {
      const r2 = await fetch('/api/admin/plans/' + encodeURIComponent(u));
      const plan = r2.ok ? await r2.json() : null;
      return {
        username: u,
        subnets: (plan && Array.isArray(plan.subnets)) ? plan.subnets : [],
        passwordManager: (plan && plan.passwordManager && typeof plan.passwordManager === 'object') ? plan.passwordManager : {}
      };
    } catch {
      return { username: u, subnets: [], passwordManager: {} };
    }
  }));

  const section = document.getElementById('other-plans-section');
  if (section) section.style.display = '';
  renderOtherPlansSection();
}

function renderOtherPlansSection() {
  const body = document.getElementById('other-plans-body');
  const toggle = document.getElementById('other-plans-toggle');
  if (!body) return;
  if (toggle) toggle.innerHTML = otherPlansSectionOpen ? '&#9650;' : '&#9660;';
  body.style.display = otherPlansSectionOpen ? '' : 'none';
  if (!otherPlansSectionOpen) return;

  body.innerHTML = '';
  for (const { username, subnets, passwordManager } of otherPlansData) {
    const group = document.createElement('div');
    group.className = 'other-user-group';
    const isExpanded = !!otherUserOpen[username];
    const isViewingThis = otherUserView && otherUserView.username === username;

    const hd = document.createElement('div');
    hd.className = 'other-user-hd' + (isViewingThis ? ' viewing' : '');
    hd.innerHTML = `
      <span class="other-user-name">${esc(username)}</span>
      <span class="other-user-count">${subnets.length} subnet${subnets.length !== 1 ? 's' : ''}</span>
      <span class="other-user-arrow">${isExpanded ? '&#9650;' : '&#9660;'}</span>`;
    hd.addEventListener('click', () => { otherUserOpen[username] = !isExpanded; renderOtherPlansSection(); });

    const list = document.createElement('div');
    list.className = 'other-user-list';
    list.style.display = isExpanded ? 'flex' : 'none';

    if (!subnets.length) {
      const em = document.createElement('div');
      em.className = 'other-user-empty';
      em.textContent = 'no subnets';
      list.appendChild(em);
    } else {
      subnets.forEach(sn => {
        const isSelected = isViewingThis && otherUserView.selectedId === sn.id;
        const card = document.createElement('div');
        card.className = 'other-subnet' + (isSelected ? ' selected' : '');
        let usable;
        if (sn.version === 4) {
          usable = (sn.prefix >= 31 ? (sn.prefix === 32 ? 1 : 2) : sn.total - 2).toLocaleString();
        } else {
          usable = '2^' + (128 - sn.prefix);
        }
        const n = Object.values(sn.comments || {}).filter(v => v && v.trim()).length;
        card.innerHTML = `
          <div class="subnet-body">
            <div class="subnet-main">
              <div class="subnet-label">${esc(sn.label)}</div>
              <div class="subnet-cidr">${esc(sn.cidr)}</div>
            </div>
            <div class="subnet-stats">
              <div><b>v${sn.version}</b> &middot; ${usable} usable</div>
              <div class="subnet-anno ${n ? '' : 'zero'}">&bull; ${n} note${n !== 1 ? 's' : ''}</div>
            </div>
          </div>`;
        card.addEventListener('click', e => {
          e.stopPropagation();
          otherUserView = { subnets, selectedId: sn.id, username, passwordManager: passwordManager || {}, readOnly: true };
          state.selectedId = null;
          renderSubnetList();
          renderPlan();
          renderOtherPlansSection();
        });
        list.appendChild(card);
      });
    }

    group.appendChild(hd);
    group.appendChild(list);
    body.appendChild(group);
  }
}

const _otherPlansHead = document.getElementById('other-plans-head');
if (_otherPlansHead) _otherPlansHead.addEventListener('click', () => {
  otherPlansSectionOpen = !otherPlansSectionOpen;
  renderOtherPlansSection();
});

const searchEl = document.getElementById('search');
const resultsEl = document.getElementById('results');
const searchStat = document.getElementById('search-stat');

let searchIndex = [];

function ipBelongsToSubnet(ip, sn) {
  if (sn.version === 4) {
    const v = ipv4ToInt(ip);
    return v !== null && v >= sn.networkInt && v <= sn.broadcastInt;
  }
  if (sn.version === 6) {
    const v = ipv6ToBig(ip);
    const net = BigInt(sn.networkBig || '0');
    if (v === null) return false;
    const prefix = Number(sn.prefix);
    if (!(prefix >= 0 && prefix <= 128)) return false;
    const mask = prefix === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << (128n - BigInt(prefix))) - 1n);
    return (v & mask) === net;
  }
  return false;
}

function findSubnetForIp(ip) {
  return state.subnets.find(sn => ipBelongsToSubnet(ip, sn)) || null;
}

function rebuildSearchIndex() {
  searchIndex = [];
  for (const sn of state.subnets) {
    for (const ip in sn.comments) {
      const note = (sn.comments[ip] || '').trim();
      if (note) searchIndex.push({ subnetId: sn.id, ip, note, tag: 'note' });
    }
  }

  if (canUsePasswordManager()) {
    for (const [ip, entries] of Object.entries(state.passwordManager || {})) {
      if (!Array.isArray(entries)) continue;
      const sn = findSubnetForIp(ip);
      if (!sn) continue;
      for (const entry of entries) {
        const description = String(entry?.description || '').trim();
        if (!description) continue;
        searchIndex.push({
          subnetId: sn.id,
          ip,
          note: description,
          tag: 'login'
        });
      }
    }
  }

  updateSearchStat();
  if (searchEl.value.trim()) runSearch(searchEl.value);
}

function updateSearchStat() {
  const subs = state.subnets.length;
  const indexed = searchIndex.length;
  searchStat.textContent = subs + ' subnet' + (subs === 1 ? '' : 's') + ' · ' + indexed + ' searchable entr' + (indexed === 1 ? 'y' : 'ies');
}

function runSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) { resultsEl.classList.remove('show'); resultsEl.innerHTML = ''; return; }

  const out = [];
  const seen = new Set();

  const v4 = ipv4ToInt(query.trim());
  for (const sn of state.subnets) {
    if (sn.version === 4 && v4 !== null && v4 >= sn.networkInt && v4 <= sn.broadcastInt) {
      const ip = intToIpv4(v4);
      const key = sn.id + '|' + ip;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ subnetId: sn.id, ip, note: sn.comments[ip] || '', tag: 'in range' });
      }
    }
  }

  for (const e of searchIndex) {
    const key = e.subnetId + '|' + e.ip;
    if (seen.has(key) && e.tag !== 'login') continue;
    if (e.ip.toLowerCase().includes(q) || e.note.toLowerCase().includes(q)) {
      if (e.tag !== 'login') seen.add(key);
      out.push({ subnetId: e.subnetId, ip: e.ip, note: e.note, tag: e.tag || 'note' });
    }
  }

  for (const sn of state.subnets) {
    if (sn.label.toLowerCase().includes(q) || sn.cidr.toLowerCase().includes(q)) {
      const key = 'sub|' + sn.id;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ subnetId: sn.id, ip: null, note: sn.label, tag: 'subnet', cidr: sn.cidr });
      }
    }
  }

  renderResults(out, q);
}

function renderResults(out, q) {
  if (!out.length) {
    resultsEl.innerHTML = `<div class="res-empty">no matches in your subnets</div>`;
    resultsEl.classList.add('show');
    return;
  }
  const shown = out.slice(0, 80);
  let html = `<div class="results-head">${out.length} match${out.length === 1 ? '' : 'es'}${out.length > 80 ? ' · showing 80' : ''}</div>`;
  shown.forEach((r, i) => {
    const sn = state.subnets.find(s => s.id === r.subnetId);
    const ipText = r.ip ? highlightMatch(r.ip, q) : '<span style="color:var(--net)">' + esc(r.cidr || '') + '</span>';
    const cm = r.note ? highlightMatch(r.note, q) : '<span style="color:var(--ink-faint);font-style:italic">— no note —</span>';
    html += `
      <div class="res" data-i="${i}" data-sub="${r.subnetId}" data-ip="${r.ip ? esc(r.ip) : ''}">
        <span class="res-ip">${ipText}</span>
        <span class="res-tag">${r.tag}</span>
        <span class="res-sub">${esc(sn ? sn.label : '')}</span>
        <span class="res-cm">${cm}</span>
      </div>`;
  });
  resultsEl.innerHTML = html;
  resultsEl.classList.add('show');

  resultsEl.querySelectorAll('.res').forEach(node => {
    node.addEventListener('click', () => {
      jumpTo(+node.dataset.sub, node.dataset.ip || null);
    });
  });
}

function jumpTo(subId, ip) {
  state.selectedId = subId;
  planFilter = { text: '', onlyAnno: false };
  pendingScrollIp = ip;
  renderSubnetList();
  renderPlan();
  resultsEl.classList.remove('show');
  document.querySelector('.subnet.selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

let searchActiveIdx = -1;
searchEl.addEventListener('input', () => { searchActiveIdx = -1; runSearch(searchEl.value); });
searchEl.addEventListener('keydown', e => {
  const items = [...resultsEl.querySelectorAll('.res')];
  if (e.key === 'ArrowDown') { e.preventDefault(); searchActiveIdx = Math.min(items.length - 1, searchActiveIdx + 1); paintActive(items); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); searchActiveIdx = Math.max(0, searchActiveIdx - 1); paintActive(items); }
  else if (e.key === 'Enter') {
    const pick = items[searchActiveIdx >= 0 ? searchActiveIdx : 0];
    if (pick) jumpTo(+pick.dataset.sub, pick.dataset.ip || null);
  } else if (e.key === 'Escape') { resultsEl.classList.remove('show'); }
});
function paintActive(items) {
  items.forEach((it, i) => it.classList.toggle('active', i === searchActiveIdx));
  items[searchActiveIdx]?.scrollIntoView({ block: 'nearest' });
}
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) resultsEl.classList.remove('show');
});
searchEl.addEventListener('focus', () => { if (searchEl.value.trim()) runSearch(searchEl.value); });

document.getElementById('btn-export').addEventListener('click', () => {
  downloadJson('ip-plan.json', {
    format: 'subnetplan',
    version: 1,
    subnets: state.subnets,
    hypervisors: state.hypervisors,
    guests: state.guests,
    routers: state.routers,
    routerInterfaces: state.routerInterfaces,
    passwordManager: state.passwordManager
  });
  showToast('plan exported');
});

document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-import').click());
document.getElementById('file-import').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d || !Array.isArray(d.subnets)) throw new Error('bad');
      state.subnets = d.subnets;
      state.hypervisors = d.hypervisors || {};
      state.guests = d.guests || {};
      state.routers = d.routers || {};
      state.routerInterfaces = d.routerInterfaces || {};
      state.passwordManager = d.passwordManager || {};
      nextId = state.subnets.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
      state.subnets.forEach((s, i) => { if (!s.id) s.id = nextId++; });
      state.selectedId = state.subnets[0]?.id || null;
      renderSubnetList(); renderPlan(); rebuildSearchIndex(); scheduleSave();
      showToast('plan imported');
    } catch (err) { showToast('invalid file'); }
    e.target.value = '';
  };
  reader.readAsText(file);
});

document.getElementById('btn-reset').addEventListener('click', async () => {
  const go = await confirmDialog('Reset everything', 'Remove all subnets and notes?\n\nThis cannot be undone.', 'Reset everything');
  if (!go) return;
  state.subnets = []; state.selectedId = null;
  state.hypervisors = {};
  state.guests = {};
  state.routers = {};
  state.routerInterfaces = {};
  state.passwordManager = {};
  searchEl.value = ''; resultsEl.classList.remove('show');
  renderSubnetList(); renderPlan(); rebuildSearchIndex(); scheduleSave();
});

const toastEl = document.getElementById('toast');
const showToast = createToastController(toastEl);

function confirmDialog(title, message, confirmLabel) {
  return openConfirmDialog(title, message, confirmLabel, {
    back: document.getElementById('modal-back'),
    title: document.getElementById('modal-title'),
    message: document.getElementById('modal-msg'),
    ok: document.getElementById('modal-ok'),
    cancel: document.getElementById('modal-cancel')
  });
}

// ── Left panel tab system ────────────────────────────────────────────────────
let currentLeftTab = 'subnets';

function switchLeftTab(tab) {
  currentLeftTab = tab;
  document.getElementById('tab-subnets').classList.toggle('active', tab === 'subnets');
  document.getElementById('tab-organized').classList.toggle('active', tab === 'organized');
  if (tab === 'organized') {
    planFacts.style.display = 'none';
    planCidr.textContent = '\u00b7 Organised view';
    renderOrganizedView();
  } else {
    planFacts.style.display = '';
    planCidr.textContent = '';
    renderPlan();
  }
}

document.getElementById('tab-subnets').addEventListener('click', () => switchLeftTab('subnets'));
document.getElementById('tab-organized').addEventListener('click', () => switchLeftTab('organized'));

function renderOrganizedView() {
  if (currentLeftTab !== 'organized') return;
  planRegion.innerHTML = '';

  // Collect all annotated IPs across all subnets
  const allAnnotated = [];
  for (const sn of state.subnets) {
    for (const [ip, comment] of Object.entries(sn.comments)) {
      if (comment && comment.trim()) allAnnotated.push({ ip, sn, comment });
    }
  }

  if (!allAnnotated.length) {
    planRegion.innerHTML = '<div class="plan-empty">&larr; Add notes to addresses in the subnet view to see them here.<br><span style="font-size:11px;color:var(--ink-faint)">Annotated addresses across all subnets will appear here.</span></div>';
    return;
  }

  // Sort by subnet order, then by IP
  allAnnotated.sort((a, b) => {
    const si = state.subnets.indexOf(a.sn);
    const sj = state.subnets.indexOf(b.sn);
    if (si !== sj) return si - sj;
    if (a.sn.version === 4) return ipv4ToInt(a.ip) - ipv4ToInt(b.ip);
    return a.ip.localeCompare(b.ip);
  });

  const ipList = allAnnotated.map(e => e.ip);
  const dispRows = buildDisplayRows(ipList);

  const head = document.createElement('div');
  head.className = 'org-head';
  head.textContent = allAnnotated.length + ' address' + (allAnnotated.length !== 1 ? 'es' : '') +
    ' across ' + state.subnets.length + ' subnet' + (state.subnets.length !== 1 ? 's' : '');
  planRegion.appendChild(head);

  const list = document.createElement('div');
  list.className = 'org-list';

  for (const dr of dispRows) {
    const entry = allAnnotated.find(e => e.ip === dr.ip);
    if (!entry) continue;
    const entryIp = entry.ip;
    const entrySn = entry.sn;
    const entryComment = entry.comment;

    const row = document.createElement('div');
    row.className = 'org-row' + 
      (dr.isGuest ? ' org-guest' : dr.isHypervisor ? ' org-hv' : '') +
      (dr.isInterface ? ' org-iface' : dr.isRouter ? ' org-router' : '');
    row.dataset.ip = entryIp;

    const badgesHtml = (dr.isHypervisor ? '<span class="t hv-badge">H</span>' : '') +
                       (dr.isGuest    ? '<span class="t guest-badge">G</span>' : '') +
                       (dr.isRouter   ? '<span class="t router-badge">R</span>' : '') +
                       (dr.isInterface ? '<span class="t iface-badge">I</span>' : '');

    row.innerHTML = `
      <div class="org-badges">${badgesHtml}</div>
      <span class="org-subnet-tag" title="${esc(entrySn.cidr)}">${esc(entrySn.label)}</span>
      <span class="org-ip">${esc(entryIp)}</span>
      <span class="org-comment">${esc(entryComment)}</span>
      ${canUsePasswordManager() ? `<button class="addr-key-btn" data-key-ip="${esc(entryIp)}" title="Password manager" aria-label="Password manager"><img class="icon-svg" src="/icons/key-black-icon.svg" alt="" /></button>` : ''}
      <button class="addr-menu-btn" data-menu-ip="${esc(entryIp)}" title="Address options">&#8942;</button>`;

    row.addEventListener('click', e => {
      const keyBtn = e.target.closest('.addr-key-btn');
      if (keyBtn) {
        e.stopPropagation();
        const rect = keyBtn.getBoundingClientRect();
        openPasswordMenu(entryIp, rect.left, rect.bottom + 4);
        return;
      }
      const btn = e.target.closest('.addr-menu-btn');
      if (btn) {
        e.stopPropagation();
        const rect = btn.getBoundingClientRect();
        showAddrMenu(entryIp, rect.left, rect.bottom + 4);
        return;
      }
      // Click on row: jump to address in subnet plan
      state.selectedId = entrySn.id;
      planFilter = { text: '', onlyAnno: false };
      pendingScrollIp = entryIp;
      switchLeftTab('subnets');
      renderSubnetList();
      document.querySelector('.subnet.selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    list.appendChild(row);
  }

  planRegion.appendChild(list);
}

// ─────────────────────────────────────────────────────────────────────────────

Promise.all([
  fetch('/api/config').then(r => r.ok ? r.json() : { hasPlanner: true, hasNetplan: true, skin: 'futuristic' }).catch(() => ({ hasPlanner: true, hasNetplan: true, skin: 'futuristic' })),
  fetch('/api/me').then(r => {
    if (!r.ok) { window.location.href = '/login'; return null; }
    return r.json();
  })
]).then(([cfg, data]) => {
  if (!data) return;
  const skin = sanitizeSkin(cfg.skin || 'futuristic');
  applyTheme(skin, preferredModeForSkin(skin));
  userCapabilities.passwordManagerEnabled = !!data.passwordManagerEnabled;
  const nav = document.getElementById('user-nav');
  nav.innerHTML = buildPlannerNavHtml(cfg, data, esc);

  const themeBtn = document.getElementById('btn-theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      uiTheme = toggleTheme(uiTheme);
    });
  }

  document.getElementById('btn-logout').addEventListener('click', async e => {
    e.preventDefault();
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  const missingNetplanBtn = document.getElementById('btn-netplan-missing');
  if (missingNetplanBtn) {
    missingNetplanBtn.addEventListener('click', e => {
      e.preventDefault();
      showToast('netplan-gen is not installed in this deployment');
    });
  }

  if (data.isAdmin) {
    loadOtherPlans(data.username);
  }

  renderPlan();
  if (currentLeftTab === 'organized') renderOrganizedView();
  rebuildSearchIndex();
}).catch(() => { window.location.href = '/login'; });

(async function boot() {
  const loaded = await loadState();
  if (!loaded) {
    const ex = parseCidr('192.168.1.0/24');
    const sn = {
      id: nextId++, label: 'Example LAN', cidr: ex.cidr, version: 4, prefix: ex.prefix,
      networkInt: ex.networkInt, broadcastInt: ex.broadcastInt, total: ex.total, maskStr: ex.maskStr,
      comments: { '192.168.1.1': 'gateway / router', '192.168.1.10': 'NAS', '192.168.1.20': 'printer' }
    };
    state.subnets = [sn];
    state.selectedId = null;
  }
  renderSubnetList();
  renderPlan();
  rebuildSearchIndex();
})();

}

export {};
