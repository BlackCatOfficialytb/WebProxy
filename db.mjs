// File-backed JSON store replacing better-sqlite3.
// The previous implementation required a native module that fails to load on
// many Node builds (CJS named-export error / segfault), which made the whole
// server unbootable. This keeps the same API surface with zero native deps.
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const DATA_DIR = join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = join(DATA_DIR, "webproxy.json");

function load() {
  if (!existsSync(DB_FILE)) return { credentials: [], settings: {} };
  try {
    return JSON.parse(readFileSync(DB_FILE, "utf8"));
  } catch {
    return { credentials: [], settings: {} };
  }
}

function save(state) {
  writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
}

function createInitialStateIfMissing() {
  if (!existsSync(DB_FILE)) save({ credentials: [], settings: {} });
}
createInitialStateIfMissing();

let autoId = load().credentials.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0) + 1;

export function getCredentials(providerId) {
  const state = load();
  return state.credentials
    .filter((c) => c.provider_id === providerId)
    .sort((a, b) => (a.priority || 1) - (b.priority || 1))
    .map((row) => ({
      id: row.id,
      name: row.name,
      cred: row.credential,
      priority: row.priority,
      status: row.status,
    }));
}

export function addCredential(providerId, name, credential, priority) {
  const state = load();
  const id = autoId++;
  state.credentials.push({
    id,
    provider_id: providerId,
    name,
    credential,
    priority: priority ?? 1,
    status: "unknown",
  });
  save(state);
  return { id, name, cred: credential, priority, status: "unknown" };
}

export function deleteCredential(id) {
  const state = load();
  const before = state.credentials.length;
  state.credentials = state.credentials.filter((c) => Number(c.id) !== Number(id));
  save(state);
  return state.credentials.length < before;
}

export function updateCredentialStatus(id, status) {
  const state = load();
  const c = state.credentials.find((x) => Number(x.id) === Number(id));
  if (c) { c.status = status; save(state); }
}

export function updateCredentialPriority(id, priority) {
  const state = load();
  const c = state.credentials.find((x) => Number(x.id) === Number(id));
  if (c) { c.priority = priority; save(state); }
}

export function clearCredentials(providerId) {
  const state = load();
  state.credentials = state.credentials.filter((c) => c.provider_id !== providerId);
  save(state);
}

export function getSetting(key, defaultValue = null) {
  const state = load();
  return state.settings[key] ?? defaultValue;
}

export function setSetting(key, value) {
  const state = load();
  state.settings[key] = String(value);
  save(state);
}

export function getAllSettings() {
  return load().settings;
}

export function exportAll() {
  const state = load();
  return { credentials: state.credentials, settings: state.settings };
}

export function importAll(data) {
  const state = load();
  if (data.credentials) state.credentials = data.credentials;
  if (data.settings) state.settings = { ...state.settings, ...data.settings };
  save(state);
}

export default {
  getCredentials,
  addCredential,
  deleteCredential,
  updateCredentialStatus,
  updateCredentialPriority,
  clearCredentials,
  getSetting,
  setSetting,
  getAllSettings,
  exportAll,
  importAll,
};
