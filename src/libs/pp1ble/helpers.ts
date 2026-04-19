/** Encode a command code as a 2-byte big-endian Uint8Array. */
export function cmdBytes(cmd: number): Uint8Array {
  return new Uint8Array([(cmd >> 8) & 0xFF, cmd & 0xFF]);
}

/** Concatenate multiple Uint8Array / ArrayBuffer into one Uint8Array. */
export function concat(...parts: (Uint8Array | ArrayBuffer)[]): Uint8Array {
  const bufs = parts.map(p => p instanceof ArrayBuffer ? new Uint8Array(p) : p);
  const len  = bufs.reduce((s, b) => s + b.length, 0);
  const out  = new Uint8Array(len);
  let off = 0;
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return out;
}

/** Pack a number as little-endian bytes. */
export function packLE(value: number, bytes: number): Uint8Array {
  const buf = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    buf[i] = (value >> (8 * i)) & 0xFF;
  }
  return buf;
}

/** Read a little-endian uint from a Uint8Array slice. */
export function readLE(buf: Uint8Array, offset: number, bytes: number): number {
  let v = 0;
  for (let i = 0; i < bytes; i++) v |= buf[offset + i] << (8 * i);
  return v >>> 0;   // unsigned
}

/** Checksum: sum of bytes, masked. */
export function checksum(data: Uint8Array, mask: number): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i];
  return s & mask;
}
