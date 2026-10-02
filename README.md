# Interview Lab — Converse com seus dados

Chat em linguagem natural sobre um banco PostgreSQL. A IA gera o SQL, o usuário pode
revisar e editar, o backend valida e executa com segurança, e a resposta volta como
tabela ou gráfico acompanhada de uma explicação, em streaming.

> **Status:** projeto em construção. Existe apenas a fundação do repositório (Fase 00):
> monorepo, lint, testes e CI. O fluxo de chat e as camadas de segurança descritos abaixo
> estão **planejados**, ainda não implementados. Este README será expandido na Fase 09
> com arquitetura detalhada e GIF de demonstração.

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

Provedor de LLM, parser SQL, biblioteca de gráficos, cache, autenticação e deploy ainda
estão em aberto — ver [DECISOES.md](DECISOES.md).

## Roadmap

| Fase | Nome | Status |
|---|---|---|
| 00 | Fundação do repositório e CI | Concluída |
| 01 | Banco de demonstração e usuário read-only | Pendente |
| 02 | Executor de queries seguro | Pendente |
| 03 | Guarda SQL (parser e validação) | Pendente |
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

# API em http://localhost:3000/api/health
pnpm --filter @interview-lab/api dev

# Web em http://localhost:5173 (outro terminal)
pnpm --filter @interview-lab/web dev
```

Por enquanto a API expõe apenas o health check e o web apenas uma página estática.

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
