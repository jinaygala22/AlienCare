import { BleManager } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform, NativeModules } from 'react-native';
import base64 from 'react-native-base64';


let manager = null;
let deviceConnected = null;
let disconnectSubscription = null;
let connectionInProgress = false;
const { TherapyTimer } = NativeModules;

function getBleManager() {
  if (manager) return manager;
  try {
    manager = new BleManager();
    return manager;
  } catch (e) {
    manager = null;
    return null;
  }
}

export function isBleAvailable() {
  return Boolean(getBleManager());
}

// 🔴 MUST MATCH ESP32
const SERVICE_UUID = "a0000001-0000-0000-0000-000000000001";
const TEMP_UUID = "a0000002-0000-0000-0000-000000000002";
const MODE_UUID = "a0000003-0000-0000-0000-000000000003";
const SET_UUID = "a0000004-0000-0000-0000-000000000004";
const TIMER_UUID = "a0000005-0000-0000-0000-000000000005";
// Add this with your other UUID constants (around line 24)
const NAME_UUID = "a0000006-0000-0000-0000-000000000006";
// --------------------
// ANDROID PERMISSION
// --------------------
export async function requestBluetoothPermission() {
  if (Platform.OS === 'android') {
    let permissions = [];
    if (Platform.Version >= 31) {
      permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];
    } else {
      permissions = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ];
    }

    try {
      await PermissionsAndroid.requestMultiple(permissions);
    } catch (err) {
      console.warn(err);
    }
  }
}

// --------------------
// SCAN FOR DEVICES
// --------------------
export async function scanForDevices(onDeviceFound, timeoutMs = 8000) {
  const m = getBleManager();
  if (!m) {
    onDeviceFound([]);
    return;
  }
  const discoveredDevices = new Map();

  m.stopDeviceScan();
  m.startDeviceScan(null, null, (error, device) => {
    if (error) return;

    if (device && (device.name || device.localName)) {
      discoveredDevices.set(device.id, device);
      // Pass back unique list to update UI
      onDeviceFound(Array.from(discoveredDevices.values()));
    }
  });

  // Automatically stop scanning after configured timeout
  setTimeout(() => {
    m.stopDeviceScan();
  }, timeoutMs);
}

// --------------------
// CONNECT TO GIVEN DEVICE
// --------------------
export async function connectToGivenDevice(device, onConnected) {
  const m = getBleManager();
  if (!m || connectionInProgress) {
    onConnected(false);
    return;
  }

  connectionInProgress = true;
  m.stopDeviceScan(); // Stop scanning before connecting

  try {
    if (disconnectSubscription) {
      disconnectSubscription.remove();
      disconnectSubscription = null;
    }

    if (deviceConnected && deviceConnected.id !== device.id) {
      try {
        await deviceConnected.cancelConnection();
      } catch (_) {}
      deviceConnected = null;
    }

    const isCurrentlyConnected = await device.isConnected().catch(() => false);
    if (isCurrentlyConnected) {
      try {
        deviceConnected = device;
        await deviceConnected.discoverAllServicesAndCharacteristics();
      } catch (err) {
        // Zombie connection reuse failed, cleanly reset
        await m.cancelDeviceConnection(device.id).catch(() => {});
        deviceConnected = await device.connect();
        await deviceConnected.discoverAllServicesAndCharacteristics();
      }
    } else {
      // Not connected, connect normally
      // Clean up any lingering internal state just in case
      await m.cancelDeviceConnection(device.id).catch(() => {});
      deviceConnected = await device.connect();
      await deviceConnected.discoverAllServicesAndCharacteristics();
    }

    TherapyTimer?.rememberConnectedDevice?.(device.id);
    onConnected(true);
  } catch (err) {
    console.warn("[BLE] Connect error:", err);
    onConnected(false);
  } finally {
    connectionInProgress = false;
  }
}

// --------------------
// SEND COMMAND
// --------------------
async function sendCommand(characteristicUuid, commandStr) {
  if (!deviceConnected) {
    console.warn(`[BLE] sendCommand skipped — no device connected. Char=${characteristicUuid} Val="${commandStr}"`);
    return;
  }

  const encoded = base64.encode(commandStr);
  console.log(`[BLE] WRITE char=${characteristicUuid} value="${commandStr}"`);

  try {
    await deviceConnected.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      characteristicUuid,
      encoded
    );
  } catch (error) {
    console.error(`[BLE] WRITE ERROR char=${characteristicUuid} val="${commandStr}"`, error?.message);
  }
}

// --------------------
// HOT MODE
// --------------------
export async function startHot(temp, time) {
  if (temp < 10) temp = 10;
  if (temp > 55) temp = 55;

  await sendCommand(MODE_UUID, "HEAT");
  await sendCommand(SET_UUID, String(Math.round(temp)));
  if (time >= 0) {
    // MUST send integer — ESP32 parseInt chokes on floats like "1.5" → parses as 1
    await sendCommand(TIMER_UUID, String(Math.round(time)));
  }
}

