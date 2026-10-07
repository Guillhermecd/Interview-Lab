# Interview Lab — Converse com seus dados

Chat em linguagem natural sobre um banco PostgreSQL. A IA gera o SQL, o usuário pode
revisar e editar, o backend valida e executa com segurança, e a resposta volta como
tabela ou gráfico acompanhada de uma explicação, em streaming.

> **Status:** projeto em construção. Existem a fundação do repositório (Fase 00), o banco
> de demonstração com a role read-only (Fase 01), o executor de queries com timeout e
> limite de linhas (Fase 02) e a guarda SQL (Fase 03) — ou seja, as três camadas de
> segurança —, o fluxo pergunta → SQL → execução → explicação com a LLM (Fase 04) e as
> conversas com resposta em streaming, histórico e memória resumida (Fase 05), a
> interface de chat (Fase 06), a revisão/edição do SQL antes de executar (Fase 07) e
> autenticação, limites de uso e cache (Fase 08). Observabilidade e deploy ainda estão
> **planejados**. Este README será expandido na Fase 10 com
> arquitetura detalhada e GIF de demonstração.

## Como vai funcionar

1. O usuário faz uma pergunta em português ("qual o faturamento por região no último trimestre?").
2. A LLM recebe a pergunta e o schema exposto e gera um `SELECT`.
3. Opcionalmente, o usuário revisa e edita o SQL antes de executar.
4. O backend valida o SQL sobre a AST e o executa com um usuário read-only.
5. O resultado volta em streaming (SSE): SQL, linhas, explicação e sugestão de visualização.

## Segurança em camadas

O ponto central do projeto é executar SQL gerado por IA sem confiar nele. Nenhuma
camada substitui a outra:

| Camada | O que faz |
|---|---|
| 1. Role read-only no banco | Fronteira real. Só `SELECT` nas tabelas expostas, `default_transaction_read_only = on` e `statement_timeout`. |
| 2. Guarda SQL | Validação sobre a AST do parser, nunca por regex: um único statement, apenas leitura, allowlist de tabelas, `LIMIT` obrigatório, bloqueio de funções perigosas. |
| 3. Limites de execução | Timeout na aplicação e limite de linhas retornadas. |

Regras complementares:

- Todo SQL — gerado pela IA **ou editado pelo usuário** — passa pela guarda SQL no backend. O frontend nunca é fronteira de segurança.
- Dados retornados do banco são tratados como conteúdo não confiável ao serem enviados à LLM (prompt injection).
- Rate limit e cota de tokens são verificados antes de chamar a LLM.
- Logs não contêm chaves de API, JWT nem linhas de resultado.

## Stack

| Área | Escolha | Decisão |
|---|---|---|
| Backend | NestJS com adapter Fastify, TypeScript `strict` | D-01 |
| Frontend | React + TypeScript + Vite, Tailwind CSS, Recharts, CodeMirror 6 | `PLANO.md`, D-06, D-29, D-30 |
| Banco | PostgreSQL | `PLANO.md` |
| Repositório | Monorepo com pnpm workspaces (`apps/api`, `apps/web`, `packages/shared`) | D-02 |
| Autenticação | JWT (`jose`) em cookie `HttpOnly`, senhas com `scrypt` | D-08, D-36 |
| Rate limit e cache | Redis (`ioredis`) | D-07b, D-37 |
| Testes | Vitest, Testcontainers, Testing Library, Playwright | D-09, D-31 |
| Parser SQL | `libpg-query` 17 (parser do próprio Postgres, mesma versão do banco) | D-04, D-24 |
| Acesso ao banco | Driver `pg`, migrations em SQL puro com `node-pg-migrate` | D-19 |

| LLM | Google Gemini atrás de uma interface própria (`LlmProvider`) | D-03 |

O deploy ainda está em aberto — ver [DECISOES.md](DECISOES.md).

## Banco de dados

| Schema | Conteúdo | Quem acessa |
|---|---|---|
| `sales` | Dados de demonstração da "Rota Materiais": `regions`, `distribution_centers`, `products`, `customers`, `orders`, `order_items`, `stock_levels`, `stock_movements` | `app_readonly` (somente `SELECT`) |
| `sales` (escrita) | Só `products`, `stock_levels` e `stock_movements`, sem `DELETE` | `app_catalog_rw`, usada apenas pelo cadastro |
| `app` | Dados da aplicação: `users`, `conversations`, `messages` e `token_usage` | `app_rw` |
| `migrations` | Histórico de migrations | Apenas o administrador |

