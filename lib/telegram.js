/**
 * lib/telegram.js
 * Encaminha eventos recebidos via webhook para o Telegram usando a Bot API.
 * Nunca lança — uma falha no Telegram não pode derrubar o recebimento do webhook.
 */
export async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[telegram] HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
  } catch (err) {
    console.error("[telegram] Falha ao enviar mensagem:", err.message);
  } finally {
    clearTimeout(timeout);
  }
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export function buildTelegramEventMessage(clientName, event) {
  const messageText = event.message?.trim() ? event.message : JSON.stringify(event.raw ?? {}, null, 2);
  return (
    `🚨 <b>${escapeHtml(event.title)}</b>\n` +
    `Cliente: ${escapeHtml(clientName)}\n\n` +
    `${escapeHtml(messageText)}\n\n` +
    `<i>${new Date(event.receivedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</i>`
  );
}
