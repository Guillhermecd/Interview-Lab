# PLANO.md — Converse com seus dados

Chat em linguagem natural sobre um banco PostgreSQL: a IA gera o SQL, o usuário pode
revisar/editar, o backend valida e executa com segurança, e a resposta volta como
tabela/gráfico + explicação, em streaming.

> Antes de executar qualquer fase: seguir `CLAUDE.md` (ler `template/` primeiro).
> Cada fase = uma branch `feature/fase-XX-*` = um PR = um relatório.

## Status das fases

| Fase | Nome | Depende de decisões | Status |
|---|---|---|---|
| 00 | Fundação do repositório e CI | D-01, D-02, D-09, D-12 | CONCLUÍDA |
| 01 | Banco de demonstração e usuário read-only | D-05 | CONCLUÍDA |
| 02 | Executor de queries seguro | — | CONCLUÍDA |
| 03 | Guarda SQL (parser e validação) | D-04 | CONCLUÍDA |
| 04 | Integração com LLM (texto → SQL → explicação) | D-03 | PENDENTE |
| 05 | Streaming SSE, histórico e memória resumida | D-07 | PENDENTE |
| 06 | Frontend: chat, tabela, gráfico, editor SQL | D-06 | PENDENTE |
| 07 | Human-in-the-loop (revisar/editar SQL) | — | PENDENTE |
| 08 | Autenticação, tokens por usuário, rate limit, cache | D-07, D-08 | PENDENTE |
| 09 | Observabilidade, hardening, deploy e README | D-11 | PENDENTE |

A ordem acima é uma proposta (ver D-10).

---

## Fase 00 — Fundação do repositório e CI
**Objetivo:** esqueleto que já bloqueia código quebrado de entrar na `main`.
**Entregas**
- Estrutura do repositório (monorepo ou não, conforme D-02) com `apps/api` e `apps/web`.
- Lint, formatação e typecheck configurados (TypeScript `strict`).
- Framework de testes (D-09) com um teste exemplo em cada app.
- `docker-compose.yml` com PostgreSQL para dev/testes.
- GitHub Actions: workflow de PR rodando lint → typecheck → testes → build.
- `.github/pull_request_template.md`.
**Verificação:** CI roda e falha de propósito com um teste quebrado; passa ao corrigir.
**Ação manual do Guilherme:** ativar branch protection na `main` exigindo o CI verde
(o Claude não altera configurações do GitHub).

## Fase 01 — Banco de demonstração e usuário read-only
**Objetivo:** ter dados realistas e a primeira camada de segurança — a do banco.
**Entregas**
- Migrations com schema de demonstração (D-05) e seed com volume suficiente para GROUP BY fazer sentido.
- Role `app_readonly`: `CONNECT` + `USAGE` no schema de dados + `SELECT` apenas nas tabelas expostas.
- Na role: `default_transaction_read_only = on` e `statement_timeout` definido.
- Banco/schema separado para dados da aplicação (histórico, tokens) com outra role.
**Verificação:** testes de integração provando que `INSERT`, `UPDATE`, `DROP`, `CREATE`
falham com a role read-only, e que uma query longa (`pg_sleep`) é cancelada pelo timeout.

## Fase 02 — Executor de queries seguro
**Objetivo:** um serviço que recebe SQL já validado e executa com limites.
**Entregas**
- Pool de conexão usando exclusivamente `app_readonly`.
- Timeout por query (no banco **e** na aplicação), limite de linhas retornadas.
- Endpoint interno de execução com resposta padronizada (colunas, tipos, linhas, tempo).
- Tratamento de erro do Postgres traduzido para mensagens seguras (sem vazar stack/credenciais).
**Verificação:** testes de integração com Postgres real (container), cobrindo timeout,
erro de sintaxe e truncamento por limite.

