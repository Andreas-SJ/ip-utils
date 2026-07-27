
const uiTheme = { skin: 'futuristic', mode: 'dark' };

function sanitizeSkin(v) {
  return (v === 'enterprise' || v === 'futuristic') ? v : 'futuristic';
}

function sanitizeMode(v) {
  return (v === 'light' || v === 'dark') ? v : 'dark';
}

function modeStorageKey(skin) {
  return 'iputils-theme-mode-' + sanitizeSkin(skin);
}

function preferredModeForSkin(skin) {
  const normalized = sanitizeSkin(skin);
  try {
    const fallback = normalized === 'enterprise' ? 'light' : 'dark';
    return sanitizeMode(localStorage.getItem(modeStorageKey(normalized)) || fallback);
  } catch {
    return normalized === 'enterprise' ? 'light' : 'dark';
  }
}

function setThemeIcon() {
  const icon = document.getElementById('theme-toggle-icon');
  if (!icon) return;
  icon.src = uiTheme.mode === 'dark' ? '/icons/day-sunny-icon.svg' : '/icons/moon-line-icon.svg';
}

function applyTheme(skin, mode) {
  uiTheme.skin = sanitizeSkin(skin);
  uiTheme.mode = sanitizeMode(mode);
  if (window.IpUtilsSkinLoader) {
    const applied = window.IpUtilsSkinLoader.applySkinAndMode(uiTheme.skin, uiTheme.mode);
    uiTheme.skin = applied.skin;
    uiTheme.mode = applied.mode;
    return;
  }
  const body = document.body;
  body.classList.remove('skin-futuristic', 'skin-enterprise', 'mode-dark', 'mode-light');
  body.classList.add('skin-' + uiTheme.skin, 'mode-' + uiTheme.mode);
  setThemeIcon();
}

const cachedBootSkin = (() => {
  try {
    return sanitizeSkin(localStorage.getItem('iputils-global-skin') || 'futuristic');
  } catch {
    return 'futuristic';
  }
})();
applyTheme(cachedBootSkin, preferredModeForSkin(cachedBootSkin));

const state = {
  renderer: 'networkd',
  version: 2,

  ifaces: []
};

let nextId = 1;

function defaultIface(kind) {
  const base = {
    id: nextId++,
    kind,
    name: '',
    dhcp4: false,
    dhcp6: false,
    addresses: [],
    gateway: '',
    nameservers: [],
    search: [],
    routes: [],
    mtu: '',
    macaddress: '',
    optional: false
  };
  if (kind === 'ethernets') {
    base.name = suggestName('eth');
    base.dhcp4 = true;
  } else if (kind === 'wifis') {
    base.name = suggestName('wlan');
    base.dhcp4 = true;
    base.accessPoints = [{ ssid: '', password: '' }];
  } else if (kind === 'bridges') {
    base.name = suggestName('br');
    base.members = [];
    base.stp = true;
    base.forwardDelay = '';
  } else if (kind === 'bonds') {
    base.name = suggestName('bond');
    base.members = [];
    base.bondMode = 'active-backup';
    base.primary = '';
  } else if (kind === 'vlans') {
    base.name = suggestName('vlan');
    base.vlanId = '';
    base.link = '';
  }
  return base;
}

