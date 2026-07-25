# Análise do Projeto: WebScope (Downloader Dashboard)

## 1. Visão Geral

**WebScope** (anteriormente DownDash) é uma aplicação web full-stack que permite ao usuário colar uma URL de qualquer página e extrair todas as mídias disponíveis (vídeos, imagens, áudios, documentos) para download individual ou em lote (ZIP). Backend em Node.js puro (sem frameworks), frontend em JavaScript vanilla com módulos ES6 e SPA routing.

---

## 2. Estrutura do Projeto

```
downloader-dashboard/
├── docs/
│   ├── tasks.md                   # Checklist de tarefas (~115 linhas)
│   └── ANALISE.md                 # Esta análise
├── locales/
│   ├── pt-BR.json                 # Traduções português (~110 chaves)
│   └── en.json                    # Traduções inglês (~110 chaves)
├── scripts/
│   ├── app.js                     # Controlador principal + SPA router (~267 linhas)
│   ├── renderer.js                # Renderização DOM (~512 linhas)
│   ├── download.js                # Wrapper para downloader.js (9 linhas)
│   ├── downloader.js              # Engine de download individual (~237 linhas)
│   ├── download-queue.js          # Painel de fila de downloads (~156 linhas)
│   ├── state.js                   # Gerenciamento de estado (47 linhas)
│   ├── i18n.js                    # Internacionalização (89 linhas)
│   ├── analyzer.js                # Análise frontend (77 linhas)
│   ├── utils.js                   # Utilitários + Toast (91 linhas)
│   └── zip-download.js            # Download ZIP em lote (199 linhas)
├── styles/
│   └── main.css                   # Design system + componentes (~1560 linhas)
├── server/                        # Módulos do servidor
│   ├── config.js                  # Constantes, cert HTTPS, TEMP_DIR
│   ├── utils.js                   # MIME_TYPES, CACHE_DURATIONS, cookieJar, fetch
│   ├── scrapers/
│   │   ├── index.js               # Router de scrapers
│   │   ├── gofile.js              # Scraper GoFile (API + fallback HTML)
│   │   ├── pixeldrain.js          # Scraper PixelDrain (API)
│   │   ├── cyberdrop.js           # Scraper CyberDrop (HTML + CDN)
│   │   ├── bunkr.js               # Scraper Bunkr (CDN + signing)
│   │   ├── generic.js             # Scraper genérico (regex + script)
│   │   ├── erome.js               # Scraper Erome (HTML)
│   │   └── twitter.js             # Scraper Twitter/X (HTML)
│   ├── middleware/
│   │   ├── auth.js                # requireAuth, sendUnauthorized, getLoginPage
│   │   ├── body-collector.js      # collectBody com limite de tamanho
│   │   ├── rate-limit.js          # Rate limiting por IP
│   │   └── ssrf.js                # Proteção SSRF (IPv4 + IPv6 + DNS)
│   ├── proxy.js                   # Proxy handler com Range + redirects
│   ├── static.js                  # Servir arquivos estáticos com gzip + cache
│   └── zip.js                     # ZIP batch: runZipTask, cleanupOrphanedZips
├── tests/
│   ├── setup.js                   # Setup do Vitest (matchMedia mock)
│   ├── backend/
│   │   ├── server.test.js         # Testes do backend (21 testes)
│   │   └── integration.test.js    # Testes de integração HTTP (18 testes)
│   └── frontend/
│       ├── utils.test.js          # Testes de utils (16 testes)
│       ├── state.test.js          # Testes de state (6 testes)
│       └── i18n.test.js           # Testes de i18n (12 testes)
├── temp_zips/                     # Diretório temporário para arquivos ZIP
├── server.js                      # Servidor HTTP Node.js (~244 linhas, ~70% redução)
├── index.html                     # SPA: Landing + Dashboard integrados (~195 linhas)
├── dashboard.html                 # Versão standalone do dashboard (~153 linhas)
├── vitest.config.js               # Configuração do Vitest
├── package.json                   # Node.js ESM + archiver v7 + vitest
└── package-lock.json              # Lockfile
```

---

## 3. Tech Stack

| Camada      | Tecnologia                                                |
|-------------|-----------------------------------------------------------|
| Backend     | Node.js puro (`http.Server`, `fetch`, `archiver` v7)      |
| Frontend    | HTML5 + CSS3 + JavaScript vanilla ES modules               |
| Estilos     | CSS puro com design system próprio, glassmorphism          |
| Ícones      | Emojis + SVGs inline (Heroicons style)                    |
| Fontes      | DM Sans + Space Grotesk (Google Fonts)                    |
| ZIP         | archiver v7 com `ZipArchive` + streaming para arquivo temp |
| Proxy       | Servidor proxy próprio para bypass de CORS + Range requests |
| Testes      | Vitest + jsdom (73 testes: unitários + integração HTTP)    |

