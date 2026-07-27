export type ParsedIpv4Cidr = {
  version: 4;
  prefix: number;
  networkInt: number;
  total: number;
  broadcastInt: number;
  maskStr: string;
  cidr: string;
};

export type ParsedIpv6Cidr = {
  version: 6;
  prefix: number;
  networkBig: bigint;
  cidr: string;
};

export type ParsedCidr = ParsedIpv4Cidr | ParsedIpv6Cidr;

export function ipv4ToInt(ip: string): number | null {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let v = 0;
  for (const o of p) {
    if (!/^\d{1,3}$/.test(o)) return null;
    const n = Number(o);
    if (n > 255) return null;
    v = (v * 256) + n;
  }
  return v >>> 0;
}

export function intToIpv4(v: number): string {
  const n = v >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function ipv6ToBig(str: string): bigint | null {
  if (!str.includes(':')) return null;

  let head: string;
  let tail: string | null;

  if (str.includes('::')) {
    const parts = str.split('::');
    if (parts.length !== 2) return null;
    head = parts[0];
    tail = parts[1];
  } else {
    head = str;
    tail = null;
  }

  const h = head.length ? head.split(':') : [];
  let groups: string[];

  if (tail !== null) {
    const t = tail.length ? tail.split(':') : [];
    const miss = 8 - (h.length + t.length);
    if (miss < 0) return null;
    groups = h.concat(Array(miss).fill('0'), t);
  } else {
    groups = h;
  }

  if (groups.length !== 8) return null;

  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    v = (v << 16n) + BigInt(parseInt(g, 16));
  }

  return v;
}

export function bigToIpv6(v: bigint): string {
  const g: string[] = [];
  for (let i = 7; i >= 0; i -= 1) {
    g[i] = Number((v >> BigInt(i * 16)) & 0xffffn).toString(16);
  }

  let best = -1;
  let bestLen = 0;
  let cur = -1;
  let curLen = 0;

  for (let i = 0; i < 8; i += 1) {
    if (g[i] === '0') {
      if (cur === -1) cur = i;
      curLen += 1;
      if (curLen > bestLen) {
        bestLen = curLen;
        best = cur;
      }
    } else {
      cur = -1;
      curLen = 0;
    }
  }

  if (bestLen > 1) {
    const parts = g.slice();
    parts.splice(best, bestLen, '');
    let s = parts.join(':');
    if (best === 0) s = ':' + s;
    if (best + bestLen === 8) s = s + ':';
    return s;
  }

  return g.join(':');
}

export function parseCidr(input: string): { error: string } | ParsedCidr {
  const raw = (input || '').trim();
  if (!raw) return { error: 'Enter a CIDR like 192.168.1.0/24.' };

  const slash = raw.indexOf('/');
  if (slash === -1) return { error: `Missing prefix length — try ${raw}/24.` };

  const addr = raw.slice(0, slash).trim();
  const prefStr = raw.slice(slash + 1).trim();
  if (!/^\d{1,3}$/.test(prefStr)) return { error: 'Prefix must be a number.' };

  const prefix = Number(prefStr);

  if (addr.includes(':')) {
    const v = ipv6ToBig(addr);
    if (v === null) return { error: 'That is not a valid IPv6 address.' };
    if (prefix < 0 || prefix > 128) return { error: 'IPv6 prefix must be 0–128.' };

    const mask = prefix === 0
      ? 0n
      : ((1n << 128n) - 1n) ^ ((1n << (128n - BigInt(prefix))) - 1n);

    const net = v & mask;
    return {
      version: 6,
      prefix,
      networkBig: net,
      cidr: `${bigToIpv6(net)}/${prefix}`
    };
  }

  const v = ipv4ToInt(addr);
  if (v === null) return { error: 'That is not a valid IPv4 address.' };
  if (prefix < 0 || prefix > 32) return { error: 'IPv4 prefix must be 0–32.' };

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (v & mask) >>> 0;
  const total = Math.pow(2, 32 - prefix);

  return {
    version: 4,
    prefix,
    networkInt: net,
    total,
    broadcastInt: (net + total - 1) >>> 0,
    maskStr: intToIpv4(mask),
    cidr: `${intToIpv4(net)}/${prefix}`
  };
}
