const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChars(n: number): string {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** New stable id, e.g. "cp-k3x9a2mf" for a checkpoint or "rm-…" for a roadmap. */
export function newId(prefix: 'cp' | 'rm' | 'rv' | 'hx' | 'tr'): string {
  return `${prefix}-${randomChars(8)}`;
}

/** Ids are opaque. Agents should use cp-<8 random chars>, but any of these characters work. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function slugify(title: string, fallback = 'untitled'): string {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || fallback;
}

/** Stable, fast, non-cryptographic hash (FNV-1a 32-bit) for change detection. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + text.length.toString(36);
}
