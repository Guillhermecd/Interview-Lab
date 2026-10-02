# Interview Lab — Converse com seus dados

Chat em linguagem natural sobre um banco PostgreSQL. A IA gera o SQL, o usuário pode
revisar e editar, o backend valida e executa com segurança, e a resposta volta como
tabela ou gráfico acompanhada de uma explicação, em streaming.

> **Status:** projeto em construção. Existem a fundação do repositório (Fase 00), o banco
> de demonstração com a role read-only (Fase 01), o executor de queries com timeout e
> limite de linhas (Fase 02) e a guarda SQL (Fase 03) — ou seja, as três camadas de
> segurança. A integração com a LLM, o streaming e o chat descritos abaixo estão
> **planejados**, ainda não implementados. Este README será expandido na Fase 09 com
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
| Frontend | React + TypeScript + Vite | `PLANO.md` |
| Banco | PostgreSQL | `PLANO.md` |
| Repositório | Monorepo com pnpm workspaces (`apps/api`, `apps/web`, `packages/shared`) | D-02 |
| Testes | Vitest, Testcontainers, Playwright | D-09 |
| Parser SQL | `libpg-query` 17 (parser do próprio Postgres, mesma versão do banco) | D-04, D-24 |
| Acesso ao banco | Driver `pg`, migrations em SQL puro com `node-pg-migrate` | D-19 |

Provedor de LLM, biblioteca de gráficos, cache, autenticação e deploy ainda estão em
aberto — ver [DECISOES.md](DECISOES.md).

## Banco de dados

| Schema | Conteúdo | Quem acessa |
|---|---|---|
| `sales` | Dados de demonstração: `regions`, `products`, `customers`, `orders`, `order_items` | `app_readonly` (somente `SELECT`) |
| `app` | Dados da aplicação (usuários, histórico, tokens — tabelas chegam nas próximas fases) | `app_rw` |
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
| 04 | Integração com LLM (texto → SQL → explicação) | Pendente |
| 05 | Streaming SSE, histórico e memória resumida | Pendente |
| 06 | Frontend: chat, tabela, gráfico, editor SQL | Pendente |
| 07 | Human-in-the-loop (revisar/editar SQL) | Pendente |
| 08 | Autenticação, tokens por usuário, rate limit, cache | Pendente |
| 09 | Observabilidade, hardening, deploy e README | Pendente |

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

Pré-requisitos: Node.js 24, pnpm 12 e Docker.

```sh
pnpm install
cp .env.example .env

# PostgreSQL 17 local
docker compose up -d postgres

# Migrations + senhas das roles + dados de demonstração
pnpm --filter @interview-lab/api db:setup

# API em http://localhost:3000/api/health
pnpm --filter @interview-lab/api dev

# Web em http://localhost:5173 (outro terminal)
pnpm --filter @interview-lab/web dev
```

Por enquanto o web é apenas uma página estática. A API expõe:

| Rota | Descrição |
|---|---|
| `GET /api/health` | `200 {"status":"ok"}` quando a aplicação e o banco respondem; `503` caso contrário |
| `POST /api/internal/queries/execute` | Executa `{"sql": "..."}` como `app_readonly`. **Desligado por padrão** (ver abaixo) |

Todo SQL enviado ao endpoint passa pela guarda SQL e depois pelo executor (transação
somente leitura, timeout no banco e na aplicação, no máximo `QUERY_MAX_ROWS` linhas).
O endpoint ainda **não tem autenticação nem rate limit**, que chegam na Fase 08. Por
isso só existe quando `INTERNAL_QUERY_ENDPOINT_ENABLED=true` no `.env`; use apenas em
testes locais.

### O que a guarda SQL aceita

A guarda analisa a árvore sintática gerada pelo parser do próprio PostgreSQL
(`libpg-query`), nunca o texto. Ela trabalha por lista de permissão: o que não está
explicitamente liberado é recusado.

| Regra | Detalhe |
|---|---|
| Um único comando | `SELECT 1; DROP ...` é recusado |
| Somente `SELECT` | Sem `INSERT`/`UPDATE`/`DELETE` (inclusive dentro de CTE), DDL, `SET`, `EXPLAIN`, `COPY` |
| Sem `INTO`, `FOR UPDATE`, `WITH RECURSIVE`, `TABLESAMPLE`, parâmetros `$1` | Qualquer construção fora da lista conhecida é recusada |
| Tabelas | Apenas `regions`, `products`, `customers`, `orders`, `order_items` (schema `sales`) e CTEs em escopo |
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
| `db:provision` | Define as senhas de `app_readonly` e `app_rw` a partir do `.env` |
| `db:seed` | Recarrega os dados de demonstração (apaga e insere de novo) |

Se a porta 5432 já estiver em uso na máquina, mude `DB_PORT` no `.env`.

### Verificação

```sh
pnpm verify   # lint → typecheck → testes unitários → testes de integração → build
```

Cada etapa também roda isolada: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm test:integration` (exige Docker em execução) e `pnpm build`.

### Estrutura

```text
apps/api          # NestJS + Fastify
apps/web          # React + Vite
packages/shared   # Tipos e constantes compartilhados entre api e web
```
