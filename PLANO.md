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
| 04 | Integração com LLM (texto → SQL → explicação) | D-03 | CONCLUÍDA |
| 05 | Streaming SSE, histórico e memória resumida | D-07 | CONCLUÍDA |
| 06 | Frontend: chat, tabela, gráfico, editor SQL | D-06 | CONCLUÍDA |
| 07 | Human-in-the-loop (revisar/editar SQL) | — | CONCLUÍDA |
| 08 | Autenticação, tokens por usuário, rate limit, cache | D-07b, D-08 | CONCLUÍDA |
| 09a | Design: tokens, tema, componentes e chat reestilizado | D-38, D-39, D-41, D-44, D-45, D-46, D-47 | CONCLUÍDA |
| 09c | Design: dashboard operacional | D-40, D-43, D-48, D-50 a D-55, D-57 | CONCLUÍDA |
| 09e | Cadastro de materiais e movimentações de estoque | D-56, D-58, D-59 | CONCLUÍDA |
| 09b | Design: tela do chat em três colunas e painel de schema | D-41, D-60, D-61 | CONCLUÍDA |
| 09f | Ocultar valores em reais | D-62 | CONCLUÍDA |
| 09d | Design: chat suspenso no dashboard | D-42, D-63 | CONCLUÍDA |
| 10a | Limites de recurso no executor | D-65, D-66 | CONCLUÍDA |
| 10b | Ajustes de segurança | D-67, D-68 | PENDENTE |
| 10c | Deploy e demo pública | D-11, D-69, D-70 | PENDENTE |
| 10d | Avaliação automatizada da LLM | D-71, D-72 | PENDENTE |
| 10e | Observabilidade | D-73 | PENDENTE |
| 10f | README e apresentação | — | PENDENTE |

A ordem acima é uma proposta (ver D-10). A Fase 09 entrou em 2026-10-05 (D-38); a ordem
dos seus PRs e a Fase 09e foram definidas na D-49. A Fase 09f entrou em 2026-10-07 (D-62).
A Fase 10 foi dividida em seis sub-fases em 2026-10-07 (D-64); o detalhe está em
[PLANO-fase-10.md](PLANO-fase-10.md).

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
- Cache de perguntas repetidas (D-07b), com chave considerando pergunta normalizada +
  versão do schema; TTL definido; o resultado da query também respeita TTL.
**Verificação:** testes de rate limit (limite atingido → 429), de cota, de acerto/erro de cache
e de invalidação quando o schema muda.

## Fase 09 — Design (handoff "Converse com seus dados")
**Objetivo:** aplicar o design do handoff (`design_handoff_converse_dados/README.md`) sobre o
fluxo real que já existe, sem simular a API (D-39). Quatro PRs, cada um com branch e relatório.

### Fase 09a — Tokens, tema, componentes e chat reestilizado
**Entregas**
- Tokens de cor claro/escuro, tipografia (Instrument Sans e JetBrains Mono, D-44), raios e sombra do handoff.
- Ícones em SVG inline (D-45).
- Componentes `SqlBlock`, `Alert`, `AiMessage` e `KpiCard` com as props do handoff.
- Chat atual usando os componentes novos, com os estados: gerando, revisão, executando,
  streaming, concluído, bloqueado, timeout, resultado vazio, rate limit e cota.
- Contrato: `cached` no evento `done` e `retryAfterSeconds` nos erros de limite de uso (D-41).

**Verificação:** testes das transições de estado do `AiMessage`, do `SqlBlock` marcando
"editado" ao salvar e do botão Executar desabilitado quando bloqueado; testes existentes
atualizados; E2E do fluxo principal.

### Fase 09b — Tela do chat em três colunas e painel de schema
**Entregas**
- Lista de conversas (264px) com busca, grupos por data e badge de estado; conversa (máx. 900px);
  painel de schema (300px, recolhível, fechado abaixo de 1200px).
- Medidor "Tokens hoje" no cabeçalho; conversa vazia com 6 sugestões.
- Contrato: `GET /api/schema` e status da última resposta na lista de conversas (D-41);
  tabelas usadas por resposta e nível de consumo de tokens (D-60).

