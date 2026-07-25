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
├── server.js                      # Servidor HTTP Node.js (~1860 linhas)
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

### 4.1 Servidor (`server.js`) — ~1860 linhas

Servidor HTTP puro (sem Express) na porta **3006**. Endpoints:

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
- Bloqueio de SSRF (proteção contra IPs privados)
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
- **Server.js** modular com scrapers especializados por site + fallback genérico
- Tratamento de erros robusto (timeouts, retry, validação de Content-Type)
- ZIP task com isolamento (Map), AbortController, cleanup programado de órfãos
- Frontend modular com ES modules (sem dependências globais)
- CSS bem organizado com variáveis e animações performáticas
- i18n completo: locales carregados via fetch assíncrono + resolução por chave aninhada
- SPA router leve para navegação sem recarregar página
- Stream seguro: error handlers, `unhandledRejection` handler
- Proteção SSRF no proxy (bloqueio de IPs privados)
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
- **Rate limiting ausente** — `/analyze` e `/proxy` sem proteção contra abuso
- **SSRF hardening incompleto** — IPv6, DNS rebinding não bloqueados
- **Sem Content-Security-Policy** headers

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
2. **Adicionar build step** (esbuild ou vite) para minificação
3. **Adicionar Dockerfile** para deploy
4. **Adicionar service worker** para cache de assets e PWA
5. **Suporte a mais fontes** (YouTube, Vimeo, Instagram, Google Drive)
6. **Sincronizar versionamento** entre git e package.json
7. **Rate limiting** no servidor para endpoints POST
8. **SSRF hardening** — bloquear IPv6, notação alternativa de IP, DNS rebinding
9. **Keyboard shortcuts** — Ctrl+Enter para analisar, atalhos de navegação nos cards
10. **Virtual scrolling** — substituir lazy loading atual para listas com 1000+ itens
