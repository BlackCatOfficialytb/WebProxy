import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { getSetting, setSetting } from "./db.mjs";

const SALT_ROUNDS = 12;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Fixed: previously referenced but never defined.
const passwordSessionStore = new Map();

let passwordHash = null;

export async function initializePasswordAuth() {
  const storedHash = getSetting("password_hash");
  if (storedHash) {
    passwordHash = storedHash;
    return;
  }
  const envPassword = process.env.WEBPROXY_PASSWORD;
  if (envPassword) {
    passwordHash = await hashPassword(envPassword);
    setSetting("password_hash", passwordHash);
    console.log("[auth] Initial admin password set from WEBPROXY_PASSWORD");
  } else {
    console.log("[auth] No admin password set - use settings page to set one");
  }
}

export function getSalt() {
  return bcrypt.genSaltSync(SALT_ROUNDS);
}

export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function hasAdminPassword() {
  return Boolean(passwordHash);
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

export default { initializePasswordAuth, isAuthenticated, createAuthToken, invalidateSession, requireAuth, hasAdminPassword };
