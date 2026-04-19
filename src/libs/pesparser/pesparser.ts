import { FLAG_LONG, JUMP_CODE, TRIM_CODE, CMD_COLOR_CHANGE, CMD_END, CMD_MOVE, CMD_STITCH, CMD_STOP, CMD_TRIM } from "./consts"
import type { Command } from "./consts"
import { signed12, signed7, readUint8 } from "./helpers"

/** A single machine instruction: absolute position + command. */
export interface Stitch {
  x: number;
  y: number;
  cmd: Command;
}

/** Result of parsing a PES/PEC file. */
export interface PESResult {
  stitches: Stitch[];
  colorCount: number;
}

/** Result of the full PES → PP1 conversion pipeline. */
export interface PP1Result {
  pp1Data: Uint8Array;
  stitchCount: number;
  colorCount: number;
}

/**
 * Parse a PES file and return stitches + color count.
 */
export function parsePES(buffer: ArrayBuffer): PESResult {
  const data = new Uint8Array(buffer);
  const dv = new DataView(buffer);

  const magic = String.fromCharCode(...data.slice(0, 4));
  if (magic !== "#PES" && magic !== "#PEC") {
    throw new Error(`Not a PES/PEC file (magic: "${magic}")`);
  }

  if (magic === "#PEC") {
    // Standalone PEC file — PEC header starts at byte 8
    return readPEC(data, 8);
  }

  // PES: PEC block offset at byte 8
  const pecOffset = dv.getUint32(8, true);
  if (pecOffset === 0 || pecOffset >= data.length) {
    throw new Error(`Invalid PEC offset: ${pecOffset}`);
  }

  return readPEC(data, pecOffset);
}

/**
 * Parse the PEC block following pyembroidery's PecReader.read_pec exactly.
 */
function readPEC(data: Uint8Array, pecStart: number): PESResult {
  // Match pyembroidery's PecReader.read_pec offset calculations:
  // f.seek(3, 1)                   → skip "LA:"
  // read_string_8(f, 16)           → label (16 bytes)
  // f.seek(0xF, 1)                 → 15 bytes
  // read_int_8(f)                  → pec_graphic_byte_stride (1 byte)
  // read_int_8(f)                  → pec_graphic_icon_height (1 byte)
  // f.seek(0xC, 1)                 → 12 bytes
  // read_int_8(f)                  → color_changes (1 byte)
  // f.read(color_changes + 1)      → color bytes
  // f.seek(0x1D0 - color_changes, 1)
  // read_int_24le(f)               → stitch block end (3 bytes)
  // f.seek(0x0B, 1)                → 11 bytes → STITCH DATA START

  let off = pecStart;
  off += 3;             // "LA:"
  off += 16;            // label
  off += 0x0F;          // padding/metadata
  off += 1;             // pec_graphic_byte_stride
  off += 1;             // pec_graphic_icon_height
  off += 0x0C;          // more metadata

  const colorChanges = data[off] ?? 0;
  const colorCount = colorChanges + 1;
  off += 1;
  off += colorCount;    // color index bytes

  off += (0x1D0 - colorChanges);   // skip to stitch block header

  // read_int_24le for stitch_block_end (we don't need it for parsing, but
  // consume the 3 bytes to keep offset aligned)
  off += 3;

  // f.seek(0x0B, 1) — skip 11 bytes of stitch block header
  off += 0x0B;

  if (off >= data.length) {
    throw new Error(`PEC stitch data offset ${off} beyond file (${data.length} bytes)`);
  }

  const stitches = decodePECStitches(data, off);
  return { stitches, colorCount };
}

/**
 * Decode PEC stitch data — faithful port of pyembroidery's read_pec_stitches.
 * Returns absolute coordinates.
 */
function decodePECStitches(data: Uint8Array, startOffset: number): Stitch[] {
  const stitches: Stitch[] = [];
  let absX = 0;
  let absY = 0;
  let i = startOffset;
  let afterColorChange = false;

  while (i < data.length - 1) {
    const val1 = data[i++];
    let val2: number | null = data[i++];

    // END: 0xFF 0x00
    if ((val1 === 0xFF && val2 === 0x00) || val2 === undefined) {
      break;
    }

    // COLOR_CHANGE: 0xFE 0xB0 + skip 1 byte
    if (val1 === 0xFE && val2 === 0xB0) {
      i += 1;  // skip 1 byte (matches pyembroidery f.seek(1, 1))
      stitches.push({ x: absX, y: absY, cmd: CMD_COLOR_CHANGE });
      afterColorChange = true;
      continue;
    }

    let jump = false;
    let trim = false;
    let x: number;
    let y: number;

    // Decode X
    if (val1 & FLAG_LONG) {
      if (val1 & TRIM_CODE) trim = true;
      if (val1 & JUMP_CODE) jump = true;
      const code = (val1 << 8) | (val2 as number);
      x = signed12(code);
      // Read NEW val2 for Y processing
      val2 = readUint8(data, i++);
      if (val2 === null) break;
    } else {
      x = signed7(val1);
    }

    // Decode Y
    if ((val2 as number) & FLAG_LONG) {
      if ((val2 as number) & TRIM_CODE) trim = true;
      if ((val2 as number) & JUMP_CODE) jump = true;
      const val3 = readUint8(data, i++);
      if (val3 === null) break;
      const code = ((val2 as number) << 8) | val3;
      y = signed12(code);
    } else {
      y = signed7(val2 as number);
    }

    // After COLOR_CHANGE: the next movement is ALWAYS a repositioning jump,
    // regardless of PEC flags. Different digitizers encode this differently —
    // some use TRIM+JUMP flags, some use plain short bytes. Either way, the
    // machine must not stitch here. We also suppress TRIM since the color
    // change already implies a thread cut.
    if (afterColorChange) {
      absX += x;
      absY += y;
      stitches.push({ x: absX, y: absY, cmd: CMD_MOVE });
      afterColorChange = false;
    } else if (trim) {
      // Intra-color trim: cut at CURRENT position, then jump to new one
      stitches.push({ x: absX, y: absY, cmd: CMD_TRIM });
      absX += x;
      absY += y;
      stitches.push({ x: absX, y: absY, cmd: CMD_MOVE });
    } else {
      absX += x;
      absY += y;
      if (jump) {
        stitches.push({ x: absX, y: absY, cmd: CMD_MOVE });
      } else {
        stitches.push({ x: absX, y: absY, cmd: CMD_STITCH });
      }
    }
  }

  // out.end()
  stitches.push({ x: absX, y: absY, cmd: CMD_END });

  return stitches;
}

