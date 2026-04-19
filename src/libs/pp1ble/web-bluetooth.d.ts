// Minimal ambient declarations for the subset of the Web Bluetooth API
// used by PP1Machine. For the full spec, install @types/web-bluetooth.

// Loose buffer type — accepts TypedArrays backed by either ArrayBuffer or
// SharedArrayBuffer, which the narrow DOM `BufferSource` rejects in TS 5.7+.
type GattBufferSource = ArrayBufferView | ArrayBufferLike;

interface BluetoothRemoteGATTCharacteristic {
  readValue(): Promise<DataView>;
  writeValue(value: GattBufferSource): Promise<void>;
  writeValueWithResponse(value: GattBufferSource): Promise<void>;
  writeValueWithoutResponse(value: GattBufferSource): Promise<void>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}

interface RequestDeviceOptions {
  filters?: Array<{ services?: (string | number)[]; name?: string; namePrefix?: string }>;
  optionalServices?: (string | number)[];
  acceptAllDevices?: boolean;
}

interface Bluetooth {
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
  getAvailability(): Promise<boolean>;
}

interface Navigator {
  readonly bluetooth: Bluetooth;
}
