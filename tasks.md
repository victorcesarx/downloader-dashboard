# WebScope — Roadmap de Qualidade e Evolução

Atualizado em: 14/08/2026 — itens 1 a 6, 8 a 17 e 21 a 25 concluídos; item 7 ignorado

Este arquivo é a fonte única de verdade para as próximas etapas. Os itens
devem ser executados em ordem. Uma etapa só pode ser marcada como concluída
depois de implementação, testes automatizados e validação visual proporcional
ao risco.

## Estado atual

- Node.js + JavaScript modular, sem framework de frontend.
- Scrapers especializados e pipeline genérico de extração de mídia.
- Download individual, ZIP em lote, fila, preview e Media Inspector.
- Grade, lista, compacto, virtual scroll, temas claro/escuro e PT-BR/EN.
- Coordenador genérico de painéis laterais.
- Proteções de SSRF, rate limit, limites de body, CSP e path traversal.
- Baseline anterior ao item 1: 442 testes aprovados em 29 arquivos.

---

## Fase 1 — Correções encontradas no QA

### [x] 1. Tornar a renderização determinística durante transições rápidas

Problema: busca, filtro ou modo de visualização alterados durante a animação
de saída podiam disputar com um timer anterior e produzir uma tela desatualizada
ou apagar o empty state.

Implementado:

- Timer de renderização cancelável e reiniciável.
- Debounce durante a animação de saída.
- Flush sempre baseado no estado mais recente da store.
- Cancelamento do timer ao entrar em loading ou empty state.
- Proteção contra container desmontado.
- Testes para timer antigo versus empty state e busca/filtro/view rápidos.

Critério de aceitação: nenhuma interação rápida pode deixar cards,
contagem, busca ou modo visual representando um estado anterior.

### [x] 2. Completar e tornar reativa a internacionalização

- Adicionar `filters.search_input` em PT-BR e EN.
- Atualizar `document.documentElement.lang` ao trocar idioma.
- Fazer fila, Inspector, modal, toasts e componentes dinâmicos renderizarem
  novamente quando `store.state.lang` mudar.
- Eliminar interfaces com textos misturados entre português e inglês.
- Criar teste que percorra todas as chaves usadas por `data-i18n*` e `t()`.
- Testar troca de idioma com fila e Inspector já montados.

Implementado:

- Chave `filters.search_input` adicionada nos dois idiomas.
- `<html lang>` sincronizado em toda troca de locale.
- Evento central `onLocaleChange` com unsubscribe.
- Cards, contagem e ações em lote renderizados novamente pelo app.
- Fila reativa, incluindo cabeçalho, abas, empty state e resumo.
- Inspector reativo sem fechar ou trocar o item selecionado.
- Preview e modal de nome do ZIP traduzidos enquanto permanecem abertos.
- Estados ativos de download renderizados novamente no novo idioma.
- Auditoria automática de completude PT-BR/EN para chaves usadas em HTML/JS.
- Testes de listener, atributo `lang` e componentes dinâmicos.

Critério de aceitação: nenhuma chave crua ou texto do idioma anterior
permanece visível depois da troca.

### [x] 3. Transformar a fila em histórico real da sessão

- Não remover downloads concluídos depois de 2,5 segundos.
- Manter concluídos e falhas até remoção explícita ou limite configurável.
- Preservar nome, tamanho, horário, origem, status e mensagem de erro.
- Ações: baixar novamente, copiar link, remover item e limpar aba.
- Limitar o histórico, inicialmente, aos 50 registros mais recentes.
- Testar conclusão, falha, retry, remoção e troca de idioma.

Implementado:

- Concluídos e falhas permanecem na fila após a restauração visual do card.
- Histórico serializado no `sessionStorage` e restaurado após recarregar a página.
- Retenção limitada aos 50 registros finais mais recentes.
- Nome, bytes recebidos/totais, horário, origem, status e erro preservados.
- Ações de baixar/tentar novamente, copiar link e remover em cada registro.
- Limpeza contextual e independente das abas Concluídos e Falhas.
- Interface e horários reativos à troca de idioma com o painel aberto.
- Testes automatizados de conclusão, falha, persistência, limite e ações.

Critério de aceitação: a fila funciona como histórico durante toda a sessão,
sem interferir no estado visual dos cards nem manter requisições finalizadas.

