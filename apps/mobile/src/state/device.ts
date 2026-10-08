// Device-local state in expo-secure-store (Android Keystore-backed): the child session token,
// the remembered child login id, this device's mode and a random device id for rate limiting.
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  childToken: 'vionx.child.token',
  childLoginId: 'vionx.child.loginId',
  deviceMode: 'vionx.device.mode',
  deviceId: 'vionx.device.id',
} as const;

export type DeviceMode = 'child' | 'shared';

export const childToken = {
  get: () => SecureStore.getItemAsync(KEYS.childToken),
  set: (token: string) => SecureStore.setItemAsync(KEYS.childToken, token),
  clear: () => SecureStore.deleteItemAsync(KEYS.childToken),
};

export const rememberedLoginId = {
  get: () => SecureStore.getItemAsync(KEYS.childLoginId),
  set: (id: string) => SecureStore.setItemAsync(KEYS.childLoginId, id),
  clear: () => SecureStore.deleteItemAsync(KEYS.childLoginId),
};

/** "child": a parent switched this phone to child-device mode; it opens on the child login. */
export const deviceMode = {
  get: async (): Promise<DeviceMode> =>
    (await SecureStore.getItemAsync(KEYS.deviceMode)) === 'child' ? 'child' : 'shared',
  set: (mode: DeviceMode) => SecureStore.setItemAsync(KEYS.deviceMode, mode),
};

let cachedDeviceId: string | undefined;
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  let id = await SecureStore.getItemAsync(KEYS.deviceId);
  if (!id) {
    id = `android-${Crypto.randomUUID()}`;
    await SecureStore.setItemAsync(KEYS.deviceId, id);
  }
  cachedDeviceId = id;
  return id;
}
