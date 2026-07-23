import bcrypt from "bcrypt";
import { getSetting, setSetting } from "./db.mjs";

const SALT_ROUNDS = 12;
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

export async function isAuthenticated(req, res) {
  const sessionToken = req.headers.cookie?.split(';')
    ?.find((c) => c.trim().startsWith('webproxy_session='))
    ?.split('=')[1];

  if (sessionToken && passwordSessionStore.has(sessionToken)) {
    return true;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (passwordSessionStore.has(token)) {
      return true;
    }

    if (passwordHash && await verifyPassword(token, passwordHash)) {
      const sessionId = crypto.randomUUID();
      passwordSessionStore.set(sessionId, {
        authenticated: true,
        created: Date.now(),
        userAgent: req.headers['user-agent'],
      });
      return sessionId;
    }
  }

  return false;
}

export function createAuthToken() {
  const token = crypto.randomUUID();
  passwordSessionStore.set(token, {
    authenticated: true,
    created: Date.now(),
  });
  return token;
}

export function invalidateSession(token) {
  if (token) passwordSessionStore.delete(token);
}
