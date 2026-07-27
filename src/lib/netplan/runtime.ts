import {
  type NetplanIface,
  type NetplanKind,
  type NetplanState,
  applyIfaceBinding,
  applyListBinding,
  applyRepeaterAction,
  createDefaultIface,
  generateYamlText,
  moveIfaceById,
  removeIfaceById,
  validateIfaces
} from '$lib/netplan/model';
import { buildNetplanNavHtml, type NetplanConfig, type NetplanMe } from '$lib/netplan/nav';
import { copyTextWithFallback, createToastController, downloadTextFile } from '$lib/netplan/ui';
import { buildYamlPreviewMarkup } from '$lib/netplan/yaml-view';
import { type Skin, applyTheme as applySharedTheme, bootSkinFromStorage, preferredModeForSkin, sanitizeSkin, toggleTheme } from '$lib/theme';

if (!window.__netplanGenBooted) {
  window.__netplanGenBooted = true;

const cachedBootSkin: Skin = bootSkinFromStorage();
let uiTheme = applySharedTheme(cachedBootSkin, preferredModeForSkin(cachedBootSkin));

function applyTheme(skin: Skin, mode: 'light' | 'dark') {
  uiTheme = applySharedTheme(skin, mode);
}

const state: NetplanState = {
  renderer: 'networkd',
  version: 2,

  ifaces: []
};

let nextId = 1;

function defaultIface(kind: NetplanKind) {
  return createDefaultIface(kind, nextId++, state.ifaces);
}

const ifaceListEl = document.getElementById('ifaces') as HTMLElement;
const emptyEl = document.getElementById('empty-state') as HTMLElement;

function render() {
  ifaceListEl.innerHTML = '';
  emptyEl.style.display = state.ifaces.length === 0 ? 'block' : 'none';

  state.ifaces.forEach((iface, idx) => {
    ifaceListEl.appendChild(renderIface(iface, idx));
  });

  generateYaml();
}

function renderIface(iface: NetplanIface, idx: number) {
  const el = document.createElement('div');
  el.className = 'iface';
  el.dataset.id = iface.id;

  const kindLabel = {
    ethernets: 'ethernet',
    wifis: 'wi-fi',
    bridges: 'bridge',
    bonds: 'bond',
    vlans: 'vlan'
  }[iface.kind];

  const head = document.createElement('div');
  head.className = 'iface-head';
  head.innerHTML = `
    <span class="iface-idx">#${String(idx + 1).padStart(2, '0')}</span>
    <span class="iface-type">${kindLabel}</span>
    <input class="iface-name-input" type="text" value="${esc(iface.name)}" placeholder="interface name" data-bind="name" />
    <div class="iface-actions">
      <button class="ghost icon-only" data-action="up" title="Move up" aria-label="Move up"><img class="action-icon" src="/icons/long-arrow-top-icon.svg" alt="" /></button>
      <button class="ghost icon-only" data-action="down" title="Move down" aria-label="Move down"><img class="action-icon" src="/icons/long-arrow-bottom-icon.svg" alt="" /></button>
      <button class="danger" data-action="remove">remove</button>
    </div>
  `;
  el.appendChild(head);

  const body = document.createElement('div');
  body.className = 'iface-body';
  body.innerHTML = renderIfaceBody(iface);
  el.appendChild(body);

  el.addEventListener('input', e => handleInput(iface, e));
  el.addEventListener('change', e => handleInput(iface, e));
  el.addEventListener('click', e => handleClick(iface, e));

  return el;
}

function renderIfaceBody(iface: NetplanIface) {
  let html = '';

  if (iface.kind === 'wifis') {
    html += `
      <div class="subgroup-title" style="margin-top:0">Access points</div>
      <div data-list="accessPoints" class="repeater">
        ${iface.accessPoints.map((ap, i) => `
          <div class="repeater-row">
            <input type="text" data-list-bind="ssid" data-i="${i}" placeholder="SSID" value="${esc(ap.ssid)}" />
            <input type="password" data-list-bind="password" data-i="${i}" placeholder="password (optional for open nets)" value="${esc(ap.password)}" />
            <button class="danger" data-action="remove-ap" data-i="${i}">×</button>
          </div>
        `).join('')}
        <button class="ghost repeater-add" data-action="add-ap"><img class="action-icon" src="/icons/plus-icon.svg" alt="" /> access point</button>
      </div>
    `;
  }

  if (iface.kind === 'bridges' || iface.kind === 'bonds') {
    html += `
      <label class="field">
        <span class="lbl">Member interfaces</span>
        <input type="text" data-bind="membersStr" value="${esc((iface.members || []).join(', '))}" placeholder="eth0, eth1" />
        <span class="hint">Comma-separated list of underlying interface names.</span>
      </label>
    `;
  }

  if (iface.kind === 'bonds') {
    html += `
      <div class="row">
        <label class="field">
          <span class="lbl">Bond mode</span>
          <select data-bind="bondMode">
            ${['balance-rr','active-backup','balance-xor','broadcast','802.3ad','balance-tlb','balance-alb']
              .map(m => `<option value="${m}" ${iface.bondMode === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="lbl">Primary slave</span>
          <input type="text" data-bind="primary" value="${esc(iface.primary)}" placeholder="eth0 (optional)" />
        </label>
      </div>
    `;
  }

  if (iface.kind === 'bridges') {
    html += `
      <div class="check-row">
        <label class="check">
          <input type="checkbox" data-bind="stp" ${iface.stp ? 'checked' : ''} />
          <span class="box"></span>
          <span class="lbl-text">Spanning Tree Protocol</span>
        </label>
      </div>
      <label class="field">
        <span class="lbl">Forward delay (s)</span>
        <input type="number" min="0" data-bind="forwardDelay" value="${esc(iface.forwardDelay)}" placeholder="leave empty for default" />
      </label>
    `;
  }

  if (iface.kind === 'vlans') {
    html += `
      <div class="row">
        <label class="field">
          <span class="lbl">VLAN ID <span class="required">*</span></span>
          <input type="number" min="1" max="4094" data-bind="vlanId" value="${esc(iface.vlanId)}" placeholder="e.g. 10" />
        </label>
        <label class="field">
          <span class="lbl">Parent link <span class="required">*</span></span>
          <input type="text" data-bind="link" value="${esc(iface.link)}" placeholder="e.g. eth0" />
        </label>
      </div>
    `;
  }

  html += `
    <div class="check-row">
      <label class="check">
        <input type="checkbox" data-bind="dhcp4" ${iface.dhcp4 ? 'checked' : ''} />
        <span class="box"></span>
        <span class="lbl-text">DHCP IPv4</span>
      </label>
      <label class="check">
        <input type="checkbox" data-bind="dhcp6" ${iface.dhcp6 ? 'checked' : ''} />
        <span class="box"></span>
        <span class="lbl-text">DHCP IPv6</span>
      </label>
      <label class="check">
        <input type="checkbox" data-bind="optional" ${iface.optional ? 'checked' : ''} />
        <span class="box"></span>
        <span class="lbl-text">Optional (don't block boot)</span>
      </label>
    </div>
  `;

  const dhcpOn = iface.dhcp4 || iface.dhcp6;
  const lockedAttr = dhcpOn ? 'disabled' : '';
  const lockedClass = dhcpOn ? ' dhcp-locked' : '';
  let dhcpNote = '';
  if (dhcpOn) {
    const which = (iface.dhcp4 && iface.dhcp6) ? 'DHCPv4 and DHCPv6'
                : iface.dhcp4 ? 'DHCPv4' : 'DHCPv6';
    dhcpNote = `
      <div class="dhcp-note">
        <b>${which}</b> is enabled — address, gateway, and nameservers are provided by the DHCP server.
        Turn DHCP off to set them by hand.
      </div>
    `;
  }

  html += `
    <div class="subgroup${lockedClass}">
      <div class="subgroup-title">Static addresses</div>
      ${dhcpNote}
      <div data-list="addresses" class="repeater">
        ${(iface.addresses || []).map((a, i) => `
          <div class="repeater-row">
            <input type="text" data-list-bind="value" data-i="${i}" value="${esc(a)}" placeholder="192.168.1.10/24  or  2001:db8::1/64" ${lockedAttr} />
            <button class="danger" data-action="remove-addr" data-i="${i}" ${lockedAttr}>×</button>
          </div>
        `).join('')}
        <button class="ghost repeater-add" data-action="add-addr" ${lockedAttr}><img class="action-icon" src="/icons/plus-icon.svg" alt="" /> address</button>
      </div>
    </div>
  `;

  html += `
    <div class="subgroup${lockedClass}">
      <div class="subgroup-title">Routing &amp; DNS</div>
      <label class="field">
        <span class="lbl">Default gateway</span>
        <input type="text" data-bind="gateway" value="${esc(iface.gateway)}" placeholder="192.168.1.1" ${lockedAttr} />
        <span class="hint">Generates a default route via this address.</span>
      </label>
      <div class="row">
        <label class="field">
          <span class="lbl">Nameservers</span>
          <input type="text" data-bind="nameserversStr" value="${esc((iface.nameservers || []).join(', '))}" placeholder="1.1.1.1, 8.8.8.8" ${lockedAttr} />
        </label>
        <label class="field">
          <span class="lbl">Search domains</span>
          <input type="text" data-bind="searchStr" value="${esc((iface.search || []).join(', '))}" placeholder="lan, example.com" ${lockedAttr} />
        </label>
      </div>
    </div>
  `;

  html += `
    <div class="subgroup">
      <div class="subgroup-title">Custom routes</div>
      <div data-list="routes" class="repeater">
        ${(iface.routes || []).map((r, i) => `
          <div class="repeater-row">
            <input type="text" data-list-bind="to" data-i="${i}" value="${esc(r.to)}" placeholder="destination (10.0.0.0/8 or 'default')" style="flex:2" />
            <input type="text" data-list-bind="via" data-i="${i}" value="${esc(r.via)}" placeholder="via" style="flex:2" />
            <input type="number" data-list-bind="metric" data-i="${i}" value="${esc(r.metric)}" placeholder="metric" style="flex:1" />
            <button class="danger" data-action="remove-route" data-i="${i}">×</button>
          </div>
        `).join('')}
        <button class="ghost repeater-add" data-action="add-route"><img class="action-icon" src="/icons/plus-icon.svg" alt="" /> route</button>
      </div>
    </div>
  `;

  html += `
    <div class="subgroup">
      <div class="subgroup-title">Advanced</div>
      <div class="row">
        <label class="field">
          <span class="lbl">MTU</span>
          <input type="number" min="68" max="9216" data-bind="mtu" value="${esc(iface.mtu)}" placeholder="1500" />
        </label>
        <label class="field">
          <span class="lbl">MAC address override</span>
          <input type="text" data-bind="macaddress" value="${esc(iface.macaddress)}" placeholder="aa:bb:cc:dd:ee:ff" />
        </label>
      </div>
    </div>
  `;

  return html;
}

function handleInput(iface: NetplanIface, e: Event) {
  const t = e.target;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;

  const bind = t.dataset.bind;
  if (bind) {
    let v: string | boolean;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.type === 'number') v = t.value === '' ? '' : t.value;
    else v = t.value;

    applyIfaceBinding(iface, bind, v);

    if (bind === 'dhcp4' || bind === 'dhcp6') {
      render();
    } else {
      generateYaml();
    }
    return;
  }

  const lb = t.dataset.listBind;
  if (lb) {
    const i = parseInt(t.dataset.i, 10);
    const listEl = t.closest('[data-list]') as HTMLElement | null;
    if (!listEl) return;
    const list = listEl.dataset.list;
    if (!list) return;
    applyListBinding(iface, list, i, lb, t.value);
    generateYaml();
  }
}

function handleClick(iface: NetplanIface, e: Event) {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  if (!action) return;
  e.preventDefault();
  const i = parseInt(actionEl.dataset.i, 10);

  switch (action) {
    case 'remove':
      state.ifaces = removeIfaceById(state.ifaces, iface.id);
      render();
      break;
    case 'up':
      if (moveIfaceById(state.ifaces, iface.id, 'up')) render();
      break;
    case 'down':
      if (moveIfaceById(state.ifaces, iface.id, 'down')) render();
      break;
    default:
      if (applyRepeaterAction(iface, action, i)) render();
      break;
  }
}

document.querySelectorAll('[data-add]').forEach(btn => {
  btn.addEventListener('click', () => {
    const kind = btn.getAttribute('data-add') as NetplanKind | null;
    if (!kind) return;
    state.ifaces.push(defaultIface(kind));
    render();
  });
});

document.getElementById('renderer')?.addEventListener('change', e => {
  const target = e.target as HTMLSelectElement;
  state.renderer = e.target.value;
  generateYaml();
});

function generateYaml() {
  const errors = validate();
  showErrors(errors);
  renderYaml(generateYamlText(state));
}

function esc(s: unknown): string { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string)); }

function renderYaml(yamlText: string) {
  const yamlEl = document.getElementById('yaml');
  if (!yamlEl) return;
  yamlEl.innerHTML = buildYamlPreviewMarkup(yamlText);

  yamlEl.dataset.plain = yamlText;
}

function validate() {
  return validateIfaces(state.ifaces);
}

function showErrors(errs: string[]) {
  const box = document.getElementById('errors');
  const list = document.getElementById('errors-list');
  if (!box || !list) return;
  if (errs.length === 0) {
    box.classList.remove('show');
    list.innerHTML = '';
    return;
  }
  list.innerHTML = errs.map(e => `<li>${esc(e)}</li>`).join('');
  box.classList.add('show');
}

const yamlEl = document.getElementById('yaml') as HTMLElement;
const toast = document.getElementById('toast') as HTMLElement;
const showToast = createToastController(toast);

document.getElementById('btn-copy')?.addEventListener('click', async () => {
  const text = yamlEl.dataset.plain || '';
  const copied = await copyTextWithFallback(text);
  if (copied) {
    showToast('copied to clipboard');
  } else {
    showToast('copy failed');
  }
});

document.getElementById('btn-download')?.addEventListener('click', () => {
  const text = yamlEl.dataset.plain || '';
  downloadTextFile('01-netcfg.yaml', text, 'text/yaml');
  showToast('file downloaded');
});

document.getElementById('btn-reset')?.addEventListener('click', () => {
  if (!confirm('Reset all configuration?')) return;
  state.renderer = 'networkd';
  state.ifaces = [];
  const rendererEl = document.getElementById('renderer') as HTMLSelectElement | null;
  if (rendererEl) rendererEl.value = 'networkd';
  render();
});

state.ifaces.push(defaultIface('ethernets'));
render();

(async function initNav() {
  const [cfg, me] = await Promise.all([
    fetch('/api/config').then(r => r.json()).catch(() => ({} as NetplanConfig)),
    fetch('/api/me').then(r => r.ok ? r.json() as Promise<NetplanMe> : null).catch(() => null)
  ]);
  const skin = sanitizeSkin(cfg.skin || 'futuristic') as Skin;
  applyTheme(skin, preferredModeForSkin(skin));
  const nav = document.getElementById('user-nav');
  if (!nav) return;
  nav.innerHTML = buildNetplanNavHtml(cfg, me, esc);

  const themeBtn = document.getElementById('btn-theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      uiTheme = toggleTheme(uiTheme);
    });
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async e => {
      e.preventDefault();
      await fetch('/api/logout', { method: 'POST' });
      window.location.reload();
    });
  }

  const missingPlannerBtn = document.getElementById('btn-planner-missing');
  if (missingPlannerBtn) {
    missingPlannerBtn.addEventListener('click', e => {
      e.preventDefault();
      showToast('ip-planner is not installed in this deployment');
    });
  }
})();
}

export {};
