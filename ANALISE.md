# Análise do Projeto: Downloader Dashboard (DownDash)

## 1. Visão Geral

**Downloader Dashboard** é uma aplicação web full-stack que permite ao usuário colar uma URL de qualquer página e extrair todas as mídias disponíveis (vídeos, imagens, áudios, documentos) para download individual ou em lote (ZIP). Backend em Node.js puro (sem frameworks), frontend em JavaScript vanilla com módulos ES6.

---

## 2. Estrutura do Projeto

```
downloader-dashboard/
├── design-system/               # Documentação de design (defasada)
│   └── downloader-dashboard/
│       ├── MASTER.md
│       └── pages/
│           ├── dashboard.md
│           └── landing.md
├── locales/
│   ├── pt-BR.json               # Traduções português (119 linhas)
│   └── en.json                  # Traduções inglês (119 linhas)
├── scripts/
│   ├── app.js                   # Controlador principal (201 linhas)
│   ├── renderer.js              # Renderização DOM (394 linhas)
│   ├── download.js              # Download individual (200 linhas)
│   ├── state.js                 # Gerenciamento de estado (13 linhas)
│   ├── i18n.js                  # Internacionalização (91 linhas)
│   ├── analyzer.js              # Análise frontend (68 linhas)
│   ├── utils.js                 # Utilitários + Toast (63 linhas)
│   └── zip-download.js          # Download ZIP em lote (164 linhas)
├── styles/
│   └── main.css                 # Design system + componentes (1538 linhas)
├── server.js                    # Servidor HTTP Node.js (1049 linhas)
├── index.html                   # Landing page (232 linhas)
├── dashboard.html               # Dashboard (232 linhas)
├── package.json                 # Node.js ESM + archiver
└── package-lock.json            # Lockfile
```

---

## 3. Tech Stack

| Camada      | Tecnologia                                                |
|-------------|-----------------------------------------------------------|
| Backend     | Node.js puro (`http.Server`, `fetch`, `archiver` v8)      |
| Frontend    | HTML5 + CSS3 + JavaScript vanilla ES modules               |
| Estilos     | CSS puro com design system próprio, glassmorphism          |
| Ícones      | Emojis + SVGs inline (Heroicons style)                    |
| Fontes      | DM Sans + Space Grotesk (Google Fonts)                    |
| ZIP         | archiver v8 com `ZipArchive` + streaming para arquivo temp |
| Proxy       | Servidor proxy próprio para bypass de CORS + Range requests |

---

## 4. Arquitetura e Fluxo

### 4.1 Servidor (`server.js`) — ~1049 linhas

Servidor HTTP puro (sem Express) na porta **3006**. Endpoints:

**POST `/analyze`**
- Recebe `{"url": "...", "lang": "pt-BR"}`
- Detecta site específico (GoFile, Bunkr, PixelDrain, CyberDrop) ou faz scrape genérico
- Retorna JSON com `{title, url, items: [{type, name, url, ext, label, size}]}`

**GET `/proxy`**
- Proxy de requisições com Range headers (download parcial + player de vídeo)
- Autenticação GoFile (cookie + token) para downloads diretos

**POST `/download-zip`**
- Cria task assíncrona para download em lote
- Retorna `{taskId}` imediatamente

**GET `/download-zip/status/:taskId`**
- Polling (200ms) com `{processed, total, currentBytes, totalBytesEstimate, currentName, status, errors}`

**GET `/download-zip/result/:taskId`**
- Stream do ZIP completo com `Content-Length` real do arquivo
- Limpeza automática do arquivo temporário após download

**GET `/download-zip/cancel/:taskId`**
- Aborta task em andamento

### 4.2 Scrapers

| Site         | Implementação                        | Autenticação                |
|-------------|--------------------------------------|-----------------------------|
| **GoFile**  | API oficial com guest account token  | Cookie + Bearer token       |
| **Bunkr**   | Resolução de links + bypass proteção | -                           |
| **PixelDrain** | Scraper HTML específico          | -                           |
| **CyberDrop** | Scraper HTML específico           | -                           |
| **Genérico** | HTMLParser com regex + meta tags     | -                           |

### 4.3 ZIP Batch Download (`runZipTask`)

O download em lote segue este fluxo para evitar travamentos:

1. Para cada arquivo na lista:
   - Fetch com timeout de 30s (conexão) + 120s (streaming)
   - Valida Content-Type (rejeita HTML/text)
   - Pipe da resposta para arquivo temporário
   - Após download completo, adiciona ao archive via `fs.createReadStream`
   - 3 tentativas com retry em caso de falha
2. Após todos os arquivos: `archive.finalize()` + `await archiveDone`
3. Arquivos temporários são limpos no `finally`
4. Apenas 1 conexão HTTP simultânea (evita rate-limit do GoFile)

### 4.4 Frontend — Módulos ES6

