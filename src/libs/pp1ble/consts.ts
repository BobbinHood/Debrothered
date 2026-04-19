// BLE UUIDs
export const MAIN_SERVICE_UUID   = "a76eb9e0-f3ac-4990-84cf-3a94d2426b2b";
export const WRITE_CHAR_UUID     = "a76eb9e2-f3ac-4990-84cf-3a94d2426b2b";
export const READ_CHAR_UUID      = "a76eb9e1-f3ac-4990-84cf-3a94d2426b2b";

// Machine Commands
export const CMD = {
  MACHINE_INFO:       0x0000,
  MACHINE_STATE:      0x0001,
  SERVICE_COUNT:      0x0100,
  REGULAR_INSPECTION: 0x0103,
  PATTERN_UUID:       0x0702,
  LAYOUT_DATA:        0x0705,
  EMBROIDERY_INFO:    0x0706,
  EMBROIDERY_MONITOR: 0x0707,
  DELETE_EMBROIDERY:  0x0708,
  SET_NEEDLE_MODE:    0x0709,
  SEND_UUID:          0x070A,
  RESUME_FLAG:        0x070B,
  RESUME_EMBROIDERY:  0x070C,
  START_SEWING:       0x070E,
  HOOP_AVOIDANCE:     0x070F,
  ORIGIN_POINT:       0x0800,
  RESET_SETTINGS:     0x0C00,
  SEND_HOST_SETTINGS: 0x0C01,
  MACHINE_SETTINGS:   0x0C02,
  PREPARE_TRANSFER:   0x1200,
  DATA_PACKET:        0x1201,
  CLEAR_ERROR:        0x1300,
  ERROR_LOG:          0x1301,
} as const;

/** Type of a command code from CMD (e.g. 0x0000 | 0x0001 | …). */
export type CmdCode = typeof CMD[keyof typeof CMD];

// Machine Status codes
export const MachineStatus: Record<number, string> = {
  0x00: "Initial",
  0x01: "LowerThread",
  0x10: "SewingWaitNoData",
  0x11: "SewingWait",
  0x12: "SewingDataReceive",
  0x20: "MaskTraceLockWait",
  0x21: "MaskTracing",
  0x22: "MaskTraceFinish",
  0x30: "Sewing",
  0x31: "SewingFinish",
  0x32: "SewingInterruption",
  0x40: "ThreadChange",
  0x41: "Pause",
  0x42: "Stop",
  0x50: "HoopAvoidance",
  0x51: "HoopAvoidancing",
  0x60: "RLReceiving",
  0x61: "RLReceived",
  0xDD: "None",
  0xFF: "TryConnecting",
};

// Transfer status codes
export const STATUS_COMPLETE = 0;
export const STATUS_CONTINUE = 2;

// Packet overhead: cmd(2) + offset(4) + checksum(1) = 7
export const PACKET_OVERHEAD = 7;

// Conservative default chunk size
export const DEFAULT_CHUNK_SIZE = 505;
