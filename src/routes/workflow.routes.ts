import { Router } from 'express';
import { protect } from '../middleware/auth';
import {
  getWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  getWorkflowContacts,
  clearWorkflowContacts,
  receiveTypebotWebhook,
  receiveWebhook,
  checkWebhookReceived,
  consumeWebhook,
} from '../controllers/workflowController';

const router = Router();

// NOTA: A rota /trigger foi movida para routes/index.ts para evitar conflito com /:id

// Rotas públicas para webhooks (não requerem autenticação)
router.post('/webhook/typebot/:nodeId', receiveTypebotWebhook);
router.post('/webhook/:nodeId', receiveWebhook);

// Todas as outras rotas requerem autenticação
router.use(protect);

// Rotas protegidas para escuta de webhooks
router.get('/webhook/listen/:nodeId', checkWebhookReceived);
router.post('/webhook/consume/:nodeId', consumeWebhook);

// Rotas de workflows
router.get('/', getWorkflows);
router.get('/:id', getWorkflow);
router.post('/', createWorkflow);
router.put('/:id', updateWorkflow);
router.delete('/:id', deleteWorkflow);

// Rotas de contatos do workflow
router.get('/:id/contacts', getWorkflowContacts);
router.post('/:id/contacts/clear', clearWorkflowContacts);

export default router;

