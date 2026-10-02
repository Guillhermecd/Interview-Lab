# DECISOES.md — Registro de decisões

Nenhuma fase avança enquanto suas decisões estiverem `PENDENTE`.
A "recomendação" é só uma sugestão; a decisão é do Guilherme.

Formato ao decidir: mudar o status para `DECIDIDA`, preencher **Escolha**, **Data** e **Motivo**.

---

### D-01 — Framework do backend
- **Opções:** Fastify | NestJS
- **Trade-off:** Fastify é enxuto, tem SSE e validação de schema simples, menos código.
  NestJS traz estrutura (módulos, DI, decorators) parecida com Spring — mais aderente a vagas
  e mais familiar para quem vem de Spring Boot, mas mais boilerplate.
- **Recomendação:** NestJS (com adapter Fastify), pelo objetivo de portfólio e pela proximidade com Spring.
- **Status:** DECIDIDA
- **Escolha:** NestJS com adapter Fastify
- **Data:** 2026-10-02
- **Motivo:** estrutura (módulos, DI, decorators) próxima do Spring e aderente ao objetivo de portfólio.

### D-02 — Estrutura do repositório
- **Opções:** monorepo (pnpm workspaces) | dois repositórios
- **Trade-off:** monorepo permite compartilhar tipos dos eventos SSE entre api e web e ter um único CI;
  dois repos isolam deploys mas duplicam contratos.
- **Recomendação:** monorepo com `apps/api`, `apps/web`, `packages/shared`.
- **Status:** DECIDIDA
- **Escolha:** monorepo com pnpm workspaces (`apps/api`, `apps/web`, `packages/shared`)
- **Data:** 2026-10-02
- **Motivo:** tipos dos eventos SSE compartilhados entre api e web e um único CI.

### D-03 — Provedor de LLM
- **Opções:** Anthropic | OpenAI | interface com os dois
- **Trade-off:** a interface custa pouco e permite mocar nos testes; suportar dois provedores
  de verdade dobra testes de integração.
- **Recomendação:** interface própria + um provedor implementado.
- **Status:** PENDENTE

### D-04 — Parser SQL
- **Opções:** `node-sql-parser` | `pgsql-ast-parser` | `libpg-query` (parser real do Postgres)
- **Trade-off:** `libpg-query` usa o parser do próprio Postgres — aceita exatamente o que o banco aceita,
  o que importa para segurança; os outros são JS puro, mais fáceis de instalar, mas podem divergir do
  Postgres em sintaxe rara (e divergência é por onde passa um ataque).
- **Recomendação:** `libpg-query`. Validar instalação no CI na Fase 00.
- **Status:** DECIDIDA
- **Escolha:** `libpg-query`, com teste de fumaça de instalação já na Fase 00
- **Data:** 2026-10-02
- **Motivo:** aceita exatamente o que o Postgres aceita; validar cedo evita descobrir problema de instalação só na Fase 03.

### D-05 — Dataset de demonstração
- **Opções:** schema próprio de vendas (regiões, produtos, pedidos) | dataset público (ex.: Pagila, Northwind)
- **Trade-off:** dataset público é pronto e conhecido; schema próprio controla volume e permite
  perguntas como "faturamento por região no último trimestre" com datas atuais.
- **Recomendação:** schema próprio com seed gerado.
- **Status:** PENDENTE

### D-06 — Biblioteca de gráficos
- **Opções:** Recharts | Chart.js | ECharts
- **Recomendação:** Recharts (declarativo, integra direto com React).
- **Status:** PENDENTE

### D-07 — Armazenamento de histórico, tokens e cache
- **Opções:** tudo no Postgres (schema da aplicação) | Postgres + Redis para cache/rate limit
- **Trade-off:** só Postgres = menos um serviço para operar; Redis é o padrão de mercado para rate limit
  e cache e conta pontos no portfólio, mas é mais um container e mais um ponto de falha.
- **Recomendação:** Postgres + Redis.
- **Status:** PENDENTE

### D-08 — Autenticação
- **Opções:** JWT próprio simples | provedor externo | sem auth (usuário fixo)
- **Observação:** "tokens por usuário" e "rate limit por usuário" exigem identidade.
- **Recomendação:** JWT próprio simples (cadastro/login), sem OAuth nesta versão.
- **Status:** PENDENTE

### D-09 — Ferramentas de teste
- **Opções:** Vitest | Jest; Testcontainers para Postgres; Playwright para E2E
- **Recomendação:** Vitest + Testcontainers + Playwright.
- **Status:** DECIDIDA
- **Escolha:** Vitest + Testcontainers + Playwright
- **Data:** 2026-10-02
- **Motivo:** um único runner para api e web; Postgres real nos testes de integração; Playwright entra na Fase 06.