A role `app_readonly` é a que executará o SQL gerado pela IA. Ela só tem `SELECT` nas
tabelas de `sales`, concedido tabela por tabela, e não enxerga os dados de `app`. Os
privilégios herdados de `PUBLIC` (criar tabelas temporárias, usar o schema `public`)
foram revogados. `default_transaction_read_only = on` e `statement_timeout = 5s` são
padrões da role — uma sessão consegue sobrescrevê-los, por isso a fronteira real são os
privilégios, e as próximas camadas (guarda SQL e timeout na aplicação) continuam
necessárias.

## Roadmap

| Fase | Nome | Status |
|---|---|---|
| 00 | Fundação do repositório e CI | Concluída |
| 01 | Banco de demonstração e usuário read-only | Concluída |
| 02 | Executor de queries seguro | Concluída |
| 03 | Guarda SQL (parser e validação) | Concluída |
| 04 | Integração com LLM (texto → SQL → explicação) | Concluída |
| 05 | Streaming SSE, histórico e memória resumida | Concluída |
| 06 | Frontend: chat, tabela, gráfico, editor SQL | Concluída |
| 07 | Human-in-the-loop (revisar/editar SQL) | Concluída |
| 08 | Autenticação, tokens por usuário, rate limit, cache | Concluída |
| 09a | Design: tokens, tema, componentes e chat reestilizado | Concluída |
| 09c | Design: dashboard operacional | Concluída |
| 09e | Cadastro de materiais e movimentações de estoque | Concluída |
| 09b | Design: tela do chat em três colunas e painel de schema | Concluída |
| 09f | Ocultar valores em reais | Em revisão |
| 09d | Design: chat suspenso no dashboard | Pendente |
| 10 | Observabilidade, hardening, deploy e README | Pendente |

Entregas e critérios de verificação de cada fase estão em [PLANO.md](PLANO.md).

## Como o projeto é conduzido

