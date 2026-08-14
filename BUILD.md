# Build e execução do WebScope

## Desenvolvimento

```bash
npm run dev
```

O comando inicia o backend em `http://127.0.0.1:3006` e o Vite em
`http://127.0.0.1:5173`. A interface deve ser aberta pela porta 5173; chamadas
de API são encaminhadas ao backend pela configuração de proxy do Vite.

Os processos também podem ser iniciados separadamente com `npm run dev:server`
e `npm run dev:client`.

## Produção

```bash
npm run build
npm run check:build
npm start
```

O build é gravado em `dist/`. O servidor de produção falha imediatamente quando
`dist/index.html` não existe, evitando servir os módulos fonte por engano.
`npm run start:prod` é mantido como alias explícito do mesmo modo de produção.

Arquivos JS e CSS com hash recebem cache imutável por um ano. `index.html` e os
arquivos em `dist/locales/` continuam com `no-cache`, permitindo que cada nova
versão aponte para os assets corretos.

## Verificação completa

```bash
npm run verify
```

Executa a suíte automatizada, gera o build e valida hashes, manifesto,
traduções, referências e ausência de versões manuais.

## Source maps de diagnóstico

O build padrão não publica source maps. Para gerar mapas ocultos de diagnóstico:

```bash
BUILD_SOURCEMAP=hidden npm run build
```

No PowerShell:

```powershell
$env:BUILD_SOURCEMAP='hidden'; npm.cmd run build
```

Esses mapas não devem ser incluídos em uma distribuição pública.