### D-10 — Ordem das fases
- **Opção A:** ordem do `PLANO.md` (segurança primeiro, frontend na Fase 06).
- **Opção B:** frontend mínimo mais cedo para ver o produto funcionando antes.
- **Recomendação:** A — a guarda SQL é o coração do projeto e precisa existir antes de qualquer SQL gerado por IA tocar o banco.
- **Status:** DECIDIDA
- **Escolha:** A — ordem do `PLANO.md`, da Fase 00 à Fase 09
- **Data:** 2026-10-02
- **Motivo:** segurança antes de qualquer SQL gerado por IA tocar o banco.

### D-11 — Deploy
- **Opções:** AWS Lightsail | VPS com Docker + Traefik | outro
- **Status:** PENDENTE (decidir só na Fase 09)

### D-12 — Política de branches e PR
- **Proposta:** `feature/fase-XX-nome`, Conventional Commits, squash merge, CI obrigatório, merge feito pelo Guilherme.
- **Status:** DECIDIDA
- **Escolha:** proposta acima, com PR direto na `main`
- **Data:** 2026-10-02
- **Motivo:** fluxo simples para projeto de um desenvolvedor, alinhado ao `CLAUDE.md` §3.
- **Exceção registrada:** o commit inicial (somente documentação) foi feito direto na `main`, porque o repositório remoto estava vazio.

### D-13 — Precedência entre `PLANO.md` e os documentos de padrões em `template/`
- **Contexto:** os documentos de padrões descrevem outra stack (Sails.js/Spring Boot, Ant Design, pastas `backend/` e `frontend/`, npm, porta 1337, fluxo com `develop`), o que contradiz o `PLANO.md`.
- **Opções:** `PLANO.md` prevalece na stack | padrões prevalecem | decidir item a item
- **Status:** DECIDIDA
- **Escolha:** `PLANO.md` prevalece na stack e na estrutura de pastas. Dos padrões valem apenas os princípios transversais: SOLID/Clean Code, nomenclatura, formato de erro da API, datas em ISO 8601, fronteira frontend/backend e validação de variáveis de ambiente.
- **Data:** 2026-10-02
- **Motivo:** manter o escopo e a stack planejados sem perder as convenções de qualidade.

### D-14 — Localização dos arquivos de processo
- **Contexto:** `RECOMENDACOES.md`, `RELATORIO_ETAPA.md` e `pull_request_template.md` estavam na raiz, mas o `CLAUDE.md` os referencia em `template/` e `.github/`.
- **Opções:** mover os arquivos | manter na raiz e corrigir o `CLAUDE.md`
- **Status:** DECIDIDA
- **Escolha:** mover para `template/RECOMENDACOES.md`, `template/RELATORIO_ETAPA.md` e `.github/pull_request_template.md`.
- **Data:** 2026-10-02
- **Motivo:** fazer os caminhos reais baterem com o protocolo do `CLAUDE.md`.

### D-15 — Conteúdo publicado no repositório público
- **Contexto:** o repositório no GitHub é público e parte de `template/` é documentação interna de terceiros.
- **Opções:** publicar tudo menos essa documentação | publicar tudo | tornar o repositório privado antes
- **Status:** DECIDIDA
- **Escolha:** publicar tudo, exceto `template/README.md`, `template/CONTRIBUTING.md` e `template/docs/`, que ficam apenas locais (listados no `.gitignore`).
- **Data:** 2026-10-02
- **Motivo:** não divulgar material interno.
- **Ponto de atenção:** um clone novo não terá esses arquivos, que o `CLAUDE.md` §1.1 manda ler.

### D-16 — Lint e formatação
- **Opções:** ESLint + Prettier | Biome
- **Status:** DECIDIDA
- **Escolha:** ESLint (typescript-eslint, regras type-aware) + Prettier
- **Data:** 2026-10-02
- **Motivo:** padrão do NestJS e do Vite, com regras type-aware mais completas.

### D-17 — Versão do Node e gerenciador de pacotes
- **Opções:** Node 24 | Node 22
- **Status:** DECIDIDA
- **Escolha:** Node 24 no CI e em `engines`; pnpm instalado globalmente via `npm install -g pnpm` (`corepack enable` falhou com `EPERM` sem terminal elevado)
- **Data:** 2026-10-02
- **Motivo:** mesma versão na máquina local e no CI.

### D-18 — Versão do PostgreSQL
- **Opções:** 17 | 16
- **Status:** DECIDIDA
- **Escolha:** PostgreSQL 17 (docker-compose e Testcontainers)
- **Data:** 2026-10-02
- **Motivo:** escolha do Guilherme.