**Verificação:** testes de componentes e de integração das rotas novas; E2E.

### Fase 09c — Dashboard operacional
**Entregas**
- Schema `sales` ampliado (D-50) e seed da "Rota Materiais" (D-51); tabelas novas na allowlist da guarda SQL.
- Endpoints de agregação para KPIs, gráficos e tabelas, pelo pool somente leitura (D-54); nenhum cálculo de negócio no frontend.
- Roteador (D-43) com `/dashboard` e `/chat`; barra superior com navegação, tema, usuário e sair (D-48).
- Página `/dashboard`: filtros fixos, 6 KPIs, 5 gráficos, 2 tabelas, grid responsivo (1440 e 834).

**Verificação:** testes de integração dos endpoints; guarda SQL com as tabelas novas; testes de componentes; E2E.

### Fase 09e — Cadastro de materiais e movimentações de estoque
**Objetivo:** alimentar o dashboard pela própria aplicação, sem abrir o caminho da IA para escrita (D-56).
**Entregas**
- Role de escrita própria no banco, com pool separado; `app_readonly` e o chat não mudam.
- Papel de administrador em `app.users`, concedido pelo comando `db:promote-admin` (D-58); só ele cadastra.
- Endpoints: CRUD de materiais (excluir arquiva) e criação/listagem de movimentações, que atualizam o saldo na mesma transação.
- Tela "Cadastro": materiais (listar, criar, editar, arquivar) e lançamento de movimentações.
- Invalidação do cache de resultados a cada escrita.

**Verificação:** testes de integração provando que a role de escrita não alcança outras tabelas, que quem não é administrador recebe `403`, as regras de validação e o saldo após cada tipo de movimentação; testes de componentes; E2E.

### Fase 09f — Ocultar valores em reais
**Objetivo:** esconder os valores em reais com um clique, para mostrar a tela a outra pessoa (D-62).
**Entregas**
- Botão com ícone de olho na barra superior, ao lado do tema; a escolha fica salva no navegador.
- Com os valores ocultos, dashboard (indicadores, gráficos, tooltips e eixo do faturamento) e
  lista de materiais do Cadastro (preço e custo) mostram `R$ ••••`. O chat não muda.

**Verificação:** testes do formato oculto, dos indicadores e do botão (ocultar, mostrar de novo,
lembrar a escolha, Cadastro); E2E com recarga da página.

### Fase 09d — Chat suspenso no dashboard
**Entregas**
- Botão flutuante e janela suspensa (420 × 680), com tela cheia, minimizar e fechar.
- "Perguntar sobre isto" abre a janela com o chip de contexto e a pergunta preenchida (D-42).
- A janela existe no dashboard e no Cadastro, e a conversa se mantém ao trocar entre os dois;
  "Tela cheia" abre a mesma conversa no `/chat` (D-63).

**Verificação:** testes de componentes e E2E do fluxo dashboard → pergunta → resposta.

## Fase 10 — Hardening, deploy, avaliação e apresentação
**Objetivo:** projeto apresentável e operável, com uma demo pública.

Dividida em seis sub-fases, numeradas na ordem de execução (D-64). Entregas, verificação e
decisões de cada uma estão em [PLANO-fase-10.md](PLANO-fase-10.md):

- **10a — Limites de recurso no executor:** concorrência por usuário, custo estimado por `EXPLAIN`, revisão da allowlist de funções.
- **10b — Ajustes de segurança:** permissão por coluna, erro de permissão como recusa, limite de login por IP, `trustProxy`, escopo no cache.
- **10c — Deploy e demo pública:** imagens Docker, Lightsail com HTTPS, CI/CD, conta de visitante, proteção de custo, reset diário. Depende da 10a e da 10b.
- **10d — Avaliação automatizada da LLM:** casos de referência e comparação de resultados.
- **10e — Observabilidade:** `app.query_runs`, logs estruturados, métricas para administradores. Depende da 10c.
- **10f — README e apresentação.** Depende da 10c, da 10d e da 10e.

A revisão de segurança final (checklist em `template/RECOMENDACOES.md`) é feita na 10c, antes
de publicar.
