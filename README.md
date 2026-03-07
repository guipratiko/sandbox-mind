# MindClerky - Microserviço de Workflows

Microserviço dedicado à execução de workflows visuais (Flow-Based Programming) do sistema Clerky.

## 🚀 Funcionalidades

- Execução de workflows visuais
- Integração com WhatsApp (via Evolution API)
- Integração com Typebot (webhooks)
- Integração com Google Sheets
- Integração com OpenAI
- Sistema de condições e delays
- Envio de mensagens com simulação de digitação (delay)

## 📋 Requisitos

- Node.js 18+
- PostgreSQL (compartilhado com Backend)
- MongoDB (para buscar instâncias)
- Evolution API configurada

## 🔧 Instalação

```bash
npm install
```

## ⚙️ Configuração

Copie o arquivo `.env` e configure as variáveis:

```env
PORT=4333
NODE_ENV=development

# PostgreSQL (compartilhado)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=clerky
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# MongoDB
MONGODB_URI=mongodb://localhost:27017/clerky

# Backend (para Socket.io)
BACKEND_URL=http://localhost:4331

# Evolution API
EVOLUTION_HOST=evo.clerky.com.br
EVOLUTION_APIKEY=sua-api-key

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4333/api/google/auth/callback
GOOGLE_API_URL=http://localhost:4333
```

## 🏃 Executar

### Desenvolvimento
```bash
npm run dev
```

### Produção
```bash
# 1. Instalar dependências
npm install

# 2. Compilar TypeScript
npm run build

# 3. Iniciar servidor
npm start
```

**Nota:** O servidor em produção usa `node dist/server.js` e requer que o código TypeScript seja compilado primeiro com `npm run build`.

## 📡 Endpoints

- `GET /` - Health check
- `GET /api/workflows` - Listar workflows
- `POST /api/workflows` - Criar workflow
- `POST /api/workflows/trigger` - Acionar workflow (interno)
- `POST /api/workflows/webhook/typebot/:nodeId` - Webhook Typebot (público)
- `GET /api/google/auth` - Autenticação Google OAuth
- `GET /api/google/auth/callback` - Callback OAuth

## 🏗️ Arquitetura

```
MindClerky/
├── src/
│   ├── config/          # Configurações
│   ├── controllers/     # Handlers HTTP
│   ├── services/        # Lógica de negócio
│   ├── routes/          # Rotas Express
│   ├── socket/          # Socket.io client
│   ├── utils/            # Utilitários
│   └── models/          # Modelos MongoDB
└── server.ts            # Servidor principal
```

## 🔗 Comunicação

- **Backend → MindClerky**: HTTP REST (para acionar workflows)
- **MindClerky → Backend**: Socket.io Client (para emitir eventos)
- **Typebot → MindClerky**: HTTP Webhook (público)

