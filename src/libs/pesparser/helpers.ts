export function signed12(v: number): number {
  v &= 0xFFF;
  return v > 0x7FF ? v - 0x1000 : v;
}

export function signed7(v: number): number {
  return v > 63 ? v - 128 : v;
}

export function readUint8(data: Uint8Array, pos: number): number | null {
  return pos < data.length ? data[pos] : null;
}

export function readInt24LE(data: Uint8Array, pos: number): number {
  if (pos + 2 >= data.length) return 0;
  return data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16);
}
