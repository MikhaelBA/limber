/**
 * UUID generation with a secure-context fallback (DESIGN.md §8.6):
 * crypto.randomUUID() requires https:// or localhost; the manual v4 fallback
 * covers plain-HTTP LAN URLs.
 */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();

  const b = new Uint8Array(16);
  c.getRandomValues(b);
  // RFC 4122 v4: version nibble 4, variant bits 10.
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
