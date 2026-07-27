export type NetplanKind = 'ethernets' | 'wifis' | 'bridges' | 'bonds' | 'vlans';

export type AccessPoint = {
  ssid: string;
  password: string;
};

export type RouteEntry = {
  to: string;
  via: string;
  metric: string | number;
};

export type NetplanIface = {
  id: number;
  kind: NetplanKind;
  name: string;
  dhcp4: boolean;
  dhcp6: boolean;
  addresses: string[];
  gateway: string;
  nameservers: string[];
  search: string[];
  routes: RouteEntry[];
  mtu: string | number;
  macaddress: string;
  optional: boolean;
  accessPoints?: AccessPoint[];
  members?: string[];
  stp?: boolean;
  forwardDelay?: string | number;
  bondMode?: string;
  primary?: string;
  vlanId?: string | number;
  link?: string;
};

export type NetplanState = {
  renderer: string;
  version: number;
  ifaces: NetplanIface[];
};

function suggestName(prefix: string, ifaces: NetplanIface[]): string {
  const used = new Set(ifaces.map((i) => i.name));
  let n = 0;
  while (used.has(prefix + n)) n += 1;
  return prefix + n;
}

export function createDefaultIface(kind: NetplanKind, id: number, ifaces: NetplanIface[]): NetplanIface {
  const base: NetplanIface = {
    id,
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
    base.name = suggestName('eth', ifaces);
    base.dhcp4 = true;
  } else if (kind === 'wifis') {
    base.name = suggestName('wlan', ifaces);
    base.dhcp4 = true;
    base.accessPoints = [{ ssid: '', password: '' }];
  } else if (kind === 'bridges') {
    base.name = suggestName('br', ifaces);
    base.members = [];
    base.stp = true;
    base.forwardDelay = '';
  } else if (kind === 'bonds') {
    base.name = suggestName('bond', ifaces);
    base.members = [];
    base.bondMode = 'active-backup';
    base.primary = '';
  } else if (kind === 'vlans') {
    base.name = suggestName('vlan', ifaces);
    base.vlanId = '';
    base.link = '';
  }

  return base;
}

