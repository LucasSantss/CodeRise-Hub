/**
 * server.js
 * Central de Webhooks de Erro — cada "cliente" cadastrado recebe uma URL de
 * webhook exclusiva. Erros enviados para essa URL (em JSON) ficam registrados
 * no painel e, se configurado, são encaminhados em tempo real para o Telegram.
 */
import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
// Carrega variáveis do .env em ambiente de desenvolvimento
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  await import('dotenv/config');
}
import {
  loadDb,
  saveDb,
  getAdminKeyFromPostgres,
  setAdminKeyPostgres,
  ensurePostgresTables,
  getAllClientsFromPostgres,
  getClientByIdFromPostgres,
  getClientByTokenFromPostgres,
  createClientInPostgres,
  updateClientInPostgres,
  deleteClientFromPostgres,
  getClientEventsFromPostgres,
  addClientEventToPostgres,
} from "./lib/db.js";
import { sendTelegramMessage, escapeHtml } from "./lib/telegram.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MAX_EVENTS_PER_CLIENT = 300;

const db = loadDb();
if (process.env.DATABASE_URL) {
  await ensurePostgresTables();
  const pgKey = await getAdminKeyFromPostgres();
  if (pgKey) {
    db.adminKey = pgKey;
  } else {
    if (!db.adminKey) {
      db.adminKey = crypto.randomBytes(24).toString("hex");
      saveDb(db);
    }
    await setAdminKeyPostgres(db.adminKey);
  }
} else {
  if (!db.adminKey) {
    db.adminKey = crypto.randomBytes(24).toString("hex");
    saveDb(db);
  }
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function requireAdmin(req, res, next) {
  const key = req.header("x-admin-key");
  if (!key) return res.status(401).json({ success: false, message: "Chave de administrador inválida." });

  if (process.env.DATABASE_URL) {
    try {
      const pgKey = await getAdminKeyFromPostgres();
      if (!pgKey || key !== pgKey) return res.status(401).json({ success: false, message: "Chave de administrador inválida." });
      return next();
    } catch (err) {
      console.error('Erro ao validar admin key no Postgres:', err.message);
      return res.status(500).json({ success: false, message: 'Erro interno ao validar chave.' });
    }
  }

  if (key !== db.adminKey) return res.status(401).json({ success: false, message: "Chave de administrador inválida." });
  next();
}

function webhookUrlFor(req, token) {
  return `${req.protocol}://${req.get("host")}/webhook/${token}`;
}

function publicClient(req, c) {
  const eventCount = c.eventCount ?? c.events?.length ?? 0;
  const lastEventAt = c.lastEventAt ?? c.events?.[0]?.receivedAt ?? null;

  return {
    id: c.id,
    name: c.name,
    token: c.token,
    webhookUrl: webhookUrlFor(req, c.token),
    active: c.active,
    telegramConfigured: !!(c.telegramBotToken && c.telegramChatId),
    telegramChatId: c.telegramChatId || null,
    telegramBotTokenMasked: c.telegramBotToken ? `••••••${c.telegramBotToken.slice(-4)}` : null,
    eventCount,
    lastEventAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ─── Sessão ────────────────────────────────────────────────────────────────────
app.get("/api/session", requireAdmin, (req, res) => res.json({ success: true }));

// ─── Clientes ──────────────────────────────────────────────────────────────────
app.get("/api/clients", requireAdmin, (req, res) => {
  res.json({ success: true, clients: db.clients.map((c) => publicClient(req, c)) });
});

app.post("/api/clients", requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, message: "Nome do cliente é obrigatório." });
  }
  const now = new Date().toISOString();
  const client = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    token: crypto.randomBytes(20).toString("hex"),
    active: true,
    telegramBotToken: null,
    telegramChatId: null,
    events: [],
    createdAt: now,
    updatedAt: now,
  };
  db.clients.unshift(client);
  saveDb(db);
  res.status(201).json({ success: true, client: publicClient(req, client) });
});

