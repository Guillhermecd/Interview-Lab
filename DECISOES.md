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
- **Status:** DECIDIDA
- **Escolha:** interface própria (`LlmProvider`) + um provedor implementado: **Google Gemini**, pela camada gratuita. Modelo padrão `gemini-3.5-flash-lite`, configurável por `LLM_MODEL`.
- **Data:** 2026-10-02
- **Motivo:** Anthropic e OpenAI não têm uso gratuito de API; o Gemini tem camada gratuita para os modelos Flash. A interface permite trocar de provedor depois escrevendo uma única classe.
- **Modelo:** a primeira escolha foi `gemini-3.8-flash` (faixa "equilibrada"), mas a camada gratuita dele permite só 20 requisições por dia, e cada pergunta usa 2 a 3. Trocado para `gemini-3.5-flash-lite`, que passou na avaliação manual da Fase 04.
- **Ponto de atenção:** na camada gratuita o Google usa os dados enviados para melhorar seus produtos. Hoje são perguntas, o schema e linhas dos dados de demonstração. Rever antes de usar dados reais ou publicar (Fase 10).

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
- **Status:** DECIDIDA
- **Escolha:** schema próprio de vendas (regiões, produtos, pedidos) com seed gerado
- **Data:** 2026-10-02
- **Motivo:** controle de volume e datas atuais para perguntas como "faturamento por região no último trimestre".

### D-06 — Biblioteca de gráficos
- **Opções:** Recharts | Chart.js | ECharts
- **Recomendação:** Recharts (declarativo, integra direto com React).
- **Status:** DECIDIDA
- **Escolha:** Recharts
- **Data:** 2026-10-03
- **Motivo:** componentes React declarativos; cobre barra e linha, os tipos que a API sugere.

### D-07 — Armazenamento de histórico, tokens e cache
- **Opções:** tudo no Postgres (schema da aplicação) | Postgres + Redis para cache/rate limit
- **Trade-off:** só Postgres = menos um serviço para operar; Redis é o padrão de mercado para rate limit
  e cache e conta pontos no portfólio, mas é mais um container e mais um ponto de falha.
- **Recomendação:** Postgres + Redis.
- **Status:** DECIDIDA
- **Escolha:** histórico de conversas e mensagens no Postgres, schema `app`. O armazenamento de cache e rate limit foi separado na D-07b.
- **Data:** 2026-10-02
- **Motivo:** a Fase 05 só precisa do histórico, que fica no Postgres nas duas opções.

### D-07b — Armazenamento de cache e rate limit
- **Opções:** Postgres (schema da aplicação) | Redis
- **Trade-off:** o mesmo da D-07 — só Postgres é um serviço a menos para operar; Redis é o padrão de mercado para cache e rate limit, mas é mais um container e mais um ponto de falha.
- **Recomendação:** Redis.
- **Status:** DECIDIDA
- **Escolha:** Redis para rate limit e cache (contabilização de tokens fica no Postgres, que é durável)
- **Data:** 2026-10-03
- **Motivo:** padrão de mercado para contadores com expiração e cache com TTL.

### D-08 — Autenticação
- **Opções:** JWT próprio simples | provedor externo | sem auth (usuário fixo)
- **Observação:** "tokens por usuário" e "rate limit por usuário" exigem identidade.
- **Recomendação:** JWT próprio simples (cadastro/login), sem OAuth nesta versão.
- **Status:** DECIDIDA
- **Escolha:** JWT próprio (cadastro, login, logout), sem OAuth, guardado em **cookie HttpOnly** (`SameSite=Strict`, `Secure` em produção) com verificação de origem nas requisições que alteram dados (proteção contra CSRF)
- **Data:** 2026-10-03
- **Motivo:** o JavaScript da página não lê o token, então um XSS não consegue roubá-lo.
- **Contradição com o template registrada:** o `api-contract.md` do template guarda o token no `localStorage` e o envia no header `Authorization`. Aqui vale o cookie; o logout passa a ser uma rota da API (`POST /api/auth/logout`), que apaga o cookie.

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
- **Status:** PENDENTE (decidir só na Fase 10)

