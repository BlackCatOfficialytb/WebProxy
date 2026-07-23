import { Database } from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const DATA_DIR = join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "webproxy.db"), { verbose: null });

db.exec(`
  CREATE TABLE IF NOT EXISTS credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    credential TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'unknown',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(provider_id, name)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_credentials_provider ON credentials(provider_id);
  CREATE INDEX IF NOT EXISTS idx_credentials_priority ON credentials(provider_id, priority);
`);

const stmt = {
  // Credentials
  getCreds: db.prepare("SELECT id, provider_id, name, credential, priority, status FROM credentials WHERE provider_id = ? ORDER BY priority, id"),
  getCred: db.prepare("SELECT * FROM credentials WHERE id = ?"),
  addCred: db.prepare("INSERT INTO credentials (provider_id, name, credential, priority) VALUES (?, ?, ?, ?)"),
  delCred: db.prepare("DELETE FROM credentials WHERE id = ?"),
  updateCredStatus: db.prepare("UPDATE credentials SET status = ?, updated_at = strftime('%s', 'now') WHERE id = ?"),
  updateCredPriority: db.prepare("UPDATE credentials SET priority = ?, updated_at = strftime('%s', 'now') WHERE id = ?"),
  clearCreds: db.prepare("DELETE FROM credentials WHERE provider_id = ?"),

  // Settings
  getSetting: db.prepare("SELECT value FROM settings WHERE key = ?"),
  setSetting: db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s', 'now'))"),
  getAllSettings: db.prepare("SELECT key, value FROM settings"),
  exportAll: db.prepare("SELECT * FROM credentials"),
};

export function getCredentials(providerId) {
  return stmt.getCreds.all(providerId).map(row => ({
    id: row.id,
    name: row.name,
    cred: row.credential,
    priority: row.priority,
    status: row.status,
  }));
}

export function addCredential(providerId, name, credential, priority) {
  const info = stmt.addCred.run(providerId, name, credential, priority);
  return { id: info.lastInsertRowid, name, cred: credential, priority, status: "unknown" };
}

export function deleteCredential(id) {
  return stmt.delCred.run(id).changes > 0;
}

export function updateCredentialStatus(id, status) {
  stmt.updateCredStatus.run(status, id);
}

export function updateCredentialPriority(id, priority) {
  stmt.updateCredPriority.run(priority, id);
}

export function clearCredentials(providerId) {
  stmt.clearCreds.run(providerId);
}

export function getSetting(key, defaultValue = null) {
  const row = stmt.getSetting.get(key);
  return row ? row.value : defaultValue;
}

export function setSetting(key, value) {
  stmt.setSetting.run(key, value);
}

export function getAllSettings() {
  return Object.fromEntries(stmt.getAllSettings.all().map(r => [r.key, r.value]));
}

export function exportAll() {
  const creds = stmt.exportAll.all();
  const settings = getAllSettings();
  return { credentials: creds, settings };
}

export function importAll(data) {
  const tx = db.transaction((d) => {
    if (d.credentials) {
      stmt.clearCreds.run(); // clear all
      for (const c of d.credentials) {
        stmt.addCred.run(c.provider_id, c.name, c.credential, c.priority);
      }
    }
    if (d.settings) {
      for (const [k, v] of Object.entries(d.settings)) {
        stmt.setSetting.run(k, v);
      }
    }
  });
  tx(data);
}

export default db;