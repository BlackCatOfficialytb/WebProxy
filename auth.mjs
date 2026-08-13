import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { getSetting, setSetting } from "./db.mjs";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BCRYPT_ROUNDS = 12;

// Fixed: previously referenced but never defined.
const passwordSessionStore = new Map();

let passwordHash = null;

// Function to hash a password using bcrypt with a random salt
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
  return await bcrypt.hash(password, salt);
}

// Function to verify a password against a bcrypt hash (or legacy SHA-256)
export async function verifyPassword(password, hash) {
  if (!hash) return false;
  // bcrypt hashes start with $2 (e.g. $2a$, $2b$)
  if (hash.startsWith("$2")) {
    return await bcrypt.compare(password, hash);
  }
  // Legacy SHA-256 hashes (64 hex chars) — still verified, migrated on next change
  const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
  return legacyHash === hash;
}

export async function initializePasswordAuth() {
  const storedHash = getSetting("password_hash");
  if (storedHash) {
    passwordHash = storedHash;
    return;
  }
  const envPassword = process.env.WEBPROXY_PASSWORD;
  if (envPassword) {
    passwordHash = await hashPassword(envPassword);
    await setSetting("password_hash", passwordHash);
    console.log("[auth] Initial admin password set from WEBPROXY_PASSWORD");
  } else {
    // Set to default password "123456"
    const defaultPassword = "123456";
    passwordHash = await hashPassword(defaultPassword);
    await setSetting("password_hash", passwordHash);
    console.log("[auth] No admin password set - set default password");
  }
}

export function hasAdminPassword() {
  return Boolean(passwordHash);
}

export function getPasswordHash() {
  return passwordHash;
}

function pruneExpired() {
  const now = Date.now();
  for (const [id, s] of passwordSessionStore) {
    if (now - s.created > SESSION_TTL_MS) passwordSessionStore.delete(id);
  }
}

// Resolve a token from Cookie or Bearer header; verify password if needed.
async function resolveToken(req) {
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("webproxy_session="));
  if (cookie) {
    const sessionId = cookie.split("=")[1];
    if (sessionId && passwordSessionStore.has(sessionId)) return sessionId;
  }

  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (!token) return null;
    if (passwordSessionStore.has(token)) return token;
    // Stateless fallback: the admin password itself as Bearer token.
    if (passwordHash && (await verifyPassword(token, passwordHash))) {
      const sid = crypto.randomUUID();
      passwordSessionStore.set(sid, { authenticated: true, created: Date.now() });
      return sid;
    }
  }
  return null;
}

export async function isAuthenticated(req) {
  pruneExpired();
  const token = await resolveToken(req);
  return token ? token : false;
}

export function createAuthToken() {
  const token = crypto.randomUUID();
  passwordSessionStore.set(token, { authenticated: true, created: Date.now() });
  return token;
}

export function invalidateSession(token) {
  if (token) passwordSessionStore.delete(token);
}

// Returns true when the request is authenticated, false otherwise.
export async function requireAuth(req) {
  pruneExpired();
  return Boolean(await resolveToken(req));
}

export default { initializePasswordAuth, isAuthenticated, createAuthToken, invalidateSession, requireAuth, hasAdminPassword, getPasswordHash, verifyPassword, hashPassword };