### D-12 — Política de branches e PR
- **Proposta:** `feature/fase-XX-nome`, Conventional Commits, squash merge, CI obrigatório, merge feito pelo Guilherme.
- **Status:** DECIDIDA
- **Escolha:** proposta acima, com PR direto na `main`
- **Data:** 2026-10-02
- **Motivo:** fluxo simples para projeto de um desenvolvedor, alinhado ao `CLAUDE.md` §3.
- **Exceção registrada:** o commit inicial (somente documentação) foi feito direto na `main`, porque o repositório remoto estava vazio.
- **Exceção registrada:** o squash merge do PR #1 (Fase 00) foi executado pelo Claude a pedido explícito do Guilherme, com o CI verde.
- **Exceção registrada:** o squash merge do PR #2 (Fase 01) foi executado pelo Claude, com o CI verde, interpretando "siga adiante" como autorização; não houve pedido explícito de merge.
- **Regra a partir de 2026-10-02 (Fase 02 em diante):** o Claude executa o squash merge quando o CI estiver verde. Se o CI não ficar verde, o Claude explica o motivo ao Guilherme antes de qualquer outra ação. Isto substitui "merge feito pelo Guilherme" da proposta original. Push e abertura do PR continuam exigindo aprovação a cada fase, depois do relatório.
- **Regra a partir de 2026-10-02 (Fase 03 em diante):** push e abertura do PR também passam a ser feitos pelo Claude ao fim de cada fase, sem pergunta; o Guilherme revisa pelo relatório no PR. Decisões pendentes da fase seguinte continuam sendo perguntadas antes de começar.

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
- **Ponto de atenção (2026-10-02):** o Node 24.15 no Windows derruba o processo de teste de forma intermitente (`0xC0000409`); 24.21 e 22.23 não. Usar 24.21 ou mais recente localmente. O CI usa a 24 mais recente e não é afetado. Detalhes no relatório da Fase 05.

### D-18 — Versão do PostgreSQL
- **Opções:** 17 | 16
- **Status:** DECIDIDA
- **Escolha:** PostgreSQL 17 (docker-compose e Testcontainers)
- **Data:** 2026-10-02
- **Motivo:** escolha do Guilherme.

### D-19 — Driver de banco e ferramenta de migrations
- **Opções:** driver `pg` + SQL puro versionado com `node-pg-migrate` | ORM/query builder com migrations próprias (Drizzle, Prisma, Kysely)
- **Status:** DECIDIDA
- **Escolha:** driver `pg` + migrations em SQL puro com `node-pg-migrate`
- **Data:** 2026-10-02
- **Motivo:** roles, `GRANT` e parâmetros da role read-only ficam explícitos no SQL, que é o foco de segurança da Fase 01.

### D-20 — Isolamento entre dados de demonstração e dados da aplicação
- **Opções:** schema separado no mesmo banco | banco separado
- **Trade-off:** banco separado isola mais (a role read-only nem conecta), mas exige bootstrap fora das migrations, dois conjuntos de migrations e duas conexões. Schema separado é mais simples, porém a role read-only enxerga os nomes das tabelas da aplicação pelo catálogo do Postgres (não os dados).
- **Status:** DECIDIDA
- **Escolha:** schemas `sales` (dados expostos) e `app` (aplicação) no mesmo banco; histórico de migrations no schema `migrations`
- **Data:** 2026-10-02
- **Motivo:** um único conjunto de migrations e um único serviço; o acesso ao catálogo será bloqueado pela guarda SQL na Fase 03.

### D-21 — Funções de large object
- **Contexto:** `app_readonly` conseguia executar `SELECT lo_create(0)` após desligar o read-only da sessão, gravando no banco sem privilégio em nenhuma tabela.
- **Opções:** revogar `EXECUTE` das funções `lo_*` de `PUBLIC` no banco | deixar apenas para a guarda SQL (Fase 03)
- **Status:** DECIDIDA
- **Escolha:** revogar no banco, por migration, com teste; a guarda SQL continua bloqueando `lo_*` como segunda camada
- **Data:** 2026-10-02
- **Motivo:** defesa em camadas — a brecha é fechada na fronteira real (o banco), sem depender da guarda.

### D-22 — Endpoint interno de execução antes da guarda SQL
- **Contexto:** a Fase 02 entrega um endpoint que executa SQL "já validado", mas a guarda SQL só existe na Fase 03. Até lá o endpoint aceitaria SQL cru, protegido apenas pela role read-only e pelos limites do executor.
- **Opções:** endpoint atrás de flag, desligado por padrão | só o serviço, sem endpoint HTTP | endpoint sempre ativo
- **Status:** DECIDIDA
- **Escolha:** `POST /api/internal/queries/execute` só é registrado com `INTERNAL_QUERY_ENDPOINT_ENABLED=true`; o padrão é `false`
- **Data:** 2026-10-02
- **Motivo:** cumpre a entrega do `PLANO.md` e permite testar por HTTP sem expor SQL cru por padrão. A partir da Fase 03 a guarda SQL entra na frente do executor.

