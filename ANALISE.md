# Análise do Projeto: WebScope (Downloader Dashboard)

## 1. Visão Geral

**WebScope** (anteriormente DownDash) é uma aplicação web full-stack que permite ao usuário colar uma URL de qualquer página e extrair todas as mídias disponíveis (vídeos, imagens, áudios, documentos) para download individual ou em lote (ZIP). Backend em Node.js puro (sem frameworks), frontend em JavaScript vanilla com módulos ES6 e SPA routing.

---

## 2. Estrutura do Projeto

```
downloader-dashboard/
├── docs/                          # Documentação
├── locales/
│   ├── pt-BR.json                 # Traduções português (~70 chaves)
│   └── en.json                    # Traduções inglês (~70 chaves)
├── scripts/
│   ├── app.js                     # Controlador principal + SPA router (236 linhas)
│   ├── renderer.js                # Renderização DOM (432 linhas)
│   ├── download.js                # Wrapper para downloader.js (9 linhas)
│   ├── downloader.js              # Engine de download individual (214 linhas)
│   ├── state.js                   # Gerenciamento de estado (47 linhas)
│   ├── i18n.js                    # Internacionalização (89 linhas)
│   ├── analyzer.js                # Análise frontend (77 linhas)
│   ├── utils.js                   # Utilitários + Toast (91 linhas)
│   └── zip-download.js            # Download ZIP em lote (199 linhas)
├── styles/
│   └── main.css                   # Design system + componentes (~1500 linhas)
├── temp_zips/                     # Diretório temporário para arquivos ZIP
├── server.js                      # Servidor HTTP Node.js (1852 linhas)
├── index.html                     # SPA: Landing + Dashboard integrados (183 linhas)
├── dashboard.html                 # Versão standalone do dashboard (140 linhas)
├── package.json                   # Node.js ESM + archiver v7
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

---

## 4. Arquitetura e Fluxo

### 4.1 Servidor (`server.js`) — 1852 linhas

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
| `renderer.js`     | Renderização grid/lista, cards, skeleton, modal, qualidade |
| `downloader.js`   | Download individual com progresso, pause, resume       |
| `download.js`     | Wrapper para inicialização do downloader               |
| `state.js`        | Estado global simples (objeto observado)               |
| `i18n.js`         | Carregamento assíncrono de locale, `t()`, scan DOM     |
| `analyzer.js`     | Comunicação com `/analyze`, parsing da resposta        |
| `utils.js`        | `formatBytes`, `formatSpeed`, Toast, debounce          |
| `zip-download.js` | Painel de criação de ZIP, polling, download direto     |

### 4.5 Fluxo de Uso

1. Usuário abre a página → SPA router decide entre landing page ou dashboard
2. Tema (dark/light) aplicado via script síncrono no `<head>`
3. Idioma detectado (navegador ou localStorage) → `i18n.init()` carrega locale embutido
4. Usuário cola URL → validação → POST `/analyze`
5. Loading com skeleton + status textual traduzido
6. Resultados exibidos em grid/lista com:
   - Thumbnail para vídeos
   - Agrupamento por qualidade (Twitter)
   - Botões "Assistir" (modal com focus trap) e "Download" (com progresso)
7. Download via `/proxy` com suporte a Range requests
8. Download em lote: selecionar arquivos → "Download ZIP" → painel de progresso → download direto
9. Alternância entre landing e dashboard via SPA routing (sem recarregar página)

---

## 5. Funcionalidades Implementadas

- ✅ Scraping de página genérica (qualquer site)
- ✅ Suporte específico: **GoFile**, **PixelDrain**, **CyberDrop**, **Bunkr**, **Erome**, **Twitter/X**
- ✅ Classificação automática de mídia (vídeo/imagem/áudio/documento)
- ✅ Agrupamento inteligente de vídeos por qualidade (Twitter)
- ✅ Player de vídeo embutido (modal com focus trap, escape, auto-focus)
- ✅ Download individual com barra de progresso, velocidade, pause, resume e cancelamento
- ✅ Download em lote ZIP com:
  - Concorrência limitada (3 downloads simultâneos)
  - Progresso em tempo real (arquivos + bytes + velocidade)
  - Cancelamento via AbortController
  - Limpeza automática de arquivos temporários (órfãos > 30 min)
  - Erros parciais reportados sem abortar
- ✅ Alternância entre visualização grid e lista
- ✅ Tema claro/escuro com persistência (localStorage) + `prefers-color-scheme`
- ✅ Internacionalização completo (pt-BR + en) com fallback no HTML
- ✅ Seletor de idioma com persistência
- ✅ SPA routing (landing + dashboard em uma única página)
- ✅ Lazy loading de seções
- ✅ NSFW blur toggle
- ✅ Drag-and-drop de URL
- ✅ Design responsivo (mobile-first com breakpoints)
- ✅ Glassmorphism + animações com spring easing
- ✅ Skeleton loading durante análise
- ✅ Sistema de Toast notifications
- ✅ Acessibilidade (ARIA labels, `prefers-reduced-motion`, foco visível, focus trap)
- ✅ Autenticação opcional via token (`DOWNDASH_TOKEN`)
- ✅ Proxy com proteção SSRF
- ✅ Gzip compressão dinâmica + cache headers
- ✅ Servidor Node.js puro sem dependências externas (exceto archiver)

---

## 6. Qualidade do Código

### Pontos Fortes
- **Server.js** modular com scrapers especializados por site + fallback genérico
- Tratamento de erros robusto (timeouts, retry, validação de Content-Type)
- ZIP task com isolamento (Map), AbortController, cleanup programado de órfãos
- Frontend modular com ES modules (sem dependências globais)
- CSS bem organizado com variáveis e animações performáticas
- i18n completo: locales embutidos inline + resolução por chave aninhada
- SPA router leve para navegação sem recarregar página
- Stream seguro: error handlers, `unhandledRejection` handler
- Proteção SSRF no proxy (bloqueio de IPs privados)

### Pontos a Melhorar
- **Sem testes automatizados** (nem frontend, nem backend)
- **Sem bundler ou build step** (JS/CSS puro)
- **renderer.js** tem ~432 linhas — poderia ser subdividido
- **Sem Dockerfile** para deploy
- **Versionamento do package.json** defasado (1.1.0, mas commits mencionam v1.3.0)

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
6. **Suporte a mais fontes** (YouTube, Vimeo, Instagram, Google Drive)
7. **Sincronizar versionamento** entre git e package.json
