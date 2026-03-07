/**
 * Script para testar conexões com bancos de dados
 */

import { testPostgreSQL, testMongoDB } from '../config/databases';

async function testConnections() {
  console.log('🔍 Testando conexões com bancos de dados...\n');

  // Testar PostgreSQL
  console.log('📊 Testando PostgreSQL...');
  try {
    const pgResult = await testPostgreSQL();
    if (pgResult) {
      console.log('✅ PostgreSQL: Conectado com sucesso\n');
    } else {
      console.log('❌ PostgreSQL: Falha na conexão\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ PostgreSQL: Erro ao conectar:', error);
    process.exit(1);
  }

  // Testar MongoDB
  console.log('🍃 Testando MongoDB...');
  try {
    const mongoResult = await testMongoDB();
    if (mongoResult) {
      console.log('✅ MongoDB: Conectado com sucesso\n');
    } else {
      console.log('❌ MongoDB: Falha na conexão\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ MongoDB: Erro ao conectar:', error);
    process.exit(1);
  }

  console.log('✅ Todas as conexões foram testadas com sucesso!');
  process.exit(0);
}

testConnections();