### D-23 — Parâmetros da guarda SQL
- **Opções:** funções por allowlist | por blocklist; `LIMIT` 1000 | injeta 100 com teto 1000 | 200; máximo de `JOIN`s 5 | 3 | 8
- **Status:** DECIDIDA
- **Escolha:** funções por **allowlist**; `LIMIT` de **1000** (o mesmo `QUERY_MAX_ROWS` do executor), injetado quando ausente e reduzido quando maior; no máximo **5 JOINs**
- **Data:** 2026-10-02
- **Motivo:** allowlist bloqueia por padrão qualquer função perigosa não prevista; um único número de limite no sistema; 5 JOINs cobrem a consulta mais larga do schema de vendas (4 JOINs) com folga.
- **Definição de JOIN:** conta-se na query inteira (subqueries, CTEs e ramos de `UNION` somados) cada `JOIN` explícito mais cada item separado por vírgula no `FROM` além do primeiro.
- **Detalhe do `LIMIT`:** a guarda injeta `QUERY_MAX_ROWS + 1`, para o executor ainda conseguir distinguir "exatamente 1000 linhas" de "havia mais" (`truncated`). O usuário nunca recebe mais de 1000.

### D-24 — Versão do parser SQL
- **Contexto:** a versão instalada na Fase 00 (`libpg-query` 18) usa a gramática do PostgreSQL 18, mas o banco é PostgreSQL 17 (D-18).
- **Opções:** fixar `libpg-query` em 17.x | subir o banco para 18 | manter a divergência
- **Status:** DECIDIDA
- **Escolha:** `libpg-query` fixado em `17.7.4` (versão exata)
- **Data:** 2026-10-02
- **Motivo:** a D-04 escolheu este parser por aceitar exatamente o que o banco aceita; parser e servidor precisam ter a mesma gramática. Ao atualizar o PostgreSQL, atualizar o parser junto.

### D-25 — Reescrita do `LIMIT` sem deparser
- **Contexto:** o `libpg-query` não transforma a AST de volta em SQL.
- **Opções:** manter o texto original e acrescentar/embrulhar o `LIMIT` | adicionar a biblioteca `pgsql-deparser`
- **Status:** DECIDIDA
- **Escolha:** sem dependência nova. Sem `LIMIT`: acrescenta `LIMIT n` ao fim do statement. `LIMIT` acima do teto, `LIMIT ALL` ou `LIMIT NULL`: embrulha em `SELECT * FROM (<sql>) AS limited_query LIMIT n`. O texto final é re-parseado e re-validado antes de executar.
- **Data:** 2026-10-02
- **Motivo:** não coloca código de terceiros no caminho de segurança e não reformata o SQL do usuário (importante para o editor da Fase 07).
- **Ponto de atenção:** no caso embrulhado, a preservação do `ORDER BY` interno não é garantida pelo padrão SQL; o PostgreSQL 17 preserva e há teste de integração cobrindo.

### D-26 — Dados do resultado enviados à LLM para a explicação
- **Opções:** até 50 linhas | até 200 linhas | todas (até 1000)
- **Status:** DECIDIDA
- **Escolha:** até **50 linhas** (`LLM_EXPLAIN_MAX_ROWS`), com a LLM informada de quantas linhas existem e se houve corte; o usuário continua recebendo todas as linhas na tabela
- **Data:** 2026-10-02
- **Motivo:** custo de tokens previsível e menos dados do banco saindo para o provedor.

### D-27 — Memória resumida das conversas
- **Opções:** quantas mensagens recentes manter na íntegra e quando regenerar o resumo
- **Status:** DECIDIDA
- **Escolha:** manter as **6 mensagens mais recentes** na íntegra; quando houver 6 ou mais mensagens além dessas ainda fora do resumo, a LLM gera um novo resumo incorporando-as
- **Data:** 2026-10-02
- **Motivo:** contexto suficiente para perguntas de continuação ("e por produto?") sem crescer o prompt indefinidamente. Cada regeneração é uma chamada extra à LLM.
- **Na prática:** a LLM recebe o resumo mais todas as mensagens ainda fora dele, ou seja, de 6 a 11 mensagens na íntegra. Cortar para exatamente 6 descartaria mensagens que ainda não entraram no resumo.

### D-28 — Dono das conversas antes da autenticação
- **Opções:** conversas sem dono, com os endpoints atrás da flag interna | antecipar a autenticação
- **Status:** DECIDIDA
- **Escolha:** conversas sem dono até a Fase 08; os endpoints de conversa só existem com `INTERNAL_QUERY_ENDPOINT_ENABLED=true` (a mesma flag da D-22)
- **Data:** 2026-10-02
- **Motivo:** manter a ordem das fases (D-10). Na Fase 08 as conversas passam a ter dono e os endpoints saem de trás da flag.