export function splitList(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function applyIfaceBinding(iface: NetplanIface, bind: string, value: unknown): void {
  if (bind === 'membersStr') {
    iface.members = splitList(String(value || ''));
    return;
  }

  if (bind === 'nameserversStr') {
    iface.nameservers = splitList(String(value || ''));
    return;
  }

  if (bind === 'searchStr') {
    iface.search = splitList(String(value || ''));
    return;
  }

  (iface as Record<string, unknown>)[bind] = value;
}

export function applyListBinding(iface: NetplanIface, list: string, index: number, key: string, value: string): void {
  if (list === 'addresses') {
    iface.addresses[index] = value;
    return;
  }

  if (list === 'accessPoints') {
    if (!iface.accessPoints) iface.accessPoints = [];
    if (!iface.accessPoints[index]) iface.accessPoints[index] = { ssid: '', password: '' };
    (iface.accessPoints[index] as Record<string, string>)[key] = value;
    return;
  }

  if (list === 'routes') {
    if (!iface.routes[index]) iface.routes[index] = { to: '', via: '', metric: '' };
    (iface.routes[index] as Record<string, string | number>)[key] = value;
  }
}

export function removeIfaceById(ifaces: NetplanIface[], id: number): NetplanIface[] {
  return ifaces.filter((item) => item.id !== id);
}

export function moveIfaceById(ifaces: NetplanIface[], id: number, direction: 'up' | 'down'): boolean {
  const idx = ifaces.findIndex((item) => item.id === id);
  if (idx < 0) return false;

  if (direction === 'up') {
    if (idx === 0) return false;
    [ifaces[idx - 1], ifaces[idx]] = [ifaces[idx], ifaces[idx - 1]];
    return true;
  }

  if (idx >= ifaces.length - 1) return false;
  [ifaces[idx + 1], ifaces[idx]] = [ifaces[idx], ifaces[idx + 1]];
  return true;
}

export function applyRepeaterAction(iface: NetplanIface, action: string, index: number): boolean {
  switch (action) {
    case 'add-addr':
      iface.addresses.push('');
      return true;
    case 'remove-addr':
      iface.addresses.splice(index, 1);
      return true;
    case 'add-ap':
      if (!iface.accessPoints) iface.accessPoints = [];
      iface.accessPoints.push({ ssid: '', password: '' });
      return true;
    case 'remove-ap':
      if (!iface.accessPoints) return false;
      iface.accessPoints.splice(index, 1);
      return true;
    case 'add-route':
      iface.routes.push({ to: '', via: '', metric: '' });
      return true;
    case 'remove-route':
      iface.routes.splice(index, 1);
      return true;
    default:
      return false;
  }
}

function qstr(s: string): string {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function qkey(s: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) ? s : qstr(s);
}

function arrInline(arr: string[]): string {
  return '[' + arr.map((x) => /[,\s:#]/.test(x) ? qstr(x) : x).join(', ') + ']';
}

function emitIface(lines: string[], iface: NetplanIface, lvl: number): void {
  const I = (n: number) => '  '.repeat(n);
  lines.push(I(lvl) + qkey(iface.name) + ':');
  const L = lvl + 1;

  if (iface.kind === 'wifis') {
    const aps = (iface.accessPoints || []).filter((a) => a.ssid.trim());
    if (aps.length) {
      lines.push(I(L) + 'access-points:');
      for (const ap of aps) {
        lines.push(I(L + 1) + qstr(ap.ssid) + ':');
        if (ap.password) lines.push(I(L + 2) + 'password: ' + qstr(ap.password));
      }
    }
  }

  if ((iface.kind === 'bridges' || iface.kind === 'bonds') && iface.members && iface.members.length) {
    lines.push(I(L) + 'interfaces: ' + arrInline(iface.members));
  }

  if (iface.kind === 'vlans') {
    if (iface.vlanId !== '' && iface.vlanId != null) lines.push(I(L) + 'id: ' + iface.vlanId);
    if (iface.link) lines.push(I(L) + 'link: ' + iface.link);
  }

  if (iface.dhcp4) lines.push(I(L) + 'dhcp4: true');
  if (iface.dhcp6) lines.push(I(L) + 'dhcp6: true');
  if (iface.optional) lines.push(I(L) + 'optional: true');

  const dhcpProvided = iface.dhcp4 || iface.dhcp6;

  if (!dhcpProvided) {
    const addrs = (iface.addresses || []).filter((a) => a.trim());
    if (addrs.length) {
      lines.push(I(L) + 'addresses:');
      for (const a of addrs) lines.push(I(L + 1) + '- ' + a.trim());
    }
  }

  const routes: RouteEntry[] = [];
  if (!dhcpProvided && iface.gateway && iface.gateway.trim()) {
    routes.push({ to: 'default', via: iface.gateway.trim(), metric: '' });
  }
  for (const r of (iface.routes || [])) {
    if (r.to && r.via) {
      routes.push({ to: r.to.trim(), via: r.via.trim(), metric: r.metric });
    }
  }

  if (routes.length) {
    lines.push(I(L) + 'routes:');
    for (const r of routes) {
      lines.push(I(L + 1) + '- to: ' + (r.to === 'default' ? 'default' : r.to));
      lines.push(I(L + 2) + 'via: ' + r.via);
      if (r.metric !== '' && r.metric != null) lines.push(I(L + 2) + 'metric: ' + r.metric);
    }
  }

  if (!dhcpProvided) {
    const ns = (iface.nameservers || []).filter(Boolean);
    const search = (iface.search || []).filter(Boolean);
    if (ns.length || search.length) {
      lines.push(I(L) + 'nameservers:');
      if (search.length) lines.push(I(L + 1) + 'search: ' + arrInline(search));
      if (ns.length) lines.push(I(L + 1) + 'addresses: ' + arrInline(ns));
    }
  }

  if (iface.kind === 'bridges') {
    const params: Array<[string, string | number]> = [];
    if (iface.stp === false) params.push(['stp', 'false']);
    if (iface.forwardDelay !== '' && iface.forwardDelay != null) params.push(['forward-delay', iface.forwardDelay]);
    if (params.length) {
      lines.push(I(L) + 'parameters:');
      for (const [k, v] of params) lines.push(I(L + 1) + k + ': ' + v);
    }
  }

  if (iface.kind === 'bonds') {
    lines.push(I(L) + 'parameters:');
    lines.push(I(L + 1) + 'mode: ' + iface.bondMode);
    if (iface.primary) lines.push(I(L + 1) + 'primary: ' + iface.primary);
  }

  if (iface.mtu !== '' && iface.mtu != null) lines.push(I(L) + 'mtu: ' + iface.mtu);
  if (iface.macaddress) lines.push(I(L) + 'macaddress: ' + iface.macaddress);
}

export function generateYamlText(state: NetplanState): string {
  const lines: string[] = [];
  const indent = (n: number) => '  '.repeat(n);

  lines.push('network:');
  lines.push(indent(1) + 'version: ' + state.version);
  lines.push(indent(1) + 'renderer: ' + state.renderer);

  const kinds: NetplanKind[] = ['ethernets', 'wifis', 'bridges', 'bonds', 'vlans'];
  for (const kind of kinds) {
    const list = state.ifaces.filter((i) => i.kind === kind && i.name.trim());
    if (list.length === 0) continue;
    lines.push(indent(1) + kind + ':');
    for (const iface of list) emitIface(lines, iface, 2);
  }

  return lines.join('\n');
}

export function validateIfaces(ifaces: NetplanIface[]): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();

  for (const iface of ifaces) {
    if (!iface.name.trim()) {
      errs.push('An interface is missing a name.');
      continue;
    }

    if (seen.has(iface.name)) errs.push(`Duplicate interface name: "${iface.name}"`);
    seen.add(iface.name);

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
      const okAp = (iface.accessPoints || []).some((a) => a.ssid.trim());
      if (!okAp) errs.push(`Wi-Fi "${iface.name}" needs at least one access point with an SSID.`);
    }

    if ((iface.kind === 'bridges' || iface.kind === 'bonds') && (!iface.members || iface.members.length === 0)) {
      errs.push(`${iface.kind === 'bridges' ? 'Bridge' : 'Bond'} "${iface.name}" has no member interfaces.`);
    }
  }

  return errs;
}
