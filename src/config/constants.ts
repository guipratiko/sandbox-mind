/**
 * Configurações centralizadas do microserviço MindFlow (workflows)
 */

import dotenv from 'dotenv';

// Carregar variáveis de ambiente
dotenv.config();

// Server Configuration
export const SERVER_CONFIG = {
  PORT: parseInt(process.env.PORT || '4333', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
};

// JWT Configuration (mesmo secret do backend principal)
export const JWT_CONFIG = {
  SECRET: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  EXPIRE: process.env.JWT_EXPIRE || '7d',
};

// PostgreSQL Configuration (compartilhado com Backend — mesma ordem de variáveis que o Backend)
export const POSTGRES_CONFIG = {
  HOST: process.env.POSTGRES_HOST || 'localhost',
  PORT: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  DB: process.env.POSTGRES_DB || 'clerky',
  USER: process.env.POSTGRES_USER || 'postgres',
  PASSWORD: process.env.POSTGRES_PASSWORD || 'postgres',
  URI:
    process.env.POSTGRES_URI?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    `postgres://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'clerky'}`,
};

// MongoDB Configuration (para buscar instâncias)
export const MONGODB_CONFIG = {
  URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/clerky',
};

// Backend Configuration (para Socket.io)
export const BACKEND_CONFIG = {
  URL: process.env.BACKEND_URL || 'http://localhost:4331',
};

// Socket.io Configuration (backend principal)
export const SOCKET_CONFIG = {
  URL: process.env.BACKEND_URL || 'http://localhost:4331',
};

// Evolution API Configuration
export const EVOLUTION_CONFIG = {
  HOST: process.env.EVOLUTION_HOST || 'evo.clerky.com.br',
  API_KEY: process.env.EVOLUTION_APIKEY || process.env.EVOLUTION_API_KEY || '',
  URL: process.env.EVOLUTION_API_URL || 'https://evo.clerky.com.br',
};

// Google OAuth Configuration
export const GOOGLE_CONFIG = {
  CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4333/api/google/auth/callback',
  API_URL: process.env.GOOGLE_API_URL || process.env.BACKEND_URL || 'http://localhost:4333',
};