### D-29 — Kit de interface do frontend
- **Opções:** Ant Design (o do template) | Tailwind CSS com componentes próprios | Mantine
- **Status:** DECIDIDA
- **Escolha:** Tailwind CSS com componentes próprios
- **Data:** 2026-10-03
- **Motivo:** escolha do Guilherme: bundle mais leve e visual livre. Custo aceito: tabela, layout e estados de tela escritos à mão.
- **Consequência:** as regras de estilo do template que falam de Ant Design (`ConfigProvider`, `theme.ts`, "sem arquivos .css") não se aplicam; vale o equivalente com Tailwind — cores e tokens definidos uma vez como variáveis de tema, nunca hexadecimais espalhados, modo claro e escuro.

### D-30 — Editor de SQL
- **Opções:** CodeMirror 6 | Monaco | textarea simples
- **Status:** DECIDIDA
- **Escolha:** CodeMirror 6 (somente leitura na Fase 06, edição na Fase 07)
- **Data:** 2026-10-03
- **Motivo:** leve, com realce de SQL no dialeto PostgreSQL.

### D-31 — Testes do frontend
- **Opções:** componentes + E2E | só componentes
- **Status:** DECIDIDA
- **Escolha:** Vitest + Testing Library (jsdom) para componentes; Playwright para o E2E do fluxo principal com o backend simulado
- **Data:** 2026-10-03
- **Motivo:** cumpre a verificação do `PLANO.md`, dentro da D-09.

### D-32 — Modo "revisar antes de executar"
- **Opções:** opcional desligado por padrão | opcional ligado por padrão | sempre revisar
- **Status:** DECIDIDA
- **Escolha:** opcional, **desligado por padrão**; a preferência fica salva no navegador
- **Data:** 2026-10-03
- **Motivo:** quem quer agilidade mantém o fluxo direto; quem quer controle revisa e edita o SQL antes de rodar.

### D-33 — Contrato da API para revisão e execução do SQL
- **Opções:** stream com pausa + endpoint de execução | dois endpoints separados (gerar / executar)
- **Status:** DECIDIDA
- **Escolha:** `POST /conversations/:id/messages` aceita `mode: "review"`: o stream envia o SQL e termina com o evento `review` (`messageId`, `sql`), sem executar. `POST /conversations/:id/messages/:messageId/execute` recebe o SQL (original ou editado) e responde no mesmo formato de stream (`rows` → `token`… → `done`), passando pela mesma guarda SQL; o `done` informa se o SQL foi editado.
- **Data:** 2026-10-03
- **Motivo:** reaproveita o stream e o histórico; pergunta, SQL e explicação continuam ligados à mesma mensagem.

### D-34 — Limites por usuário
- **Opções:** 10/min e 200 mil tokens/dia | 5/min e 50 mil | 20/min e 500 mil
- **Status:** DECIDIDA
- **Escolha:** **10 perguntas por minuto** e **200 mil tokens por dia** por usuário, verificados antes de chamar a LLM; configuráveis por variável de ambiente
- **Data:** 2026-10-03
- **Motivo:** ~130 perguntas por dia por usuário, com ~1.500 tokens cada.

### D-35 — Conversas criadas antes da autenticação
- **Opções:** manter sem dono e invisíveis | apagar na migration (irreversível)
- **Status:** DECIDIDA
- **Escolha:** manter no banco, sem dono; nenhum usuário as vê
- **Data:** 2026-10-03
- **Motivo:** nada é apagado; podem ser atribuídas a alguém depois.

### D-36 — Bibliotecas de autenticação e Redis
- **Opções:** jose + @fastify/cookie + ioredis | jsonwebtoken + @fastify/cookie + node-redis | implementação própria
- **Status:** DECIDIDA
- **Escolha:** `jose` (JWT), `@fastify/cookie` (cookies), `ioredis` (Redis); senhas com `scrypt` do próprio Node, sem biblioteca
- **Data:** 2026-10-03
- **Motivo:** bibliotecas mantidas e sem dependências pesadas; nenhum código criptográfico escrito à mão.

### D-37 — Implementação do rate limit
- **Opções:** contador próprio por janela de 1 minuto | rate-limiter-flexible
- **Status:** DECIDIDA
- **Escolha:** contador próprio no Redis (`INCR` + `EXPIRE` atômicos) por usuário e minuto
- **Data:** 2026-10-03
- **Motivo:** poucas linhas e fácil de testar. Limitação aceita: janela fixa permite até 2x o limite na virada do minuto.

### D-38 — Entrada do handoff de design no plano
- **Contexto:** o handoff `design_handoff_converse_dados/` (redesign do chat, dashboard operacional e chat suspenso) não estava no `PLANO.md`.
- **Opções:** nova Fase 09 "Design" em quatro PRs, com o deploy passando a Fase 10 | um PR único | depois do deploy
- **Status:** DECIDIDA
- **Escolha:** nova **Fase 09 — Design**, em quatro PRs: 09a (tokens, tema, componentes e chat reestilizado), 09b (`/chat` em três colunas com painel de schema), 09c (dashboard), 09d (chat suspenso). Observabilidade, hardening e deploy passam a ser a **Fase 10**.
- **Data:** 2026-10-05
- **Motivo:** PRs pequenos e revisáveis; o deploy publica o produto já com a interface final.
- **Consequência:** cada PR tem a própria branch (`feature/fase-09a-…`) e o próprio relatório (`docs/relatorios/fase-09a.md`).