### [x] 4. Versionar e migrar o cache de análise

- Substituir `analyze_cache` por cache versionado ou envelope com `schemaVersion`.
- Invalidar entradas que não tenham os campos esperados pelo contrato atual.
- Definir TTL e limite por quantidade/tamanho.
- Preservar compatibilidade durante a migração.
- Testar cache antigo, expirado, corrompido e atual.

Implementado:

- Envelope `schemaVersion: 2` com entradas contendo `cachedAt` e `data`.
- Migração automática do mapa legado, mantendo somente respostas válidas.
- Validação do contrato mínimo de análise antes da leitura e da gravação.
- TTL de 30 minutos, máximo de 10 entradas e orçamento total de 1 MB.
- Remoção das entradas mais antigas por ordem de uso/gravação.
- Recuperação segura de JSON corrompido, schema incompatível e storage indisponível.
- Testes para formato atual, legado, expirado, inválido, corrompido e limites.

Critério de aceitação: apenas respostas compatíveis, atuais e dentro dos limites
podem evitar uma nova chamada ao endpoint de análise.

### [x] 5. Tratar tamanho desconhecido corretamente

- Exibir `—` ou “Desconhecido” em vez de `0 B`.
- Diferenciar arquivo realmente vazio de tamanho ainda não consultado.
- Atualizar card, Inspector, fila e total selecionado quando o tamanho chegar.
- Evitar que tamanho desconhecido distorça o total do ZIP.

Implementado:

- `null` representa tamanho desconhecido; `0` representa arquivo realmente vazio.
- Formatação centralizada e traduzida como “Desconhecido”/“Unknown”.
- Cards, seletor de variantes, Inspector e seleção em lote usam o mesmo contrato.
- Totais parciais informam bytes conhecidos e quantidade de itens desconhecidos.
- ZIP preserva a contagem de desconhecidos sem tratá-los como arquivos de zero byte.
- `Content-Length`, resposta por range e blob concluído atualizam card, Inspector,
  seleção e histórico quando o tamanho real fica disponível.
- Testes para zero, desconhecido, soma parcial e componentes visuais.

Critério de aceitação: nenhum tamanho ausente aparece como `0 B`, e nenhum total
é apresentado como completo enquanto existir item selecionado de tamanho desconhecido.

### [x] 6. Refinar o cabeçalho em telas pequenas

- Evitar que a marca WebScope seja cortada pela fila, idioma e tema.
- Em larguras estreitas, manter o ícone e ocultar/abreviar o texto da marca.
- Avaliar menu compacto para idioma, tema e fila.
- Validar em 320, 360, 390 e 430 px.

Implementado:

- Botão da fila vira um controle compacto por ícone abaixo de 560 px.
- Nome “WebScope” é ocultado até 430 px, preservando o ícone e o link da marca.
- Seletor de idioma recebe largura previsível sem perder Português/English.
- Espaçamentos e padding lateral são reduzidos progressivamente até 320 px.
- Fila, idioma e tema permanecem visíveis e com nomes acessíveis completos.
- Testes de regressão verificam os breakpoints e contratos de acessibilidade.

Critério de aceitação: nenhuma ação do cabeçalho é cortada ou removida nas
larguras-alvo, e o texto da marca só é sacrificado quando necessário.

### [~] 7. Completar acessibilidade e navegação por teclado — ignorado

Item ignorado por decisão do projeto nesta etapa.

- Região `aria-live="polite"` para análise, download, ZIP e erros.
- Cards acessíveis por Tab.
- Enter abre preview; Espaço alterna seleção.
- Foco preso e restaurado em modal e painéis quando apropriado.
- Nomes acessíveis consistentes para botões somente com ícone.
- Testes de teclado e auditoria com axe ou ferramenta equivalente.

---

## Fase 2 — Fluxos essenciais de produtividade

### [x] 8. Histórico de URLs analisadas

- Armazenar URLs recentes no `localStorage`.
- Dropdown de sugestões no campo principal.
- Fixar, reutilizar, copiar e remover entradas.
- Não registrar URLs inválidas ou análises que falharam antes da requisição.
- Limite e limpeza configuráveis.

Implementado:

- Histórico persistente no `localStorage`, independente do cache de respostas.
- Dropdown filtrável integrado ao campo principal e reativo ao idioma.
- Ações para reutilizar, fixar/desafixar, copiar e remover cada URL.
- Limpeza preserva URLs fixadas; limite configurável entre 1 e 100, padrão 20.
- URLs repetidas sobem para o topo sem duplicação e fixadas têm prioridade.
- Apenas URLs HTTP(S) cuja análise terminou com sucesso são registradas.
- Testes para validação, ordenação, limite, fixação, limpeza e ações do dropdown.

Critério de aceitação: o histórico acelera análises recorrentes sem acumular
URLs inválidas ou resultados fracassados.

### [x] 9. Retry automático de downloads individuais

- Até três tentativas com backoff exponencial e jitter.
- Não repetir erros permanentes como 401, 403 e formato incompatível.
- Mostrar tentativa atual na fila.
- Permitir retry manual depois do limite.
- Cancelamento deve interromper espera e requisição.

Implementado:

- Até três tentativas totais para falhas transitórias.
- Backoff exponencial de 500 ms e 1 s, acrescido de jitter até 249 ms.
- HTTP 400/401/403/404/405/410/415/422 e HLS/DASH não são repetidos.
- Card e fila mostram tentativa atual e estado de espera pelo próximo retry.
- Durante o backoff permanece disponível apenas a ação segura de cancelar.
- Cancelamento limpa timer e `AbortController`, impedindo nova requisição.
- Depois do limite, o erro entra no histórico e mantém retry manual.
- Testes para sucesso posterior, limite, erro permanente, formato incompatível
  e cancelamento durante o backoff.

Critério de aceitação: falhas temporárias são recuperadas sem intervenção,
enquanto falhas permanentes e cancelamentos nunca geram requisições extras.

### [x] 10. Painel de preferências

Usar o coordenador genérico de painéis laterais.

- Tema: sistema, claro ou escuro.
- Idioma.
- Blur NSFW.
- Som e notificações.
- Qualidade preferida.
- Concorrência de downloads.
- Retenção do histórico.
- Restaurar padrões.

Implementado:

- Painel lateral registrado no coordenador genérico, exclusivo com fila e Inspector.
- Preferências centralizadas e versionadas em `webscope_preferences_v1`.
- Migração automática das chaves legadas de tema, idioma, blur e som.
- Tema Sistema/Claro/Escuro com reação à preferência do sistema.
- Idioma, blur NSFW, som e notificações do sistema aplicados imediatamente.
- Qualidade preferida usada ao montar novas análises com variantes disponíveis.
- Limite de 1 a 5 downloads simultâneos, com estado “Aguardando vaga”.
- Retenção configurável de 10 a 100 registros do histórico da sessão.
- Restauração dos padrões e salvamento automático sem botão adicional.
- Botão responsivo no cabeçalho e painel validado em PT-BR/EN e claro/escuro.
- Testes para migração, normalização, painel, reset, qualidade e concorrência.

Critério de aceitação: todas as preferências alteram o comportamento real do
WebScope, persistem após recarregar e podem ser restauradas com segurança.

### [x] 11. Evoluir o Media Inspector

- Atualizar metadados sob demanda via HEAD/probe seguro.
- Exibir container, proporção, duração e dimensões quando disponíveis.
- Listar e trocar variantes dentro do Inspector.
- Copiar metadados como JSON.
- Manter campos ausentes como `N/A`, sem uma seção separada de indisponibilidade.
- Ações de preview, seleção e download no painel.

Implementado:

- Endpoint de metadados sob demanda com HEAD e fallback por range de um byte.
- Proteção SSRF para URL inicial e cada redirecionamento, timeout, limite de
  redirects, rate limit compartilhado e resposta sem cache.
- Leitura parcial limitada de PNG, JPEG, GIF, WebP, WAV e MP4/MOV, sem lógica
  específica por site e sem introduzir dependência de ffmpeg/ffprobe.
- Enriquecimento complementar por `loadedmetadata` do navegador para duração e
  dimensões, com proporção simplificada calculada localmente.
- Campos ausentes permanecem como `N/A`, sem uma seção visual adicional.
- Lista e troca de variantes dentro do painel, preservando exclusividade de
  seleção entre itens do mesmo grupo.
