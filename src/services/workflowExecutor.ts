/**
 * Serviço para executar workflows do MindFlow
 */

import { WorkflowService, Workflow, WorkflowNode, WorkflowEdge } from './workflowService';
import { sendTextWithDelay, sendMediaWithDelay, sendAudioWithDelay } from '../utils/evolutionAPI';
import Instance from '../models/Instance';
import { emitWorkflowContactUpdate } from '../socket/socketClient';
import { GoogleSheetsService } from './googleSheetsService';
import { callOpenAI } from './openaiService';
import { OpenAIMemoryService } from './openaiMemoryService';
import { replaceVariables, ContactData } from '../utils/variableReplacer';
import { normalizePhone } from '../utils/numberNormalizer';
import { pgPool } from '../config/databases';

interface ExecutionContext {
  workflow: Workflow;
  contactPhone: string;
  instanceId: string;
  messageText: string;
  userId: string;
  typebotVariables?: Record<string, any>; // Variáveis do Typebot (ex: { Name: "Marcos", Telefone: "+5562984049128" })
  openaiResponseDelay?: number; // Delay configurado no nó OpenAI para usar na resposta (em milissegundos)
}

interface ExecutionState {
  visitedNodes: Set<string>;
  hasReachedEnd: boolean; // Indica se pelo menos um caminho chegou ao final
  conditionMatched: boolean; // Indica se uma condição foi atendida (para pular nós intermediários)
}

/**
 * Executa um workflow completo
 */
export async function executeWorkflow(
  workflow: Workflow,
  contactPhone: string,
  instanceId: string,
  messageText: string,
  userId: string
): Promise<void> {
  try {
    console.log(`🚀 Iniciando execução do workflow: ${workflow.name} (${workflow.id})`);
    console.log(`📱 Contato: ${contactPhone}, Instância: ${instanceId}`);

    // Verificar se o contato já entrou no workflow
    const hasEntered = await WorkflowService.hasContactEntered(
      workflow.id,
      contactPhone,
      instanceId
    );

    if (hasEntered) {
      console.log(`⏭️ Contato ${contactPhone} já entrou neste workflow. Pulando execução.`);
      return;
    }

    // Encontrar o nó de gatilho (whatsappTrigger)
    const triggerNode = workflow.nodes.find((node) => node.type === 'whatsappTrigger');

    if (!triggerNode) {
      console.log(`⚠️ Workflow ${workflow.id} não possui nó de gatilho. Pulando execução.`);
      return;
    }

    // Verificar se a instância do gatilho corresponde
    const triggerInstanceId = triggerNode.data?.instanceId;
    if (triggerInstanceId && triggerInstanceId !== instanceId) {
      console.log(`⏭️ Instância do gatilho (${triggerInstanceId}) não corresponde à instância da mensagem (${instanceId}). Pulando execução.`);
      return;
    }

    // Criar contexto de execução
    const context: ExecutionContext = {
      workflow,
      contactPhone,
      instanceId,
      messageText,
      userId,
    };

    // Criar estado de execução
    const state: ExecutionState = {
      visitedNodes: new Set(),
      hasReachedEnd: false,
      conditionMatched: false,
    };

    // Log do workflow para debug
    console.log(`📊 Workflow configurado:`);
    console.log(`   - Nós: ${workflow.nodes.length}`);
    console.log(`   - Arestas: ${workflow.edges.length}`);
    workflow.nodes.forEach((n) => {
      console.log(`   - Nó ${n.id}: ${n.type}`);
      if (n.type === 'condition') {
        console.log(`     Condições: ${JSON.stringify(n.data?.conditions || [])}`);
      }
    });

    // Verificar se o workflow contém nó OpenAI
    const hasOpenAINode = workflow.nodes.some((node) => node.type === 'openai');

    // Executar workflow começando pelo gatilho
    await executeNode(context, state, triggerNode.id);

    // Adicionar contato à lista APENAS se o workflow chegou ao final
    // Se o workflow tiver nó OpenAI, não adicionar à lista (permite múltiplas execuções)
    if (state.hasReachedEnd && !hasOpenAINode) {
      await WorkflowService.addWorkflowContact(workflow.id, contactPhone, instanceId);
      console.log(`✅ Contato ${contactPhone} adicionado ao workflow ${workflow.id} (após conclusão completa)`);
      
      // Emitir evento WebSocket para atualizar frontend em tempo real
      try {
        emitWorkflowContactUpdate(userId, workflow.id, contactPhone, instanceId);
      } catch (error) {
        // Não falhar se o WebSocket não estiver disponível
        console.error('Erro ao emitir evento de contato do workflow:', error);
      }
    } else if (hasOpenAINode) {
      console.log(`🤖 Workflow com OpenAI: Contato ${contactPhone} não adicionado à lista (permite múltiplas interações)`);
    } else {
      console.log(`⏭️ Contato ${contactPhone} não adicionado ao workflow (fluxo não completou)`);
    }

    console.log(`✅ Workflow ${workflow.name} executado com sucesso`);
  } catch (error) {
    console.error(`❌ Erro ao executar workflow ${workflow.id}:`, error);
    throw error;
  }
}

/**
 * Executa um nó específico do workflow
 */
