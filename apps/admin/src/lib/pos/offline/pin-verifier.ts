import { db, PosOfflineDatabase } from "./db";

export interface StoredPinVerifier {
  userId: string;
  saltHex: string;
  hashHex: string;
  failedAttempts: number;
  lockedUntilMs?: number | null;
  expiresAtMs: number;
}

const ITERATIONS = 210_000;
const KEY_LEN_BITS = 256;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const VERIFIER_VALIDITY_MS = 12 * 60 * 60 * 1000; // 12 hours

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

/**
 * Derive PBKDF2-SHA256 hash using Web Crypto API.
 */
export async function derivePinHash(pin: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as any,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LEN_BITS
  );

  return bufferToHex(derived);
}

/**
 * Save an offline PIN verifier for a user.
 * Plaintext PIN is hashed with PBKDF2 and NEVER stored.
 */
export async function saveOfflinePinVerifier(
  userId: string,
  pin: string,
  database?: PosOfflineDatabase,
  validityMs = VERIFIER_VALIDITY_MS
): Promise<void> {
  const targetDb = database || db;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bufferToHex(salt.buffer);
  const hashHex = await derivePinHash(pin, salt);

  const verifier: StoredPinVerifier = {
    userId,
    saltHex,
    hashHex,
    failedAttempts: 0,
    lockedUntilMs: null,
    expiresAtMs: Date.now() + validityMs,
  };

  await targetDb.session.put({
    key: `pin_verifier_${userId}`,
    value: verifier,
  });
}

export type VerifyPinResult =
  | { success: true; error?: undefined }
  | { success: false; error: "LOCKED"; lockedUntilMs: number }
  | { success: false; error: "EXPIRED" }
  | { success: false; error: "NOT_FOUND" }
  | { success: false; error: "INVALID_PIN"; remainingAttempts: number };

/**
 * Verify an entered offline PIN against the stored verifier.
 */
export async function verifyOfflinePin(
  userId: string,
  pin: string,
  database?: PosOfflineDatabase
): Promise<VerifyPinResult> {
  const targetDb = database || db;
  const item = await targetDb.session.get(`pin_verifier_${userId}`);

  if (!item || !item.value) {
    return { success: false, error: "NOT_FOUND" };
  }

  const verifier = item.value as StoredPinVerifier;
  const now = Date.now();

  // 1. Check lockout
  if (verifier.lockedUntilMs && verifier.lockedUntilMs > now) {
    return {
      success: false,
      error: "LOCKED",
      lockedUntilMs: verifier.lockedUntilMs,
    };
  }

  // 2. Check expiration
  if (verifier.expiresAtMs < now) {
    return { success: false, error: "EXPIRED" };
  }

  // 3. Compute hash
  const salt = new Uint8Array(hexToBuffer(verifier.saltHex));
  const candidateHash = await derivePinHash(pin, salt);

  if (candidateHash === verifier.hashHex) {
    // Reset failed attempts on success
    verifier.failedAttempts = 0;
    verifier.lockedUntilMs = null;
    await targetDb.session.put({
      key: `pin_verifier_${userId}`,
      value: verifier,
    });
    return { success: true };
  }

  // 4. Failed attempt
  verifier.failedAttempts += 1;
  const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - verifier.failedAttempts);

  if (verifier.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    verifier.lockedUntilMs = now + LOCKOUT_DURATION_MS;
    await targetDb.session.put({
      key: `pin_verifier_${userId}`,
      value: verifier,
    });
    return {
      success: false,
      error: "LOCKED",
      lockedUntilMs: verifier.lockedUntilMs,
    };
  }

  await targetDb.session.put({
    key: `pin_verifier_${userId}`,
    value: verifier,
  });

  return {
    success: false,
    error: "INVALID_PIN",
    remainingAttempts: remaining,
  };
}
