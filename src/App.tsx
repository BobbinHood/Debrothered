import { useState, useCallback, useEffect, useRef } from "react";
import type { ChangeEvent } from "react";
import { PP1Machine } from "./libs/pp1ble/pp1ble.ts";
import type { EmbroideryInfo, MonitorInfo } from "./libs/pp1ble/pp1ble.ts";
import { MachineStatus } from "./libs/pp1ble/consts.ts";
import { pesToPP1 } from "./libs/pesparser/pesparser.ts";

interface LogEntry {
  time: Date;
  msg: string;
}

const machine = new PP1Machine();

const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

function App() {
  const [connected, setConnected] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [transferring, setTransferring] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileData, setFileData] = useState<Uint8Array | null>(null);
  const [machineState, setMachineState] = useState<number | null>(null);
  const [embInfo, setEmbInfo] = useState<EmbroideryInfo | null>(null);
  const [monitorInfo, setMonitorInfo] = useState<MonitorInfo | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, { time: new Date(), msg }]);
    setTimeout(
      () => logEndRef.current?.scrollIntoView({ behavior: "smooth" }),
      50
    );
  }, []);

  // Wire up machine callbacks (must run in an effect, not during render).
  useEffect(() => {
    machine.onLog = (msg) => addLog(msg);
    machine.onProgress = (sent, total) =>
      setProgress(Math.round((sent / total) * 100));
  }, [addLog]);

  // Poll machine state while connected
  useEffect(() => {
    if (!connected) return;

    const poll = async () => {
      try {
        const state = await machine.getMachineState();
        setMachineState(state);

        // If sewing, also poll monitor info
        if (state === 0x30 || state === 0x32 || state === 0x40) {
          const mon = await machine.getMonitorInfo();
          setMonitorInfo(mon);
        } else {
          setMonitorInfo(null);
        }
      } catch {
        // BLE read failed, probably disconnected
      }
    };

    poll(); // immediate first poll
    const intervalId = setInterval(poll, 2000);
    return () => clearInterval(intervalId);
  }, [connected]);

  const handleConnect = async (): Promise<void> => {
    if (connected) {
      machine.disconnect();
      setConnected(false);
      setMachineState(null);
      setEmbInfo(null);
      setMonitorInfo(null);
      return;
    }
    try {
      setConnecting(true);
      await machine.connect();
      setConnected(true);
    } catch (err) {
      addLog(`Connection failed: ${errMsg(err)}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFileData(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = reader.result;
        if (!(raw instanceof ArrayBuffer)) {
          throw new Error("Expected ArrayBuffer from FileReader");
        }
        const { pp1Data, stitchCount, colorCount } = pesToPP1(raw);
        setFileData(pp1Data);
        addLog(
          `Loaded ${file.name} — ${stitchCount} stitches, ${colorCount} colors → ${pp1Data.length} bytes PP1`
        );
      } catch (err) {
        addLog(`File parse error: ${errMsg(err)}`);
        setFileData(null);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleTransfer = async (): Promise<void> => {
    if (!fileData) {
      addLog("No file loaded");
      return;
    }
    try {
      setTransferring(true);
      setProgress(0);
      const ok = await machine.fullTransfer(fileData);
      addLog(ok ? "Transfer complete!" : "Transfer failed.");
    } catch (err) {
      addLog(`Transfer error: ${errMsg(err)}`);
    } finally {
      setTransferring(false);
    }
  };

  const handleStartSewing = async (): Promise<void> => {
    try {
      await machine.startSewing();
    } catch (err) {
      addLog(`Start sewing error: ${errMsg(err)}`);
    }
  };

  const handleGetInfo = async (): Promise<void> => {
    try {
      const info = await machine.getEmbroideryInfo();
      setEmbInfo(info);
      if (info) {
        addLog(
          `Embroidery: ${info.totalStitches} stitches, ` +
            `size ${info.sizeLeft},${info.sizeTop} → ${info.sizeRight},${info.sizeBottom}, ` +
            `time=${info.totalTime}s, speed=${info.speed}`
        );
      } else {
        addLog("No embroidery info available");
      }
    } catch (err) {
      addLog(`Info error: ${errMsg(err)}`);
    }
  };

  const statusName = machineState !== null
    ? MachineStatus[machineState] ?? `Unknown (0x${machineState.toString(16)})`
    : "—";

  const isSewing = machineState === 0x30;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center p-6 font-mono">
      <h1 className="text-2xl font-bold mb-6 tracking-tight">
        sendpp1<span className="text-indigo-400">web</span>
      </h1>

      <div className="w-full max-w-md space-y-4">
        {/* Connection */}
        <button
          onClick={handleConnect}
          disabled={connecting}
          className={`w-full py-2.5 rounded-lg font-semibold transition-colors cursor-pointer ${
            connected
              ? "bg-red-600 hover:bg-red-700"
              : "bg-indigo-600 hover:bg-indigo-700"
          } disabled:opacity-50`}
        >
          {connecting
            ? "Connecting…"
            : connected
              ? "Disconnect"
              : "Connect via BLE"}
        </button>

        {/* Machine Status */}
        {connected && (
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-sm">Machine Status</span>
              <span
                className={`text-sm font-semibold px-2 py-0.5 rounded ${
                  isSewing
                    ? "bg-emerald-900 text-emerald-300"
                    : machineState === 0x11 || machineState === 0x12
                      ? "bg-amber-900 text-amber-300"
                      : machineState === 0x31
                        ? "bg-blue-900 text-blue-300"
                        : "bg-gray-800 text-gray-300"
                }`}
              >
                {statusName}
              </span>
            </div>

            {/* Embroidery Info */}
            {embInfo && (
              <div className="text-xs text-gray-400 space-y-0.5">
                <div>
                  Stitches: {embInfo.totalStitches} | Time: {embInfo.totalTime}s
                  | Speed: {embInfo.speed}
                </div>
                <div>
                  Bounds: ({embInfo.sizeLeft}, {embInfo.sizeTop}) → (
                  {embInfo.sizeRight}, {embInfo.sizeBottom})
                </div>
              </div>
            )}

            {/* Monitor Info (live during sewing) */}
            {monitorInfo && (
              <div className="text-xs text-indigo-300">
                Sewing: {monitorInfo.currentStitches}
                {embInfo ? ` / ${embInfo.totalStitches}` : ""} stitches | Pos: (
                {monitorInfo.currentX}, {monitorInfo.currentY})
              </div>
            )}

            {/* Sewing progress bar */}
            {monitorInfo && embInfo && embInfo.totalStitches > 0 && (
              <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, Math.round((monitorInfo.currentStitches / embInfo.totalStitches) * 100))}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* File picker */}
        <label
          className={`block w-full text-center py-2.5 rounded-lg border-2 border-dashed transition-colors cursor-pointer ${
            connected
              ? "border-gray-600 hover:border-indigo-500 hover:bg-gray-900"
              : "border-gray-800 text-gray-600 cursor-not-allowed"
          }`}
        >
          <input
            type="file"
            accept=".pes,.dst,.exp,.jef,.pcs,.hus,.vip,.shv,.xxx,.sew"
            onChange={handleFile}
            disabled={!connected}
            className="hidden"
          />
          {fileName ? fileName : "Choose stitch file…"}
        </label>

        {/* Transfer button */}
        <button
          onClick={handleTransfer}
          disabled={!connected || !fileData || transferring}
          className="w-full py-2.5 rounded-lg font-semibold bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {transferring ? "Transferring…" : "Send to Machine"}
        </button>

        {/* Transfer progress bar */}
        {transferring && (
          <>
            <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
              <div
                className="bg-indigo-500 h-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-center text-sm text-gray-400">{progress}%</p>
          </>
        )}

        {/* Action buttons */}
        {connected && (
          <div className="flex gap-2">
            <button
              onClick={handleStartSewing}
              disabled={!connected}
              className="flex-1 py-2 rounded-lg font-semibold bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50 cursor-pointer text-sm"
            >
              Start Sewing
            </button>
            <button
              onClick={handleGetInfo}
              disabled={!connected}
              className="flex-1 py-2 rounded-lg font-semibold bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50 cursor-pointer text-sm"
            >
              Get Info
            </button>
          </div>
        )}

        {/* Log area */}
        <div className="mt-4 bg-gray-900 rounded-lg border border-gray-800 h-64 overflow-y-auto p-3 text-xs leading-relaxed">
          {logs.length === 0 && (
            <p className="text-gray-600 italic">Waiting for activity…</p>
          )}
          {logs.map((l, i) => (
            <div key={i} className="mb-1">
              <span className="text-gray-500">
                {l.time.toLocaleTimeString()}
              </span>{" "}
              <span className="text-gray-300">{l.msg}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      <p className="mt-8 text-xs text-gray-600">
        Web Bluetooth — Chrome / Edge only
      </p>
    </div>
  );
}

export default App;
