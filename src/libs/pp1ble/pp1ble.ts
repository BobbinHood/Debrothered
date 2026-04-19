import { MAIN_SERVICE_UUID, WRITE_CHAR_UUID, READ_CHAR_UUID, CMD, STATUS_COMPLETE, STATUS_CONTINUE, DEFAULT_CHUNK_SIZE } from "./consts";
import type { CmdCode } from "./consts";
import { cmdBytes, concat, packLE, readLE, checksum } from "./helpers"

/** Info returned by CMD.EMBROIDERY_INFO. */
export interface EmbroideryInfo {
  sizeLeft: number;
  sizeTop: number;
  sizeRight: number;
  sizeBottom: number;
  totalTime: number;
  totalStitches: number;
  speed: number;
}

/** Real-time monitor info returned by CMD.EMBROIDERY_MONITOR during sewing. */
export interface MonitorInfo {
  currentStitches: number;
  currentTime: number;
  stopTime: number;
  currentX: number;
  currentY: number;
}

/** Callback fired with a human-readable status line. */
export type LogCallback = (msg: string) => void;

/** Callback fired during a data transfer. */
export type ProgressCallback = (sent: number, total: number) => void;

export class PP1Machine {
  device: BluetoothDevice | null = null;
  writeCh: BluetoothRemoteGATTCharacteristic | null = null;
  readCh: BluetoothRemoteGATTCharacteristic | null = null;

  chunkSize: number = DEFAULT_CHUNK_SIZE;

  /** Callbacks — override these to hook into the UI. */
  onLog: LogCallback = (msg) => console.log(`[PP1] ${msg}`);
  onProgress: ProgressCallback = () => { };

  /** GATT operation mutex — Web Bluetooth can only do one op at a time. */
  #gattQueue: Promise<unknown> = Promise.resolve();