app.patch("/api/clients/:id", requireAdmin, (req, res) => {
  const client = db.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ success: false, message: "Cliente não encontrado." });

  const { name, active, telegramBotToken, telegramChatId } = req.body || {};
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ success: false, message: "Nome não pode ser vazio." });
    client.name = String(name).trim();
  }
  if (active !== undefined) client.active = !!active;
  if (telegramBotToken !== undefined) client.telegramBotToken = telegramBotToken ? String(telegramBotToken).trim() : null;
  if (telegramChatId !== undefined) client.telegramChatId = telegramChatId ? String(telegramChatId).trim() : null;
  client.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json({ success: true, client: publicClient(req, client) });
});

app.delete("/api/clients/:id", requireAdmin, (req, res) => {
  const idx = db.clients.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Cliente não encontrado." });
  db.clients.splice(idx, 1);
  saveDb(db);
  res.json({ success: true });
});

app.get("/api/clients/:id/events", requireAdmin, (req, res) => {
  const client = db.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ success: false, message: "Cliente não encontrado." });
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_EVENTS_PER_CLIENT);
  res.json({ success: true, events: client.events.slice(0, limit) });
});

app.post("/api/clients/:id/test-telegram", requireAdmin, async (req, res) => {
  let client;
  if (process.env.DATABASE_URL) {
    client = await getClientByIdFromPostgres(req.params.id);
  } else {
    client = db.clients.find((c) => c.id === req.params.id);
  }
  if (!client) return res.status(404).json({ success: false, message: "Cliente não encontrado." });
  if (!client.telegramBotToken || !client.telegramChatId) {
    return res.status(400).json({ success: false, message: "Configure o bot e o chat ID do Telegram antes de testar." });
  }
  await sendTelegramMessage(
    client.telegramBotToken,
    client.telegramChatId,
    `🔔 <b>Teste de conexão</b>\nCliente: ${escapeHtml(client.name)}\n\nSe você recebeu esta mensagem, a integração com o Telegram está funcionando.`
  );
  res.json({ success: true });
});

// ─── Webhook receiver (público — chamado pelos sistemas dos clientes) ──────────
app.post("/webhook/:token", async (req, res) => {
  let client;
  if (process.env.DATABASE_URL) {
    client = await getClientByTokenFromPostgres(req.params.token);
  } else {
    client = db.clients.find((c) => c.token === req.params.token);
  }
  if (!client) return res.status(404).json({ success: false, message: "Webhook não encontrado." });

  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const event = {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    type: payload.type || "unknown",
    title: payload.title || "(sem título)",
    message: payload.message || "",
    raw: payload,
  };

  if (process.env.DATABASE_URL) {
    await addClientEventToPostgres(client.id, event);
  } else {
    client.events.unshift(event);
    if (client.events.length > MAX_EVENTS_PER_CLIENT) client.events.length = MAX_EVENTS_PER_CLIENT;
    saveDb(db);
  }

  // Responde imediatamente ao chamador — o encaminhamento ao Telegram roda em
  // paralelo, sem bloquear nem depender da resposta deste webhook.
  if (client.active && client.telegramBotToken && client.telegramChatId) {
    const text =
      `🚨 <b>${escapeHtml(event.title)}</b>\n` +
      `Cliente: ${escapeHtml(client.name)}\n\n` +
      `${escapeHtml(event.message)}\n\n` +
      `<i>${new Date(event.receivedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</i>`;
    sendTelegramMessage(client.telegramBotToken, client.telegramChatId, text);
  }

  res.status(200).json({ success: true });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log("\n=== Central de Webhooks de Erro ===");
    console.log(`Painel:         http://localhost:${PORT}`);
    console.log(`Chave de admin: ${db.adminKey}`);
    console.log("(cole esta chave no painel na primeira vez que abrir — ela fica salva no navegador depois)\n");
  });
}

export default app;