### D-39 — Camada de dados do handoff
- **Contexto:** o `PROMPT.md` do handoff pede um serviço `chatApi` implementado com mocks.
- **Opções:** seguir o prompt e simular a API | usar o backend real que já existe
- **Status:** DECIDIDA
- **Escolha:** a interface nova é construída sobre o fluxo real (`ConversationService`, `useChat`, `chat-state`, SSE com modo de revisão). Mocks existem apenas nos testes (`src/test/fake-api.ts` e `e2e/fake-backend.ts`).
- **Data:** 2026-10-05
- **Motivo:** o prompt foi escrito para um projeto sem backend; aqui a API já existe e é a fonte da verdade.
- **Consequência:** os números mostrados na tela (limite por minuto, cota diária, tempo limite) vêm do backend — 10/min e 200 mil tokens (D-34) —, nunca dos valores do protótipo (20/min, 500 mil). O streaming segue o ritmo real dos tokens, sem atraso artificial, e a contagem de tokens só aparece com o valor enviado no evento `done`.

### D-40 — Dados do dashboard
- **Contexto:** o dashboard do handoff mostra centros de distribuição, estoque, giro, ruptura, movimentações, curva ABC e entrega no prazo. O schema `sales` só tem `regions`, `products`, `customers`, `orders` e `order_items`.
- **Opções:** (A) ampliar o schema `sales`, o seed e criar endpoints de agregação | (B) dashboard só com o que existe (cerca de 2 KPIs e 3 gráficos) | (C) dados fixos no frontend
- **Status:** DECIDIDA
- **Escolha:** **A** — ampliar o schema e o seed e expor endpoints de agregação, na Fase 09c.
- **Data:** 2026-10-05
- **Motivo:** é a única opção que entrega o dashboard do handoff. A opção C colocaria dados e cálculos de negócio no frontend, contra a fronteira definida no template.
- **Custo aceito:** nova migration, seed maior, tabelas novas na allowlist da guarda SQL, contexto do prompt da LLM maior e revisão da D-05. O detalhe das tabelas novas é perguntado antes de começar a 09c.

### D-41 — Mudanças no contrato da API para o novo chat
- **Opções:** cada item abaixo pode ser adicionado ao contrato ou o estado correspondente fica fora da tela
- **Status:** DECIDIDA
- **Escolha:** adicionar (1) `GET /api/schema`, com as tabelas e colunas expostas; (2) `cached` no evento `done`; (3) `retryAfterSeconds` nos erros de limite de uso (`RATE_LIMITED` e `QUOTA_EXCEEDED`); (4) o status da última resposta em cada item da lista de conversas. **Não** adicionar a posição do trecho recusado pela guarda SQL: o bloqueio mostra só o motivo.
- **Data:** 2026-10-05
- **Motivo:** os quatro itens alimentam estados obrigatórios do handoff (painel de schema, selo "Resposta do cache", contagem regressiva do rate limit, badges da lista) com dados que só o backend conhece. A posição do trecho exigiria mexer na guarda SQL, que é caminho de segurança, por um ganho só visual.
- **Fases:** (2) e (3) na 09a; (1) e (4) na 09b.
- **Alcance do item (3), registrado na 09a:** a recomendação aprovada citava só `RATE_LIMITED`. O campo também vai em `QUOTA_EXCEEDED` (segundos até a meia-noite UTC), porque o alerta de cota do handoff mostra "Renova em". Como o limite de tentativas de login usa o mesmo erro `RATE_LIMITED`, a resposta 429 do login passa a trazer o campo também.

### D-42 — Contexto do "Perguntar sobre isto"
- **Opções:** prefixar o contexto no texto da pergunta | campo novo em `AskQuestionRequest`
- **Status:** DECIDIDA
- **Escolha:** prefixar no texto da pergunta, sem mudar o contrato.
- **Data:** 2026-10-05
- **Motivo:** a LLM recebe o contexto como parte da pergunta e o histórico guarda exatamente o que foi enviado.

### D-43 — Roteador do frontend
- **Opções:** `react-router-dom` | roteador próprio
- **Status:** DECIDIDA
- **Escolha:** `react-router-dom`, adicionado na Fase 09b, quando passam a existir duas telas (`/dashboard` e `/chat`).
- **Data:** 2026-10-05
- **Motivo:** biblioteca padrão, já prevista no template.

