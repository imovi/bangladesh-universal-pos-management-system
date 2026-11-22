#!/usr/bin/env node
/**
 * scripts/gen-secrets.cjs
 *
 * Generates cryptographically secure random secrets for production deployment.
 * Prints to stdout only. NEVER writes any file or touches disk.
 */

const crypto = require("crypto");

function generateHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function generateBase64Url(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

const postgresPassword = generateBase64Url(24);
const runtimePassword = generateBase64Url(24);
const jwtAccessSecret = generateHex(32); // 64 hex chars = 32 bytes
const jwtRefreshSecret = generateHex(32); // 64 hex chars = 32 bytes

console.log("# === Generated Production Secrets ===");
console.log("# Copy and paste these into your deploy/.env.production file:");
console.log("");
console.log(`POSTGRES_PASSWORD=${postgresPassword}`);
console.log(`POSTGRES_RUNTIME_PASSWORD=${runtimePassword}`);
console.log(`JWT_ACCESS_SECRET=${jwtAccessSecret}`);
console.log(`JWT_REFRESH_SECRET=${jwtRefreshSecret}`);
console.log("");
console.log("# === End of Generated Secrets ===");
