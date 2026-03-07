/**
 * Service para integração com Google Sheets API
 * Requer configuração OAuth 2.0 do Google
 */

import { google } from 'googleapis';
import { pgPool } from '../config/databases';
import { GOOGLE_CONFIG } from '../config/constants';

/**
 * Converte um número em letra de coluna do Excel (1 = A, 2 = B, ..., 27 = AA, etc.)
 */
function numberToColumnLetter(num: number): string {
  let result = '';
  while (num > 0) {
    num--;
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26);
  }
  return result;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  scope?: string;
  token_type?: string;
}

export interface SpreadsheetInfo {
  id: string;
  name: string;
  url: string;
}

export class GoogleSheetsService {
  private static readonly CLIENT_ID = GOOGLE_CONFIG.CLIENT_ID;
  private static readonly CLIENT_SECRET = GOOGLE_CONFIG.CLIENT_SECRET;
  
  private static getRedirectUri(): string {
    // Usar variável de ambiente ou construir a partir da API_URL
    if (GOOGLE_CONFIG.REDIRECT_URI) {
      return GOOGLE_CONFIG.REDIRECT_URI;
    }
    // Construir URL de callback baseado na API_URL configurada
    const apiUrl = GOOGLE_CONFIG.API_URL || 'http://localhost:4333';
    return `${apiUrl}/api/google/auth/callback`;
  }

