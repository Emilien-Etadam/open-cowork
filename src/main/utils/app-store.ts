/**
 * @module main/utils/app-store
 *
 * Shared encrypted electron-store factory for Lygodactylus persistent data.
 * Uses machine-bound encryption (same model as config-store).
 */
import Store, { type Options as StoreOptions } from 'electron-store';
import { log, logWarn } from './logger';
import {
  getMachineEncryptionKey,
  LEGACY_STATIC_ENCRYPTION_KEYS,
} from './machine-encryption-key';
import {
  createEncryptedStoreWithKeyRotation,
  getLegacyDerivedKeyHexes,
} from './store-encryption';

export interface CreateAppEncryptedStoreOptions<T extends Record<string, unknown>> {
  /** electron-store file name (without .json) */
  name: string;
  defaults: T;
  logPrefix: string;
  /** Additional legacy decryption keys (e.g. store-specific static keys). */
  extraLegacyKeys?: string[];
}

/**
 * Creates an encrypted electron-store with key rotation and plain-text migration.
 */
export function createAppEncryptedStore<T extends Record<string, unknown>>(
  options: CreateAppEncryptedStoreOptions<T>
): Store<T> {
  const storeOptions: StoreOptions<T> & { projectName?: string } = {
    name: options.name,
    projectName: 'lygodactylus',
    defaults: options.defaults,
  };

  const legacyKeys = [
    ...(options.extraLegacyKeys ?? []),
    ...LEGACY_STATIC_ENCRYPTION_KEYS,
    `${options.name}-v1`,
    ...getLegacyDerivedKeyHexes({
      moduleDirname: __dirname,
      stableSeed: `lygodactylus-${options.name}-stable-v1`,
      legacySeed: `lygodactylus-${options.name}-v1`,
      salt: `lygodactylus-${options.name}-salt`,
    }),
  ];

  return createEncryptedStoreWithKeyRotation<T>({
    stableKey: getMachineEncryptionKey(),
    legacyKeys,
    storeOptions,
    logPrefix: options.logPrefix,
    log,
    warn: logWarn,
  });
}