---

## 4. Arquitetura e Fluxo

### 4.1 Servidor (`server.js` + `server/`) — ~244 + ~662 linhas

Servidor HTTP puro (sem Express) na porta **3006**, modularizado em camadas:

**server.js** (~244 linhas, ~70% menor) — orquestrador principal:
- Criação do servidor HTTP + roteamento
- Startup (HTTP/HTTPS)
- Re-exporta módulos para compatibilidade com testes

**server/config.js** — constantes e setup inicial:
- PORT, TEMP_DIR, AUTH_TOKEN, limites de body/rate-limit
- Carregamento de certificados HTTPS
- Criação do diretório temp_zips

**server/scrapers/** — scrapers específicos + genérico (vide seção 4.2)

**server/middleware/** — camada intermediária:
- `auth.js`: `requireAuth()`, `sendUnauthorized()`, página de login
- `body-collector.js`: `collectBody()` com limite de tamanho
- `rate-limit.js`: rate limiting por IP com cleanup automático
- `ssrf.js`: proteção contra IPs privados (IPv4, IPv6, DNS lookup)

**server/proxy.js** — proxy handler completo com Range headers, redirects, SSRF

**server/static.js** — servir arquivos estáticos com gzip + cache headers + auth

**server/zip.js** — gerenciamento de tasks ZIP assíncronas:
- `runZipTask()` com concorrência limitada, AbortController, progresso
- `cleanupOrphanedZips()` — limpeza periódica de arquivos órfãos (>30 min)

**Endpoints:**

**POST `/analyze`**
- Recebe `{"url": "..."}`
- Detecta site específico (GoFile, PixelDrain, CyberDrop, Bunkr, Erome, Twitter/X) ou faz scrape genérico
- Retorna JSON com `{title, url, items: [{type, name, url, ext, label, size, thumbnail, qualities}]}`

**GET `/proxy`**
- Proxy de requisições com Range headers (download parcial + player de vídeo)
- Gerenciamento de cookies por domínio (cookie jar)

**POST `/download-zip`**
- Cria task assíncrona para download em lote com concorrência limitada (3 simultâneos)
- Retorna `{taskId}` imediatamente

**GET `/download-zip/status/:taskId`**
- Polling com `{processed, total, currentBytes, speed, status, error}`

**GET `/download-zip/result/:taskId`**
- Stream do ZIP completo com `Content-Length` real do arquivo
- Limpeza automática do arquivo temporário após download

**GET `/download-zip/cancel/:taskId`**
- Aborta task em andamento via `AbortController`

**POST `/auth`**
- Autenticação via token (quando `DOWNDASH_TOKEN` está definido)

**Recursos adicionais do servidor:**
- Gzip compressão dinâmica para respostas de texto
- Cache headers diferenciados por extensão de arquivo
- Limpeza periódica de arquivos ZIP órfãos (a cada 5 min, remove >30 min)
- Suporte a HTTPS (opcional, via certs/cert.pem + key.pem)
- Rate limiting por IP (20 req/min no /analyze)
- Bloqueio de SSRF (proteção contra IPs privados, IPv6, DNS rebinding)
- Content-Security-Policy restritiva em páginas HTML
- Guarda `process.env.VITEST` para não iniciar servidor durante testes

### 4.2 Scrapers

| Site             | Função                          | Autenticação                |
|------------------|--------------------------------|-----------------------------|
| **GoFile**       | API oficial + fallback HTML    | Guest account token + WT    |
| **PixelDrain**   | API oficial (file + list)      | -                           |
| **CyberDrop**    | API própria + fallback HTML    | Cookie jar + auth_url       |
| **Bunkr**        | Resolução CDN + API signing    | -                           |
| **Erome**        | Scraper HTML (vídeo + imagem)  | -                           |
| **Twitter / X**  | Scraper HTML (MP4 + HLS + img) | -                           |
| **Genérico**     | HTML Parser com regex + script | -                           |

### 4.3 ZIP Batch Download

O download em lote segue este fluxo:
1. Concorrência limitada a 3 downloads simultâneos
2. Fetch com suporte a `AbortController` para cancelamento
3. Append direto ao archive via `Buffer.concat(chunks)`
4. Atualização de progresso em tempo real (arquivos + bytes + velocidade)
5. `archive.finalize()` ao finalizar todos os downloads
6. Erros parciais são reportados sem abortar o processo completo

### 4.4 Frontend — Módulos ES6

| Módulo            | Responsabilidade                                      |
|-------------------|-------------------------------------------------------|
| `app.js`          | Controlador principal: SPA router, eventos, formulário |
| `renderer.js`     | Renderização grid/lista/compacto, cards, skeleton, modal, qualidade, animação de transição de filtros |
| `downloader.js`   | Download individual com progresso, pause, resume       |
| `download.js`     | Wrapper para inicialização do downloader               |
| `download-queue.js` | Painel de fila de downloads ativos com pause/resume/cancel |
| `state.js`        | Estado global simples (objeto observado) com `structuredClone` para mutations imutáveis |
| `i18n.js`         | Carregamento assíncrono de locale via fetch, `t()`, scan DOM (data-i18n, data-i18n-title, data-i18n-aria-label) |
| `analyzer.js`     | Comunicação com `/analyze`, parsing da resposta        |
| `utils.js`        | `formatBytes`, `formatSpeed`, Toast, debounce          |
| `zip-download.js` | Painel de criação de ZIP, polling, download direto     |

### 4.5 Fluxo de Uso

1. Usuário abre a página → SPA router decide entre landing page ou dashboard
2. Tema (dark/light) aplicado via script síncrono no `<head>`
3. Idioma detectado (navegador ou localStorage) → `i18n.init()` carrega locale via fetch assíncrono
4. Usuário cola URL → validação → POST `/analyze`
5. Loading com skeleton + status textual traduzido
6. Resultados exibidos em grid/lista/compacto com:
   - Thumbnail para vídeos
   - Agrupamento por qualidade (Twitter)
   - Botões "Preview" (modal com focus trap + ARIA), "Copiar Link" 📋, e "Download" (com progresso)
   - Tooltips i18n em todos os botões de ação
   - Transição animada (fade) ao trocar de filtro
7. Download via `/proxy` com suporte a Range requests
8. Download em lote: selecionar arquivos → "Download ZIP" → painel de progresso → download direto
9. Fila de downloads: botão na navbar mostra contagem de downloads ativos, painel expansível com progresso individual, pause/resume/cancel
10. Alternância entre landing e dashboard via SPA routing (sem recarregar página)
11. Barra de progresso global no navbar durante ZIP ativo

---

## 5. Funcionalidades Implementadas

- ✅ Scraping de página genérica (qualquer site)
- ✅ Suporte específico: **GoFile**, **PixelDrain**, **CyberDrop**, **Bunkr**, **Erome**, **Twitter/X**
- ✅ Classificação automática de mídia (vídeo/imagem/áudio/documento)
- ✅ Agrupamento inteligente de vídeos por qualidade (Twitter)
- ✅ Player de vídeo embutido (modal com focus trap, ARIA, fallback de foco)
- ✅ Download individual com barra de progresso, velocidade, pause, resume e cancelamento
- ✅ Download em lote ZIP com:
  - Concorrência limitada (3 downloads simultâneos)
  - Progresso em tempo real (arquivos + bytes + velocidade + ETA)
  - Cancelamento via AbortController
  - Limpeza automática de arquivos temporários (órfãos > 30 min)
  - Erros parciais reportados sem abortar
- ✅ Alternância entre visualização grid, lista e **compacto**
- ✅ Tema claro/escuro com persistência (localStorage) + `prefers-color-scheme`
- ✅ Internacionalização completo (pt-BR + en) com fallback no HTML
- ✅ Seletor de idioma com persistência
- ✅ SPA routing (landing + dashboard em uma única página)
- ✅ Lazy loading de seções (IntersectionObserver + batches)
- ✅ NSFW blur toggle
- ✅ Drag-and-drop de URL
- ✅ Design responsivo (mobile-first com breakpoints)
- ✅ Glassmorphism + animações com spring easing
- ✅ Skeleton loading durante análise
- ✅ Sistema de Toast notifications
- ✅ Acessibilidade (ARIA labels, `prefers-reduced-motion`, foco visível, focus trap, `role="dialog"`, `aria-modal`)
- ✅ Autenticação opcional via token (`DOWNDASH_TOKEN`)
- ✅ Proxy com proteção SSRF
- ✅ Gzip compressão dinâmica + cache headers
- ✅ Servidor Node.js puro sem dependências externas (exceto archiver)
- ✅ **Fila de downloads ativos** — painel com toggle na navbar, badge com contagem, progresso individual por item
- ✅ **Copiar link da mídia** — botão com ícone SVG em cada card, clipboard API, toast de feedback
- ✅ **Tooltips i18n** — `data-i18n-title` + `title` dinâmico em todos os botões de ação (HTML e JS)
- ✅ **Transição animada nos filtros** — fade in/out dos cards com CSS `@keyframes` ao mudar `activeFilter`
- ✅ **Barra de progresso global ZIP** — progresso do ZIP atual visível no navbar
- ✅ **Testes** — 73 testes Vitest (21 unitários backend + 18 integração HTTP + 16 utils + 6 state + 12 i18n)
- ✅ **Focus trap completo** no modal — `trapFocus()` com fallback para container sem elementos focáveis, `prefers-reduced-motion`
- ✅ **Estado imutável** — `structuredClone()` para mutations de itens no `renderer.js`
- ✅ **i18n assíncrono** — locales carregados via `fetch()` em vez de inline `window.__LOCALES__`
- ✅ **Consolidação de estilos** — estilos inline movidos do HTML para CSS

---

## 6. Qualidade do Código

### Pontos Fortes
- **Server.js** modularizado em camadas: scrapers dedicados, middleware, proxy, ZIP, static — 70% menor (~244 linhas)
- **Regra do projeto:** todo novo scraper específico deve ser criado em `server/scrapers/` como arquivo dedicado, seguindo o padrão dos existentes (exportar função scrapeXxx + manter lógica isolada)
- Tratamento de erros robusto (timeouts, retry exponencial, validação de Content-Type)
- ZIP task com isolamento (Map), AbortController, cleanup programado de órfãos
- Frontend modular com ES modules (sem dependências globais)
- CSS bem organizado com variáveis e animações performáticas
- i18n completo: locales carregados via fetch assíncrono + resolução por chave aninhada
- SPA router leve para navegação sem recarregar página
- Stream seguro: error handlers, `unhandledRejection` handler
- Proteção SSRF no proxy (bloqueio de IPs privados, IPv6, DNS lookup)
- Rate limiting por IP com cleanup automático (20 req/min no /analyze)
- Testes automatizados com Vitest (73 testes, backend + frontend + integração HTTP)
- Modal acessível com ARIA `role="dialog"`, `aria-modal`, `aria-labelledby`, foco restaurado
- Estado gerenciado com `structuredClone` para mutations imutáveis
- Animações CSS com `@keyframes` para transições de filtro e entrada de cards
- Tooltips i18n em todos os botões (HTML estático + JS dinâmico)

### Pontos a Melhorar
- **renderer.js** tem ~512 linhas — poderia ser subdividido
- **Sem bundler ou build step** (JS/CSS puro)
- **Sem Dockerfile** para deploy
- **Versionamento do package.json** defasado (1.1.0, mas commits mencionam v1.3.0)

- **GoFile** — API sofre rate limiting facilmente; fallback HTML não captura conteúdo SPA

---

## 7. Maturidade do Projeto

| Aspecto               | Status            |
|-----------------------|-------------------|
| Funcionalidade core   | ✅ Completa       |
| Design / UI           | ✅ Premium        |
| Responsividade        | ✅ Boa            |
| Acessibilidade        | ✅ Boa            |
| Internacionalização   | ✅ pt-BR + en     |
| Tema claro/escuro     | ✅ Explícito      |
| Testes                | ⚠️ Parcial (73: unitários + integração HTTP) |
| Documentação          | ⚠️ Parcial        |
| Build / Deploy        | ❌ Nenhum setup   |
| Gerenciamento de estado | ⚠️ Manual (Proxy global) |
| Performance           | ⚠️ Sem otimizações |

---

## 8. Recomendações

1. **Modularizar renderer.js** (separar card, modal, grid, skeleton, batch) — ~512 linhas atualmente
2. **Manter padrão de scrapers dedicados** — todo novo scraper específico deve ser criado em `server/scrapers/` como arquivo individual (ex.: `server/scrapers/youtube.js`), registrado em `server/scrapers/index.js`, sem poluir `server.js` ou `server/scrapers/generic.js`. O padrão atual garante isolamento de lógica e facilita manutenção.
3. **Adicionar build step** (esbuild ou vite) para minificação
4. **Adicionar Dockerfile** para deploy
5. **Adicionar service worker** para cache de assets e PWA
6. **Suporte a mais fontes** (YouTube, Vimeo, Instagram, Google Drive)
7. **Sincronizar versionamento** entre git e package.json
8. **Keyboard shortcuts** — Ctrl+Enter para analisar, atalhos de navegação nos cards
9. **Virtual scrolling** — substituir lazy loading atual para listas com 1000+ itens