async function executeNode(
  context: ExecutionContext,
  state: ExecutionState,
  nodeId: string
): Promise<void> {
  // Prevenir loops infinitos
  if (state.visitedNodes.has(nodeId)) {
    console.log(`⚠️ Nó ${nodeId} já foi visitado. Prevenindo loop.`);
    return;
  }

  state.visitedNodes.add(nodeId);

  const node = context.workflow.nodes.find((n) => n.id === nodeId);

  if (!node) {
    console.log(`⚠️ Nó ${nodeId} não encontrado no workflow.`);
    return;
  }

  console.log(`🔷 Executando nó: ${node.type} (${node.id})`);

  // Executar lógica baseada no tipo do nó
  switch (node.type) {
    case 'whatsappTrigger':
      // O gatilho apenas inicia o fluxo
      // A lógica de verificar condições e pular nós intermediários é tratada em executeNextNodes
      await executeNextNodes(context, state, nodeId);
      break;

    case 'typebotTrigger':
      // O gatilho Typebot apenas inicia o fluxo
      // Os dados do webhook já estão disponíveis no messageText (JSON stringificado)
      await executeNextNodes(context, state, nodeId);
      break;

    case 'webhookTrigger':
      // O gatilho Webhook apenas inicia o fluxo
      // Os dados do webhook já estão disponíveis no messageText (JSON stringificado)
      await executeNextNodes(context, state, nodeId);
      break;

    case 'condition':
      await executeConditionNode(context, state, node);
      break;

    case 'delay':
      await executeDelayNode(context, state, node);
      break;

    case 'response':
      await executeResponseNode(context, state, node);
      break;

    case 'spreadsheet':
      await executeSpreadsheetNode(context, state, node);
      break;

    case 'openai':
      await executeOpenAINode(context, state, node);
      break;

    case 'end':
      console.log(`🏁 Workflow finalizado no nó End`);
      state.hasReachedEnd = true;
      return;

    default:
      console.log(`⚠️ Tipo de nó desconhecido: ${node.type}`);
      await executeNextNodes(context, state, nodeId);
  }
}

/**
 * Executa nó de condição
 */
async function executeConditionNode(
  context: ExecutionContext,
  state: ExecutionState,
  node: WorkflowNode
): Promise<void> {
  const conditions = node.data?.conditions || [];

  console.log(`🔍 Verificando ${conditions.length} condição(ões) na mensagem: "${context.messageText}"`);
  console.log(`📋 Condições configuradas:`, conditions.map((c: any) => `"${c.text}"`).join(', '));

  if (conditions.length === 0) {
    console.log(`⚠️ Nó de condição não possui condições configuradas. Continuando para próximo nó.`);
    await executeNextNodes(context, state, node.id);
    return;
  }

  // Verificar condições usando função auxiliar
  const match = checkConditions(context, node);

  if (match) {
    console.log(`✅ Condição encontrada: "${match.condition.text}"`);
    state.conditionMatched = true;
    console.log(`➡️ Seguindo para próximo nó: ${match.edge.target}`);
    await executeNode(context, state, match.edge.target);
  } else {
    console.log(`❌ Nenhuma condição foi atendida. Fluxo interrompido.`);
  }
}

/**
 * Executa nó de delay
 */
async function executeDelayNode(
  context: ExecutionContext,
  state: ExecutionState,
  node: WorkflowNode
): Promise<void> {
  const delay = node.data?.delay || 0;
  const delayUnit = node.data?.delayUnit || 'seconds';

  if (delay <= 0) {
    console.log(`⏭️ Delay configurado como 0. Pulando delay.`);
    await executeNextNodes(context, state, node.id);
    return;
  }

  // Converter para milissegundos
  let delayMs = delay;
  switch (delayUnit) {
    case 'minutes':
      delayMs = delay * 60 * 1000;
      break;
    case 'hours':
      delayMs = delay * 60 * 60 * 1000;
      break;
    default: // seconds
      delayMs = delay * 1000;
  }

  console.log(`⏳ Aguardando ${delay} ${delayUnit} (${delayMs}ms)...`);

  await new Promise((resolve) => setTimeout(resolve, delayMs));

  console.log(`✅ Delay concluído. Continuando execução.`);

  await executeNextNodes(context, state, node.id);
}

/**
 * Busca o nome do contato no banco de dados PostgreSQL
 */
async function getContactName(
  userId: string,
  instanceId: string,
  contactPhone: string
): Promise<string | undefined> {
  try {
    // Normalizar telefone para construir remote_jid
    const normalizedPhone = normalizePhone(contactPhone, '55');
    if (!normalizedPhone) {
      return undefined;
    }

    // Construir remote_jid no formato do WhatsApp
    const remoteJid = `${normalizedPhone}@s.whatsapp.net`;

    // Buscar contato no PostgreSQL
    const query = `
      SELECT name FROM contacts
      WHERE user_id = $1 AND instance_id = $2 AND remote_jid = $3
      LIMIT 1
    `;

    const result = await pgPool.query(query, [userId, instanceId, remoteJid]);

    if (result.rows.length > 0 && result.rows[0].name) {
      const name = result.rows[0].name.trim();
      if (name && name !== 'Sem nome') {
        console.log(`📝 Nome do contato encontrado no banco: ${name}`);
        return name;
      }
    }

    return undefined;
  } catch (error) {
    console.warn(`⚠️ Erro ao buscar nome do contato no banco:`, error);
    return undefined;
  }
}