### D-44 — Fontes
- **Opções:** `@fontsource` (arquivos servidos pela própria aplicação) | Google Fonts por CDN | arquivos copiados para o repositório
- **Status:** DECIDIDA
- **Escolha:** `@fontsource-variable/instrument-sans` e `@fontsource-variable/jetbrains-mono`.
- **Data:** 2026-10-05
- **Motivo:** nenhuma requisição a terceiros em tempo de execução e versão fixada pelo lockfile.

### D-45 — Ícones
- **Opções:** SVG inline | Lucide
- **Status:** DECIDIDA
- **Escolha:** SVG inline, num único arquivo de componentes de ícone (16×16, traço de 1.6).
- **Data:** 2026-10-05
- **Motivo:** nenhuma dependência nova para cerca de vinte ícones.

### D-46 — Realce e edição de SQL no novo design
- **Opções:** CodeMirror 6, já instalado, com as cores do tema | textarea com um highlighter novo
- **Status:** DECIDIDA
- **Escolha:** CodeMirror 6 (D-30), com as cores de sintaxe do handoff definidas como tokens do tema.
- **Data:** 2026-10-05
- **Motivo:** nenhuma dependência nova e um único componente para ver e editar SQL.

### D-47 — Pasta do handoff no repositório público
- **Opções:** commitar tudo | só o `README.md` | ignorar tudo
- **Status:** DECIDIDA
- **Escolha:** commitar `design_handoff_converse_dados/README.md` e `PROMPT.md`; a pasta `design_handoff_converse_dados/design/` fica apenas local (listada no `.gitignore`).
- **Data:** 2026-10-05
- **Motivo:** o `README.md` é a especificação contra a qual os PRs são conferidos; os protótipos dependem de `support.js`, que é o runtime da ferramenta de design (código de terceiros).
- **Ponto de atenção:** um clone novo não terá os protótipos em HTML.

### D-48 — Identidade na barra superior
- **Contexto:** o protótipo mostra "Carla Souza · Gerente de operações"; `AuthUser` tem nome e e-mail, sem cargo.
- **Status:** DECIDIDA
- **Escolha:** mostrar as iniciais e o nome do usuário autenticado, sem cargo, e manter a ação de sair.
- **Data:** 2026-10-05
- **Motivo:** a tela só mostra o que o backend informa.

### D-49 — Ordem dos PRs da Fase 09 e entrada do cadastro
- **Contexto:** depois da 09a, o Guilherme pediu o dashboard antes da tela do chat em três colunas e uma tela de cadastro, com CRUD completo e endpoints, para alimentar o dashboard.
- **Opções:** manter a ordem 09b → 09c → 09d | dashboard primeiro; cadastro junto com a 09c | cadastro em PR próprio
- **Status:** DECIDIDA
- **Escolha:** nova ordem **09c (dashboard, levando o roteador) → 09e (cadastro) → 09b (chat em três colunas) → 09d (chat suspenso)**. O cadastro é um PR próprio, a **Fase 09e**.
- **Data:** 2026-10-05
- **Motivo:** o dashboard é a prioridade; a 09c já leva schema, seed, endpoints e a tela, e o cadastro abre um caminho de escrita que merece revisão separada.
- **Consequência:** o roteador (D-43) e a barra superior (D-48) entram na 09c, não na 09b.
- **"Perguntar sobre isto" até a 09d:** os botões dos cards levam ao `/chat` com a pergunta e o contexto escritos no composer (D-42), para o usuário enviar. Nada é enviado sozinho. A janela suspensa da 09d substitui essa navegação.

### D-50 — Tabelas do dashboard (detalhe da D-40)
- **Opções:** nomes em inglês estendendo as tabelas atuais | nomes em português como no protótipo (`materiais`, `pedidos_venda`…)
- **Status:** DECIDIDA
- **Escolha:** nomes em **inglês**, estendendo o schema `sales`:
  - novas: `distribution_centers` (`name`, `city`, `state`, `region_id`), `stock_levels` (`distribution_center_id`, `product_id`, `quantity`, `minimum_quantity`) e `stock_movements` (`moved_at`, `type` — `inbound`, `outbound`, `transfer`, `adjustment` —, `product_id`, `distribution_center_id`, `destination_center_id`, `quantity`, `responsible_name`, `document`);
  - `products` ganha `sku`, `unit` e `cost`;
  - `orders` ganha `distribution_center_id`, `expected_delivery_at` e `delivered_at`.
- **Data:** 2026-10-05
- **Motivo:** padrão de nomenclatura do projeto; não quebra a guarda SQL, o prompt nem os testes existentes.
- **Acréscimo registrado na 09c (2026-10-05):** `products` ganhou também a coluna `active`, que não estava na lista aprovada. A D-56 já tinha escolhido arquivar materiais com `active = false`; criar a coluna nesta migration evita uma segunda migration que apaga dados na 09e.
- **Custo aceito:** a migration apaga os dados de demonstração de `sales` (as colunas novas são `NOT NULL`); `db:seed` recria tudo. O schema `app` não é tocado. As tabelas novas entram na allowlist da guarda e no contexto do prompt, que fica maior.

