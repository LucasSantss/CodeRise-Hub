-- 001_create_tables.sql
-- Cria as tabelas para clients, client_events e app_settings (Postgres)

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