function suggestName(prefix) {
  const used = new Set(state.ifaces.map(i => i.name));
  let n = 0;
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

const ifaceListEl = document.getElementById('ifaces');
const emptyEl = document.getElementById('empty-state');

function render() {
  ifaceListEl.innerHTML = '';
  emptyEl.style.display = state.ifaces.length === 0 ? 'block' : 'none';

  state.ifaces.forEach((iface, idx) => {
    ifaceListEl.appendChild(renderIface(iface, idx));
  });

  generateYaml();
}

function renderIface(iface, idx) {
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

function renderIfaceBody(iface) {
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

function handleInput(iface, e) {
  const t = e.target;

  const bind = t.dataset.bind;
  if (bind) {
    let v;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.type === 'number') v = t.value === '' ? '' : t.value;
    else v = t.value;

    if (bind === 'membersStr') {
      iface.members = splitList(v);
    } else if (bind === 'nameserversStr') {
      iface.nameservers = splitList(v);
    } else if (bind === 'searchStr') {
      iface.search = splitList(v);
    } else {
      iface[bind] = v;
    }

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
    const list = t.closest('[data-list]').dataset.list;
    if (list === 'addresses') {
      iface.addresses[i] = t.value;
    } else if (list === 'accessPoints') {
      iface.accessPoints[i][lb] = t.value;
    } else if (list === 'routes') {
      iface.routes[i][lb] = t.value;
    }
    generateYaml();
  }
}

function handleClick(iface, e) {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  e.preventDefault();
  const i = parseInt(actionEl.dataset.i, 10);

  switch (action) {
    case 'remove':
      state.ifaces = state.ifaces.filter(x => x.id !== iface.id);
      render();
      break;
    case 'up': {
      const idx = state.ifaces.findIndex(x => x.id === iface.id);
      if (idx > 0) {
        [state.ifaces[idx-1], state.ifaces[idx]] = [state.ifaces[idx], state.ifaces[idx-1]];
        render();
      }
      break;
    }
    case 'down': {
      const idx = state.ifaces.findIndex(x => x.id === iface.id);
      if (idx < state.ifaces.length - 1) {
        [state.ifaces[idx+1], state.ifaces[idx]] = [state.ifaces[idx], state.ifaces[idx+1]];
        render();
      }
      break;
    }
    case 'add-addr':
      iface.addresses.push('');
      render();
      break;
    case 'remove-addr':
      iface.addresses.splice(i, 1);
      render();
      break;
    case 'add-ap':
      iface.accessPoints.push({ ssid: '', password: '' });
      render();
      break;
    case 'remove-ap':
      iface.accessPoints.splice(i, 1);
      render();
      break;
    case 'add-route':
      iface.routes.push({ to: '', via: '', metric: '' });
      render();
      break;
    case 'remove-route':
      iface.routes.splice(i, 1);
      render();
      break;
  }
}

document.querySelectorAll('[data-add]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.ifaces.push(defaultIface(btn.dataset.add));
    render();
  });
});

document.getElementById('renderer').addEventListener('change', e => {
  state.renderer = e.target.value;
  generateYaml();
});

function generateYaml() {
  const errors = validate();
  showErrors(errors);

  const lines = [];
  const indent = (n) => '  '.repeat(n);

  lines.push(['network:', null]);
  lines.push([indent(1) + 'version: ' + state.version, null]);
  lines.push([indent(1) + 'renderer: ' + state.renderer, null]);

  const kinds = ['ethernets', 'wifis', 'bridges', 'bonds', 'vlans'];
  for (const kind of kinds) {
    const list = state.ifaces.filter(i => i.kind === kind && i.name.trim());
    if (list.length === 0) continue;

    lines.push([indent(1) + kind + ':', null]);
    for (const iface of list) {
      emitIface(lines, iface, 2);
    }
  }

  renderYaml(lines.map(l => l[0]).join('\n'));
}