// --------------------
// COOL MODE
// --------------------
export async function startCool(temp, time) {
  if (temp < 10) temp = 10;
  if (temp > 55) temp = 55;

  await sendCommand(MODE_UUID, "COOL");
  await sendCommand(SET_UUID, String(Math.round(temp)));
  if (time >= 0) {
    await sendCommand(TIMER_UUID, String(Math.round(time)));
  }
}

// --------------------
// OFF MODE
// --------------------
export async function stopTherapy() {
  await sendCommand(MODE_UUID, "OFF");
  await sendCommand(TIMER_UUID, "0");
}
// Add this new exported function after stopTherapy()
export async function writeUserName(name) {
  console.log('[BLE] Writing username:', name);

  if (!name) {
    console.log('[BLE] Username empty');
    return;
  }

  if (!deviceConnected) {
    console.log('[BLE] No connected device');
    return;
  }

  await sendCommand(NAME_UUID, name);
}
// --------------------
// TEMPERATURE MONITORING
// --------------------
let tempSubscription = null;

export function monitorTemperature(onTemperatureUpdate) {
  if (!deviceConnected) return;

  tempSubscription = deviceConnected.monitorCharacteristicForService(
    SERVICE_UUID,
    TEMP_UUID,
    (error, characteristic) => {
      if (error) return;
      if (characteristic?.value) {
        const rawVal = base64.decode(characteristic.value);
        onTemperatureUpdate(rawVal);
      }
    }
  );
}

export function stopMonitoring() {
  if (tempSubscription) {
    tempSubscription.remove();
    tempSubscription = null;
  }
}

// --------------------
// DEVICE STATUS SYNCHRONIZATION
// --------------------
let modeSubscription = null;
let setpointSubscription = null;
let timerSubscription = null;

export function monitorDeviceStatus(onModeUpdate, onSetpointUpdate, onTimerUpdate) {
  if (!deviceConnected) return;

  modeSubscription = deviceConnected.monitorCharacteristicForService(
    SERVICE_UUID,
    MODE_UUID,
    (error, characteristic) => {
      if (error) return;
      if (characteristic?.value) {
        const rawVal = base64.decode(characteristic.value);
        let appMode = 'Off';
        if (rawVal === 'HEAT') appMode = 'Hot';
        else if (rawVal === 'COOL') appMode = 'Cold';
        else if (rawVal === 'OFF') appMode = 'Off';
        onModeUpdate(appMode);
      }
    }
  );

  setpointSubscription = deviceConnected.monitorCharacteristicForService(
    SERVICE_UUID,
    SET_UUID,
    (error, characteristic) => {
      if (error) return;
      if (characteristic?.value) {
        const rawVal = base64.decode(characteristic.value);
        const setpoint = parseInt(rawVal, 10);
        if (!isNaN(setpoint)) onSetpointUpdate(setpoint);
      }
    }
  );

  timerSubscription = deviceConnected.monitorCharacteristicForService(
    SERVICE_UUID,
    TIMER_UUID,
    (error, characteristic) => {
      if (error) return;
      if (characteristic?.value) {
        const rawVal = base64.decode(characteristic.value);
        const timerSeconds = parseInt(rawVal, 10);
        if (!isNaN(timerSeconds)) onTimerUpdate(timerSeconds);
      }
    }
  );
}

export function stopDeviceStatusMonitoring() {
  if (modeSubscription) {
    modeSubscription.remove();
    modeSubscription = null;
  }
  if (setpointSubscription) {
    setpointSubscription.remove();
    setpointSubscription = null;
  }
  if (timerSubscription) {
    timerSubscription.remove();
    timerSubscription = null;
  }
}

// --------------------
// DISCONNECT listener
// --------------------
export function onDeviceDisconnect(callback) {
  if (deviceConnected) {
    if (disconnectSubscription) {
      disconnectSubscription.remove();
    }

    disconnectSubscription = deviceConnected.onDisconnected((error, device) => {
      deviceConnected = null;
      disconnectSubscription = null;
      connectionInProgress = false;
      TherapyTimer?.clearRememberedDevice?.();
      callback();
    });
  }
}

// --------------------
// DISCONNECT
// --------------------
export function disconnectDevice() {
  stopMonitoring();
  stopDeviceStatusMonitoring();
  if (disconnectSubscription) {
    disconnectSubscription.remove();
    disconnectSubscription = null;
  }
  connectionInProgress = false;
  getBleManager()?.stopDeviceScan();
  if (deviceConnected) {
    deviceConnected.cancelConnection();
    deviceConnected = null;
  }
  TherapyTimer?.clearRememberedDevice?.();
}
