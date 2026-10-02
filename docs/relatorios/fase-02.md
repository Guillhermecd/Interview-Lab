# Relatório — Fase 02: Executor de queries seguro

**Branch:** `feature/fase-02-executor-queries`  **Data:** 2026-10-02

## 1. O que foi feito
- **`QueryExecutor`** (`apps/api/src/query/query-executor.service.ts`): recebe SQL e o executa com limites que não dependem do texto do SQL.
- **Pool read-only** (`readonly-pool.ts`): o usuário é fixo em `app_readonly`; nenhuma configuração aponta o pool para outro usuário.
- **Tradução de erros** (`query-error.ts`): SQLSTATE do Postgres → códigos estáveis com mensagem segura em português.
- **Endpoint interno** `POST /api/internal/queries/execute` (`query.controller.ts`), registrado só com `INTERNAL_QUERY_ENDPOINT_ENABLED=true` (D-22).
- **Formato padrão de erro** para toda a API (`src/http/api-exception.filter.ts`): `{ code, message, details? }`, sem stack trace.
- **Health check consulta o banco:** `GET /api/health` responde `503` se o banco não responder.
- **Configuração** (`src/config`): `DB_POOL_MAX`, `QUERY_MAX_ROWS`, `QUERY_STATEMENT_TIMEOUT_MS`, `QUERY_APP_TIMEOUT_MS`, `INTERNAL_QUERY_ENDPOINT_ENABLED`; funções de leitura de env extraídas para `env-parsers.ts`.
- **`packages/shared`:** tipos `QueryResult`, `QueryColumn`, `ExecuteQueryRequest`, `ApiErrorBody`.
- **Testes:** unitários passaram de 20 para 57; integração de 39 para 79. O teste unitário do health check foi substituído por testes de integração (o health agora depende do banco).
- **Documentação:** D-22 e exceção da D-12 em `DECISOES.md`; rotas e exemplo no `README.md`; `.env.example`; Fase 02 marcada `CONCLUÍDA` no `PLANO.md` (vale com o merge).

## 2. Por que foi feito assim
Entregas do `PLANO.md` e como cada uma foi atendida:

| Entrega | Implementação |
|---|---|
| Pool exclusivo `app_readonly` | Usuário fixo no código; a API nem lê as credenciais de administrador |
| Timeout no banco | `statement_timeout` reaplicado em toda execução, dentro da transação |
| Timeout na aplicação | Cronômetro para a execução inteira; ao estourar, cancela o backend (`pg_cancel_backend`) e destrói a conexão |
| Limite de linhas | Cursor no servidor: busca `limite + 1` linhas e marca `truncated` |
| Resposta padronizada | `columns` (nome e tipo), `rows`, `rowCount`, `truncated`, `durationMs` |
| Erros seguros | Só erros de sintaxe e de nome inexistente repassam a mensagem do Postgres; os demais viram mensagem fixa |

Escolhas de segurança além do pedido:
- **Cada execução roda em `BEGIN TRANSACTION READ ONLY` + `ROLLBACK`.** O que uma query fizer na sessão (por exemplo `set_config`) é desfeito; a próxima execução reaplica o timeout.
- **Protocolo estendido do Postgres**, que aceita um único statement por mensagem: `SELECT 1; DROP ...` é recusado pelo próprio banco, independente da guarda SQL.
- **`DECLARE CURSOR FOR <sql>`** só aceita `SELECT`/`VALUES`: `INSERT`, `UPDATE`, `DELETE`, `DROP` e `SET` falham como erro de sintaxe antes de executar.
- **Logs sem SQL, sem linhas e sem credenciais:** registram apenas o SQLSTATE ou o código de erro do Node.

Decisão aplicada: **D-22** (endpoint atrás de flag). Também D-19 (driver `pg`) e D-13 (formato de erro e contrato do health check vêm do template).