  /** Wrap a GATT operation so it waits for the previous one to finish. */
  #gattMutex<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#gattQueue.then(fn, fn);  // run even if prev rejected
    this.#gattQueue = next.catch(() => { });      // swallow so chain continues
    return next as Promise<T>;
  }

  // ── Connection ───────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [MAIN_SERVICE_UUID] }],
    });

    this.onLog(`Paired with ${this.device.name ?? this.device.id}`);

    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(MAIN_SERVICE_UUID);
    this.writeCh = await service.getCharacteristic(WRITE_CHAR_UUID);
    this.readCh = await service.getCharacteristic(READ_CHAR_UUID);

    this.onLog("GATT connected, characteristics ready");
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.writeCh = null;
    this.readCh = null;
    this.onLog("Disconnected");
  }

  get connected(): boolean {
    return !!this.device?.gatt?.connected;
  }

  // ── Low-level BLE I/O ────────────────────────────────────────────────────

  /** Build the wire frame: cmd(2) + data. */
  #buildCmd(cmd: CmdCode, data: Uint8Array = new Uint8Array(0)): Uint8Array {
    return concat(cmdBytes(cmd), data);
  }

  async #send(cmd: CmdCode, data: Uint8Array = new Uint8Array(0)): Promise<void> {
    const frame = this.#buildCmd(cmd, data);
    await this.writeCh!.writeValueWithResponse(frame);
  }

  async #receive(): Promise<Uint8Array> {
    const dv = await this.readCh!.readValue();
    return new Uint8Array(dv.buffer);
  }

  /**
   * Send a command and read the response.
   * Serialized through the GATT mutex so overlapping BLE ops never happen.
   * Returns the payload AFTER the 2-byte command echo, or null on mismatch.
   */
  async #request(cmd: CmdCode, data: Uint8Array = new Uint8Array(0)): Promise<Uint8Array | null> {
    return this.#gattMutex(async () => {
      await this.#send(cmd, data);
      const resp = await this.#receive();
      if (resp.length < 2) return null;
      const echoed = (resp[0] << 8) | resp[1];
      if (echoed !== cmd) {
        this.onLog(`Command echo mismatch: expected 0x${cmd.toString(16)} got 0x${echoed.toString(16)}`);
        return null;
      }
      return resp.slice(2);
    });
  }

  // ── Machine queries ──────────────────────────────────────────────────────

  async getMachineState(): Promise<number | null> {
    const resp = await this.#request(CMD.MACHINE_STATE);
    return resp ? resp[0] : null;
  }

  async getMachineInfo(): Promise<Uint8Array | null> {
    return await this.#request(CMD.MACHINE_INFO);
  }

  /**
   * Get embroidery info (dimensions, stitch count, speed, etc.)
   */
  async getEmbroideryInfo(): Promise<EmbroideryInfo | null> {
    const resp = await this.#request(CMD.EMBROIDERY_INFO);
    if (!resp || resp.length < 14) return null;
    const dv = new DataView(resp.buffer, resp.byteOffset, resp.byteLength);
    return {
      sizeLeft: dv.getInt16(0, true),
      sizeTop: dv.getInt16(2, true),
      sizeRight: dv.getInt16(4, true),
      sizeBottom: dv.getInt16(6, true),
      totalTime: dv.getInt16(8, true),
      totalStitches: dv.getUint16(10, true),
      speed: dv.getInt16(12, true),
    };
  }

  /**
   * Get real-time embroidery monitor info (progress during sewing).
   */
  async getMonitorInfo(): Promise<MonitorInfo | null> {
    const resp = await this.#request(CMD.EMBROIDERY_MONITOR);
    if (!resp || resp.length < 10) return null;
    const dv = new DataView(resp.buffer, resp.byteOffset, resp.byteLength);
    return {
      currentStitches: dv.getUint16(0, true),
      currentTime: dv.getInt16(2, true),
      stopTime: dv.getInt16(4, true),
      currentX: dv.getInt16(6, true),
      currentY: dv.getInt16(8, true),
    };
  }

  /**
   * Check if the machine can resume a previous embroidery.
   */
  async getResumeFlag(): Promise<boolean> {
    const resp = await this.#request(CMD.RESUME_FLAG);
    return !!resp && resp[0] === 1;
  }

  /**
   * Resume a previously interrupted embroidery.
   */
  async resumeEmbroidery(): Promise<boolean> {
    const resp = await this.#request(CMD.RESUME_EMBROIDERY);
    if (resp && resp[0] !== 0) {
      this.onLog(`Resume embroidery failed, status=${resp[0]}`);
      return false;
    }
    this.onLog("Resume embroidery OK");
    return true;
  }

  /**
   * Tell the machine to start sewing.
   */
  async startSewing(): Promise<void> {
    await this.#request(CMD.START_SEWING);
    this.onLog("Start sewing command sent");
  }

  /**
   * Clear an error from the machine.
   */
  async clearError(errorCode: number = 0): Promise<void> {
    await this.#request(CMD.CLEAR_ERROR, new Uint8Array([errorCode]));
    this.onLog("Error cleared");
  }

  // ── Transfer protocol ────────────────────────────────────────────────────

  async deleteEmbroidery(): Promise<boolean> {
    const resp = await this.#request(CMD.DELETE_EMBROIDERY);
    if (resp && resp[0] !== 0) {
      this.onLog(`Delete embroidery failed, status=${resp[0]}`);
      return false;
    }
    this.onLog("Embroidery deleted");
    return true;
  }

  async #prepareTransfer(size: number, csum: number): Promise<boolean> {
    // Payload: type(1)=0x03 | size(4, uint32 LE) | checksum(2, uint16 LE)
    const payload = concat(
      new Uint8Array([0x03]),
      packLE(size, 4),
      packLE(csum, 2),
    );
    const resp = await this.#request(CMD.PREPARE_TRANSFER, payload);
    if (!resp || resp[0] !== 0) {
      this.onLog(`Prepare transfer rejected, status=${resp?.[0]}`);
      return false;
    }
    this.onLog(`Prepare transfer OK — ${size} bytes, checksum 0x${csum.toString(16).toUpperCase()}`);
    return true;
  }

  /**
   * Transfer stitch data to the machine.
   */
  async transfer(data: Uint8Array): Promise<boolean> {
    const transferSize = this.chunkSize;
    const totalChecksum = checksum(data, 0xFFFF);
    const totalChunks = Math.ceil(data.length / transferSize);

    this.onLog(`Starting transfer: ${data.length} bytes, checksum=0x${totalChecksum.toString(16).toUpperCase()}, chunks=${totalChunks}`);

    if (!(await this.#prepareTransfer(data.length, totalChecksum))) {
      return false;
    }

    // Small delay for the machine to allocate its receive buffer
    await new Promise(r => setTimeout(r, 100));

    let bytesSent = 0;
    for (let i = 0; i < totalChunks; i++) {
      const start = i * transferSize;
      const end = Math.min(start + transferSize, data.length);
      const chunk = data.slice(start, end);
      const chunkCsum = checksum(chunk, 0xFF);

      // Format: offset(4,LE) + chunk + checksum(1)
      const payload = concat(
        packLE(bytesSent, 4),
        chunk,
        new Uint8Array([chunkCsum]),
      );

      const resp = await this.#request(CMD.DATA_PACKET, payload);
      if (!resp || resp.length === 0) {
        this.onLog(`DATA_PACKET ${i + 1}/${totalChunks} — no response`);
        return false;
      }

      const status = resp[0];

      if (status === STATUS_COMPLETE) {
        bytesSent += chunk.length;
        this.onLog(`Transfer complete — ${bytesSent} bytes`);
        this.onProgress(bytesSent, data.length);
        return true;
      } else if (status === STATUS_CONTINUE) {
        bytesSent += chunk.length;
        this.onProgress(bytesSent, data.length);
      } else {
        const extra = resp.length >= 5 ? readLE(resp, 1, 4) : -1;
        this.onLog(`DATA_PACKET ${i + 1}/${totalChunks} REJECTED status=${status} extra=${extra}`);
        return false;
      }
    }

    this.onLog(`All ${totalChunks} chunks sent (${bytesSent} bytes)`);
    return true;
  }

  async sendLayout(layout: Uint8Array | null = null): Promise<void> {
    // Default layout: no move, 100% scale, no rotation, frame=1 (100mm)
    const payload = layout ?? concat(
      packLE(0, 2),     // moveX
      packLE(0, 2),     // moveY
      packLE(100, 2),   // sizeX %
      packLE(100, 2),   // sizeY %
      packLE(0, 2),     // rotate
      new Uint8Array([0x00]),  // flip
      new Uint8Array([0x01]),  // frame (1 = 100mm)
      // Bounding box (12 bytes of zeros = no constraint)
      new Uint8Array(12),
    );
    await this.#request(CMD.LAYOUT_DATA, payload);
    this.onLog("Layout sent");
  }

  async sendPatternUUID(uuidBytes: Uint8Array): Promise<void> {
    await this.#request(CMD.SEND_UUID, uuidBytes);
    this.onLog("Pattern UUID sent");
  }

  /**
   * Full transfer flow: delete old → transfer data → send layout → send UUID.
   */
  async fullTransfer(stitchData: Uint8Array): Promise<boolean> {
    await this.deleteEmbroidery();
    const ok = await this.transfer(stitchData);
    if (!ok) return false;
    await this.sendLayout();
    // Generate a random UUID for the pattern
    const uuid = crypto.getRandomValues(new Uint8Array(16));
    await this.sendPatternUUID(uuid);
    return true;
  }
}