function emitIface(lines, iface, lvl) {
  const I = (n) => '  '.repeat(n);
  lines.push([I(lvl) + qkey(iface.name) + ':', null]);
  const L = lvl + 1;

  if (iface.kind === 'wifis') {
    const aps = (iface.accessPoints || []).filter(a => a.ssid.trim());
    if (aps.length) {
      lines.push([I(L) + 'access-points:', null]);
      for (const ap of aps) {
        lines.push([I(L+1) + qstr(ap.ssid) + ':', null]);
        if (ap.password) {
          lines.push([I(L+2) + 'password: ' + qstr(ap.password), null]);
        }
      }
    }
  }

  if ((iface.kind === 'bridges' || iface.kind === 'bonds') && iface.members && iface.members.length) {
    lines.push([I(L) + 'interfaces: ' + arrInline(iface.members), null]);
  }

  if (iface.kind === 'vlans') {
    if (iface.vlanId !== '' && iface.vlanId != null) lines.push([I(L) + 'id: ' + iface.vlanId, null]);
    if (iface.link) lines.push([I(L) + 'link: ' + iface.link, null]);
  }

  if (iface.dhcp4) lines.push([I(L) + 'dhcp4: true', null]);
  if (iface.dhcp6) lines.push([I(L) + 'dhcp6: true', null]);
  if (iface.optional) lines.push([I(L) + 'optional: true', null]);

  const dhcpProvided = iface.dhcp4 || iface.dhcp6;

  if (!dhcpProvided) {
    const addrs = (iface.addresses || []).filter(a => a.trim());
    if (addrs.length) {
      lines.push([I(L) + 'addresses:', null]);
      for (const a of addrs) lines.push([I(L+1) + '- ' + a.trim(), null]);
    }
  }

  const routes = [];
  if (!dhcpProvided && iface.gateway && iface.gateway.trim()) {
    routes.push({ to: 'default', via: iface.gateway.trim(), metric: '' });
  }
  for (const r of (iface.routes || [])) {
    if (r.to && r.via) routes.push({ to: r.to.trim(), via: r.via.trim(), metric: r.metric });
  }
  if (routes.length) {
    lines.push([I(L) + 'routes:', null]);
    for (const r of routes) {
      lines.push([I(L+1) + '- to: ' + (r.to === 'default' ? 'default' : r.to), null]);
      lines.push([I(L+2) + 'via: ' + r.via, null]);
      if (r.metric !== '' && r.metric != null) lines.push([I(L+2) + 'metric: ' + r.metric, null]);
    }
  }

  if (!dhcpProvided) {
    const ns = (iface.nameservers || []).filter(Boolean);
    const search = (iface.search || []).filter(Boolean);
    if (ns.length || search.length) {
      lines.push([I(L) + 'nameservers:', null]);
      if (search.length) lines.push([I(L+1) + 'search: ' + arrInline(search), null]);
      if (ns.length) lines.push([I(L+1) + 'addresses: ' + arrInline(ns), null]);
    }
  }

  if (iface.kind === 'bridges') {
    const params = [];
    if (iface.stp === false) params.push(['stp', 'false']);
    if (iface.forwardDelay !== '' && iface.forwardDelay != null) params.push(['forward-delay', iface.forwardDelay]);
    if (params.length) {
      lines.push([I(L) + 'parameters:', null]);
      for (const [k, v] of params) lines.push([I(L+1) + k + ': ' + v, null]);
    }
  }

  if (iface.kind === 'bonds') {
    lines.push([I(L) + 'parameters:', null]);
    lines.push([I(L+1) + 'mode: ' + iface.bondMode, null]);
    if (iface.primary) lines.push([I(L+1) + 'primary: ' + iface.primary, null]);
  }

  if (iface.mtu !== '' && iface.mtu != null) lines.push([I(L) + 'mtu: ' + iface.mtu, null]);
  if (iface.macaddress) lines.push([I(L) + 'macaddress: ' + iface.macaddress, null]);
}

