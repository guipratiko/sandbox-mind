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
// ============================================
export const pgPool = new Pool({
  connectionString: POSTGRES_CONFIG.URI,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
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

