import net from 'net';
import dns from 'dns';
import { PRIVATE_IPV4 } from '../config.js';

function ipv4ToNum(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.reduce((acc, oct) => { const n = parseInt(oct, 10); return isNaN(n) ? null : (acc === null ? null : acc * 256 + n); }, 0);
}

function isPrivateIPv4(ip) {
  const num = ipv4ToNum(ip);
  if (num === null) return false;
  if (num === 0) return true;
  if (num === 2130706432) return true;
  if (num >= 2851995648 && num <= 2852061183) return true;
  if (num >= 167772160 && num <= 184549375) return true;
  if (num >= 2886729728 && num <= 2887778303) return true;
  if (num >= 3232235520 && num <= 3232301055) return true;
  if (num >= 3221225472 && num <= 3221225727) return true;
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
  if (lower.startsWith('::ffff:') || lower.startsWith('0:0:0:0:0:ffff:')) {
    const ipv4 = lower.includes('::ffff:') ? lower.split('::ffff:')[1] : lower.split('0:0:0:0:0:ffff:')[1];
    if (ipv4) return isPrivateIPv4(ipv4);
  }
  if (lower.startsWith('fd') || lower.startsWith('fc')) return true;
  if (lower.startsWith('fe80')) return true;
  return false;
}

export async function isPrivateHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === 'localhost.localdomain' || h.endsWith('.local')) return true;
  if (net.isIP(h)) {
    if (net.isIPv4(h)) return isPrivateIPv4(h);
    return isPrivateIPv6(h);
  }
  try {
    const addresses = await new Promise((resolve, reject) => {
      dns.lookup(h, { all: true }, (err, addrs) => {
        if (err) return reject(err);
        resolve(addrs.map(a => a.address));
      });
    });
    return addresses.some(addr => {
      if (net.isIPv4(addr)) return isPrivateIPv4(addr);
      return isPrivateIPv6(addr);
    });
  } catch {
    return true;
  }
}