  /**
   * Obter URL de autenticação OAuth
   */
  static async getAuthUrl(userId: string, nodeId: string, workflowId: string): Promise<string> {
    // Validar se as credenciais estão configuradas
    if (!this.CLIENT_ID || this.CLIENT_ID === '') {
      throw new Error('GOOGLE_CLIENT_ID não configurado. Por favor, configure a variável de ambiente GOOGLE_CLIENT_ID no arquivo .env do backend.');
    }

    if (!this.CLIENT_SECRET || this.CLIENT_SECRET === '') {
      throw new Error('GOOGLE_CLIENT_SECRET não configurado. Por favor, configure a variável de ambiente GOOGLE_CLIENT_SECRET no arquivo .env do backend.');
    }

    const redirectUri = this.getRedirectUri();
    console.log('🔐 Configuração OAuth:', {
      clientId: this.CLIENT_ID ? `${this.CLIENT_ID.substring(0, 10)}...` : 'NÃO CONFIGURADO',
      redirectUri,
    });

    const oauth2Client = new google.auth.OAuth2(
      this.CLIENT_ID,
      this.CLIENT_SECRET,
      redirectUri
    );

    const state = `${userId}:${nodeId}:${workflowId}`;
    // Escopo drive.file: acesso apenas a arquivos criados pelo app ou selecionados pelo usuário (Google Picker)
    const scopes = ['https://www.googleapis.com/auth/drive.file'];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state,
      prompt: 'consent', // Força mostrar tela de consentimento para obter refresh_token
    });

    return authUrl;
  }

  /**
   * Processar callback do OAuth e salvar tokens
   */
  static async handleAuthCallback(code: string, userId: string): Promise<GoogleTokens> {
    const redirectUri = this.getRedirectUri();
    const oauth2Client = new google.auth.OAuth2(
      this.CLIENT_ID,
      this.CLIENT_SECRET,
      redirectUri
    );

    try {
      // Trocar código por tokens
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.access_token) {
        throw new Error('Token de acesso não recebido');
      }

      const googleTokens: GoogleTokens = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || '',
        expiry_date: tokens.expiry_date || Date.now() + 3600000, // 1 hora padrão
        scope: tokens.scope,
        token_type: tokens.token_type || 'Bearer',
      };

      // Salvar tokens no banco de dados
      await this.saveTokens(userId, googleTokens);

      return googleTokens;
    } catch (error: any) {
      console.error('Erro ao processar callback OAuth:', error);
      throw new Error(`Erro ao obter tokens: ${error.message}`);
    }
  }

  /**
   * Salvar tokens no banco de dados
   */
  private static async saveTokens(userId: string, tokens: GoogleTokens): Promise<void> {
    const query = `
      INSERT INTO google_tokens (user_id, access_token, refresh_token, expiry_date, scope, token_type)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expiry_date = EXCLUDED.expiry_date,
        scope = EXCLUDED.scope,
        token_type = EXCLUDED.token_type,
        updated_at = CURRENT_TIMESTAMP
    `;

    await pgPool.query(query, [
      userId,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expiry_date,
      tokens.scope,
      tokens.token_type,
    ]);
  }

  /**
   * Obter tokens do banco de dados
   */
  private static async getTokens(userId: string): Promise<GoogleTokens | null> {
    const query = `
      SELECT access_token, refresh_token, expiry_date, scope, token_type
      FROM google_tokens
      WHERE user_id = $1
    `;

    const result = await pgPool.query(query, [userId]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expiry_date: row.expiry_date,
      scope: row.scope,
      token_type: row.token_type,
    };
  }

  /**
   * Obter cliente OAuth autenticado (com refresh automático)
   */
  private static async getAuthenticatedClient(userId: string): Promise<any> {
    let tokens = await this.getTokens(userId);

    if (!tokens) {
      throw new Error('Usuário não autenticado com Google');
    }

    const redirectUri = this.getRedirectUri();
    const oauth2Client = new google.auth.OAuth2(
      this.CLIENT_ID,
      this.CLIENT_SECRET,
      redirectUri
    );

    oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });

    // Verificar se token expirou e renovar se necessário
    if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
      console.log(`🔄 Token expirado para usuário ${userId}. Renovando...`);
      
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        // Atualizar tokens
        const updatedTokens: GoogleTokens = {
          access_token: credentials.access_token || tokens.access_token,
          refresh_token: credentials.refresh_token || tokens.refresh_token,
          expiry_date: credentials.expiry_date || Date.now() + 3600000,
          scope: credentials.scope || undefined,
          token_type: credentials.token_type || 'Bearer',
        };

        await this.saveTokens(userId, updatedTokens);
        oauth2Client.setCredentials({
          access_token: updatedTokens.access_token,
          refresh_token: updatedTokens.refresh_token,
          expiry_date: updatedTokens.expiry_date,
        });
      } catch (error: any) {
        console.error('Erro ao renovar token:', error);
        throw new Error('Erro ao renovar token de acesso. Por favor, autentique novamente.');
      }
    }

    return oauth2Client;
  }

  /**
   * Verificar se usuário está autenticado
   */
  static async isUserAuthenticated(userId: string): Promise<boolean> {
    const tokens = await this.getTokens(userId);
    return tokens !== null;
  }

  /**
   * Obter access token e clientId para uso no Google Picker (frontend).
   * Token é renovado automaticamente se expirado.
   */
  static async getAccessTokenForPicker(userId: string): Promise<{ accessToken: string; clientId: string }> {
    const auth = await this.getAuthenticatedClient(userId);
    const credentials = auth.credentials;
    if (!credentials?.access_token) {
      throw new Error('Token de acesso não disponível. Autentique novamente com Google.');
    }
    if (!this.CLIENT_ID) {
      throw new Error('GOOGLE_CLIENT_ID não configurado');
    }
    return {
      accessToken: credentials.access_token,
      clientId: this.CLIENT_ID,
    };
  }

  /**
   * Criar planilha no Google Sheets
   */
  static async createSpreadsheet(
    userId: string,
    name: string,
    sheetName: string
  ): Promise<SpreadsheetInfo> {
    const auth = await this.getAuthenticatedClient(userId);
    const sheets = google.sheets({ version: 'v4', auth });

    try {
      // Criar nova planilha
      const createResponse = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: name,
          },
          sheets: [
            {
              properties: {
                title: sheetName,
              },
            },
          ],
        },
      });

      const spreadsheetId = createResponse.data.spreadsheetId;
      if (!spreadsheetId) {
        throw new Error('ID da planilha não retornado');
      }

      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

      // Cabeçalhos serão criados dinamicamente na primeira inserção de dados
      // (não criar cabeçalhos fixos aqui, pois podem variar dependendo do webhook)

      return {
        id: spreadsheetId,
        name,
        url: spreadsheetUrl,
      };
    } catch (error: any) {
      console.error('Erro ao criar planilha:', error);
      throw new Error(`Erro ao criar planilha: ${error.message}`);
    }
  }

  /**
   * Adicionar dados à planilha
   */
  static async appendData(
    userId: string,
    spreadsheetId: string,
    sheetName: string,
    data: any[]
  ): Promise<void> {
    const auth = await this.getAuthenticatedClient(userId);
    const sheets = google.sheets({ version: 'v4', auth });

    try {
      // Verificar se a planilha existe e obter cabeçalhos existentes
      let existingHeaders: string[] = [];
      let actualSheetName = sheetName;
      
      try {
        // Primeiro, verificar se a planilha existe e obter informações
        const spreadsheetInfo = await sheets.spreadsheets.get({
          spreadsheetId,
        });
        
        // Verificar se a aba existe
        let sheet = spreadsheetInfo.data.sheets?.find(s => s.properties?.title === sheetName);
        
        // Se não encontrou a aba com o nome especificado, tentar usar a primeira aba disponível
        if (!sheet) {
          const allSheets = spreadsheetInfo.data.sheets || [];
          if (allSheets.length > 0) {
            const firstSheet = allSheets[0];
            actualSheetName = firstSheet.properties?.title || sheetName;
            sheet = firstSheet;
            console.log(`⚠️ Aba "${sheetName}" não encontrada. Usando primeira aba disponível: "${actualSheetName}"`);
          } else {
            throw new Error(`Nenhuma aba encontrada na planilha`);
          }
        }
        
        // Tentar ler cabeçalhos da primeira linha
        try {
          // Escapar o nome da planilha se necessário (usar actualSheetName)
          const escapedSheetName = actualSheetName.includes(' ') || actualSheetName.includes("'") 
            ? `'${actualSheetName.replace(/'/g, "''")}'` 
            : actualSheetName;
          const headerResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${escapedSheetName}!A1:Z1`,
          });
          
          if (headerResponse.data.values && headerResponse.data.values.length > 0) {
            existingHeaders = headerResponse.data.values[0] as string[];
            console.log(`📊 Cabeçalhos existentes encontrados:`, existingHeaders);
          }
        } catch (headerError: any) {
          // Se não conseguir ler cabeçalhos, assumir que a planilha está vazia
          console.log(`ℹ️ Não foi possível ler cabeçalhos existentes (planilha pode estar vazia):`, headerError.message);
        }
      } catch (error: any) {
        // Se não conseguir acessar a planilha, lançar erro
        console.error(`❌ Erro ao acessar planilha:`, error.message);
        throw new Error(`Erro ao acessar planilha: ${error.message}`);
      }

      // Converter objeto de dados em array de valores e determinar cabeçalhos
      const values: any[][] = [];
      let headers: string[] = [];
      let isFirstRow = existingHeaders.length === 0;

      for (const row of data) {
        const rowValues: any[] = [];
        const rowHeaders: string[] = [];
        
        // Se for objeto, converter para array
        if (typeof row === 'object' && row !== null) {
          // Usar submittedAt como Timestamp (do Typebot), ou timestamp como fallback
          const timestamp = row.submittedAt || row.timestamp || new Date().toISOString();
          
          // Extrair campos do Typebot (case-insensitive) para compatibilidade
          const name = row.Name || row.name || '';
          const telefone = row.Telefone || row.telefone || row.contactPhone || row.phone || '';
          const idade = row.Idade || row.idade || '';
          
          // Verificar se há campos dinâmicos além dos fixos (webhook com campos customizados)
          const allKeys = Object.keys(row);
          const fixedFields = ['submittedAt', 'timestamp', 'Name', 'name', 'Telefone', 'telefone', 'contactPhone', 'phone', 'Idade', 'idade'];
          const hasDynamicFields = allKeys.some(key => !fixedFields.includes(key));
          
          if (hasDynamicFields) {
            // Se há campos dinâmicos (webhook), usar TODOS os campos do objeto
            // Ordenar: primeiro timestamp, depois campos fixos conhecidos, depois campos dinâmicos em ordem alfabética
            const dynamicKeys = allKeys.filter(key => !fixedFields.includes(key)).sort();
            
            // Construir cabeçalhos e valores
            if (isFirstRow) {
              rowHeaders.push('Timestamp');
              if (row.Name || row.name) rowHeaders.push('Name');
              if (row.Telefone || row.telefone || row.contactPhone || row.phone) rowHeaders.push('Telefone');
              if (row.Idade || row.idade) rowHeaders.push('Idade');
              dynamicKeys.forEach(key => {
                if (key !== 'submittedAt' && key !== 'timestamp') {
                  rowHeaders.push(key);
                }
              });
              headers = rowHeaders;
            }
            
            // Adicionar valores na mesma ordem dos cabeçalhos
            rowValues.push(timestamp);
            if (row.Name || row.name) rowValues.push(name);
            if (row.Telefone || row.telefone || row.contactPhone || row.phone) rowValues.push(telefone);
            if (row.Idade || row.idade) rowValues.push(idade);
            
            for (const key of dynamicKeys) {
              if (key !== 'submittedAt' && key !== 'timestamp') {
                rowValues.push(row[key] != null ? String(row[key]) : '');
              }
            }
            
            console.log(`📊 Adicionando linha com campos dinâmicos:`, {
              timestamp,
              headers: isFirstRow ? headers : 'usando existentes',
              values: rowValues
            });
          } else {
            // Se não há campos dinâmicos, usar formato fixo (compatibilidade com Typebot)
            if (isFirstRow && existingHeaders.length === 0) {
              headers = ['Timestamp', 'Nome', 'Telefone', 'Idade'];
            }
            
            // Ordem: Timestamp, Nome, Telefone, Idade
            rowValues.push(timestamp);
            rowValues.push(name);
            rowValues.push(telefone);
            rowValues.push(idade);
          }
        } else {
          // Se for array, usar diretamente
          rowValues.push(...(Array.isArray(row) ? row : [row]));
        }

        values.push(rowValues);
        isFirstRow = false;
      }

      // Se não há cabeçalhos existentes e temos cabeçalhos para criar, criar primeiro
      if (existingHeaders.length === 0 && headers.length > 0) {
        console.log(`📊 Criando cabeçalhos:`, headers);
        const lastColumn = numberToColumnLetter(headers.length);
        // Escapar o nome da planilha se necessário (usar actualSheetName)
        const escapedSheetName = actualSheetName.includes(' ') || actualSheetName.includes("'") 
          ? `'${actualSheetName.replace(/'/g, "''")}'` 
          : actualSheetName;
        const range = `${escapedSheetName}!A1:${lastColumn}1`;
        console.log(`📊 Range para cabeçalhos: ${range}`);
        
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: range,
          valueInputOption: 'RAW',
          requestBody: {
            values: [headers],
          },
        });
        console.log(`✅ Cabeçalhos criados na planilha`);
      } else if (existingHeaders.length > 0 && headers.length > 0) {
        // Verificar se os cabeçalhos são diferentes e avisar
        const headersMatch = JSON.stringify(existingHeaders) === JSON.stringify(headers);
        if (!headersMatch) {
          console.log(`⚠️ Cabeçalhos existentes (${existingHeaders.join(', ')}) diferem dos novos (${headers.join(', ')}). Usando cabeçalhos existentes.`);
        }
      }

      // Adicionar dados à planilha
      if (values.length > 0) {
        // Escapar o nome da planilha se necessário (usar actualSheetName)
        const escapedSheetName = actualSheetName.includes(' ') || actualSheetName.includes("'") 
          ? `'${actualSheetName.replace(/'/g, "''")}'` 
          : actualSheetName;
        const range = `${escapedSheetName}!A:Z`;
        
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: range,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values,
          },
        });

        console.log(`✅ ${values.length} linha(s) adicionada(s) à planilha ${spreadsheetId}`);
      }
    } catch (error: any) {
      console.error('Erro ao adicionar dados à planilha:', error);
      console.error('Detalhes do erro:', {
        spreadsheetId,
        sheetName,
        errorMessage: error.message,
        errorCode: error.code
      });
      throw new Error(`Erro ao adicionar dados: ${error.message}`);
    }
  }

  /**
   * Obter informações da planilha
   */
  static async getSpreadsheetInfo(
    userId: string,
    spreadsheetId: string
  ): Promise<SpreadsheetInfo> {
    const auth = await this.getAuthenticatedClient(userId);
    const sheets = google.sheets({ version: 'v4', auth });

    try {
      const response = await sheets.spreadsheets.get({
        spreadsheetId,
      });

      const title = response.data.properties?.title || 'Planilha sem nome';
      const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

      return {
        id: spreadsheetId,
        name: title,
        url,
      };
    } catch (error: any) {
      console.error('Erro ao obter informações da planilha:', error);
      throw new Error(`Erro ao obter informações: ${error.message}`);
    }
  }

  /**
   * Listar planilhas do usuário
   */
  static async listSpreadsheets(userId: string): Promise<SpreadsheetInfo[]> {
    const auth = await this.getAuthenticatedClient(userId);
    const drive = google.drive({ version: 'v3', auth });

    try {
      // Buscar planilhas do Google Sheets (mimeType: 'application/vnd.google-apps.spreadsheet')
      const response = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: 'files(id, name, webViewLink)',
        orderBy: 'modifiedTime desc',
        pageSize: 50, // Limitar a 50 planilhas mais recentes
      });

      const spreadsheets: SpreadsheetInfo[] = (response.data.files || []).map((file) => ({
        id: file.id || '',
        name: file.name || 'Planilha sem nome',
        url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}`,
      }));

      return spreadsheets;
    } catch (error: any) {
      console.error('Erro ao listar planilhas:', error);
      throw new Error(`Erro ao listar planilhas: ${error.message}`);
    }
  }

  /**
   * Obter lista de abas (sheets) de uma planilha
   */
  static async getSpreadsheetSheets(
    userId: string,
    spreadsheetId: string
  ): Promise<Array<{ id: number; title: string }>> {
    const auth = await this.getAuthenticatedClient(userId);
    const sheets = google.sheets({ version: 'v4', auth });

    try {
      const response = await sheets.spreadsheets.get({
        spreadsheetId,
      });

      const sheetList = (response.data.sheets || []).map((sheet) => ({
        id: sheet.properties?.sheetId || 0,
        title: sheet.properties?.title || 'Sem nome',
      }));

      return sheetList;
    } catch (error: any) {
      console.error('Erro ao obter abas da planilha:', error);
      throw new Error(`Erro ao obter abas: ${error.message}`);
    }
  }
}

