/**
 * Servidor principal do microserviço MindClerky (Workflows)
 */

// Configurar timezone
process.env.TZ = 'America/Sao_Paulo';

import express, { Express, Request, Response } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { connectAllDatabases } from './config/databases';
import { SERVER_CONFIG } from './config/constants';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { connectSocket } from './socket/socketClient';
import { triggerWorkflow } from './controllers/workflowController';
import packageJson from '../package.json';

const app: Express = express();
const httpServer = createServer(app);
const PORT = SERVER_CONFIG.PORT;

// Middlewares
app.use(cors({
  origin: SERVER_CONFIG.CORS_ORIGIN,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rota raiz
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'MindClerky API está funcionando',
    version: process.env.VERSION || packageJson.version || '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      workflows: '/api/workflows',
      google: '/api/google',
    },
  });
});

// IMPORTANTE: Registrar rota /trigger ANTES do router.use('/api', routes)
// para garantir que seja encontrada antes de qualquer processamento pelo router
app.post('/api/workflows/trigger', (req, res, next) => {
  console.log('🔍 [SERVER] Rota /api/workflows/trigger encontrada diretamente no app!');
  console.log('🔍 [SERVER] req.method:', req.method);
  console.log('🔍 [SERVER] req.originalUrl:', req.originalUrl);
  console.log('🔍 [SERVER] req.path:', req.path);
  console.log('🔍 [SERVER] req.url:', req.url);
  next();
}, triggerWorkflow);

// Rotas da API
app.use('/api', routes);

// Log de rotas registradas (apenas para debug)
console.log('📋 Rotas registradas:');
console.log('   POST /api/workflows/trigger');
console.log('   POST /api/workflows/webhook/typebot/:nodeId');
console.log('   GET  /api/workflows');
console.log('   GET  /api/workflows/:id');
console.log('   POST /api/workflows');
console.log('   PUT  /api/workflows/:id');
console.log('   DELETE /api/workflows/:id');
console.log('   GET  /api/workflows/:id/contacts');
console.log('   POST /api/workflows/:id/contacts/clear');
console.log('   GET  /api/google/auth');
console.log('   GET  /api/google/auth/callback');
console.log('   GET  /api/google/test');
console.log('   POST /api/google/spreadsheet');
console.log('   GET  /api/google/spreadsheets');
console.log('   GET  /api/google/picker-token');

// Conectar a bancos de dados (após registrar rotas)
connectAllDatabases();

// Middleware de erro 404
app.use(notFoundHandler);

// Middleware de tratamento de erros
app.use(errorHandler);

// Conectar ao Socket.io do backend principal
connectSocket();

// Iniciar servidor
httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor MindClerky rodando na porta ${PORT}`);
  console.log(`📡 Ambiente: ${SERVER_CONFIG.NODE_ENV}`);
  console.log(`🌐 API disponível em http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Recebido SIGTERM, encerrando servidor...');
  httpServer.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Recebido SIGINT, encerrando servidor...');
  httpServer.close();
  process.exit(0);
});

export default app;

