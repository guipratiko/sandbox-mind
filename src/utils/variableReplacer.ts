/**
 * Utilitário para substituição de variáveis dinâmicas em templates
 * 
 * Variáveis disponíveis:
 * - $firstName - Primeiro nome
 * - $lastName - Último nome
 * - $fullName - Nome completo
 * - $formattedPhone - Número formatado (ex: (62)9 9844-8536)
 * - $originalPhone - Número original/normalizado (ex: 5562998448536)
 */

import { formatBrazilianPhone } from './numberNormalizer';

/**
 * Converte valor de variável (webhook/Typebot) para texto na mensagem.
 * Objetos não viram "[object Object]": prioriza display_string/name/label e senão JSON.
 */
function valueToTemplateString(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const preferred =
      o.display_string ??
      o.displayString ??
      o.name ??
      o.label ??
      o.title ??
      o.text;
    if (preferred != null && (typeof preferred === 'string' || typeof preferred === 'number')) {
      return String(preferred);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ContactData {
  phone: string; // Número normalizado (ex: 5562998448536)
  name?: string; // Nome do contato
  formattedPhone?: string; // Número formatado (opcional, será calculado se não fornecido)
}

/**
 * Extrai o primeiro nome de um nome completo
 */
const getFirstName = (fullName?: string): string => {
  if (!fullName || !fullName.trim()) {
    return '';
  }
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || '';
};

/**
 * Extrai o último nome de um nome completo
 */
const getLastName = (fullName?: string): string => {
  if (!fullName || !fullName.trim()) {
    return '';
  }
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) {
    return '';
  }
  // Retornar tudo exceto o primeiro nome
  return parts.slice(1).join(' ') || '';
};

/**
 * Substitui variáveis em um texto usando dados do contato e variáveis do Typebot
 * @param text - Texto com variáveis (ex: "Olá $firstName, como vai?")
 * @param contact - Dados do contato
 * @param defaultName - Nome padrão caso não tenha nome
 * @param typebotVariables - Variáveis do Typebot (ex: { Name: "Marcos", Telefone: "+5562984049128" })
 * @returns Texto com variáveis substituídas
 */
export const replaceVariables = (
  text: string,
  contact: ContactData,
  defaultName: string = 'Cliente',
  typebotVariables?: Record<string, any>
): string => {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Usar o nome do contato se existir e não for vazio, senão usar defaultName
  const contactName = (contact.name && contact.name.trim()) ? contact.name.trim() : defaultName;

  console.log(`🔍 DEBUG replaceVariables - contactName:`, contactName);
  console.log(`🔍 DEBUG replaceVariables - typebotVariables:`, JSON.stringify(typebotVariables, null, 2));

  // Calcular valores das variáveis do contato
  const firstName = getFirstName(contactName);
  const lastName = getLastName(contactName);
  const fullName = contactName;
  const formattedPhone = contact.formattedPhone || formatBrazilianPhone(contact.phone);
  const originalPhone = contact.phone;

  console.log(`🔍 DEBUG replaceVariables - firstName calculado:`, firstName);
  console.log(`🔍 DEBUG replaceVariables - fullName calculado:`, fullName);

  // Mapa de variáveis para valores (variáveis padrão do contato)
  const variables: Record<string, string> = {
    $name: fullName, // Alias para $fullName (nome completo)
    $firstName: firstName,
    $lastName: lastName,
    $fullName: fullName,
    $formattedPhone: formattedPhone,
    $originalPhone: originalPhone,
  };

  console.log(`🔍 DEBUG replaceVariables - variables antes de adicionar typebotVariables:`, JSON.stringify(variables, null, 2));

  // Adicionar variáveis do Typebot (com prefixo $)
  if (typebotVariables && typeof typebotVariables === 'object') {
    for (const [key, value] of Object.entries(typebotVariables)) {
      // Converter chave para variável com $ (ex: "Name" -> "$Name")
      const variableKey = `$${key}`;
      variables[variableKey] = valueToTemplateString(value);
      console.log(`🔍 DEBUG replaceVariables - Adicionando variável: ${variableKey} = ${variables[variableKey]}`);
    }
  }

  console.log(`🔍 DEBUG replaceVariables - variables final:`, JSON.stringify(variables, null, 2));

  // Substituir do placeholder mais longo para o mais curto (evita $a corromper $accountId)
  let result = text;
  const sortedEntries = Object.entries(variables).sort((a, b) => b[0].length - a[0].length);
  for (const [variable, value] of sortedEntries) {
    const regex = new RegExp(escapeRegExpLiteral(variable), 'g');
    // Callback evita que `$` no valor seja interpretado como metacaracter do replace
    result = result.replace(regex, () => value);
  }

  return result;
};

/**
 * Substitui variáveis em um objeto JSON (para templates de sequência)
 * @param content - Conteúdo do template (pode ser string ou objeto)
 * @param contact - Dados do contato
 * @param defaultName - Nome padrão
 * @param typebotVariables - Variáveis do Typebot (opcional)
 * @returns Conteúdo com variáveis substituídas
 */
export const replaceVariablesInContent = (
  content: any,
  contact: ContactData,
  defaultName: string = 'Cliente',
  typebotVariables?: Record<string, any>
): any => {
  if (typeof content === 'string') {
    return replaceVariables(content, contact, defaultName, typebotVariables);
  }

  if (Array.isArray(content)) {
    return content.map((item) => replaceVariablesInContent(item, contact, defaultName, typebotVariables));
  }

  if (content && typeof content === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(content)) {
      result[key] = replaceVariablesInContent(value, contact, defaultName, typebotVariables);
    }
    return result;
  }

  return content;
};

/**
 * Lista de variáveis disponíveis para exibição no frontend
 */
export const AVAILABLE_VARIABLES = [
  { variable: '$name', label: 'Nome', description: 'Nome completo do contato (alias para $fullName)' },
  { variable: '$firstName', label: 'Primeiro Nome', description: 'Primeiro nome do contato' },
  { variable: '$lastName', label: 'Último Nome', description: 'Último nome do contato' },
  { variable: '$fullName', label: 'Nome Completo', description: 'Nome completo do contato' },
  { variable: '$formattedPhone', label: 'Número Formatado', description: 'Número formatado (ex: (62) 99844-8536)' },
  { variable: '$originalPhone', label: 'Número Original', description: 'Número original/normalizado' },
];