### D-51 — Dados de demonstração do dashboard
- **Opções:** trocar o seed para materiais de construção, como no handoff | manter produtos genéricos; 200 produtos | 40
- **Status:** DECIDIDA
- **Escolha:** seed da "Rota Materiais": 5 categorias do handoff (Cimento e argamassa, Aço e metais, Tubos e conexões, Elétrica e cabos, EPIs), **200 produtos**, 9 centros de distribuição nas 5 regiões, estoque e movimentações.
- **Data:** 2026-10-05
- **Motivo:** dados coerentes com as telas; 200 produtos dão forma à curva ABC. Substitui a parte "regiões, produtos, pedidos" genérica da D-05, que continua valendo no resto (schema próprio, seed gerado, datas relativas a hoje).

### D-52 — Região do faturamento
- **Opções:** região do centro de distribuição que atendeu o pedido | região do cliente
- **Status:** DECIDIDA
- **Escolha:** região do **centro de distribuição** do pedido.
- **Data:** 2026-10-05
- **Motivo:** é a leitura do handoff, e os filtros de centro de distribuição e de região ficam coerentes entre si.

### D-53 — Views do handoff
- **Opções:** não criar; os endpoints usam SQL próprio | criar `vw_saidas_12m` e `vw_estoque_valorizado` e expô-las à IA
- **Status:** DECIDIDA
- **Escolha:** não criar views.
- **Data:** 2026-10-05
- **Motivo:** menos superfície para a guarda SQL; a IA consegue as mesmas respostas pelas tabelas.

### D-54 — Acesso dos endpoints do dashboard ao banco
- **Opções:** pool `app_readonly`, com SQL fixo e parametrizado | pool da aplicação (`app_rw`)
- **Status:** DECIDIDA
- **Escolha:** pool `app_readonly`. O SQL do dashboard é escrito no código, com valores sempre por parâmetro; nenhum texto vindo do usuário ou da IA passa por esse caminho.
- **Data:** 2026-10-05
- **Motivo:** `app_rw` continua sem ler `sales`; o dashboard herda o `statement_timeout` e o somente leitura da role.

### D-55 — Meta de entrega no prazo
- **Opções:** variável de ambiente no backend | coluna ou tabela
- **Status:** DECIDIDA
- **Escolha:** variável de ambiente `ON_TIME_DELIVERY_TARGET_PERCENT`, padrão 95.
- **Data:** 2026-10-05
- **Motivo:** um único número, lido e devolvido pelo backend; a tela só o exibe.

### D-56 — Tela de cadastro (Fase 09e)
- **Contexto:** hoje nada na aplicação escreve no schema `sales`; a role somente leitura é a primeira camada de segurança. O cadastro cria o primeiro caminho de escrita.
- **Status:** DECIDIDA
- **Escolha:**
  - **O que é cadastrado:** materiais (produtos), com CRUD completo, e movimentações de estoque.
  - **Movimentações:** só criar e listar. Correção é um novo lançamento de ajuste; não há edição nem exclusão.
  - **Role de escrita:** role nova no banco, com escrita apenas nas tabelas do cadastro e pool próprio. O chat continua usando só `app_readonly`; a IA nunca usa o pool de escrita.
  - **Quem pode cadastrar:** só administrador (coluna `role` em `app.users`). O primeiro administrador é definido por variável de ambiente com o e-mail.
  - **Excluir material:** arquiva (`active = false`); o histórico de pedidos e movimentações fica.
  - **Saldo de estoque:** calculado pelas movimentações, na mesma transação; só o estoque mínimo é editável.
  - **Cache:** cada escrita invalida o cache de resultados de consulta.
- **Data:** 2026-10-05
- **Motivo:** o que alimenta estoque, ruptura e giro são as movimentações; movimentação é registro de auditoria; o repositório é público e a demonstração será publicada, então escrita exige permissão própria.
- **Pontos de atenção:** `db:seed` apaga o que foi cadastrado; toda regra (SKU único, quantidade positiva, saída maior que o saldo) é validada no backend.
- **Ajustes registrados na 09e (2026-10-05):**
  - **Role:** chama-se `app_catalog_rw`, com senha na variável nova `DB_CATALOG_PASSWORD`. Além de escrever, ela **lê** as três tabelas em que escreve (`products`, `stock_levels`, `stock_movements`): `RETURNING`, `UPDATE ... WHERE` e `ON CONFLICT` exigem `SELECT`. Não lê pedidos, clientes, regiões, centros de distribuição nem nada de `app`, e não tem `DELETE` em nenhuma tabela.
  - **Administrador:** definido por comando de terminal, não por variável de ambiente (D-58).
  - **Categoria:** só as existentes (D-59).
  - **Material arquivado não aceita movimentação** de nenhum tipo; é preciso restaurá-lo antes. Restaurar é uma rota própria.
  - **Leituras do cadastro** usam o pool somente leitura, como o dashboard; o pool de escrita só escreve.
  - **O cliente recebe uma capacidade, não o papel:** `/auth/me` devolve `canManageCatalog`. A tela mostra ou esconde a aba com isso, e a API confere de novo em toda requisição.

