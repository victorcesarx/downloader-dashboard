# Observabilidade local do WebScope

O WebScope expõe logs estruturados, métricas locais e um healthcheck para
diagnóstico sem depender de um serviço externo.

## Logs JSON

Cada linha escrita em stdout/stderr é um objeto JSON. Requisições recebem um
`requestId`, devolvido no header `X-Request-ID`; tarefas ZIP também incluem seu
`taskId`. Um `X-Request-ID` enviado pelo cliente só é aceito quando contém de 8
a 64 caracteres alfanuméricos, `_` ou `-`.

```json
{"timestamp":"2026-08-08T22:00:00.000Z","level":"info","event":"http.request.completed","requestId":"...","method":"GET","route":"/health","statusCode":200,"durationMs":2}
```

Defina `LOG_LEVEL` como `debug`, `info`, `warn` ou `error`. O padrão é `info`.
Mensagens legadas e detalhes por item ficam em `debug`, portanto não poluem a
saída normal.

`LOG_FORMAT=auto` usa linhas compactas no desenvolvimento e JSON em produção.
Também é possível forçar `pretty` ou `json`. Docker usa JSON por padrão para
manter compatibilidade com coletores de logs.
Campos com token, autorização, cookie, senha, segredo ou URL são removidos; URLs
encontradas dentro de mensagens de erro também são redigidas.

```bash
docker compose logs -f webscope
LOG_LEVEL=debug npm run dev
```

## Healthcheck

`GET /health` é público para permitir healthchecks do Docker e de proxies. A
resposta informa somente uptime e se o diretório temporário está acessível:

```json
{"status":"ok","uptimeSeconds":120,"checks":{"tempWritable":true}}
```

O endpoint usa `Cache-Control: no-store` e responde `503` quando o diretório não
está gravável. Não inclui caminhos, nomes de host, versões ou configurações.

## Métricas

`GET /metrics` usa o formato de texto Prometheus. Quando `DOWNDASH_TOKEN` está
configurado, o endpoint exige a mesma autenticação da aplicação. Nenhuma métrica
usa URL, IP, request ID ou task ID como label, evitando vazamento e cardinalidade
sem limite.

Famílias principais:

- `webscope_http_requests_total` e `webscope_http_request_duration_seconds_*`;
- `webscope_analysis_total` e `webscope_analysis_duration_seconds_*`;
- `webscope_scraper_requests_total` e `webscope_scraper_items_total`;
- `webscope_proxy_requests_total`, `webscope_proxy_duration_seconds_*`;
- `webscope_downloads_total` e `webscope_download_bytes_total`;
- `webscope_zip_tasks`, `webscope_zip_task_runs_total`,
  `webscope_zip_task_duration_seconds_*` e `webscope_zip_files_total`;
- `webscope_process_uptime_seconds` e `webscope_process_resident_memory_bytes`.

Exemplo local:

```bash
curl http://127.0.0.1:3006/metrics
curl -H "Authorization: Bearer $DOWNDASH_TOKEN" http://127.0.0.1:3006/metrics
```

Os nomes de rota HTTP são normalizados (`:taskId`, `/static`, `/unmatched`) para
que parâmetros fornecidos pelo usuário nunca se transformem em labels.
