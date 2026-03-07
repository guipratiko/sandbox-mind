/**
 * Service para gerenciar escuta temporária de webhooks
 * Armazena webhooks recebidos por até 3 minutos
 */

interface WebhookData {
  nodeId: string;
  body: any;
  receivedAt: Date;
  expiresAt: Date;
}

// Armazenamento em memória (será limpo automaticamente)
const webhookStore: Map<string, WebhookData> = new Map();

// Limpar webhooks expirados a cada minuto
setInterval(() => {
  const now = new Date();
  for (const [nodeId, data] of webhookStore.entries()) {
    if (now > data.expiresAt) {
      webhookStore.delete(nodeId);
      console.log(`🧹 Webhook expirado removido para nó ${nodeId}`);
    }
  }
}, 60000); // Verificar a cada minuto

/**
 * Armazenar webhook recebido
 */
export function storeWebhook(nodeId: string, body: any): void {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3 * 60 * 1000); // 3 minutos

  webhookStore.set(nodeId, {
    nodeId,
    body,
    receivedAt: now,
    expiresAt,
  });

  console.log(`📥 Webhook armazenado para nó ${nodeId} (expira em 3 minutos)`);
}

/**
 * Obter webhook recebido (e removê-lo do armazenamento)
 */
export function getAndRemoveWebhook(nodeId: string): WebhookData | null {
  const data = webhookStore.get(nodeId);
  if (data) {
    webhookStore.delete(nodeId);
    console.log(`📤 Webhook recuperado e removido para nó ${nodeId}`);
    return data;
  }
  return null;
}

/**
 * Verificar se há webhook disponível (sem remover)
 */
export function hasWebhook(nodeId: string): boolean {
  const data = webhookStore.get(nodeId);
  if (!data) {
    return false;
  }
  
  // Verificar se não expirou
  if (new Date() > data.expiresAt) {
    webhookStore.delete(nodeId);
    return false;
  }
  
  return true;
}

/**
 * Obter webhook sem remover (para preview)
 */
export function peekWebhook(nodeId: string): WebhookData | null {
  const data = webhookStore.get(nodeId);
  if (!data) {
    return null;
  }
  
  // Verificar se não expirou
  if (new Date() > data.expiresAt) {
    webhookStore.delete(nodeId);
    return null;
  }
  
  return data;
}

/**
 * Limpar webhook manualmente
 */
export function clearWebhook(nodeId: string): void {
  webhookStore.delete(nodeId);
  console.log(`🗑️ Webhook removido manualmente para nó ${nodeId}`);
}

/**
 * Limpar todos os webhooks expirados
 */
export function clearExpiredWebhooks(): void {
  const now = new Date();
  let count = 0;
  for (const [nodeId, data] of webhookStore.entries()) {
    if (now > data.expiresAt) {
      webhookStore.delete(nodeId);
      count++;
    }
  }
  if (count > 0) {
    console.log(`🧹 ${count} webhook(s) expirado(s) removido(s)`);
  }
}
