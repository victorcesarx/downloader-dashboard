# WebScope — Roadmap pessoal

Atualizado em: 14/08/2026

Este roadmap substitui o histórico de implementação anterior. O WebScope será
tratado, por enquanto, como uma ferramenta local de uso individual. As prioridades
são conveniência diária, recuperação de falhas, compatibilidade com os sites usados
e manutenção simples.

## Baseline atual

- Aplicação local em Node.js e JavaScript modular, com build Vite e execução por Docker.
- Scrapers especializados, extração genérica, download individual e ZIP.
- Fila, histórico da sessão, retry, previews, galeria, Inspector e seleção de qualidade.
- Temas claro/escuro, PT-BR/EN, preferências e interface responsiva.
- Proteções de SSRF, autenticação opcional, limites operacionais e observabilidade.
- Pipeline aprovado com 587 testes, build versionado e verificação dos assets.

## Princípios para as próximas mudanças

- Otimizar primeiro o fluxo de uma única pessoa em uma máquina confiável.
- Manter as proteções de rede: uma URL externa ainda é conteúdo não confiável.
- Preferir recursos locais e opcionais a serviços externos ou contas em nuvem.
- Não exigir Docker para funcionalidades básicas, mas preservar compatibilidade.
- Toda tarefa deve ter testes proporcionais ao risco e documentação curta de uso.
- Um item só é concluído depois de passar em `npm run verify`.

---

## Prioridade 0 — Confiabilidade e produtividade diária

### [ ] 1. Comando de diagnóstico local

Criar `npm run doctor` para verificar, em uma única execução:

- versão do Node.js, dependências e integridade do build;
- portas necessárias e permissão de escrita nos diretórios configurados;
- espaço livre para arquivos temporários e downloads;
- acesso aos endpoints dos scrapers mais usados, sem baixar mídia;
- estado da descoberta automática do GoFile;
- presença e versão de ferramentas opcionais como `yt-dlp` e `ffmpeg`.

Critério de aceitação: o diagnóstico deve indicar claramente “pronto”, “opcional
ausente” ou uma correção sugerida para cada verificação, sem imprimir tokens,
cookies ou URLs privadas.

### [ ] 2. Sessões persistentes e recuperáveis

Substituir a persistência limitada ao `sessionStorage` por armazenamento local
durável e versionado.

- Restaurar análises, seleção, fila e histórico após fechar o navegador.
- Salvar apenas metadados; nunca armazenar blobs completos no navegador.
- Permitir nomear, reabrir, arquivar e excluir sessões.
- Migrar automaticamente o formato atual.
- Aplicar limites de quantidade e tamanho com limpeza explícita.

Critério de aceitação: reiniciar navegador e servidor não deve apagar o contexto
de trabalho, e dados antigos ou corrompidos não podem impedir a inicialização.

### [ ] 3. Fila de análise para múltiplas URLs

Permitir colar uma lista de URLs ou importar um arquivo de texto.

- Uma URL por linha, com deduplicação e validação antes do envio.
- Concorrência configurável, pausa, cancelamento e retry individual.
- Resultado consolidado com agrupamento por página de origem.
- Filtros para sucesso, vazio e falha.
- Seleção e ZIP funcionando entre várias análises.

Critério de aceitação: dezenas de URLs podem ser processadas sem travar a
interface, perder resultados concluídos ou exceder o limite configurado.

### [ ] 4. Pasta local de downloads gerenciada pelo servidor

Adicionar um modo opcional adequado à execução local:

- configurar `DOWNLOAD_DIR` dentro de uma raiz explicitamente permitida;
- salvar downloads individuais e ZIPs diretamente nessa pasta;
- mostrar caminho relativo, progresso e resultado na interface;
- impedir path traversal, sobrescrita acidental e saída da raiz configurada;
- funcionar também por volume montado no Docker;
- manter o download tradicional do navegador como fallback.