- Cada fase é uma branch `feature/fase-XX-nome`, um PR e um relatório em `docs/relatorios/`.
- Commits seguem [Conventional Commits](https://www.conventionalcommits.org/pt-br/).
- Antes de cada PR: lint → typecheck → testes unitários → testes de integração → build.
- Merge na `main` apenas com o CI verde.
- Toda decisão técnica é registrada em [DECISOES.md](DECISOES.md).

## Documentos

| Documento | Conteúdo |
|---|---|
| [PLANO.md](PLANO.md) | Fases, entregas e verificação |
| [DECISOES.md](DECISOES.md) | Registro de decisões e trade-offs |
| [template/RECOMENDACOES.md](template/RECOMENDACOES.md) | Princípios, regras de segurança e verificação local |
| [CLAUDE.md](CLAUDE.md) | Protocolo de execução usado com o Claude Code |

## Como rodar

Pré-requisitos: Node.js 24 (no Windows, 24.21 ou mais recente — o 24.15 derruba o processo
de teste de forma intermitente), pnpm 12 e Docker.

```sh
pnpm install
cp .env.example .env

# PostgreSQL 17 e Redis locais
docker compose up -d postgres redis

# Migrations + senhas das roles + dados de demonstração
# (quem já tinha o banco: a migration do dashboard limpa os dados de demonstração;
#  rode db:setup, ou db:migrate seguido de db:seed, para recarregá-los.
#  Desde o cadastro, o .env precisa de DB_CATALOG_PASSWORD e de um db:provision.)
pnpm --filter @interview-lab/api db:setup

# API em http://localhost:3000/api/health
pnpm --filter @interview-lab/api dev

# Web em http://localhost:5173 (outro terminal)
pnpm --filter @interview-lab/web dev
```

O web (http://localhost:5173) começa pela tela de login/cadastro e abre no
**dashboard** (`/dashboard`): filtros de período, centro de distribuição, região e
categoria; seis indicadores comparados com o período anterior; faturamento no tempo e
por região, top 10 materiais, estoque por centro e curva ABC; alertas de ruptura e
últimas movimentações. Todo número é calculado pela API (regras na D-57). O botão
"Perguntar" de cada card leva ao chat com a pergunta escrita.

O **cadastro** (`/cadastro`) aparece só para administradores: materiais (criar, editar,
arquivar, restaurar, estoque mínimo por centro) e lançamento de movimentações de
estoque, que atualizam o saldo na hora. Para tornar uma conta administradora, crie-a
pela tela e rode:

```sh
pnpm --filter @interview-lab/api db:promote-admin voce@exemplo.com
```

O **olho** na barra superior esconde os valores em reais do dashboard e da lista de
materiais (`R$ ••••`), e a escolha fica salva no navegador (D-62). É só na tela: serve
para mostrá-la a outra pessoa, não é controle de acesso.

O **chat** (`/chat`) tem três colunas: a lista de conversas (busca por título, grupos por data
e o aviso de conversa aguardando revisão, bloqueada ou com timeout); a conversa, com pergunta em
português, resposta em streaming com o SQL gerado, gráfico (quando faz sentido), tabela de
resultado e explicação, e no cabeçalho o consumo de tokens do dia; e o painel de schema, que
lista as tabelas que a IA pode ler e marca as usadas na última resposta. Tema claro e escuro. Configure a chave do Gemini e um
`JWT_SECRET` com 32+ caracteres no `.env`.

A API expõe:

| Rota | Descrição |
|---|---|
| `GET /api/health` | `200 {"status":"ok"}` quando a aplicação e o banco respondem; `503` caso contrário |
| `POST /api/auth/register` · `POST /api/auth/login` | Cria conta / entra; a sessão vai num cookie `HttpOnly` |
| `POST /api/auth/logout` · `GET /api/auth/me` | Sai (apaga o cookie) / usuário atual |
| `GET /api/usage` | Tokens gastos hoje, no total e por conversa, os limites e o nível de consumo (`normal`, `attention`, `critical`) |
| `GET /api/schema` | Tabelas que a IA pode ler, com colunas, tipos, chaves primárias e estrangeiras |
| `GET /api/dashboard/filters` | Centros de distribuição, regiões e categorias para os filtros |
| `GET /api/dashboard/overview` | Indicadores e gráficos de um período (`period`: `7d`, `30d`, `month`, `quarter`, `year` ou `custom` com `from` e `to`), comparados ao período anterior |
| `GET /api/dashboard/stock-alerts` | Materiais abaixo ou perto do estoque mínimo, agora (`status`, `limit`) |
| `GET /api/dashboard/stock-movements` | Últimas movimentações de estoque (`type`, `limit`) |
| `GET /api/catalog/options` | Categorias, unidades e centros para os formulários do cadastro (rotas `/api/catalog`: só administrador, `403` para os demais) |
| `GET` · `POST /api/catalog/products` | Lista paginada (`search`, `category`, `status`, `page`, `pageSize`) / cria um material |
| `GET` · `PUT` · `DELETE /api/catalog/products/:id` | Detalhe com estoque por centro / substitui os dados / arquiva (nada é apagado) |
| `POST /api/catalog/products/:id/restore` | Restaura um material arquivado |
| `PUT /api/catalog/products/:id/stock-levels/:centerId` | Define o estoque mínimo do material num centro |
| `GET` · `POST /api/catalog/stock-movements` | Lista paginada / lança uma movimentação e atualiza o saldo na mesma transação |
| `POST /api/conversations` | Cria uma conversa do usuário |
| `GET /api/conversations` | Lista as conversas do usuário, da mais recente para a mais antiga |
| `GET /api/conversations/:id/messages` | Histórico de uma conversa |
| `POST /api/conversations/:id/messages` | Faz uma pergunta `{"question": "...", "mode": "auto" \| "review"}`; a resposta vem em streaming (SSE) |
| `POST /api/conversations/:id/messages/:messageId/execute` | Executa `{"sql": "..."}` de uma mensagem em revisão; resposta em streaming |

| `POST /api/internal/queries/execute` | Executa `{"sql": "..."}` como `app_readonly`, para depuração. **Desligado por padrão** |

Todas as rotas, exceto health, cadastro e login, exigem a sessão. Conversas são
privadas: a de outro usuário responde `404`. O endpoint interno de SQL passa pela guarda
e pelo executor, exige login e só existe com `INTERNAL_QUERY_ENDPOINT_ENABLED=true`.

### Autenticação e limites

- **Sessão em cookie `HttpOnly`, `SameSite=Strict`** (e `Secure` em produção): o
  JavaScript da página não lê o token. Requisições que alteram dados vindas de uma
  origem fora de `ALLOWED_ORIGINS` são recusadas (proteção contra CSRF).
- **Senhas com `scrypt`**; login com erro genérico ("e-mail ou senha incorretos") e
  limite de tentativas por e-mail.
- **Antes de qualquer chamada à LLM**, cada usuário passa por um limite de perguntas por
  minuto e por uma cota diária de tokens (padrões: 10/min e 200 mil/dia). Acima disso, a
  API responde `429` sem chamar a LLM, com `retryAfterSeconds`: os segundos até o
  limite liberar (fim do minuto) ou a cota renovar (meia-noite UTC).
- **Consumo registrado** por usuário e conversa, inclusive as chamadas de resumo da
  memória.
- **Cache no Redis** de perguntas repetidas (o SQL gerado, por 1 hora) e de resultados
  (5 minutos). As chaves incluem a versão do schema, então uma mudança no banco invalida
  tudo. Perguntas de continuação, que dependem da conversa, não usam o cache de SQL. O
  SQL vindo do cache passa pela guarda de novo.

### O que a guarda SQL aceita

A guarda analisa a árvore sintática gerada pelo parser do próprio PostgreSQL
(`libpg-query`), nunca o texto. Ela trabalha por lista de permissão: o que não está
explicitamente liberado é recusado.

| Regra | Detalhe |
|---|---|
| Um único comando | `SELECT 1; DROP ...` é recusado |
| Somente `SELECT` | Sem `INSERT`/`UPDATE`/`DELETE` (inclusive dentro de CTE), DDL, `SET`, `EXPLAIN`, `COPY` |
| Sem `INTO`, `FOR UPDATE`, `WITH RECURSIVE`, `TABLESAMPLE`, parâmetros `$1` | Qualquer construção fora da lista conhecida é recusada |
| Tabelas | Apenas `regions`, `products`, `customers`, `orders`, `order_items`, `distribution_centers`, `stock_levels`, `stock_movements` (schema `sales`) e CTEs em escopo |
| Funções | Lista de permissão: agregadas, janela, data, texto e matemática. `pg_sleep`, `pg_read_file`, `dblink`, `lo_*`, `set_config` e qualquer outra fora da lista são recusadas |
| Conversões de tipo | Apenas tipos numéricos, texto, booleano, data/hora e intervalo |
| `JOIN`s | No máximo 5, somando a query inteira |
| `LIMIT` | Obrigatório: injetado quando ausente e reduzido ao máximo quando maior |

Quando recusa, a resposta é `422` com `code: "QUERY_REJECTED"` e o motivo em `details`,
escrito para que o usuário ou a LLM consigam corrigir a consulta.

```sh
curl -X POST http://localhost:3000/api/internal/queries/execute \
  -H 'content-type: application/json' \
  -d '{"sql":"SELECT name FROM regions ORDER BY name"}'
```

```json
{
  "columns": [{ "name": "name", "type": "text" }],
  "rows": [["Centro-Oeste"], ["Nordeste"], ["Norte"], ["Sudeste"], ["Sul"]],
  "rowCount": 5,
  "truncated": false,
  "durationMs": 7
}
```

Erros seguem sempre o formato `{ "code", "message", "details"? }`.

Comandos de banco (`pnpm --filter @interview-lab/api <comando>`):

| Comando | O que faz |
|---|---|
| `db:setup` | `db:migrate` + `db:provision` + `db:seed` |
| `db:migrate` | Aplica as migrations pendentes |
| `db:migrate:down` | Desfaz todas as migrations |
| `db:provision` | Define as senhas de `app_readonly`, `app_rw` e `app_catalog_rw` a partir do `.env` |
| `db:promote-admin <e-mail>` | Torna uma conta existente administradora do cadastro (D-58) |
| `db:seed` | Recarrega os dados de demonstração (apaga e insere de novo) |

Se a porta 5432 já estiver em uso na máquina, mude `DB_PORT` no `.env`.

### Perguntas em linguagem natural

O fluxo completo já existe como serviço (`AskService`): a LLM recebe o schema exposto e
a pergunta, gera o SQL, a guarda valida, o executor roda e a LLM explica o resultado e
sugere a visualização (tabela, barra ou linha). Se o SQL for recusado, a LLM tem uma
nova tentativa recebendo o motivo.

Pela API, a pergunta é feita dentro de uma conversa e a resposta chega como
Server-Sent Events, nesta ordem:

| Evento | Conteúdo |
|---|---|
| `sql` | O SQL gerado (um evento por tentativa) |
| `rows` | Colunas, linhas e a sugestão de visualização |
| `token` | Um pedaço da explicação; vários eventos, na ordem |
| `review` | Modo revisão: o SQL está pronto e espera aprovação; nada foi executado |
| `done` | Fim: id da mensagem, tentativas, tokens gastos, se o SQL veio do cache (`cached`) e, após uma revisão, se o SQL foi editado |
| `error` | Encerra o stream a qualquer momento, no formato padrão de erro |

```sh
# Cria a conta e guarda o cookie da sessão
curl -s -c cookies.txt -X POST http://localhost:3000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"name":"Ana","email":"ana@example.com","password":"uma-senha-segura"}'

ID=$(curl -s -b cookies.txt -X POST http://localhost:3000/api/conversations | jq -r .id)
curl -N -b cookies.txt -X POST http://localhost:3000/api/conversations/$ID/messages \
  -H 'content-type: application/json' \
  -d '{"question":"Qual o faturamento total por categoria de produto?"}'
```

### Revisar o SQL antes de executar

Com a opção "Revisar SQL antes de executar" ligada na tela (`mode: "review"` na API),
o SQL gerado — já aprovado uma vez pela guarda — aparece para revisão e só roda quando o
usuário clicar em "Aprovar e executar", do jeito que veio ou depois de "Editar". Também
dá para cancelar: nada é consultado e a revisão pode ser reaberta. O SQL enviado passa de
novo pela guarda no servidor: o frontend nunca é fronteira de segurança. Se for recusado,
a revisão continua aberta com o motivo, e o mesmo texto não pode ser reenviado. O histórico registra se o SQL foi editado e guarda
o SQL gerado originalmente (auditoria).

Perguntas seguintes na mesma conversa enxergam as anteriores ("e só da região Sul?").
A memória envia à LLM um resumo das mensagens antigas mais as recentes na íntegra
(de 6 a 11 mensagens: o resumo é refeito quando 6 ou mais ficam fora da janela das 6
mais recentes). Se
o cliente fechar a conexão no meio da resposta, a chamada à LLM e a consulta ao banco
são canceladas. O histórico guarda perguntas, SQL e explicações — nunca as linhas
retornadas pelas consultas.

Para experimentar com o provedor real, crie uma chave em
<https://aistudio.google.com/apikey>, coloque em `GEMINI_API_KEY` no `.env` e rode:

```sh
pnpm --filter @interview-lab/api eval:llm
```

O comando faz dez perguntas de avaliação e imprime, para cada uma, o SQL gerado, as
primeiras linhas, a explicação e os tokens gastos. Sem a chave, a API sobe normalmente
e só as perguntas falham.

As linhas lidas do banco são enviadas à LLM apenas para a explicação (no máximo
`LLM_EXPLAIN_MAX_ROWS`, padrão 50) e tratadas como conteúdo não confiável: ficam em um
bloco de dados separado das instruções, e a resposta da LLM é validada antes de ser
usada.

### Verificação

```sh
pnpm verify   # lint → typecheck → testes unitários → testes de integração → build → E2E
```

Cada etapa também roda isolada: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm test:integration` (exige Docker em execução), `pnpm build` e `pnpm test:e2e`
(Playwright; antes da primeira execução: `pnpm --filter @interview-lab/web exec playwright
install chromium`).

### Estrutura

```text
apps/api          # NestJS + Fastify
apps/web          # React + Vite
packages/shared   # Tipos e constantes compartilhados entre api e web
```