// ── PP1 Encoder ─────────────────────────────────────────────────────────────

/**
 * Encode stitches into PP1 binary format.
 * Each stitch = 4 bytes:  x_raw(int16 LE) + y_raw(int16 LE)
 */
export function encodePP1(stitches: Stitch[]): Uint8Array {
  const buf = new ArrayBuffer(stitches.length * 4);
  const dv = new DataView(buf);
  let off = 0;

  // Track whether the next MOVE should be a JUMP (feed+cut) or FEED (move only).
  // When a TRIM is dropped (because it precedes a MOVE), its "cut" semantics
  // are absorbed into the following MOVE → JUMP(3).  Otherwise MOVE → FEED(1).
  let nextMoveIsJump = false;
  let lastCmd: Command | -1 = -1;
  let lastX = NaN, lastY = NaN;
  let lastStitchFlag = -1;

  for (let idx = 0; idx < stitches.length; idx++) {
    const { x, y, cmd } = stitches[idx];

    // Drop zero-delta STITCHes that follow a JUMP (feed+cut) — these are
    // PEC anchor bytes (0x00 0x00) inserted after TRIM+JUMP sequences.
    // They're not real design stitches. We only drop them after JUMP (sf=3),
    // NOT after FEED (sf=1), because a stitch at the FEED destination is
    // the real first stitch of the pattern/color.
    if (cmd === CMD_STITCH && lastCmd === CMD_MOVE && lastStitchFlag === 3
        && x === lastX && y === lastY) {
      continue;
    }
    let blockFlag = 0;   // section flag (x low 3 bits)
    let stitchFlag = 0;  // operation flag (y low 3 bits)

    // Drop TRIM when followed by MOVE or COLOR_CHANGE — the cut semantics
    // get absorbed into the next MOVE (which becomes JUMP = feed+cut).
    if (cmd === CMD_TRIM) {
      const next = stitches[idx + 1];
      if (next && (next.cmd === CMD_MOVE || next.cmd === CMD_COLOR_CHANGE)) {
        nextMoveIsJump = true;   // next MOVE absorbs the cut
        continue;
      }
    }

    switch (cmd) {
      case CMD_STITCH:
        blockFlag = 0; stitchFlag = 0;
        break;
      case CMD_MOVE:
        // JUMP(3) = feed+cut — only when absorbing a dropped TRIM.
        // FEED(1) = move only — for initial positioning & after color change.
        blockFlag = 0;
        stitchFlag = nextMoveIsJump ? 3 : 1;
        nextMoveIsJump = false;
        break;
      case CMD_TRIM:
        blockFlag = 0; stitchFlag = 2;
        break;
      case CMD_COLOR_CHANGE:
      case CMD_STOP:
        blockFlag = 3; stitchFlag = 0;
        nextMoveIsJump = false;  // color change handles the cut
        break;
      case CMD_END:
        blockFlag = 5; stitchFlag = 0;
        break;
      default:
        continue;
    }

    const xRaw = (x << 3) | (blockFlag & 0x07);
    const yRaw = (y << 3) | (stitchFlag & 0x07);

    dv.setInt16(off, xRaw, true);
    dv.setInt16(off + 2, yRaw, true);
    off += 4;

    lastCmd = cmd;
    lastX = x;
    lastY = y;
    lastStitchFlag = stitchFlag;
  }

  return new Uint8Array(buf, 0, off);
}

/**
 * Convenience: parse a PES file and return PP1-encoded binary.
 */
export function pesToPP1(pesBuffer: ArrayBuffer): PP1Result {
  const { stitches, colorCount } = parsePES(pesBuffer);
  const stitchCount = stitches.filter(s => s.cmd === CMD_STITCH).length;
  const pp1Data = encodePP1(stitches);
  return { pp1Data, stitchCount, colorCount };
}