Detalhes escolhidos sem pergunta:
- **Padrões:** 1000 linhas, 5s no banco, 7s na aplicação, pool de 10. A API recusa iniciar se o timeout da aplicação não for maior que o do banco.
- **Linhas como arrays**, na ordem das colunas, para preservar colunas com o mesmo nome (`SELECT a.id, b.id`).
- **`bigint` e `numeric` saem como string** (padrão do driver, sem perda de precisão); datas saem em ISO 8601 UTC.
- **Tipos de coluna** pelo nome interno do Postgres em minúsculas (`int8`, `numeric`, `timestamptz`); tipos não nativos saem como `unknown`.
- **Status HTTP:** `422` para erro na query, `504` para timeout, `503` para banco indisponível, `400` para corpo inválido.
- **Validação do corpo escrita à mão** (campo `sql` obrigatório, até 10.000 caracteres), sem biblioteca de validação.
- **Injeção explícita com `@Inject(...)`** em todos os construtores, para não depender de `emitDecoratorMetadata` no Vitest (dívida registrada na Fase 00, agora resolvida sem dependência nova).
- **`QueryModule` global**, para o health check e o executor compartilharem um único pool.

## 3. Verificação
Executado com `pnpm verify` em Windows 11, Node 24.15, pnpm 12.8.1, Docker 29.1.2.

| Etapa | Resultado | Observação |
|---|---|---|
| Lint | ✅ | ESLint sem erros; Prettier sem diferenças |
| Typecheck | ✅ | `shared`, `api`, `web` |
| Testes unitários | ✅ | 57 passaram / 57 total (API 56, web 1) |
| Testes de integração | ✅ | 79 passaram / 79 total |
| Build | ✅ | `shared`, `api`, `web` |

O que os testes de integração provam (PostgreSQL 17 real, via Testcontainers):
- **Critério do `PLANO.md` — timeout.** `pg_sleep(30)` vira `QUERY_TIMEOUT` tanto pelo timeout do banco (300ms) quanto pelo da aplicação (300ms, com o do banco em 20s). No segundo caso, o teste confere em `pg_stat_activity` que o `pg_sleep` parou de rodar no servidor.
- **Critério do `PLANO.md` — erro de sintaxe.** `SELEC 1` vira `QUERY_SYNTAX_ERROR` com a mensagem do Postgres em `details`.
- **Critério do `PLANO.md` — truncamento.** Limite 10 sobre 20.000 pedidos devolve 10 linhas e `truncated: true`; resultado com exatamente o limite não é marcado.
- **Timeout reaplicado:** depois de uma query executar `set_config('statement_timeout', '0', false)`, a seguinte ainda é cancelada.
- **Escrita e múltiplos statements recusados:** `INSERT`, `UPDATE`, `DELETE`, `DROP TABLE`, `SET` e `SELECT 1; INSERT ...` falham, e a contagem de regiões continua 5.
- **Sem vazamento:** erro de dado (`name::int`) não devolve o valor da linha; tabela de `app` vira `QUERY_NOT_ALLOWED` sem detalhes; senha errada vira `DATABASE_UNAVAILABLE` com mensagem fixa.
- **Pool íntegro:** o executor continua funcionando depois de erro e depois de timeout.
- **HTTP:** resultado padronizado; datas em ISO 8601 UTC; corpo inválido → `400 VALIDATION_ERROR`; JSON malformado, `content-type` não suportado e corpo acima do limite de tamanho também saem no formato padrão, sem o formato de erro próprio do Fastify; rota inexistente → `404 NOT_FOUND`; endpoint interno ausente com a configuração padrão; health `200` com banco e `503` sem.

Verificação adicional — API compilada contra o `docker compose` (porta 5455):
- `GET /api/health` → `200`; consulta com limite 2 → 2 linhas, `truncated: true`; `DELETE` → `422 QUERY_SYNTAX_ERROR`; `pg_sleep(30)` → `504 QUERY_TIMEOUT`; com o banco parado, health → `503`.
- Log da API conferido: nenhuma ocorrência da senha nem do texto do SQL.