Critério de aceitação: arquivos grandes podem ser salvos sem acumular o conteúdo
inteiro na memória do navegador e sem permitir escrita fora da pasta autorizada.

### [ ] 5. Retomada real de downloads interrompidos

Evoluir pause/retry para retomada por bytes quando a origem permitir.

- Usar `Range`, `ETag`, `Last-Modified` e arquivo parcial.
- Confirmar que a origem não mudou antes de continuar.
- Reiniciar com segurança quando o servidor ignorar ranges.
- Preservar checkpoints após reinício da aplicação.
- Limpar parciais cancelados ou expirados por política configurável.

Critério de aceitação: interromper e reiniciar um download compatível deve
transferir apenas os bytes restantes e produzir um arquivo final íntegro.

### [ ] 6. Detecção de duplicados e verificação de integridade

Evitar baixar ou arquivar repetidamente o mesmo conteúdo.

- Detectar duplicados por URL normalizada, tamanho e hash quando disponível.
- Calcular SHA-256 durante o streaming, sem uma segunda leitura obrigatória.
- Oferecer ações: ignorar, renomear, substituir ou manter ambos.
- Gerar manifesto opcional para ZIPs e lotes.
- Exibir claramente quando a comparação é apenas provável.

Critério de aceitação: nunca descartar automaticamente um arquivo apenas por
nome; decisões definitivas devem usar hash ou confirmação do usuário.

---

## Prioridade 1 — Cobertura e organização pessoal

### [ ] 7. Integração local opcional com yt-dlp e ffmpeg

Adicionar um provedor separado, desativado quando as ferramentas não existirem.

- Detectar executáveis e versões pelo comando de diagnóstico.
- Listar formatos e combinar vídeo/áudio quando necessário.
- Integrar qualidade, progresso, cancelamento e pasta de downloads.
- Limitar processos simultâneos e limpar temporários.
- Não tentar instalar binários automaticamente.
- Documentar que o usuário é responsável pelos termos e direitos do conteúdo.

Critério de aceitação: a aplicação continua funcionando sem essas dependências e
explica precisamente por que um recurso não está disponível.

### [ ] 8. Perfis de nomeação e organização

Criar modelos reutilizáveis para nomes e subpastas.

- Variáveis como origem, título, data, índice, qualidade, extensão e hash curto.
- Prévia do resultado antes de iniciar o download.
- Sanitização específica para Windows e demais sistemas suportados.
- Presets por site e por tipo de mídia.
- Resolução determinística de colisões.

Critério de aceitação: qualquer nome gerado permanece dentro da pasta autorizada
e é válido no sistema operacional de destino.

### [ ] 9. Perfis por site

Salvar preferências específicas para os sites mais usados.

- Qualidade preferida, tipos aceitos e regra de nome.
- Download individual ou ZIP como ação padrão.
- Limites de concorrência e retry por origem.
- Ativar ou desativar scraper genérico como fallback.
- Exportar e importar os perfis.

Critério de aceitação: um perfil só afeta o domínio correspondente e pode ser
temporariamente ignorado sem editar sua configuração.

### [ ] 10. Suporte explícito a sessões autenticadas

Permitir, de forma opcional, analisar conteúdo acessível pela conta do usuário.

- Importar arquivo de cookies no formato Netscape para um cofre local.
- Nunca ler automaticamente cookies do navegador.
- Criptografar ou proteger o arquivo quando a plataforma oferecer mecanismo seguro.
- Escopo por domínio, expiração visível e remoção imediata.
- Redaction total em logs, erros e exportações.
- Desativado por padrão e indisponível em bind público sem autenticação.

Critério de aceitação: nenhum cookie pode ser enviado a domínio diferente,
persistido em texto em logs ou incluído em relatórios.

### [ ] 11. Central de compatibilidade dos scrapers

Criar uma página local de saúde e manutenção dos conectores.

- Último sucesso, última falha, duração e estratégia usada por scraper.
- Teste manual sem download e sem expor a URL consultada.
- Mensagens que diferenciem mudança do site, bloqueio temporário e configuração.
- Fixtures sanitizadas para regressões de parsers.
- Cache e descoberta automática com invalidação observável.

