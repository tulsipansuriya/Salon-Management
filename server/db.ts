import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const databasePath = resolve(process.env.DATABASE_PATH ?? 'data/salon.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })

export const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.exec(`CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`)

db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    name_en TEXT NOT NULL,
    name_gu TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
    price_inr INTEGER NOT NULL CHECK(price_inr >= 0),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS barbers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    on_break INTEGER NOT NULL DEFAULT 0 CHECK(on_break IN (0, 1)),
    on_duty INTEGER NOT NULL DEFAULT 1 CHECK(on_duty IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS queue_entries (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    token_day TEXT NOT NULL,
    token_number INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    service_ids TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    price_inr INTEGER NOT NULL,
    preferred_barber TEXT,
    status TEXT NOT NULL DEFAULT 'Waiting',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS queue_phone_status_idx ON queue_entries(phone, status);
  CREATE INDEX IF NOT EXISTS queue_day_idx ON queue_entries(token_day, token_number);
`)

const seedServices = db.prepare(`INSERT OR IGNORE INTO services
  (id, name_en, name_gu, duration_minutes, price_inr) VALUES (?, ?, ?, ?, ?)`)
const seedBarber = db.prepare('INSERT OR IGNORE INTO barbers (id, name) VALUES (?, ?)')
const seed = db.transaction(() => {
  [
    ['haircut', 'Haircut', 'હેરકટ', 30, 150],
    ['beard-trim', 'Beard Trim', 'દાઢી ટ્રિમ', 15, 80],
    ['hair-spa', 'Hair Spa', 'હેર સ્પા', 45, 400],
    ['head-massage', 'Head Massage', 'માથાની મસાજ', 20, 120],
    ['hair-color', 'Hair Color', 'હેર કલર', 40, 350],
    ['facial-cleanup', 'Facial Cleanup', 'ફેશિયલ ક્લીનઅપ', 30, 250],
  ].forEach((service) => seedServices.run(...service))
  ;['Ravi', 'Amit', 'Imran'].forEach((name) => seedBarber.run(name.toLowerCase(), name))
  db.prepare(`INSERT OR IGNORE INTO app_meta (key, value) VALUES ('online_queue_open', '1')`).run()
})
seed()
