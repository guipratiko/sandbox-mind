import { Router } from 'express';
import workflowRoutes from './workflow.routes';
import googleRoutes from './google.routes';

const router = Router();

// NOTA: A rota /trigger foi movida para server.ts (registrada diretamente no app)
// para garantir que seja encontrada antes de qualquer processamento pelo router

// Rotas de Workflows
router.use('/workflows', workflowRoutes);

// Rotas de Google Sheets
router.use('/google', googleRoutes);

export default router;