/**
 * Executa nó de resposta (MODIFICADO para usar funções com delay)
 */
async function executeResponseNode(
  context: ExecutionContext,
  state: ExecutionState,
  node: WorkflowNode
): Promise<void> {
  // Verificar se o próximo nó é uma condição
  // Se for, verificar a condição ANTES de enviar a resposta
  const nextEdges = context.workflow.edges.filter((e) => e.source === node.id);
  const nextNodes = nextEdges.map((e) => context.workflow.nodes.find((n) => n.id === e.target)).filter(Boolean);
  const conditionNode = nextNodes.find((n) => n?.type === 'condition');

  if (conditionNode && !state.conditionMatched) {
    console.log(`🔍 Condição detectada após resposta. Verificando condição antes de enviar resposta.`);
    
    const match = checkConditions(context, conditionNode);

    if (match) {
      console.log(`✅ Condição encontrada ANTES de enviar resposta: "${match.condition.text}"`);
      console.log(`⏭️ Pulando resposta "${node.id}" pois condição foi atendida. Seguindo pelo caminho da condição.`);
      state.conditionMatched = true;
      state.visitedNodes.add(conditionNode.id);
      await executeNode(context, state, match.edge.target);
      return; // Não enviar a resposta
    } else {
      console.log(`❌ Condição não atendida. Enviando resposta normalmente.`);
    }
  }
  const responseType = node.data?.responseType || 'text';
  
  // Buscar nome do contato no banco de dados (prioridade: Typebot > Banco de dados)
  console.log(`🔍 DEBUG - Verificando typebotVariables no nó de resposta:`, JSON.stringify(context.typebotVariables, null, 2));
  console.log(`🔍 DEBUG - context.typebotVariables?.Name:`, context.typebotVariables?.Name);
  
  let contactName = context.typebotVariables?.Name;
  console.log(`🔍 DEBUG - contactName após ler de typebotVariables:`, contactName);
  
  if (!contactName) {
    console.log(`🔍 DEBUG - contactName não encontrado em typebotVariables, buscando no banco...`);
    contactName = await getContactName(context.userId, context.instanceId, context.contactPhone);
    console.log(`🔍 DEBUG - contactName após buscar no banco:`, contactName);
  }
  
  // Criar dados do contato para replaceVariables
  const contactData: ContactData = {
    phone: context.contactPhone,
    name: contactName,
  };
  
  console.log(`🔍 DEBUG - contactData criado:`, JSON.stringify(contactData, null, 2));

  // Se for tipo texto e não houver conteúdo configurado, usar messageText do contexto
  // (que pode ter sido atualizado pelo nó OpenAI)
  let content = responseType === 'text' && !node.data?.content 
    ? context.messageText 
    : (node.data?.content || '');
  
  // Substituir variáveis no conteúdo (incluindo variáveis do Typebot)
  content = replaceVariables(content, contactData, 'Cliente', context.typebotVariables);
  
  let mediaUrl = node.data?.mediaUrl || '';
  mediaUrl = replaceVariables(mediaUrl, contactData, 'Cliente', context.typebotVariables);
  let caption = node.data?.caption || '';
  // Substituir variáveis na legenda também
  caption = replaceVariables(caption, contactData, 'Cliente', context.typebotVariables);
  
  let fileName = node.data?.fileName || '';
  // Substituir variáveis no nome do arquivo também
  fileName = replaceVariables(fileName, contactData, 'Cliente', context.typebotVariables);

  // Obter delay configurado
  // Prioridade: 1) Delay do OpenAI (se disponível), 2) Delay do próprio nó de resposta, 3) Padrão 1200ms
  const delay = context.openaiResponseDelay || node.data?.responseDelay || 1200;
  
  if (context.openaiResponseDelay) {
    console.log(`⏱️ Usando delay do nó OpenAI: ${context.openaiResponseDelay}ms`);
  } else if (node.data?.responseDelay) {
    console.log(`⏱️ Usando delay do nó de resposta: ${node.data.responseDelay}ms`);
  } else {
    console.log(`⏱️ Usando delay padrão: 1200ms (nenhum delay configurado no nó)`);
  }

  console.log(`📤 Enviando resposta do tipo: ${responseType} (delay: ${delay}ms)`);

  try {
    // Usar responseInstanceId do nó de resposta se fornecido, senão usar do contexto
    const responseInstanceId = node.data?.responseInstanceId || context.instanceId;
    
    // Buscar instância
    const instance = await Instance.findById(responseInstanceId);

    if (!instance) {
      console.error(`❌ Instância ${responseInstanceId} não encontrada.`);
      await executeNextNodes(context, state, node.id);
      return;
    }

    const instanceName = instance.instanceName;

    // Preparar número de telefone
    // O número precisa estar no formato completo (com DDI) para a Evolution API
    // Se o número não começar com 55, adicionar
    let phoneNumber = context.contactPhone;
    if (!phoneNumber.startsWith('55') && phoneNumber.length >= 10) {
      phoneNumber = `55${phoneNumber}`;
    }

    // Usar funções específicas com delay baseado no tipo de resposta
    switch (responseType) {
      case 'text':
        await sendTextWithDelay(instanceName, phoneNumber, content, delay);
        break;

      case 'image':
        await sendMediaWithDelay(instanceName, phoneNumber, 'image', mediaUrl, undefined, delay);
        break;

      case 'image_caption':
        await sendMediaWithDelay(instanceName, phoneNumber, 'image', mediaUrl, caption, delay);
        break;

      case 'video':
        await sendMediaWithDelay(instanceName, phoneNumber, 'video', mediaUrl, undefined, delay);
        break;

      case 'video_caption':
        await sendMediaWithDelay(instanceName, phoneNumber, 'video', mediaUrl, caption, delay);
        break;

      case 'audio':
        await sendAudioWithDelay(instanceName, phoneNumber, mediaUrl, delay);
        break;

      case 'file':
        // Para arquivos, ainda usar sendMedia (não há função específica com delay para arquivos)
        // TODO: Criar função sendFileWithDelay se necessário
        console.warn(`⚠️ Tipo 'file' ainda não suporta delay. Enviando sem delay.`);
        // Por enquanto, usar sendMedia sem delay
        const { requestEvolutionAPI } = await import('../utils/evolutionAPI');
        await requestEvolutionAPI('POST', `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
          number: phoneNumber,
          mediatype: 'document',
          media: mediaUrl,
          fileName: fileName || 'arquivo',
        });
        break;

      default:
        console.error(`❌ Tipo de resposta desconhecido: ${responseType}`);
        await executeNextNodes(context, state, node.id);
        return;
    }

    console.log(`✅ Resposta enviada com sucesso para ${context.contactPhone}`);
  } catch (error) {
    console.error(`❌ Erro ao enviar resposta:`, error);
  }

  // Continuar para o próximo nó
  await executeNextNodes(context, state, node.id);
}

/**
 * Executa nó de planilha
 */
async function executeSpreadsheetNode(
  context: ExecutionContext,
  state: ExecutionState,
  node: WorkflowNode
): Promise<void> {
  const spreadsheetId = node.data?.spreadsheetId;
  const spreadsheetName = node.data?.spreadsheetName || 'Dados do Workflow';
  const sheetName = node.data?.sheetName || 'Sheet1';

  console.log(`📊 Executando nó de planilha: ${spreadsheetName}`);

  if (!spreadsheetId) {
    console.log(`⚠️ Planilha não configurada. Criando nova planilha...`);
    
    try {
      // Criar nova planilha
      const spreadsheet = await GoogleSheetsService.createSpreadsheet(
        context.userId,
        spreadsheetName,
        sheetName
      );

      console.log(`✅ Planilha criada: ${spreadsheet.id}`);

      // Atualizar o nó com o spreadsheetId recém-criado
      const updatedNodes = context.workflow.nodes.map((n) => {
        if (n.id === node.id) {
          return {
            ...n,
            data: {
              ...n.data,
              spreadsheetId: spreadsheet.id,
            },
          };
        }
        return n;
      });

      // Atualizar o contexto do workflow em memória
      context.workflow.nodes = updatedNodes;

      // Salvar o workflow atualizado no banco de dados
      await WorkflowService.updateWorkflow(
        context.workflow.id,
        context.userId,
        { nodes: updatedNodes }
      );

      console.log(`✅ SpreadsheetId salvo no workflow: ${spreadsheet.id}`);

      // Adicionar dados à planilha
      await GoogleSheetsService.appendData(
        context.userId,
        spreadsheet.id,
        sheetName,
        [extractDataFromContext(context)]
      );

      console.log(`✅ Dados adicionados à planilha`);
    } catch (error) {
      console.error(`❌ Erro ao criar/adicionar dados à planilha:`, error);
      // Continuar o fluxo mesmo se houver erro
    }
  } else {
    try {
      // Adicionar dados à planilha existente
      await GoogleSheetsService.appendData(
        context.userId,
        spreadsheetId,
        sheetName,
        [extractDataFromContext(context)]
      );

      console.log(`✅ Dados adicionados à planilha existente`);
    } catch (error) {
      console.error(`❌ Erro ao adicionar dados à planilha:`, error);
      // Continuar o fluxo mesmo se houver erro
    }
  }

  // Continuar para o próximo nó
  await executeNextNodes(context, state, node.id);
}

/**
 * Executa nó OpenAI
 */
async function executeOpenAINode(
  context: ExecutionContext,
  state: ExecutionState,
  node: WorkflowNode
): Promise<void> {
  const apiKey = node.data?.apiKey;
  const model = node.data?.model || 'gpt-3.5-turbo';
  const systemPrompt = node.data?.prompt || 'Você é um assistente útil. Responda à mensagem do usuário de forma clara e objetiva.';

  console.log(`🤖 Executando nó OpenAI: ${model}`);

  if (!apiKey) {
    console.log(`⚠️ API Key da OpenAI não configurada. Pulando processamento.`);
    // Continuar o fluxo mesmo sem API key
    await executeNextNodes(context, state, node.id);
    return;
  }

  try {
    // Buscar nome do contato no banco de dados (prioridade: Typebot > Banco de dados)
    let contactName = context.typebotVariables?.Name;
    if (!contactName) {
      contactName = await getContactName(context.userId, context.instanceId, context.contactPhone);
    }
    
    // Substituir variáveis no prompt (incluindo variáveis do Typebot)
    // Criar dados do contato para replaceVariables
    const contactData: ContactData = {
      phone: context.contactPhone,
      name: contactName,
    };

    // Substituir variáveis no prompt
    const processedPrompt = replaceVariables(
      systemPrompt,
      contactData,
      'Cliente',
      context.typebotVariables
    );

    console.log(`📝 Prompt processado com variáveis: ${processedPrompt.substring(0, 100)}...`);

    // Obter histórico de conversa do contato
    const conversationHistory = await OpenAIMemoryService.getMessages(
      context.workflow.id,
      context.contactPhone,
      context.instanceId
    );

    console.log(`💭 Histórico de conversa: ${conversationHistory.length} mensagens anteriores`);

    // Processar mensagem com OpenAI (incluindo histórico)
    const aiResponse = await callOpenAI(
      apiKey,
      model,
      processedPrompt, // Usar prompt processado com variáveis
      context.messageText,
      conversationHistory
    );

    console.log(`✅ OpenAI processou mensagem: ${aiResponse.substring(0, 50)}...`);

    // Salvar mensagem do usuário na memória
    await OpenAIMemoryService.addMessage(
      context.workflow.id,
      context.contactPhone,
      context.instanceId,
      'user',
      context.messageText
    );

    // Salvar resposta da IA na memória
    await OpenAIMemoryService.addMessage(
      context.workflow.id,
      context.contactPhone,
      context.instanceId,
      'assistant',
      aiResponse
    );

    // Atualizar messageText no contexto com a resposta da IA
    // Isso permite que o próximo nó (resposta) use a resposta gerada
    context.messageText = aiResponse;

    // Armazenar delay configurado no nó OpenAI para usar no nó de resposta
    // Se o nó OpenAI tiver um delay configurado, ele será usado pelo nó de resposta
    if (node.data?.responseDelay) {
      context.openaiResponseDelay = node.data.responseDelay;
      console.log(`⏱️ Delay do OpenAI configurado: ${context.openaiResponseDelay}ms`);
    }

    // Continuar para o próximo nó
    await executeNextNodes(context, state, node.id);
  } catch (error) {
    console.error(`❌ Erro ao processar com OpenAI:`, error);
    // Continuar o fluxo mesmo se houver erro
    await executeNextNodes(context, state, node.id);
  }
}

/**
 * Extrai dados do contexto para adicionar à planilha
 */
function extractDataFromContext(context: ExecutionContext): any {
  // PRIORIDADE 1: Se há variáveis do webhook/typebot no contexto, usar elas (campos mapeados)
  // Isso garante que os campos selecionados no webhook sejam usados
  if (context.typebotVariables && Object.keys(context.typebotVariables).length > 0) {
    // Adicionar timestamp se não existir
    const data = { ...context.typebotVariables };
    if (!data.submittedAt && !data.timestamp) {
      data.submittedAt = new Date().toISOString();
    }
    console.log(`🔍 DEBUG extractDataFromContext - Retornando typebotVariables:`, JSON.stringify(data, null, 2));
    return data;
  }
  
  // PRIORIDADE 2: Tentar parsear messageText como JSON (vindo do Typebot ou Webhook)
  try {
    const parsed = typeof context.messageText === 'string' 
      ? JSON.parse(context.messageText)
      : context.messageText;
    
    // Se os dados vieram do Typebot, retornar diretamente
    // O formato esperado: { submittedAt, Name, Telefone, Idade }
    if (parsed.submittedAt || parsed.Name || parsed.Telefone || parsed.Idade) {
      console.log(`🔍 DEBUG extractDataFromContext - Retornando parsed (Typebot):`, JSON.stringify(parsed, null, 2));
      return parsed;
    }
    
    // Se não for formato Typebot/Webhook, retornar dados básicos
    const basicData = {
      submittedAt: new Date().toISOString(),
      Name: '',
      Telefone: context.contactPhone,
      Idade: '',
    };
    console.log(`🔍 DEBUG extractDataFromContext - Retornando dados básicos:`, JSON.stringify(basicData, null, 2));
    return basicData;
  } catch {
    // Se não for JSON, retornar dados básicos
    const basicData = {
      submittedAt: new Date().toISOString(),
      Name: '',
      Telefone: context.contactPhone,
      Idade: '',
    };
    console.log(`🔍 DEBUG extractDataFromContext - Erro ao parsear, retornando dados básicos:`, JSON.stringify(basicData, null, 2));
    return basicData;
  }
}

/**
 * Normaliza texto para comparação (lowercase e trim)
 */
function normalizeText(text: string): string {
  return (text || '').toLowerCase().trim();
}

/**
 * Verifica se uma condição é atendida na mensagem
 */
function checkConditionMatch(
  condition: { text: string; outputId: string },
  messageText: string
): boolean {
  const conditionText = normalizeText(condition.text);
  const normalizedMessage = normalizeText(messageText);
  return conditionText.length > 0 && normalizedMessage.includes(conditionText);
}

/**
 * Encontra a aresta correspondente a uma condição atendida
 */
function findConditionEdge(
  workflow: Workflow,
  conditionNode: WorkflowNode,
  condition: { text: string; outputId: string }
): WorkflowEdge | null {
  return (
    workflow.edges.find(
      (e) => e.source === conditionNode.id && e.sourceHandle === condition.outputId
    ) || null
  );
}

/**
 * Busca uma condição no caminho a partir de um nó (busca em profundidade)
 */
function findConditionInPath(
  workflow: Workflow,
  startNodeId: string,
  visited: Set<string> = new Set()
): WorkflowNode | null {
  if (visited.has(startNodeId)) {
    return null; // Evitar loops
  }
  visited.add(startNodeId);

  const node = workflow.nodes.find((n) => n.id === startNodeId);
  if (!node) {
    return null;
  }

  // Se este nó é uma condição, retornar
  if (node.type === 'condition') {
    return node;
  }

  // Buscar nos próximos nós
  const outgoingEdges = workflow.edges.filter((e) => e.source === startNodeId);
  for (const edge of outgoingEdges) {
    const found = findConditionInPath(workflow, edge.target, visited);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Verifica condições de um nó e retorna a condição atendida e sua aresta
 */
function checkConditions(
  context: ExecutionContext,
  conditionNode: WorkflowNode
): { condition: { text: string; outputId: string }; edge: WorkflowEdge } | null {
  const conditions = conditionNode.data?.conditions || [];
  const messageText = context.messageText;

  for (const condition of conditions) {
    if (checkConditionMatch(condition, messageText)) {
      const edge = findConditionEdge(context.workflow, conditionNode, condition);
      if (edge) {
        return { condition, edge };
      }
    }
  }

  return null;
}

/**
 * Executa os próximos nós conectados ao nó atual
 */
async function executeNextNodes(
  context: ExecutionContext,
  state: ExecutionState,
  currentNodeId: string
): Promise<void> {
  // Encontrar todas as arestas que saem deste nó
  const outgoingEdges = context.workflow.edges.filter((e) => e.source === currentNodeId);

  if (outgoingEdges.length === 0) {
    console.log(`🏁 Nenhum próximo nó encontrado. Fluxo finalizado neste caminho.`);
    // Se não há mais nós e chegamos aqui, consideramos que o caminho foi completado
    state.hasReachedEnd = true;
    return;
  }

  // Verificar se há uma condição no caminho a partir dos próximos nós
  // Se houver e for atendida, pular todos os nós intermediários
  for (const edge of outgoingEdges) {
    const conditionNode = findConditionInPath(context.workflow, edge.target, new Set(state.visitedNodes));
    
    if (conditionNode && !state.conditionMatched) {
      const match = checkConditions(context, conditionNode);

      if (match) {
        console.log(`✅ Condição encontrada no caminho: "${match.condition.text}". Pulando nós intermediários.`);
        console.log(`⏭️ Pulando nós intermediários e indo direto para o caminho da condição.`);
        state.conditionMatched = true;
        state.visitedNodes.add(conditionNode.id);
        await executeNode(context, state, match.edge.target);
        continue; // Não executar os nós intermediários
      }
    }

    // Se não há condição ou ela não foi atendida, executar normalmente
    await executeNode(context, state, edge.target);
  }
}

/**
 * Executa workflow a partir de um webhook do Typebot
 */
export async function executeWorkflowFromTypebot(
  workflow: Workflow,
  contactPhone: string,
  bodyData: any,
  userId: string
): Promise<void> {
  try {
    console.log(`🚀 Iniciando execução do workflow Typebot: ${workflow.name} (${workflow.id})`);
    console.log(`📱 Contato: ${contactPhone}`);

    // Encontrar o nó de gatilho typebotTrigger
    const triggerNode = workflow.nodes.find((node) => node.type === 'typebotTrigger');

    if (!triggerNode) {
      console.log(`⚠️ Workflow ${workflow.id} não possui nó de gatilho Typebot. Pulando execução.`);
      return;
    }

    // Para workflows Typebot, permitir múltiplas execuções do mesmo contato
    // Cada webhook pode trazer dados diferentes, então não verificamos se já entrou
    // Isso permite que o mesmo telefone envie formulários múltiplas vezes

    // Extrair variáveis do body do Typebot
    // O body pode vir como objeto direto ou dentro de um array
    let typebotVariables: Record<string, any> = {};
    
    if (bodyData && typeof bodyData === 'object') {
      // Se bodyData é um objeto, usar diretamente
      if (Array.isArray(bodyData) && bodyData.length > 0 && bodyData[0].body) {
        // Formato: [{ body: { Name: "...", Telefone: "..." } }]
        typebotVariables = bodyData[0].body || {};
      } else if (bodyData.body) {
        // Formato: { body: { Name: "...", Telefone: "..." } }
        typebotVariables = bodyData.body;
      } else {
        // Formato: { Name: "...", Telefone: "..." } (direto)
        typebotVariables = bodyData;
      }
    }

    console.log(`📋 Variáveis do Typebot extraídas:`, Object.keys(typebotVariables));

    // Se o Typebot tiver um campo "Telefone" no body, usar ele ao invés do contactPhone padrão
    let finalContactPhone = contactPhone;
    if (typebotVariables && typebotVariables.Telefone) {
      const typebotPhone = typebotVariables.Telefone;
      // Normalizar o telefone do Typebot
      const normalizedTypebotPhone = normalizePhone(String(typebotPhone), '55');
      if (normalizedTypebotPhone) {
        finalContactPhone = normalizedTypebotPhone;
        console.log(`📱 Usando telefone do Typebot: ${finalContactPhone} (original: ${typebotPhone})`);
      } else {
        console.log(`⚠️ Telefone do Typebot inválido: ${typebotPhone}. Usando telefone padrão: ${contactPhone}`);
      }
    }

    // Criar contexto de execução
    // Para Typebot, usamos os dados do body como mensagem
    const messageText = JSON.stringify(bodyData);

    const context: ExecutionContext = {
      workflow,
      contactPhone: finalContactPhone, // Usar telefone do Typebot se disponível
      instanceId: workflow.instanceId,
      messageText,
      userId,
      typebotVariables, // Adicionar variáveis do Typebot ao contexto
    };

    // Criar estado de execução
    const state: ExecutionState = {
      visitedNodes: new Set(),
      hasReachedEnd: false,
      conditionMatched: false,
    };

    // Executar workflow começando pelo gatilho
    await executeNode(context, state, triggerNode.id);

    // Para workflows Typebot, adicionar contato à lista APENAS se o workflow chegou ao final
    // Usar ON CONFLICT DO NOTHING para não gerar erro se o contato já estiver na lista
    if (state.hasReachedEnd) {
      try {
        await WorkflowService.addWorkflowContact(workflow.id, contactPhone, workflow.instanceId);
        console.log(`✅ Contato ${contactPhone} adicionado ao workflow ${workflow.id} (após conclusão completa)`);
      } catch (error) {
        // Se já estiver na lista, apenas logar (não é um erro crítico)
        console.log(`ℹ️ Contato ${contactPhone} já estava na lista do workflow ${workflow.id}`);
      }
      
      // Emitir evento WebSocket para atualizar frontend em tempo real
      try {
        emitWorkflowContactUpdate(userId, workflow.id, contactPhone, workflow.instanceId);
      } catch (error) {
        console.error('Erro ao emitir evento de contato do workflow:', error);
      }
    } else {
      console.log(`⏭️ Contato ${contactPhone} não adicionado ao workflow (fluxo não completou)`);
    }

    console.log(`✅ Workflow ${workflow.name} executado com sucesso`);
  } catch (error) {
    console.error(`❌ Erro ao executar workflow Typebot ${workflow.id}:`, error);
    throw error;
  }
}

/**
 * Executa workflow a partir de um webhook genérico
 */
export async function executeWorkflowFromWebhook(
  workflow: Workflow,
  bodyData: any,
  userId: string
): Promise<void> {
  try {
    console.log(`🚀 Iniciando execução do workflow Webhook: ${workflow.name} (${workflow.id})`);

    // Encontrar o nó de gatilho webhookTrigger
    const triggerNode = workflow.nodes.find((node) => node.type === 'webhookTrigger');

    if (!triggerNode) {
      console.log(`⚠️ Workflow ${workflow.id} não possui nó de gatilho Webhook. Pulando execução.`);
      return;
    }

    // Extrair telefone ANTES de verificar se contato já entrou no workflow
    const phoneField = triggerNode.data?.phoneField;
    let finalContactPhone = '';
    
    if (phoneField) {
      const phone = getNestedValue(bodyData, phoneField);
      if (phone) {
        const normalizedPhone = normalizePhone(String(phone), '55');
        if (normalizedPhone) {
          finalContactPhone = normalizedPhone;
          console.log(`📱 Telefone extraído do webhook: ${finalContactPhone} (campo: ${phoneField})`);
        }
      }
    }

    // Se encontrou telefone, verificar se o contato já entrou no workflow
    if (finalContactPhone) {
      const hasEntered = await WorkflowService.hasContactEntered(
        workflow.id,
        finalContactPhone,
        workflow.instanceId || ''
      );

      if (hasEntered) {
        console.log(`⏭️ Contato ${finalContactPhone} já entrou neste workflow. Pulando execução.`);
        return;
      }
    }

    // Para workflows Webhook, permitir múltiplas execuções
    // Cada webhook pode trazer dados diferentes

    // Extrair campos selecionados do nó
    const selectedFields = triggerNode.data?.selectedFields || [];
    const nameField = triggerNode.data?.nameField;

    console.log(`📋 Campos selecionados:`, selectedFields);
    console.log(`📱 Campo de telefone:`, phoneField || 'não configurado');
    console.log(`👤 Campo de nome:`, nameField || 'não configurado');
    console.log(`🔍 DEBUG - triggerNode.data completo:`, JSON.stringify(triggerNode.data, null, 2));
    console.log(`🔍 DEBUG - bodyData recebido:`, JSON.stringify(bodyData, null, 2));

    // Criar variáveis do webhook baseadas nos campos selecionados
    const webhookVariables: Record<string, any> = {};
    
    if (selectedFields.length > 0) {
      // Extrair apenas os campos selecionados do body
      for (const field of selectedFields) {
        // Suportar caminhos aninhados (ex: "user.email")
        const value = getNestedValue(bodyData, field);
        if (value !== undefined) {
          webhookVariables[field] = value;
        }
      }
    } else {
      // Se nenhum campo foi selecionado, usar todo o body
      webhookVariables['body'] = bodyData;
    }

    console.log(`📋 Variáveis do webhook extraídas (antes de adicionar Name):`, Object.keys(webhookVariables));
    console.log(`🔍 DEBUG - webhookVariables antes de adicionar Name:`, JSON.stringify(webhookVariables, null, 2));

    // Extrair nome se campo de nome foi configurado e adicionar como "Name" (compatível com Typebot)
    if (nameField) {
      console.log(`🔍 DEBUG - Tentando extrair nome do campo: "${nameField}"`);
      const name = getNestedValue(bodyData, nameField);
      console.log(`🔍 DEBUG - Valor extraído do campo "${nameField}":`, name);
      if (name) {
        webhookVariables['Name'] = String(name);
        console.log(`👤 Nome extraído do webhook: ${name} (campo: ${nameField})`);
        console.log(`🔍 DEBUG - webhookVariables['Name'] definido como:`, webhookVariables['Name']);
      } else {
        console.log(`⚠️ DEBUG - Campo "${nameField}" não retornou valor válido`);
      }
    } else {
      console.log(`⚠️ DEBUG - nameField não está configurado no nó`);
    }

    // Se não encontrou telefone anteriormente, usar um valor padrão ou deixar vazio
    // (workflows webhook podem não precisar de telefone)
    if (!finalContactPhone) {
      finalContactPhone = 'webhook-' + Date.now(); // Valor temporário único
      console.log(`📱 Telefone não encontrado, usando valor temporário: ${finalContactPhone}`);
    }

    const instanceIdForContact = workflow.instanceId || '';

    try {
      await WorkflowService.addWorkflowContact(workflow.id, finalContactPhone, instanceIdForContact);
      console.log(`✅ Contato ${finalContactPhone} registrado no workflow ${workflow.id} (entrada via webhook)`);
    } catch {
      console.log(`ℹ️ Contato ${finalContactPhone} já estava na lista do workflow ${workflow.id}`);
    }
    try {
      emitWorkflowContactUpdate(userId, workflow.id, finalContactPhone, instanceIdForContact);
    } catch (error) {
      console.error('Erro ao emitir evento de contato do workflow:', error);
    }

    // Criar contexto de execução
    // Para Webhook, usamos os dados do body como mensagem
    const messageText = JSON.stringify(bodyData);

    console.log(`🔍 DEBUG - webhookVariables final antes de criar contexto:`, JSON.stringify(webhookVariables, null, 2));
    console.log(`🔍 DEBUG - webhookVariables['Name'] no contexto:`, webhookVariables['Name']);

    const context: ExecutionContext = {
      workflow,
      contactPhone: finalContactPhone,
      instanceId: workflow.instanceId || '',
      messageText,
      userId,
      typebotVariables: webhookVariables, // Reutilizar typebotVariables para variáveis do webhook
    };

    console.log(`🔍 DEBUG - context.typebotVariables['Name'] após criar contexto:`, context.typebotVariables?.Name);

    // Criar estado de execução
    const state: ExecutionState = {
      visitedNodes: new Set(),
      hasReachedEnd: false,
      conditionMatched: false,
    };

    // Executar workflow começando pelo gatilho
    await executeNode(context, state, triggerNode.id);

    console.log(`✅ Workflow ${workflow.name} executado com sucesso`);
  } catch (error) {
    console.error(`❌ Erro ao executar workflow Webhook ${workflow.id}:`, error);
    throw error;
  }
}

/**
 * Função auxiliar para obter valor aninhado de um objeto
 * Exemplo: getNestedValue({ user: { email: 'test@test.com' } }, 'user.email') => 'test@test.com'
 */
function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) {
    return undefined;
  }

  const keys = path.split('.');
  let value = obj;

  for (const key of keys) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = value[key];
  }

  return value;
}

/**
 * Processa mensagem recebida e executa workflows ativos
 */
export async function processMessageForWorkflows(
  instanceId: string,
  userId: string,
  contactPhone: string,
  messageText: string,
  fromMe: boolean
): Promise<void> {
  // Só processar mensagens recebidas (FromMe: false)
  if (fromMe) {
    return;
  }

  try {
    console.log(`🔍 Verificando workflows ativos para instância ${instanceId}...`);

    // Buscar todos os workflows ativos do usuário
    const workflows = await WorkflowService.getWorkflowsByUserId(userId);

    // Filtrar apenas workflows ativos
    const activeWorkflows = workflows.filter((w) => w.isActive);

    console.log(`📋 Encontrados ${activeWorkflows.length} workflow(s) ativo(s)`);

    // Executar cada workflow
    for (const workflow of activeWorkflows) {
      try {
        await executeWorkflow(workflow, contactPhone, instanceId, messageText, userId);
      } catch (error) {
        console.error(`❌ Erro ao executar workflow ${workflow.id}:`, error);
        // Continuar com outros workflows mesmo se um falhar
      }
    }
  } catch (error) {
    console.error(`❌ Erro ao processar mensagem para workflows:`, error);
  }
}