- Exportação dos metadados normalizados como JSON e cópia da URL direta.
- Ações de visualizar, selecionar/desmarcar e baixar com as mesmas restrições
  de streaming e abertura externa usadas pelos cards.
- Contrato `MediaItem` ampliado com container opcional.
- Testes de probe por HEAD/range, bloqueio de destino privado, variantes,
  seleção, atualização remota, JSON e completude PT-BR/EN.

Critério de aceitação: o Inspector permite consultar e agir sobre a mídia sem
baixar o arquivo completo, explica limitações da origem e mantém card, seleção
e metadados sincronizados.

### [x] 12. Relatório de erros parciais do ZIP

- Listar arquivos concluídos, ignorados e falhos.
- Exibir motivo por arquivo.
- Retry somente das falhas.
- Exportar relatório em texto.
- Manter o ZIP utilizável quando houver sucesso parcial.

Implementado:

- Resultado individual persistido para cada arquivo como concluído, falho,
  ignorado ou pendente, incluindo motivo e status HTTP quando disponível.
- Relatório integrado ao item ZIP na Fila de Downloads, com contadores e lista
  expansível por arquivo; falhas e itens ignorados abrem o relatório por padrão.
- Formatos HLS/DASH selecionados junto de arquivos compatíveis entram como
  ignorados no relatório, sem impedir a criação do ZIP parcial.
- O ZIP pronto permanece utilizável e disponível para download mesmo quando
  um ou mais itens falham.
- Ação para criar uma nova tarefa ZIP contendo exclusivamente os arquivos que
  falharam, preservando o relatório original e identificando a tarefa de origem.
- Relatórios exportáveis em texto legível diretamente pela fila.
- Ação `Cancelar ZIP` disponível inclusive após a conclusão: aborta streams,
  apaga arquivo e temporários e remove tarefa e relatório de retry do servidor.
- Metadados mínimos das falhas permanecem no servidor durante a janela de
  retenção mesmo depois da transferência e remoção do arquivo ZIP temporário.
- Interface traduzida em PT-BR/EN e testes de backend, endpoint, fila, payload,
  exportação, cancelamento destrutivo e retry seletivo.

Critério de aceitação: toda tarefa ZIP informa claramente o resultado de cada
arquivo, permite aproveitar sucessos parciais, repetir somente falhas, exportar
o diagnóstico e remover integralmente a instância sem conservar temporários.

### [x] 13. Seleção invertida

- Inverter somente os itens filtrados/visíveis.
- Respeitar exclusividade entre variantes do mesmo grupo.
- Atualizar total, ZIP e estados dos cards sem re-render desnecessário.

Implementado:

- Ação dedicada na barra de seleção, traduzida em PT-BR/EN.
- Inversão baseada na lista já filtrada, pesquisada, ordenada e colapsada.
- Seleções fora do filtro atual permanecem intactas.
- Ao selecionar um representante, outras variantes do grupo são removidas.
- Cards comuns e virtualizados, contador, tamanho total e botão ZIP são
  sincronizados incrementalmente, sem reconstruir a grade.
- Testes para filtro, seleção externa, variantes e lista visível vazia.

Critério de aceitação: inverter a seleção afeta somente os resultados exibidos,
preserva itens fora do filtro e nunca mantém duas variantes do mesmo grupo.

### [x] 14. Atalhos globais seguros

- Ctrl/Cmd+Enter: analisar.
- Escape: fechar modal/painel ou limpar seleção conforme contexto.
- Ctrl/Cmd+A: selecionar itens somente fora de campos de texto.
- Atalho para iniciar ZIP somente quando houver seleção.
- Tela de ajuda com todos os atalhos.

Implementado:

- `Ctrl/Cmd+Enter` envia o formulário somente quando há URL e nenhuma análise ativa.
- `Escape` respeita a prioridade modal, painel e seleção, sem apagar seleção
  enquanto o foco está em um campo editável.
- `Ctrl/Cmd+A` seleciona os resultados filtrados fora de inputs, textareas,
  selects e regiões editáveis, preservando exclusividade entre variantes.
- `Alt+Z` inicia o fluxo ZIP apenas quando existe mídia selecionada e nenhum
  modal ou painel está bloqueando o contexto.
