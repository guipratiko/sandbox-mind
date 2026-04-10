/**
 * Configuração e gerenciamento de conexões de banco de dados
 * - PostgreSQL: Workflows, workflow_contacts, google_tokens (compartilhado)
 * - MongoDB: Instâncias (para buscar instanceName)
 */

import mongoose from 'mongoose';
import { Pool, PoolClient } from 'pg';
import { POSTGRES_CONFIG, MONGODB_CONFIG } from './constants';

// ============================================
// PostgreSQL (Workflows - compartilhado)
// Alinhado ao Backend: timeout curto (2s) falha em rede lenta / TLS para Postgres remoto.
// ============================================
function postgresPoolInt(envKey: string, fallback: number, min: number, max: number): number {
  const raw = process.env[envKey];
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const postgresConnectionString = POSTGRES_CONFIG.URI;

const connectionStringForLog = postgresConnectionString.replace(/:[^:@]+@/, ':****@');
console.log(`📡 MindClerky PostgreSQL: ${connectionStringForLog}`);

const POSTGRES_POOL_MAX = postgresPoolInt('POSTGRES_POOL_MAX', 20, 2, 100);
const POSTGRES_POOL_CONNECTION_TIMEOUT_MS = postgresPoolInt(
  'POSTGRES_POOL_CONNECTION_TIMEOUT_MS',
  20_000,
  3000,
  120_000
);
const POSTGRES_POOL_IDLE_MS = postgresPoolInt('POSTGRES_POOL_IDLE_TIMEOUT_MS', 30_000, 5000, 300_000);

console.log(
  `📡 MindClerky pool: max=${POSTGRES_POOL_MAX}, connectionTimeout=${POSTGRES_POOL_CONNECTION_TIMEOUT_MS}ms, idle=${POSTGRES_POOL_IDLE_MS}ms`
);

export const pgPool = new Pool({
  connectionString: postgresConnectionString,
  max: POSTGRES_POOL_MAX,
  idleTimeoutMillis: POSTGRES_POOL_IDLE_MS,
  connectionTimeoutMillis: POSTGRES_POOL_CONNECTION_TIMEOUT_MS,
  keepAlive: true,
});

// Event listeners para PostgreSQL
pgPool.on('error', (err: Error) => {
  console.error('❌ Erro inesperado no pool PostgreSQL:', err);
});

// Função para testar conexão PostgreSQL
export const testPostgreSQL = async (): Promise<boolean> => {
  try {
    const client = await pgPool.connect();
    await client.query('SELECT NOW()');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Erro ao testar conexão PostgreSQL:', error);
    return false;
  }
};

// Função para obter cliente PostgreSQL (para transações)
export const getPostgreSQLClient = async (): Promise<PoolClient> => {
  return await pgPool.connect();
};

// ============================================
// MongoDB (Instâncias)
// ============================================
export const connectMongoDB = async (): Promise<void> => {
  try {
    await mongoose.connect(MONGODB_CONFIG.URI);
    console.log('✅ Conectado ao MongoDB com sucesso');
  } catch (error) {
    console.error('❌ Erro ao conectar ao MongoDB:', error);
    // Não encerrar processo, apenas logar erro (MongoDB pode não ser crítico)
  }
};

// Event listeners para MongoDB
mongoose.connection.on('disconnected', () => {
  console.log('⚠️  MongoDB desconectado');
});

mongoose.connection.on('error', (error) => {
  console.error('❌ Erro na conexão MongoDB:', error);
});

// Função para testar conexão MongoDB
export const testMongoDB = async (): Promise<boolean> => {
  try {
    // Se já estiver conectado, apenas verificar o estado
    if (mongoose.connection.readyState === 1) {
      return true;
    }
    
    // Tentar conectar
    await mongoose.connect(MONGODB_CONFIG.URI);
    return true;
  } catch (error) {
    console.error('❌ Erro ao testar conexão MongoDB:', error);
    return false;
  }
};

// ============================================
// Função para conectar todos os bancos
// ============================================
export const connectAllDatabases = async (): Promise<void> => {
  try {
    // Conectar MongoDB
    await connectMongoDB();

    // Testar PostgreSQL
    const pgConnected = await testPostgreSQL();
    if (pgConnected) {
      console.log('✅ PostgreSQL conectado e testado');
    } else {
      console.warn('⚠️  PostgreSQL não conectado, mas continuando...');
    }
  } catch (error) {
    console.error('❌ Erro ao conectar bancos de dados:', error);
    throw error;
  }
};

// ============================================
// Função para fechar todas as conexões
// ============================================
export const closeAllDatabases = async (): Promise<void> => {
  try {
    // Fechar MongoDB
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log('✅ MongoDB desconectado');
    }

    // Fechar PostgreSQL
    await pgPool.end();
    console.log('✅ PostgreSQL desconectado');
  } catch (error) {
    console.error('❌ Erro ao fechar conexões:', error);
  }
};

