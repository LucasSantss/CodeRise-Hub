/**
 * lib/db.js
 * Persistência local com fallback para Postgres quando DATABASE_URL está definido.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.VERCEL
  ? path.join(os.tmpdir(), "plataforma-acompanhamento-data.json")
  : path.join(__dirname, "..", "data", "data.json");

const DATABASE_URL = process.env.DATABASE_URL?.replace(/^['"]|['"]$/g, "") || null;
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadDb() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    const initial = { adminKey: null, clients: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return { adminKey: null, clients: [] };
  }
}

export function saveDb(db) {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

async function query(text, params = []) {
  if (!pool) throw new Error("DATABASE_URL não está definido.");
  const result = await pool.query(text, params);
  return result;
}

function mapClientRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    active: row.active,
    telegramBotToken: row.telegram_bot_token,
    telegramChatId: row.telegram_chat_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    eventCount: row.event_count !== undefined ? Number(row.event_count) : undefined,
    lastEventAt: row.last_event_at,
  };
}

function mapEventRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    receivedAt: row.received_at,
    type: row.type,
    title: row.title,
    message: row.message,
    raw: row.raw,
  };
}

export async function ensurePostgresTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS clients (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      token text NOT NULL UNIQUE,
      active boolean NOT NULL DEFAULT true,
      telegram_bot_token text,
      telegram_chat_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS client_events (
      id uuid PRIMARY KEY,
      client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      received_at timestamptz NOT NULL DEFAULT now(),
      type text NOT NULL DEFAULT 'unknown',
      title text NOT NULL DEFAULT '(sem título)',
      message text NOT NULL DEFAULT '',
      raw jsonb NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      name text PRIMARY KEY,
      value text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_client_events_client_id ON client_events(client_id);
    CREATE INDEX IF NOT EXISTS idx_client_events_received_at ON client_events(received_at);
  `);
}

export async function getAdminKeyFromPostgres() {
  const res = await query("SELECT value FROM app_settings WHERE name = $1 LIMIT 1", ["admin_key"]);
  return res.rows[0] ? res.rows[0].value : null;
}

export async function setAdminKeyPostgres(key) {
  if (!key) return;
  await query(
    `INSERT INTO app_settings (name, value, created_at, updated_at)
     VALUES ($1, $2, now(), now())
     ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    ["admin_key", key]
  );
}

export async function getAllClientsFromPostgres() {
  const res = await query(
    `SELECT c.id, c.name, c.token, c.active, c.telegram_bot_token, c.telegram_chat_id,
            c.created_at, c.updated_at,
            COUNT(e.id) AS event_count,
            MAX(e.received_at) AS last_event_at
     FROM clients c
     LEFT JOIN client_events e ON e.client_id = c.id
     GROUP BY c.id
     ORDER BY c.created_at DESC`
  );
  return res.rows.map(mapClientRow);
}

export async function getClientByIdFromPostgres(id) {
  const res = await query("SELECT * FROM clients WHERE id = $1 LIMIT 1", [id]);
  return mapClientRow(res.rows[0]);
}

export async function getClientByTokenFromPostgres(token) {
  const res = await query("SELECT * FROM clients WHERE token = $1 LIMIT 1", [token]);
  return mapClientRow(res.rows[0]);
}

export async function createClientInPostgres(client) {
  const res = await query(
    `INSERT INTO clients (id, name, token, active, telegram_bot_token, telegram_chat_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [client.id, client.name, client.token, client.active, client.telegramBotToken, client.telegramChatId, client.createdAt, client.updatedAt]
  );
  return mapClientRow(res.rows[0]);
}

export async function updateClientInPostgres(id, updates) {
  const fields = [];
  const values = [];
  if (updates.name !== undefined) {
    values.push(updates.name);
    fields.push(`name = $${values.length}`);
  }
  if (updates.active !== undefined) {
    values.push(updates.active);
    fields.push(`active = $${values.length}`);
  }
  if (updates.telegramBotToken !== undefined) {
    values.push(updates.telegramBotToken);
    fields.push(`telegram_bot_token = $${values.length}`);
  }
  if (updates.telegramChatId !== undefined) {
    values.push(updates.telegramChatId);
    fields.push(`telegram_chat_id = $${values.length}`);
  }
  if (fields.length === 0) return null;
  values.push(id);
  const res = await query(
    `UPDATE clients SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values
  );
  return mapClientRow(res.rows[0]);
}

export async function deleteClientFromPostgres(id) {
  await query("DELETE FROM clients WHERE id = $1", [id]);
}

export async function getClientEventsFromPostgres(clientId, limit = 50) {
  const res = await query(
    `SELECT id, received_at, type, title, message, raw
     FROM client_events
     WHERE client_id = $1
     ORDER BY received_at DESC
     LIMIT $2`,
    [clientId, limit]
  );
  return res.rows.map(mapEventRow);
}

export async function addClientEventToPostgres(clientId, event) {
  await query(
    `INSERT INTO client_events (id, client_id, received_at, type, title, message, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [event.id, clientId, event.receivedAt, event.type, event.title, event.message, event.raw]
  );
}
