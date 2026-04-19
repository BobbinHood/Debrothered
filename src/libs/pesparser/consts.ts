// ── PEC constants ───────────────────────────────────────────────────────────
export const FLAG_LONG  = 0x80;
export const JUMP_CODE  = 0x10;
export const TRIM_CODE  = 0x20;

// pyembroidery command IDs (must match EmbConstant)
export const CMD_STITCH       = 0;
export const CMD_MOVE         = 1;  // JUMP / move
export const CMD_TRIM         = 2;
export const CMD_STOP         = 3;
export const CMD_END          = 4;
export const CMD_COLOR_CHANGE = 5;

/** Discriminator for Stitch.cmd — union of all command IDs. */
export type Command =
  | typeof CMD_STITCH
  | typeof CMD_MOVE
  | typeof CMD_TRIM
  | typeof CMD_STOP
  | typeof CMD_END
  | typeof CMD_COLOR_CHANGE;
