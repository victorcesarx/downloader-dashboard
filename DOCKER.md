# WebScope com Docker

## Requisitos

- Docker Engine ou Docker Desktop com Compose v2.
- Portas 3006 (acesso direto) ou 80/443 (proxy) disponíveis.

## Execução direta

Crie um `.env` a partir de `.env.example` e defina ao menos um token forte em
`DOWNDASH_TOKEN` antes de expor o serviço fora da máquina local.

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f webscope
```

Por padrão, o WebScope fica disponível somente em `http://127.0.0.1:3006`.
Para publicar diretamente em todas as interfaces, use `BIND_ADDRESS=0.0.0.0`,
preferencialmente apenas atrás de firewall e HTTPS.

## Proxy reverso com HTTPS

O arquivo complementar inicia Caddy e encaminha requisições para o WebScope
pela rede interna do Compose:

```bash
WEBSCOPE_DOMAIN=downloads.example.com \
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up --build -d
```

No PowerShell:

```powershell
$env:WEBSCOPE_DOMAIN='downloads.example.com'
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up --build -d
```

O DNS do domínio deve apontar para o servidor, e as portas 80/443 precisam estar
liberadas para a emissão automática do certificado. O Caddy aplica compressão e
usa timeout de cinco minutos para aguardar cabeçalhos de operações demoradas.

## Build da imagem

O `Dockerfile` possui estágios separados:

1. Instalação completa e cache de dependências.
2. Testes, build Vite e verificação do artefato.
3. Instalação somente das dependências de produção.
4. Runtime mínimo, sem fontes do frontend, testes ou ferramentas de build.

O container final executa como `node:node`, sem privilégios de root.

```bash
docker build --target runtime -t webscope:local .
```

## Temporários e limites

`/app/temp_zips` é um volume dedicado e gravável. O restante do filesystem do
container é somente leitura. O volume preserva tarefas temporárias durante uma
reinicialização do container, mas os próprios mecanismos de retenção do WebScope
continuam responsáveis pela expiração dos arquivos.

Os principais limites são:

| Variável | Padrão no Compose | Finalidade |
|---|---:|---|
| `ZIP_MAX_ITEMS` | `200` | Itens aceitos por tarefa |
| `GOFILE_TOKEN` | vazio | Token de conta GoFile opcional para evitar sessões guest repetidas |
| `GOFILE_WT_SALT` | vazio | Override administrativo opcional; vazio ativa descoberta, validação e cache automáticos do salt |
| `ZIP_FETCH_TIMEOUT_MS` | `30000` | Timeout por tentativa remota |
| `ZIP_MAX_TOTAL_BYTES` | `10737418240` | Bytes máximos por ZIP (10 GB) |
| `ZIP_MAX_TEMP_BYTES` | `10737418240` | Orçamento total do volume temporário (10 GB) |
| `ZIP_MAX_TASKS_PER_IP` | `2` | Tarefas simultâneas por IP |
| `WEBSCOPE_MEMORY_LIMIT` | `1g` | Memória máxima do container |
| `WEBSCOPE_CPU_LIMIT` | `1.0` | CPUs disponíveis |
| `WEBSCOPE_PIDS_LIMIT` | `200` | Processos permitidos |

O volume nomeado não impõe cota física por conta própria em todos os drivers.
`ZIP_MAX_TEMP_BYTES` é a proteção portátil aplicada pela aplicação. Em produção,
o host também deve monitorar e limitar o armazenamento do volume.

## Saúde e segurança

`GET /health` verifica se o processo responde e se o volume temporário continua
gravável. O endpoint não exige autenticação, não é armazenado em cache e não
expõe caminhos internos nem segredos.

O Compose também aplica:

- filesystem raiz somente leitura;
- remoção de todas as capabilities Linux;
- `no-new-privileges`;
- usuário sem privilégios;
- limites de CPU, memória e processos;
- reinicialização automática, processo init e período de encerramento.

Segredos devem ser fornecidos em runtime. Nunca copie `.env`, certificados ou
tokens para a imagem; esses arquivos são excluídos pelo `.dockerignore`.

## Operações comuns

```bash
docker compose ps
docker compose logs --tail=200 webscope
docker compose restart webscope
docker compose down
```

Para também remover os temporários, use `docker compose down -v`. Essa operação
apaga definitivamente o volume de ZIPs e os volumes do proxy quando aplicável.