- `?` e um botão acessível no cabeçalho abrem uma ajuda traduzida com todos
  os atalhos; a ajuda acompanha mudanças de idioma enquanto está aberta.
- Ações globais, exceto Escape, ficam suspensas durante modais e painéis.
- Testes para Windows/macOS, campos editáveis, ausência de resultados,
  prioridade do Escape, bloqueio contextual, ZIP e ajuda.

Critério de aceitação: atalhos nunca substituem edição de texto ou ações do
navegador fora do contexto previsto e produzem a mesma atualização da interface
que seus controles visuais equivalentes.

### [x] Ajuste visual — padronizar controles de fechar

- Substituir o caractere tipográfico `×` por um SVG compartilhado e simétrico.
- Unificar caixa clicável, centralização, raio, contraste, hover e foco.
- Aplicar a modais, fila, preferências, Inspector e remoção do histórico de URLs.

Implementado:

- Componente compartilhado de 40 px com ícone de 18 px e variante compacta de
  30 px com ícone de 15 px para ações dentro de listas.
- Centralização geométrica independente das métricas da fonte.
- Hover destrutivo sutil com tokens de perigo e anel de foco do design system.
- Mesmo comportamento nos temas claro/escuro e em desktop/mobile.
- Teste de regressão impede o retorno de `×`/`&times;` nesses controles.

Critério de aceitação: todos os ícones de fechar permanecem visualmente
centralizados e usam o mesmo contrato de interação do design system.

---

## Fase 3 — Distribuição e manutenção

### [x] 15. Build com Vite

- Bundling e minificação de JS/CSS.
- Assets com hash para cache imutável.
- Source maps de produção controlados.
- Separar configuração de desenvolvimento e produção.
- Remover a necessidade de versões manuais como `main.css?v=N`.

Implementado:

- Vite configurado com `index.html` como entrada e manifesto de produção.
- Bundle minificado de JS/CSS com nomes baseados em hash dentro de `dist/assets/`.
- Traduções PT-BR/EN copiadas e validadas em `dist/locales/` durante o build.
- Tema inicial incorporado ao grafo de módulos sem perder a aplicação antes da UI.
- Import externo de fontes removido para manter assets compatíveis com a CSP.
- Desenvolvimento com Vite/HMR na porta 5173 e proxy para o backend na porta 3006.
- Produção servida exclusivamente de `dist/`, com falha rápida quando o build falta.
- Cache imutável de um ano somente para assets com hash; HTML e locales usam `no-cache`.
- Compressão gzip corrigida para JavaScript e JSON com `charset` no MIME type.
- Source maps desativados por padrão e disponíveis apenas no build de diagnóstico.
- Scripts de build, verificação, preview, produção e pipeline completo adicionados.
- Verificador automático exige hashes, manifesto, locales, arquivos existentes,
  ausência de versões manuais e ausência de source maps no build padrão.
- Documentação de desenvolvimento, produção, cache e diagnóstico em `BUILD.md`.
- Smoke tests dos modos desenvolvimento/produção e validação visual em desktop/mobile.

Critério de aceitação: uma instalação limpa consegue testar, gerar e validar um
artefato autocontido, e o servidor Node entrega esse artefato com CSP, gzip e
políticas de cache coerentes sem expor os módulos fonte em produção.

### [x] 16. Dockerfile e docker-compose

- Imagem multi-stage e usuário sem privilégios.
- Healthcheck.
- Volumes e limites para temporários do ZIP.
- Variáveis documentadas.
- Exemplo de proxy reverso.

Implementado:

- `Dockerfile` multi-stage separa dependências, validação/build e runtime enxuto.
- O build da imagem executa o pipeline completo de testes e validação do bundle.
- Runtime baseado em Node 24, executado como usuário `node` sem privilégios.
- Contexto reduzido por `.dockerignore`, sem segredos, temporários ou artefatos locais.
- Endpoint `GET /health` público, sem dados sensíveis, valida a escrita no diretório
  temporário e é usado pelos healthchecks da imagem e do Compose.
- `docker-compose.yml` publica apenas em localhost por padrão, usa filesystem
  somente leitura, remove capabilities e aplica limites de memória, CPU e processos.