### D-57 — Regras de cálculo do dashboard
- **Contexto:** o protótipo mostra números fixos; as regras abaixo definem como o backend os calcula. Foram escolhidas pelo Claude na implementação da 09c, dentro da D-40.
- **Status:** PROPOSTA — aplicada na 09c, aguardando revisão do Guilherme
- **Proposta aplicada:**
  - **Dia e período:** os dias são contados no fuso `America/Sao_Paulo`, qualquer que seja o fuso do servidor ou do navegador. "Mês", "Trimestre" e "Ano" vão do início do período até hoje. A comparação é sempre com o período imediatamente anterior, de mesma duração em dias.
  - **Faturamento e pedidos:** só pedidos com status diferente de `cancelled`, pela data do pedido. Ticket médio é faturamento dividido por pedidos.
  - **Estoque no passado:** o saldo de uma data é o saldo de hoje menos tudo o que movimentou depois dela. Valor em estoque é quantidade vezes custo, incluindo materiais arquivados.
  - **Giro (dias de cobertura):** valor em estoque no fim do período dividido pelo custo médio diário das saídas do período.
  - **Abaixo do mínimo:** materiais ativos com saldo menor que o estoque mínimo, no fim do período.
  - **Alertas de ruptura:** cobertura é o saldo dividido pela saída média diária dos últimos 30 dias. **Crítico:** abaixo do mínimo e cobertura de até 5 dias. **Atenção:** abaixo do mínimo nos demais casos (inclusive sem saída recente). **OK:** no mínimo ou acima dele, por menos de 20%.
  - **Entrega no prazo:** entre os pedidos entregues no período, os que chegaram até a data prevista. Meta pela D-55.
  - **Curva ABC:** materiais ativos ordenados pelo faturamento dos 12 meses que terminam no fim do período. Classe A: os que abrem os primeiros 80% do faturamento; classe B: os 15% seguintes; classe C: o resto, inclusive os sem venda.
  - **Tendência e cor:** variação menor que 0,05 é "estável". A cor da variação é decidida pelo backend: alta de faturamento, pedidos e entrega no prazo é boa; alta de dias de cobertura e de itens abaixo do mínimo é ruim; valor em estoque é neutro.
- **Data:** 2026-10-05
- **Motivo:** um único lugar para cada regra (`apps/api/src/dashboard/dashboard-rules.ts`), com testes de números conferidos à mão; o frontend só formata.
- **Ponto de atenção:** os limiares (5 dias, 20%, 80%/95%, 30 dias) são constantes no código, não configuração.

### D-58 — Como alguém se torna administrador do cadastro
- **Contexto:** a D-56 definia o primeiro administrador por variável de ambiente com o e-mail. Na implementação apareceu o problema: o cadastro de contas é aberto e o e-mail não é verificado, então em ambiente público quem se cadastrasse primeiro com aquele e-mail viraria administrador.
- **Opções:** comando de terminal | manter a variável `ADMIN_EMAIL` | os dois (variável só fora de produção)
- **Status:** DECIDIDA
- **Escolha:** comando de terminal `db:promote-admin <e-mail>`, que roda com a credencial de administrador do banco e promove uma conta que já existe. Não há variável `ADMIN_EMAIL`.
- **Data:** 2026-10-05
- **Motivo:** ninguém vira administrador só por se cadastrar; nada na API consegue conceder o papel.
- **Substitui:** o trecho da D-56 "o primeiro administrador é definido por variável de ambiente com o e-mail".
- **Custo aceito:** um passo manual depois de criar a conta. Não há comando para rebaixar; isso se faz direto no banco.

### D-59 — Categoria de um material novo
- **Opções:** só as categorias que já existem | texto livre
- **Status:** DECIDIDA
- **Escolha:** só as categorias existentes. O formulário oferece a lista e a API recusa qualquer outra (`400`, campo `category`).
- **Data:** 2026-10-05
- **Motivo:** o dashboard tem uma cor por categoria e cinco cores; uma sexta categoria repetiria a cor da primeira.
- **Custo aceito:** criar uma categoria nova exige mudança no código (e nas cores) depois.