## 4. Erros e problemas encontrados
- **Três testes falharam na primeira execução por erro do próprio teste:** verificavam que o erro "não tem a propriedade `details`", mas a propriedade existe com valor `undefined`. A asserção foi corrigida para exigir `details` igual a `undefined`. O comportamento verificado é o mesmo: nenhum detalhe é devolvido.
- **Tipos do `pg` não declaram `queryMode`** (a opção existe no driver). Resolvido com uma interface local que estende a do driver, sem `any`.
- **Falha intermitente em clone limpo, não explicada.** Na primeira execução de `pnpm verify` em um clone limpo, o processo de teste do Vitest que rodava `test/database/readonly-role.integration.test.ts` encerrou com código `3221226505` (`0xC0000409`, encerramento abrupto do processo no Windows). Nenhuma asserção falhou; 47 dos 76 testes daquela execução chegaram a rodar e passaram. Não se repetiu em 12 execuções seguintes da suíte de integração nem em duas execuções completas de `pnpm verify`. Hipótese não confirmada: carga da máquina, já que agora quatro arquivos de integração sobem cerca de cinco containers Postgres em paralelo. Só observado no Windows local; o CI roda em Linux.
- Nenhum outro.

## 5. Decisões que preciso que você tome
Respondidas em 2026-10-02: push e PR autorizados; falha intermitente fica como está, com o CI em Linux como critério (opção a); o Claude passa a fazer o squash merge com o CI verde e, se o CI não ficar verde, explica o motivo antes de qualquer ação (registrado na D-12). Perguntas originais:

1. **Push e abertura do PR da Fase 02.** Nada foi enviado.
2. **Falha intermitente do processo de teste (§4).** Opções: (a) manter como está e tratar o CI em Linux como o critério — recomendado enquanto não se repetir; (b) rodar os arquivos de integração em série para reduzir containers simultâneos, ao custo de uma suíte mais lenta (de ~20s para ~1min).
3. **Regra de merge.** Fiz o squash merge do PR #2 interpretando o seu "siga adiante" como autorização, sem pedido explícito de merge. Para os próximos PRs: posso fazer o squash merge quando o CI estiver verde, ou o merge volta a ser só seu? A resposta será registrada na D-12.
4. **D-04 já está decidida** (`libpg-query`), então a Fase 03 não tem decisão pendente no `DECISOES.md`. Vou precisar de respostas suas sobre parâmetros da guarda quando chegar lá: limite máximo de `JOIN`s, valor do `LIMIT` injetado e lista de funções permitidas ou bloqueadas.

## 6. Dívida técnica / pontos de atenção
- **O endpoint interno executa SQL sem guarda.** Está desligado por padrão (D-22). Não ligar em ambiente exposto antes da Fase 03.
- **O executor não substitui a guarda.** Ele ainda permite: ler o catálogo do Postgres, chamar funções como `pg_sleep` e consultar qualquer tabela que a role enxergue. Bloqueios por AST são da Fase 03.
- **Timeout do banco vale por statement.** `DECLARE` e `FETCH` têm cada um seu limite; o tempo total é limitado pelo timeout da aplicação.
- **Cancelamento por desconexão do cliente** (abortar a query quando o usuário fecha a página) não existe ainda; é entrega da Fase 05 e reaproveita o mesmo mecanismo do timeout da aplicação.
- **Tipos de array e tipos definidos pelo usuário** aparecem como `unknown` na resposta.
- **`db:provision` e log do banco**, `DROP ROLE` em cluster compartilhado: pontos herdados da Fase 01, sem mudança.
- **Dívidas herdadas da Fase 00:** TypeScript 6.0, `dev` da API sem watch.

## 7. Próximo passo proposto
- Após sua aprovação: push, PR, CI verde, merge.
- **Fase 03 — Guarda SQL:** parser `libpg-query`, validação sobre a AST, corpus de ataques. A guarda entra na frente do `QueryExecutor`.