Critério de aceitação: quando um site mudar, deve ser possível identificar o
conector afetado e coletar diagnóstico seguro sem examinar logs extensos.

---

## Prioridade 2 — Conveniência e manutenção

### [ ] 12. Caixa de entrada rápida pela área de transferência

Com permissão explícita do navegador:

- detectar URLs ao retornar o foco para a aplicação;
- mostrar uma prévia antes de adicioná-las à fila;
- ignorar conteúdo já processado;
- permitir desativação completa;
- nunca monitorar a área de transferência em segundo plano sem ação visível.

Critério de aceitação: nenhum conteúdo é enviado ao servidor antes da confirmação
do usuário.

### [ ] 13. Favoritos e reanálise de páginas recorrentes

- Fixar páginas usadas com frequência.
- Reanalisar manualmente ou em intervalo local configurável.
- Destacar mídias novas desde a última execução.
- Não baixar automaticamente por padrão.
- Suspender verificações quando a aplicação estiver inativa.

Critério de aceitação: a comparação deve usar identidade estável e não marcar
todas as mídias como novas apenas porque tokens da URL mudaram.

### [ ] 14. Backup e restauração portáveis

Exportar um arquivo JSON versionado contendo somente dados escolhidos.

- Preferências, perfis, favoritos, histórico e sessões.
- Opção de excluir URLs, caminhos locais e outros dados sensíveis.
- Prévia do conteúdo antes de exportar ou importar.
- Validação e migração de schema.
- Nunca incluir token, cookie ou arquivo de mídia.

Critério de aceitação: uma instalação limpa recupera a configuração selecionada
sem sobrescrever dados existentes sem confirmação.

### [ ] 15. Painel local de armazenamento e limpeza

- Mostrar uso de temporários, parciais, ZIPs, cache e histórico.
- Ações de limpeza separadas por categoria.
- Política automática por idade e orçamento de disco.
- Nunca apagar downloads concluídos da pasta pessoal.
- Relatar arquivos órfãos e falhas de limpeza.

Critério de aceitação: toda exclusão informa exatamente a categoria e o espaço
recuperado, mantendo os downloads finais fora do alcance da limpeza automática.

### [ ] 16. Testes ponta a ponta dos fluxos críticos

Adicionar automação de navegador para:

- análise, filtros, variantes e preview;
- download individual e ZIP com servidor de mídia controlado;
- persistência após recarregar;
- preferências e temas;
- retomada e recuperação de falhas quando implementadas.

Critério de aceitação: os fluxos principais devem rodar localmente sem depender
de sites externos instáveis.

### [ ] 17. Redução de custo de manutenção do frontend

- Ativar `checkJs` gradualmente nos contratos de mídia, fila e ZIP.
- Dividir o CSS principal por componente sem alterar o resultado visual.
- Documentar fronteiras entre store, renderização e serviços.
- Remover compatibilidades legadas apenas depois das migrações de dados.
- Medir tamanho do bundle e tempo de inicialização no pipeline.

Critério de aceitação: a manutenção melhora sem exigir migração total para
TypeScript ou adoção de framework.

---

## Fora do roadmap atual

Enquanto o WebScope permanecer pessoal e local, não são prioridade:

- integração com Telegram ou outros serviços de envio;
- contas, permissões e colaboração multiusuário;
- publicação como serviço público;
- PWA offline para respostas de mídia;
- telemetria externa;
- migração integral para TypeScript;
- instalador desktop baseado em Electron.

Esses itens podem voltar se o modelo de uso mudar.

## Ordem recomendada

Executar na sequência: **1 → 2 → 3 → 4 → 5 → 6**. Depois escolher entre o bloco
de cobertura (**7–11**) e o de conveniência (**12–15**) conforme o uso real.
Os itens **16 e 17** devem acompanhar os demais quando reduzirem risco concreto.