## Fase 03 — Guarda SQL
**Objetivo:** segunda camada de segurança — rejeitar SQL perigoso antes de chegar ao banco.
**Entregas**
- Parser SQL (D-04) gerando AST; validação sobre a AST, nunca por regex.
- Regras: um único statement; apenas `SELECT` (e CTEs de leitura); bloqueio de DDL/DML;
  limite de JOINs; `LIMIT` obrigatório (injetado ou reduzido ao máximo);
  allowlist de tabelas; bloqueio de funções perigosas (`pg_sleep`, `pg_read_file`, `dblink`,
  `lo_*`, `set_config`, etc.); bloqueio de `SELECT ... FOR UPDATE` e `INTO`.
- Erros de validação com motivo legível para o usuário e para a LLM corrigir.
**Verificação:** suíte com corpus de ataques (múltiplos statements, comentários,
CTE com DML, casing misto, funções perigosas) e de queries legítimas que devem passar.

## Fase 04 — Integração com LLM
**Objetivo:** pergunta em linguagem natural → SQL válido → explicação do resultado.
**Entregas**
- Camada de provedor (D-03) atrás de uma interface, para trocar/mocar nos testes.
- Introspecção do schema exposto para montar o contexto do prompt.
- Fluxo: gerar SQL → guarda SQL → (se inválido, uma nova tentativa com o erro) → executar → explicar.
- Sugestão de tipo de visualização (tabela, barra, linha) junto com a resposta.
- Contagem de tokens de entrada/saída por chamada.
**Verificação:** testes unitários com provedor mockado; conjunto pequeno de perguntas
de avaliação rodado manualmente com o provedor real e registrado no relatório.

## Fase 05 — Streaming, histórico e memória resumida
**Objetivo:** resposta token a token e conversa contínua sem estourar tokens.
**Entregas**
- Endpoint SSE com eventos tipados (`sql`, `rows`, `token`, `done`, `error`).
- Persistência de conversas e mensagens.
- Memória: últimas N mensagens na íntegra + resumo das anteriores, regenerado por limiar.
- Cancelamento quando o cliente desconecta (abortar chamada à LLM e query).
**Verificação:** testes de integração do SSE (ordem dos eventos, erro no meio do fluxo,
desconexão); teste da regra de resumo.

## Fase 06 — Frontend
**Objetivo:** interface de chat utilizável.
**Entregas**
- React + TypeScript + Vite; consumo do SSE com renderização incremental.
- Tabela de resultados, gráfico (D-06), explicação, lista de conversas.
- Estados de carregamento, erro e vazio.
**Verificação:** testes de componentes; teste E2E do fluxo principal com backend mockado.

## Fase 07 — Human-in-the-loop
**Objetivo:** usuário vê e pode editar o SQL antes de rodar.
**Entregas**
- Modo "revisar antes de executar": o SQL gerado aparece num editor; o usuário aprova, edita ou cancela.
- **O SQL editado passa pela mesma guarda SQL no backend** — o frontend nunca é fronteira de segurança.
- Registro de que a query foi editada pelo usuário (auditoria).
**Verificação:** teste provando que SQL malicioso enviado direto à API, simulando edição, é rejeitado.

## Fase 08 — Autenticação, tokens, rate limit e cache
**Objetivo:** controle de custo e abuso.
**Entregas**
- Autenticação (D-08) — pré-requisito para "tokens por usuário".
- Contabilização de tokens por usuário e por conversa; consulta de consumo.
- Rate limiting por usuário **antes** da chamada à LLM; cota diária de tokens.
- Cache de perguntas repetidas (D-07), com chave considerando pergunta normalizada +
  versão do schema; TTL definido; o resultado da query também respeita TTL.
**Verificação:** testes de rate limit (limite atingido → 429), de cota, de acerto/erro de cache
e de invalidação quando o schema muda.

## Fase 09 — Observabilidade, hardening, deploy e README
**Objetivo:** projeto apresentável e operável.
**Entregas**
- Logs estruturados (sem SQL com dados sensíveis, sem tokens de API); métricas básicas.
- Revisão de segurança final (checklist em `template/RECOMENDACOES.md`).
- Deploy (D-11) com CI/CD.
- README com arquitetura, decisões, camadas de segurança e GIF de demonstração.
**Verificação:** checklist de segurança completo; smoke test no ambiente publicado.
