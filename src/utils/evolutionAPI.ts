import { https } from 'follow-redirects';
import { EVOLUTION_CONFIG } from '../config/constants';

/**
 * Helper para fazer requisições HTTPS para Evolution API
 */
export const requestEvolutionAPI = async (
  method: string,
  path: string,
  body?: any
): Promise<{ statusCode: number; data: any }> => {
  const hostname = EVOLUTION_CONFIG.HOST;
  const apiKey = EVOLUTION_CONFIG.API_KEY;

  if (!apiKey) {
    throw new Error('EVOLUTION_APIKEY não configurada no .env');
  }

  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;

    const options = {
      hostname,
      method,
      path,
      headers: {
        apikey: apiKey,
        ...(body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': data!.length,
            }
          : {}),
      },
      maxRedirects: 20,
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;

        let parsed: any = raw;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          // Se não conseguir parsear, mantém como string
        }

        if (!ok) {
          return reject(
            new Error(
              `HTTP ${res.statusCode} ${res.statusMessage}\nPATH: ${path}\nRESPONSE: ${raw}`
            )
          );
        }

        resolve({ statusCode: res.statusCode || 200, data: parsed });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Timeout na requisição para Evolution API'));
    });

    if (data) {
      req.write(data);
    }
    req.end();
  });
};

/**
 * Envia mensagem de texto com delay (simula digitação)
 * @param instanceName - Nome da instância
 * @param number - Número do destinatário
 * @param text - Texto da mensagem
 * @param delay - Delay em milissegundos (padrão: 1200ms)
 */
export const sendTextWithDelay = async (
  instanceName: string,
  number: string,
  text: string,
  delay: number = 1200
): Promise<any> => {
  const path = `/message/sendText/${encodeURIComponent(instanceName)}`;
  const body = {
    number,
    text,
    delay, // Campo específico para simular digitação
  };

  const response = await requestEvolutionAPI('POST', path, body);
  return response.data;
};

/**
 * Envia mídia (imagem/vídeo) com legenda e delay
 * @param instanceName - Nome da instância
 * @param number - Número do destinatário
 * @param mediaType - Tipo de mídia ('image' ou 'video')
 * @param media - URL da mídia
 * @param caption - Legenda (opcional)
 * @param delay - Delay em milissegundos (padrão: 1200ms)
 */
export const sendMediaWithDelay = async (
  instanceName: string,
  number: string,
  mediaType: 'image' | 'video',
  media: string,
  caption?: string,
  delay: number = 1200
): Promise<any> => {
  const path = `/message/sendMedia/${encodeURIComponent(instanceName)}`;
  const body: any = {
    number,
    mediatype: mediaType,
    media,
    delay,
  };

  if (caption) {
    body.caption = caption;
  }

  // Determinar mimetype baseado no tipo
  if (mediaType === 'image') {
    body.mimetype = 'image/png'; // Pode ser melhorado para detectar da URL
  } else if (mediaType === 'video') {
    body.mimetype = 'video/mp4'; // Pode ser melhorado para detectar da URL
  }

  const response = await requestEvolutionAPI('POST', path, body);
  return response.data;
};

/**
 * Envia áudio com delay
 * @param instanceName - Nome da instância
 * @param number - Número do destinatário
 * @param audio - URL do áudio
 * @param delay - Delay em milissegundos (padrão: 1200ms)
 */
export const sendAudioWithDelay = async (
  instanceName: string,
  number: string,
  audio: string,
  delay: number = 1200
): Promise<any> => {
  const path = `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`;
  const body = {
    number,
    audio,
    delay,
  };

  const response = await requestEvolutionAPI('POST', path, body);
  return response.data;
};

/**
 * Envia mensagem via Evolution API (versão genérica sem delay - para compatibilidade)
 * @deprecated Use sendTextWithDelay, sendMediaWithDelay ou sendAudioWithDelay para workflows
 */
export const sendMessage = async (
  instanceName: string,
  payload: {
    number: string;
    text?: string;
    image?: string;
    video?: string;
    audio?: string;
    document?: string;
    caption?: string;
    fileName?: string;
  }
): Promise<any> => {
  try {
    let path = '';
    let body: any = {
      number: payload.number,
    };

    if (payload.text) {
      // Mensagem de texto
      path = `/message/sendText/${encodeURIComponent(instanceName)}`;
      body.text = payload.text;
    } else if (payload.image) {
      // Imagem (com ou sem legenda)
      path = `/message/sendMedia/${encodeURIComponent(instanceName)}`;
      body.mediatype = 'image';
      body.media = payload.image;
      if (payload.caption) {
        body.caption = payload.caption;
      }
    } else if (payload.video) {
      // Vídeo (com ou sem legenda)
      path = `/message/sendMedia/${encodeURIComponent(instanceName)}`;
      body.mediatype = 'video';
      body.media = payload.video;
      if (payload.caption) {
        body.caption = payload.caption;
      }
    } else if (payload.audio) {
      // Áudio
      path = `/message/sendMedia/${encodeURIComponent(instanceName)}`;
      body.mediatype = 'audio';
      body.media = payload.audio;
    } else if (payload.document) {
      // Arquivo
      path = `/message/sendMedia/${encodeURIComponent(instanceName)}`;
      body.mediatype = 'document';
      body.media = payload.document;
      body.fileName = payload.fileName || 'arquivo';
    } else {
      throw new Error('Tipo de mensagem não especificado');
    }

    const response = await requestEvolutionAPI('POST', path, body);
    return response.data;
  } catch (error) {
    console.error('Erro ao enviar mensagem via Evolution API:', error);
    throw error;
  }
};

