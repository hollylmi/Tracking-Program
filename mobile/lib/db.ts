import * as SQLite from 'expo-sqlite'
import { LocalEntry, LocalBreakdown, CachedProject } from '../types'

const db = SQLite.openDatabaseSync('plytrack.db')

// ── Schema ────────────────────────────────────────────────────────────────────

export function initDB(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS entries (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id                TEXT UNIQUE NOT NULL,
      server_id               INTEGER,
      project_id              INTEGER NOT NULL,
      entry_date              TEXT NOT NULL,
      lot_number              TEXT,
      location                TEXT,
      material                TEXT,
      num_people              INTEGER DEFAULT 0,
      install_hours           REAL DEFAULT 0,
      install_sqm             REAL DEFAULT 0,
      delay_hours             REAL DEFAULT 0,
      delay_billable          INTEGER DEFAULT 1,
      delay_reason            TEXT,
      delay_description       TEXT,
      notes                   TEXT,
      other_work_description  TEXT,
      machines_stood_down     INTEGER DEFAULT 0,
      weather                 TEXT,
      form_opened_at          TEXT,
      synced                  INTEGER DEFAULT 0,
      created_at              TEXT DEFAULT (datetime('now')),
      updated_at              TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS breakdowns (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id          TEXT UNIQUE NOT NULL,
      server_id         INTEGER,
      machine_id        INTEGER NOT NULL,
      breakdown_date    TEXT NOT NULL,
      description       TEXT NOT NULL,
      resolved          INTEGER DEFAULT 0,
      resolution_notes  TEXT,
      synced            INTEGER DEFAULT 0,
      created_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id            INTEGER PRIMARY KEY,
      name          TEXT NOT NULL,
      start_date    TEXT,
      active        INTEGER DEFAULT 1,
      quoted_days   INTEGER,
      hours_per_day REAL,
      cached_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reference_data (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      key        TEXT UNIQUE NOT NULL,
      value      TEXT NOT NULL,
      cached_at  TEXT DEFAULT (datetime('now'))
    );
  `)
}

// ── Entries ───────────────────────────────────────────────────────────────────

export function saveEntry(entry: LocalEntry): void {
  db.runSync(
    `INSERT OR REPLACE INTO entries (
      local_id, server_id, project_id, entry_date, lot_number, location,
      material, num_people, install_hours, install_sqm, delay_hours,
      delay_billable, delay_reason, delay_description, notes,
      other_work_description, machines_stood_down, weather,
      form_opened_at, synced, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, datetime('now')
    )`,
    entry.local_id,
    entry.server_id ?? null,
    entry.project_id,
    entry.entry_date,
    entry.lot_number ?? null,
    entry.location ?? null,
    entry.material ?? null,
    entry.num_people ?? 0,
    entry.install_hours ?? 0,
    entry.install_sqm ?? 0,
    entry.delay_hours ?? 0,
    entry.delay_billable != null ? (entry.delay_billable ? 1 : 0) : 1,
    entry.delay_reason ?? null,
    entry.delay_description ?? null,
    entry.notes ?? null,
    entry.other_work_description ?? null,
    entry.machines_stood_down != null ? (entry.machines_stood_down ? 1 : 0) : 0,
    entry.weather ?? null,
    entry.form_opened_at ?? null,
    entry.synced ?? 0,
    entry.created_at ?? null,
  )
}

export function getUnsyncedEntries(): LocalEntry[] {
  return db.getAllSync<LocalEntry>(
    `SELECT * FROM entries WHERE synced = 0 ORDER BY created_at ASC`
  )
}

export function markEntrySynced(localId: string, serverId: number): void {
  db.runSync(
    `UPDATE entries SET synced = 1, server_id = ?, updated_at = datetime('now')
     WHERE local_id = ?`,
    serverId,
    localId,
  )
}

export function getEntries(projectId: number): LocalEntry[] {
  return db.getAllSync<LocalEntry>(
    `SELECT * FROM entries WHERE project_id = ? ORDER BY entry_date DESC`,
    projectId,
  )
}

export function deleteEntry(localId: string): void {
  db.runSync(`DELETE FROM entries WHERE local_id = ?`, localId)
}

// ── Breakdowns ────────────────────────────────────────────────────────────────

export function saveBreakdown(breakdown: LocalBreakdown): void {
  db.runSync(
    `INSERT OR REPLACE INTO breakdowns (
      local_id, server_id, machine_id, breakdown_date, description,
      resolved, resolution_notes, synced, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    breakdown.local_id,
    breakdown.server_id ?? null,
    breakdown.machine_id,
    breakdown.breakdown_date,
    breakdown.description,
    breakdown.resolved ? 1 : 0,
    breakdown.resolution_notes ?? null,
    breakdown.synced ?? 0,
    breakdown.created_at ?? null,
  )
}

export function getUnsyncedBreakdowns(): LocalBreakdown[] {
  return db.getAllSync<LocalBreakdown>(
    `SELECT * FROM breakdowns WHERE synced = 0 ORDER BY created_at ASC`
  )
}

export function markBreakdownSynced(localId: string, serverId: number): void {
  db.runSync(
    `UPDATE breakdowns SET synced = 1, server_id = ? WHERE local_id = ?`,
    serverId,
    localId,
  )
}

// ── Projects ──────────────────────────────────────────────────────────────────

export function saveProjects(projects: CachedProject[]): void {
  for (const p of projects) {
    db.runSync(
      `INSERT OR REPLACE INTO projects (
        id, name, start_date, active, quoted_days, hours_per_day, cached_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      p.id,
      p.name,
      p.start_date ?? null,
      p.active ?? 1,
      p.quoted_days ?? null,
      p.hours_per_day ?? null,
    )
  }
}

export function getProjects(): CachedProject[] {
  return db.getAllSync<CachedProject>(`SELECT * FROM projects`)
}

// ── Reference data ────────────────────────────────────────────────────────────

export function saveReferenceData(key: string, value: unknown): void {
  db.runSync(
    `INSERT OR REPLACE INTO reference_data (key, value, cached_at)
     VALUES (?, ?, datetime('now'))`,
    key,
    JSON.stringify(value),
  )
}

export function getReferenceData(key: string): unknown | null {
  const row = db.getFirstSync<{ value: string }>(
    `SELECT value FROM reference_data WHERE key = ?`,
    key,
  )
  return row ? JSON.parse(row.value) : null
}