function qkey(s) { return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) ? s : qstr(s); }
function qstr(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function arrInline(arr) { return '[' + arr.map(x => /[,\s:#]/.test(x) ? qstr(x) : x).join(', ') + ']'; }
function splitList(s) { return s.split(',').map(x => x.trim()).filter(Boolean); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderYaml(yamlText) {
  const yamlEl = document.getElementById('yaml');
  const lines = yamlText.split('\n');
  yamlEl.innerHTML = lines.map(line => {
    const safe = esc(line);
    const highlighted = highlightLine(safe);
    return '<span class="ln">' + (highlighted || '&nbsp;') + '</span>';
  }).join('');

  yamlEl.dataset.plain = yamlText;
}

function highlightLine(line) {
  if (/^\s*#/.test(line)) return '<span class="c">' + line + '</span>';

  let m = line.match(/^(\s*)(-\s+)(.*)$/);
  if (m) {
    return m[1] + '<span class="d">' + m[2] + '</span>' + highlightValue(m[3]);
  }

  m = line.match(/^(\s*)([^:]+?)(:\s*)(.*)$/);
  if (m) {
    return m[1] + '<span class="k">' + m[2] + '</span><span class="d">' + m[3] + '</span>' + highlightValue(m[4]);
  }
  return line;
}

function highlightValue(v) {
  if (v === '') return '';

  if (/^\[.*\]$/.test(v)) return '<span class="v">' + v + '</span>';
  if (/^&quot;.*&quot;$/.test(v)) return '<span class="s">' + v + '</span>';
  if (/^(true|false)$/.test(v)) return '<span class="b">' + v + '</span>';
  if (/^-?\d+(\.\d+)?$/.test(v)) return '<span class="n">' + v + '</span>';
  return '<span class="v">' + v + '</span>';
}

function validate() {
  const errs = [];
  const seen = new Set();

  for (const iface of state.ifaces) {
    if (!iface.name.trim()) {
      errs.push('An interface is missing a name.');
      continue;
    }
    if (seen.has(iface.name)) {
      errs.push(`Duplicate interface name: "${iface.name}"`);
    }
    seen.add(iface.name);

    const hasAddrs = (iface.addresses || []).some(a => a.trim());
    if (!iface.dhcp4 && !iface.dhcp6 && !hasAddrs && iface.kind !== 'vlans' && iface.kind !== 'bridges' && iface.kind !== 'bonds') {
    }

    if (!iface.dhcp4 && !iface.dhcp6) {
      for (const a of (iface.addresses || [])) {
        if (a.trim() && !/^[\da-fA-F:.]+\/\d{1,3}$/.test(a.trim())) {
          errs.push(`"${a}" doesn't look like an IP/prefix (e.g. 192.168.1.10/24).`);
        }
      }
    }

    if (iface.kind === 'vlans') {
      if (iface.vlanId === '' || iface.vlanId == null) errs.push(`VLAN "${iface.name}" needs an ID.`);
      if (!iface.link) errs.push(`VLAN "${iface.name}" needs a parent link.`);
    }
    if (iface.kind === 'wifis') {
      const okAp = (iface.accessPoints || []).some(a => a.ssid.trim());
      if (!okAp) errs.push(`Wi-Fi "${iface.name}" needs at least one access point with an SSID.`);
    }
    if ((iface.kind === 'bridges' || iface.kind === 'bonds') && (!iface.members || iface.members.length === 0)) {
      errs.push(`${iface.kind === 'bridges' ? 'Bridge' : 'Bond'} "${iface.name}" has no member interfaces.`);
    }
  }
  return errs;
}

function showErrors(errs) {
  const box = document.getElementById('errors');
  const list = document.getElementById('errors-list');
  if (errs.length === 0) {
    box.classList.remove('show');
    list.innerHTML = '';
    return;
  }
  list.innerHTML = errs.map(e => `<li>${esc(e)}</li>`).join('');
  box.classList.add('show');
}

const yamlEl = document.getElementById('yaml');
const toast = document.getElementById('toast');

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 1800);
}

document.getElementById('btn-copy').addEventListener('click', async () => {
  const text = yamlEl.dataset.plain || '';
  try {
    await navigator.clipboard.writeText(text);
    showToast('copied to clipboard');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('copied');
  }
});

document.getElementById('btn-download').addEventListener('click', () => {
  const text = yamlEl.dataset.plain || '';
  const blob = new Blob([text], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '01-netcfg.yaml';
  a.click();
  URL.revokeObjectURL(url);
  showToast('file downloaded');
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('Reset all configuration?')) return;
  state.renderer = 'networkd';
  state.ifaces = [];
  document.getElementById('renderer').value = 'networkd';
  render();
});

state.ifaces.push(defaultIface('ethernets'));
render();

(async function initNav() {
  const [cfg, me] = await Promise.all([
    fetch('/api/config').then(r => r.json()).catch(() => ({})),
    fetch('/api/me').then(r => r.ok ? r.json() : null).catch(() => null)
  ]);
  const skin = sanitizeSkin(cfg.skin || 'futuristic');
  applyTheme(skin, preferredModeForSkin(skin));
  const nav = document.getElementById('user-nav');
  let html = '';
  if (cfg.hasPlanner) {
    html += '<a href="/ip-planner">ip-planner</a>';
  } else {
    html += '<a href="#" id="btn-planner-missing" class="nav-disabled" aria-disabled="true">ip-planner</a>';
  }
  if (me) {
    if (html) html += ' &nbsp;&middot;&nbsp; ';
    html = '<span class="u-name">' + esc(me.username) + '</span> &nbsp;&middot;&nbsp; ' + html;
    if (me.isAdmin) html += ' &nbsp;&middot;&nbsp; <a href="/admin">admin</a>';
    html += ' &nbsp;&middot;&nbsp; <button id="btn-theme-toggle" class="theme-toggle" title="Toggle dark/light mode" aria-label="Toggle dark/light mode"><img id="theme-toggle-icon" class="theme-icon" src="/icons/day-sunny-icon.svg" alt="" /></button>';
    html += ' &nbsp;&middot;&nbsp; <a href="#" id="btn-logout">logout</a>';
  } else if (cfg.hasPlanner) {
    html += ' &nbsp;&middot;&nbsp; <button id="btn-theme-toggle" class="theme-toggle" title="Toggle dark/light mode" aria-label="Toggle dark/light mode"><img id="theme-toggle-icon" class="theme-icon" src="/icons/day-sunny-icon.svg" alt="" /></button>';
    html += ' &nbsp;&middot;&nbsp; <a href="/login">log in</a>';
  }
  nav.innerHTML = html;
  setThemeIcon();

  const themeBtn = document.getElementById('btn-theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const nextMode = uiTheme.mode === 'dark' ? 'light' : 'dark';
      applyTheme(uiTheme.skin, nextMode);
      try {
        localStorage.setItem(modeStorageKey(uiTheme.skin), nextMode);
      } catch {}
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