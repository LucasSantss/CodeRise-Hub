/**
 * lib/db.js
 * Armazenamento simples em arquivo JSON — sem dependências nativas, roda em
 * qualquer máquina com Node apenas rodando "npm install".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.VERCEL
  ? path.join(os.tmpdir(), "plataforma-acompanhamento-data.json")
  : path.join(__dirname, "..", "data", "data.json");

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