- Volume nomeado e `TEMP_DIR` configurável isolam os arquivos temporários de ZIP;
  cotas de tarefa e de ocupação total permanecem configuráveis por ambiente.
- Override `docker-compose.proxy.yml` e `Caddyfile.example` demonstram HTTPS e
  proxy reverso sem expor diretamente a porta da aplicação.
- Variáveis, operações, persistência, atualização e cenários de proxy documentados
  em `DOCKER.md` e `.env.example`.
- Testes automatizados validam os invariantes de segurança dos arquivos de
  contêiner e o contrato do endpoint de saúde.

Critério de aceitação: a configuração descreve uma imagem reproduzível e não
privilegiada, com saúde observável, temporários persistentes e limitados e uma
rota documentada para execução local ou atrás de proxy reverso.

Validação em Docker Desktop 29.6.2 / Compose 5.3.1:

- Imagem construída com sucesso e os 534 testes executados dentro do build.
- Contêiner saudável como `node:node`, com root filesystem somente leitura.
- Limites efetivos de 1 GiB de memória, 1 CPU e 200 processos confirmados.
- Healthcheck, autenticação e persistência do volume após reinício validados.
- Proxy Caddy validado em HTTPS, com redirecionamento automático de HTTP.

### [x] 17. Observabilidade local

- Logs estruturados com request/task ID.
- Métricas de análise, scraper, proxy, download e ZIP.
- Endpoint de saúde sem dados sensíveis.
- Níveis de log configuráveis.

Implementado:

- Logger JSON por linha com níveis `debug`, `info`, `warn` e `error`, configurado
  por `LOG_LEVEL` e adequado à coleta via stdout/stderr.
- Formato compacto e colorido no desenvolvimento, mantendo JSON em produção;
  detalhes legados e mensagens por item ficam restritos ao nível `debug`.
- Correlação automática por `requestId` usando contexto assíncrono e header
  `X-Request-ID`; operações ZIP relevantes também incluem `taskId`.
- Redaction centralizada de URLs, tokens, autorização, cookies, senhas e segredos.
- Métricas Prometheus em `GET /metrics`, protegidas pela autenticação existente
  quando `DOWNDASH_TOKEN` está configurado e sem labels de alta cardinalidade.
- Contadores e durações para HTTP, análise, scraper, proxy, download e ZIP, além
  de gauges da fila ZIP, uptime e memória residente do processo.
- Rotas normalizadas nas métricas para impedir que IDs e caminhos arbitrários
  sejam convertidos em labels.
- `GET /health` permanece público, sem cache e sem dados sensíveis, retornando
  `503` quando o diretório temporário deixa de estar gravável.
- Variáveis, formato, segurança e exemplos de consulta documentados em
  `OBSERVABILITY.md`, `.env.example` e no Compose.
- Testes automatizados cobrem redaction, correlação, métricas e ausência de
  caminhos ou IDs sensíveis nos endpoints operacionais.

Critério de aceitação: uma requisição pode ser correlacionada do acesso HTTP à
operação de domínio, falhas podem ser filtradas por nível e os principais fluxos
podem ser monitorados localmente sem registrar ou expor dados fornecidos pelo usuário.

### [ ] 18. Migração gradual para TypeScript

Status: adiado por decisão de produto; retomar após os recursos avançados prioritários.

- Começar pelos contratos MediaItem, download e ZIP.
- JSDoc/checkJs antes da conversão completa.
- `strict` habilitado por etapas.
- Nenhuma migração massiva sem cobertura equivalente.

### [ ] 19. PWA e Service Worker

Status: adiado por decisão de produto; retomar após os recursos avançados prioritários.

Executar somente depois do build com assets versionados.

- Manifesto instalável.
- Cache apenas do shell estático.
- Nunca armazenar respostas de proxy ou mídia privada sem regra explícita.
- Atualização segura do service worker.

---

## Fase 4 — Recursos avançados

### [ ] 20. Suporte a YouTube

- Integração opcional com yt-dlp/ffmpeg.
- Seleção de qualidade e combinação de vídeo+áudio.
- Detecção clara de dependências ausentes.
- Limites, cancelamento, progresso e limpeza de temporários.
- Revisar implicações legais e de termos de uso antes da distribuição.

### [x] 21. Lightbox e galeria