| Módulo       | Responsabilidade                                      |
|-------------|-------------------------------------------------------|
| `app.js`    | Controlador principal: eventos, formulário, tabs      |
| `renderer.js` | Renderização de grid/lista, cards, skeleton, modal  |
| `download.js` | Download individual com progresso, pause, cancel     |
| `state.js`  | Estado global simples (objeto reativo)                |
| `i18n.js`   | Carregamento assíncrono de locale, `t()`, scan DOM    |
| `analyzer.js`| Comunicação com `/analyze`, parsing da resposta       |
| `utils.js`  | `formatBytes`, `formatSpeed`, `Toast`                 |
| `zip-download.js` | Painel de criação de ZIP, polling, download direto |

### 4.5 Fluxo de Uso

1. Usuário abre dashboard → tema (dark/light) aplicado via script síncrono no `<head>`
2. Idioma detectado (navegador ou localStorage) → `i18n.init()` carrega `.json`
3. Usuário cola URL → validação → POST `/analyze` (com `lang`)
4. Loading com skeleton + status textual traduzido
5. Resultados exibidos em grid/lista com:
   - Thumbnail para vídeos
   - Agrupamento por qualidade
   - Botões "Assistir" (modal) e "Download" (com progresso)
6. Download via `/proxy` com suporte a Range requests
7. Download em lote: selecionar arquivos → "Download ZIP" → painel de progresso → download direto via `<a download>`

---

## 5. Funcionalidades Implementadas

- ✅ Scraping de página genérica (qualquer site)
- ✅ Suporte específico: **GoFile**, **Bunkr**, **PixelDrain**, **CyberDrop**
- ✅ Classificação automática de mídia (vídeo/imagem/áudio/documento)
- ✅ Agrupamento inteligente de vídeos por qualidade
- ✅ Player de vídeo embutido (modal)
- ✅ Download individual com barra de progresso, velocidade, pause e cancelamento
- ✅ Download em lote ZIP com:
  - Progresso em tempo real (arquivos + bytes + velocidade)
  - Timeout por arquivo (30s conexão + 120s streaming)
  - Retry automático (3 tentativas)
  - Validação de Content-Type
  - Limpeza automática de arquivos temporários
- ✅ Alternância entre visualização grid e lista
- ✅ Tema claro/escuro com persistência (localStorage) + `colorScheme`
- ✅ Internacionalização completo (pt-BR + en) com fallback
- ✅ Seletor de idioma com persistência
- ✅ Design responsivo (mobile-first com breakpoints)
- ✅ Glassmorphism + animações com spring easing
- ✅ Skeleton loading durante análise
- ✅ Sistema de Toast notifications
- ✅ Acessibilidade (ARIA labels, `prefers-reduced-motion`, foco visível)
- ✅ Servidor Node.js puro sem dependências externas (exceto archiver)

---

## 6. Qualidade do Código

### Pontos Fortes
- **Server.js** modular com funções específicas por site + separação clara de concerns
- Tratamento de erros robusto (timeouts, retry, validação de Content-Type)
- ZIP task com isolamento de tasks (Map), timeout global, cleanup programado
- Frontend modular com ES modules (app.js sem dependências globais)
- CSS bem organizado com variáveis e animações performáticas
- i18n completo: frontend + server-side
- Tema explícito com `data-theme` + `colorScheme` para prevenir force-dark-mode
- Stream seguro: error handlers em todos os streams, `unhandledRejection` handler

### Pontos a Melhorar
- **Sem testes automatizados** (nem frontend, nem backend)
- **Sem bundler ou build step** (JS/CSS puro)
- **renderer.js** tem ~394 linhas — poderia ser subdividido
- **Sem Dockerfile** para deploy
- **design-system/** desatualizado (cores, tipografia e categorias não correspondem ao CSS real)

---

## 7. Maturidade do Projeto

| Aspecto               | Status            |
|-----------------------|-------------------|
| Funcionalidade core   | ✅ Completa       |
| Design / UI           | ✅ Premium        |
| Responsividade        | ✅ Boa            |
| Acessibilidade        | ✅ Básica         |
| Internacionalização   | ✅ pt-BR + en     |
| Tema claro/escuro     | ✅ Explícito      |
| Testes                | ❌ Nenhum         |
| Documentação          | ⚠️ Parcial        |
| Build / Deploy        | ❌ Nenhum setup   |
| Gerenciamento de estado | ⚠️ Manual (objeto global) |
| Performance           | ⚠️ Sem otimizações |

---

## 8. Recomendações

1. **Adicionar testes** (para server.js e frontend)
2. **Modularizar renderer.js** (separar grid, list, modal, skeleton)
3. **Adicionar build step** (esbuild ou vite) para minificação
4. **Adicionar Dockerfile** para deploy
5. **Adicionar service worker** para cache de assets
6. **Suporte a mais fontes** (YouTube, Vimeo, Instagram)
7. **Sincronizar ou remover design-system/** (atualmente defasado)
