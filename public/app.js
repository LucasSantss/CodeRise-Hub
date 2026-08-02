const STORAGE_KEY = "webhook_hub_admin_key";
let adminKey = localStorage.getItem(STORAGE_KEY) || "";
const openEventPanels = new Set(); // ids de clientes com o painel de eventos aberto
let pollTimer = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": adminKey,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

// ─── Login ──────────────────────────────────────────────────────────────────
const loginModal = document.getElementById("loginModal");
const adminKeyInput = document.getElementById("adminKeyInput");
const loginError = document.getElementById("loginError");

async function trySession() {
  if (!adminKey) return showLogin();
  try {
    await api("/api/session");
    loginModal.style.display = "none";
    boot();
  } catch {
    showLogin();
  }
}

function showLogin() {
  loginModal.style.display = "flex";
  adminKeyInput.focus();
}

document.getElementById("loginBtn").addEventListener("click", async () => {
  adminKey = adminKeyInput.value.trim();
  loginError.style.display = "none";
  try {
    await api("/api/session");
    localStorage.setItem(STORAGE_KEY, adminKey);
    loginModal.style.display = "none";
    boot();
  } catch (err) {
    loginError.textContent = "Chave inválida. Verifique o console do servidor.";
    loginError.style.display = "block";
  }
});
adminKeyInput.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("loginBtn").click(); });

// ─── Clientes ───────────────────────────────────────────────────────────────
const clientsList = document.getElementById("clientsList");
const emptyState = document.getElementById("emptyState");
const cardTemplate = document.getElementById("clientCardTemplate");
const eventTemplate = document.getElementById("eventItemTemplate");

async function loadClients() {
  const { clients } = await api("/api/clients");
  clientsList.innerHTML = "";
  emptyState.style.display = clients.length ? "none" : "block";
  for (const client of clients) renderClientCard(client);
}

function renderClientCard(client) {
  const node = cardTemplate.content.cloneNode(true);
  const card = node.querySelector(".client-card");
  card.dataset.id = client.id;

  card.querySelector(".client-name").textContent = client.name;
  const badge = card.querySelector(".status-badge");
  badge.classList.add(client.active ? "on" : "off");

  const toggleBtn = card.querySelector(".toggle-active-btn");
  toggleBtn.title = client.active ? "Desativar" : "Ativar";
  toggleBtn.addEventListener("click", async () => {
    await api(`/api/clients/${client.id}`, { method: "PATCH", body: JSON.stringify({ active: !client.active }) });
    loadClients();
  });

  card.querySelector(".delete-btn").addEventListener("click", async () => {
    if (!confirm(`Excluir o cliente "${client.name}"? A URL de webhook deixará de funcionar.`)) return;
    await api(`/api/clients/${client.id}`, { method: "DELETE" });
    openEventPanels.delete(client.id);
    loadClients();
  });

  const urlInput = card.querySelector(".webhook-url");
  urlInput.value = client.webhookUrl;
  card.querySelector(".copy-btn").addEventListener("click", async (e) => {
    await navigator.clipboard.writeText(client.webhookUrl);
    const btn = e.currentTarget;
    const original = btn.textContent;
    btn.textContent = "✓";
    setTimeout(() => (btn.textContent = original), 1200);
  });

  const botInput = card.querySelector(".telegram-bot-token");
  const chatInput = card.querySelector(".telegram-chat-id");
  botInput.value = client.telegramBotTokenMasked || "";
  chatInput.value = client.telegramChatId || "";
  const telegramStatus = card.querySelector(".telegram-status");
  telegramStatus.textContent = client.telegramConfigured ? "Configurado" : "Não configurado";
  if (client.telegramConfigured) telegramStatus.classList.add("ok");

  card.querySelector(".save-telegram-btn").addEventListener("click", async () => {
    const botValue = botInput.value.trim();
    const payload = { telegramChatId: chatInput.value.trim() || null };
    // Só atualiza o token se o usuário digitou um novo valor (não o placeholder mascarado)
    if (botValue && !botValue.startsWith("••••••")) payload.telegramBotToken = botValue;
    if (!botValue) payload.telegramBotToken = null;
    try {
      await api(`/api/clients/${client.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      telegramStatus.textContent = "Salvo com sucesso";
      telegramStatus.className = "telegram-status ok";
      loadClients();
    } catch (err) {
      telegramStatus.textContent = err.message;
      telegramStatus.className = "telegram-status err";
    }
  });

  card.querySelector(".test-telegram-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api(`/api/clients/${client.id}/test-telegram`, { method: "POST" });
      telegramStatus.textContent = "Mensagem de teste enviada!";
      telegramStatus.className = "telegram-status ok";
    } catch (err) {
      telegramStatus.textContent = err.message;
      telegramStatus.className = "telegram-status err";
    } finally {
      btn.disabled = false;
    }
  });

  const eventCountEl = card.querySelector(".event-count");
  eventCountEl.textContent = client.eventCount;
  const eventsPanel = card.querySelector(".events-panel");
  const toggleEventsBtn = card.querySelector(".toggle-events-btn");
  if (openEventPanels.has(client.id)) {
    eventsPanel.style.display = "flex";
    loadEvents(client.id, eventsPanel);
  }
  toggleEventsBtn.addEventListener("click", () => {
    const isOpen = eventsPanel.style.display !== "none";
    if (isOpen) {
      eventsPanel.style.display = "none";
      openEventPanels.delete(client.id);
    } else {
      eventsPanel.style.display = "flex";
      openEventPanels.add(client.id);
      loadEvents(client.id, eventsPanel);
    }
  });

  clientsList.appendChild(node);
}

async function loadEvents(clientId, panelEl) {
  const list = panelEl.querySelector(".events-list");
  try {
    const { events } = await api(`/api/clients/${clientId}/events?limit=50`);
    list.innerHTML = "";
    if (!events.length) {
      list.innerHTML = '<p class="muted">Nenhum evento recebido ainda.</p>';
      return;
    }
    for (const ev of events) {
      const node = eventTemplate.content.cloneNode(true);
      node.querySelector(".event-title").textContent = ev.title;
      node.querySelector(".event-time").textContent = new Date(ev.receivedAt).toLocaleString("pt-BR");
      node.querySelector(".event-message").textContent = ev.message;
      list.appendChild(node);
    }
  } catch (err) {
    list.innerHTML = `<p class="muted">Erro ao carregar eventos: ${err.message}</p>`;
  }
}

document.getElementById("createClientBtn").addEventListener("click", async () => {
  const input = document.getElementById("newClientName");
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  await api("/api/clients", { method: "POST", body: JSON.stringify({ name }) });
  input.value = "";
  loadClients();
});
document.getElementById("newClientName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("createClientBtn").click();
});

function boot() {
  loadClients();
  if (pollTimer) clearInterval(pollTimer);
  // Atualiza a lista (contagens, últimos eventos) e os painéis abertos periodicamente
  pollTimer = setInterval(loadClients, 5000);
}

trySession();