- Navegação anterior/próxima.
- Teclado, touch e preload limitado.
- Respeitar filtros e ordem atuais.
- Não carregar arquivos originais sem ação do usuário.

Implementado:

- O preview existente passou a funcionar como lightbox, usando a mesma lista
  filtrada, ordenada e com variantes colapsadas exibida nos cards.
- Navegação circular por botões, setas do teclado e gesto horizontal no touch,
  com contador e rótulos acessíveis em PT-BR e EN.
- Somente as thumbnails dos dois itens vizinhos são pré-carregadas; a mídia
  principal só é solicitada quando o usuário abre ou navega até o item.
- Fechamento por botão, backdrop ou Escape pausa a mídia e restaura o foco.
- Layout responsivo, suporte a tema claro/escuro pelos tokens existentes e
  respeito à preferência de movimento reduzido.

### [x] 22. Preview de áudio com waveform

- Geração progressiva e cancelável.
- Fallback para player nativo.
- Não bloquear a thread principal em arquivos grandes.

Implementado:

- Waveform progressivo em `canvas` alimentado pelo `AnalyserNode` do próprio
  player, sem baixar ou decodificar antecipadamente o arquivo completo.
- Desenho distribuído por `requestAnimationFrame` e cancelado ao pausar,
  terminar, trocar de mídia ou fechar o lightbox.
- Player HTML nativo permanece sempre disponível; quando Web Audio ou CORS não
  permitem a análise, uma mensagem traduzida informa o fallback.
- Resolução do canvas limitada a 2× a densidade da tela para evitar custo
  desnecessário em monitores de alta densidade.
- Testes cobrem ordem da galeria, teclado, preload limitado, fallback e limpeza.

### [x] 23. Seletor visual de qualidade

- Resolução, tamanho e formato por variante.
- Preview somente quando houver thumbnail distinta.
- Integrar com card, Inspector e preferência padrão.

Implementado:

- Opções visuais exibem resolução/qualidade, formato e tamanho disponível.
- Miniaturas aparecem somente quando uma opção oferece imagem distinta da atual.
- Cards e Inspector compartilham o mesmo padrão para qualidades e variantes.
- A seleção continua respeitando a preferência padrão aplicada durante a análise.

### [x] 24. Reordenação dos itens do ZIP

- Drag and drop com alternativa por teclado.
- Preservar ordem no payload e no arquivo final.
- Funcionar com listas virtualizadas.

Implementado:

- Modal único reúne nomeação do ZIP e organização dos arquivos selecionados.
- Reordenação por drag and drop, botões acessíveis e `Alt + ↑/↓` pelo teclado.
- A lista usa o estado completo da análise, independentemente da virtualização dos cards.
- O payload preserva a ordem escolhida e o backend insere as entradas nessa mesma sequência, mesmo com downloads concorrentes.

### [x] 25. Badge de progresso no favicon

- Contagem de downloads ativos.
- Restaurar favicon original ao zerar.
- Desativável nas preferências.

Implementado:

- O favicon mostra a quantidade de downloads individuais e ZIPs ainda ativos, com limite visual em `99+`.
- Ao concluir todos os downloads ou desativar a opção, o favicon original é restaurado sem atraso de renderizações anteriores.
- A preferência fica ativada por padrão, é persistente e está disponível em português e inglês.
- Cobertura automatizada inclui contagem, restauração, desativação, persistência e concorrência assíncrona; layout validado em desktop/mobile e temas claro/escuro.

### [ ] 26. Integração opcional com Telegram

- Módulo separado e desativado por padrão.
- Tokens apenas no servidor.
- Limites de tamanho, autenticação e expiração dos arquivos.
- Auditoria de privacidade antes de habilitar.

---

## Regras permanentes de conclusão

Para marcar qualquer item como concluído:

1. Implementar sem quebrar contratos existentes.
2. Adicionar testes de regressão e casos de erro.
3. Executar a suíte completa.
4. Fazer validação visual quando houver impacto de interface.
5. Testar tema claro/escuro e PT-BR/EN quando aplicável.
6. Testar desktop e mobile quando houver impacto de layout.
7. Atualizar este arquivo e a documentação relacionada.
8. Não adicionar dependência sem justificar custo, segurança e manutenção.
