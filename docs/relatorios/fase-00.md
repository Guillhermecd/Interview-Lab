# Relatório — Fase 00: Fundação do repositório e CI

**Branch:** `feature/fase-00-fundacao`  **Data:** 2026-10-02

## 1. O que foi feito
- **Monorepo pnpm** (`pnpm-workspace.yaml`, `package.json` raiz) com `apps/api`, `apps/web` e `packages/shared`.
- **`packages/shared`:** tipo `HealthResponse` e constante `HEALTH_STATUS_OK`, consumidos pela API.
- **`apps/api`:** NestJS 12 + adapter Fastify, ESM. `GET /api/health`, validação de `PORT` na inicialização (`src/config/env.ts`).
- **`apps/web`:** React 19 + Vite 8, página estática, proxy de `/api` para a API em dev.
- **Qualidade:** TypeScript `strict` (`tsconfig.base.json`), ESLint com `strictTypeChecked` do typescript-eslint, Prettier.
- **Testes (Vitest):**
  - API, unitários: health check via HTTP injetado, validação de env, teste de fumaça do `libpg-query` (D-04).
  - API, integração: Testcontainers sobe `postgres:17-alpine` e confere a versão do servidor.
  - Web: renderização do componente `App`.
- **`docker-compose.yml`** com PostgreSQL 17 e `.env.example`.
- **CI** (`.github/workflows/ci.yml`): lint → typecheck → testes unitários → testes de integração → build, em PRs e em push na `main`.
- **Documentação:** seção "Como rodar" no `README.md`; decisões D-04, D-10, D-16, D-17, D-18 em `DECISOES.md`; Fase 00 marcada `CONCLUÍDA` no `PLANO.md` (passa a valer com o merge).
- **Alteração na pasta protegida `template/`:** comandos de verificação registrados em `template/RECOMENDACOES.md`, porque o próprio arquivo determina que sejam registrados ali na Fase 00. Reverto se você preferir outro lugar.
- `.github/pull_request_template.md` já existia desde o commit inicial.

## 2. Por que foi feito assim
- **D-01:** NestJS com adapter Fastify. **D-02:** pnpm workspaces. **D-09:** Vitest + Testcontainers. **D-16:** ESLint + Prettier. **D-17:** Node 24. **D-18:** PostgreSQL 17. **D-13:** stack do `PLANO.md`; do template foram aplicados nomenclatura, constantes nomeadas, validação de env e `GET /api/health` respondendo `{ "status": "ok" }`.
- **D-04:** `libpg-query` 18 é distribuído como WASM, sem compilação nativa. O teste de fumaça prova que carrega, gera AST, enxerga múltiplos statements e rejeita SQL inválido.

Detalhes escolhidos sem pergunta:
- **TypeScript fixado em `~6.0`.** A versão mais recente é 7.0, mas o typescript-eslint 8.71 só aceita `<6.1`. Sem isso o lint type-aware (D-16) rodaria em combinação não suportada.
- **`@types/node` fixado em `^24`** para bater com o Node 24 (D-17).
- **Porta padrão da API: 3000**, não 1337 do template (D-13).
- **Validação de env escrita à mão**, sem biblioteca. Só existe `PORT`; escolher biblioteca de validação seria uma decisão sua (ver §5).
- **Teste de integração usa `psql` dentro do container**, porque o driver de banco só é escolhido na Fase 02.
- **Teste do web usa `react-dom/server`**, porque a biblioteca de teste de componentes só é necessária na Fase 06.
- **`packages/shared` é compilado para `dist/`**; os scripts `lint`, `typecheck` e `test` da raiz o compilam antes de rodar, pois API e lint dependem dos tipos gerados.
- **Vitest sem plugin SWC.** Os decorators do NestJS funcionaram com o transformador padrão do Vitest 5. Nenhum provider com injeção por tipo existe ainda (ver §6).
- **Scripts de build de `cpu-features`, `protobufjs` e `ssh2` bloqueados** em `pnpm-workspace.yaml`: dependências nativas opcionais do Testcontainers, não usadas.
- **Ações do CI** nas versões principais atuais (`checkout@v7`, `setup-node@v7`, `pnpm/action-setup@v6`); versão do pnpm vem do campo `packageManager`.

## 3. Verificação
Executado com `pnpm verify` em Windows 11, Node 24.15, pnpm 12.8.1, Docker 29.1.2.

| Etapa | Resultado | Observação |
|---|---|---|
| Lint | ✅ | ESLint sem erros; Prettier sem diferenças |
| Typecheck | ✅ | `shared`, `api`, `web` |
| Testes unitários | ✅ | 11 passaram / 11 total (API 10, web 1) |
| Testes de integração | ✅ | 1 passou / 1 total (PostgreSQL 17 em container) |
| Build | ✅ | `shared`, `api` (`tsc`), `web` (`vite build`) |

Verificações adicionais:
- **Teste quebrado de propósito (local):** asserção do health check alterada para `'broken'` → `pnpm test` falhou com `1 failed | 9 passed`; restaurada → verde.
- **API compilada em execução:** `node apps/api/dist/main.js` respondeu `200 {"status":"ok"}` em `/api/health`; com `PORT=abc` recusou iniciar com `InvalidEnvError`.
- **`docker compose config`:** válido.
- **Clone limpo (simulação do CI):** `git clone` da branch, `pnpm install --frozen-lockfile` e `pnpm verify` passaram por completo.

**Não verificado:** o workflow do GitHub Actions ainda não rodou — exige push e PR. O critério do `PLANO.md` ("CI roda e falha de propósito com um teste quebrado; passa ao corrigir") só foi demonstrado localmente.

## 4. Erros e problemas encontrados
- **`corepack enable` falhou** com `EPERM` em `C:\Program Files\nodejs`. Contornado com `npm install -g pnpm` (registrado em D-17).
- **pnpm instalado sem binário:** o npm 12 bloqueou o script de instalação do pnpm. Resolvido com `npm install -g --allow-scripts=pnpm pnpm`.
- **Conflito de peer dependency** TypeScript 7.0 × typescript-eslint. Resolvido fixando TypeScript `~6.0`.
- **Lint falhava em clone limpo** (`no-unsafe-assignment`), porque os tipos de `packages/shared` não existiam antes do build. Resolvido compilando `shared` no início do script `lint`.

## 5. Decisões que preciso que você tome
1. **Push e abertura do PR da Fase 00.** Nada foi enviado. Recomendo autorizar: só assim o CI roda.
2. **Demonstração de falha no CI.** Opções: (a) commit com teste quebrado seguido de commit de correção no mesmo PR — deixa a prova no histórico do PR, e o squash merge limpa a `main`; (b) aceitar a demonstração local. Recomendo (a).
3. **Branch protection na `main`** exigindo o check `Lint, typecheck, test and build` — ação manual sua, depois da primeira execução do CI.
4. **D-05 (dataset de demonstração)** — necessária para a Fase 01. Recomendação do `DECISOES.md`: schema próprio de vendas com seed gerado.
5. **Driver de banco e ferramenta de migrations** — a Fase 01 exige os dois e não há decisão registrada. O driver já é necessário na Fase 01: os testes precisam conectar como `app_readonly` para provar que `INSERT`/`DROP` falham e que `pg_sleep` é cancelado. Opções a detalhar: driver `pg` + SQL puro versionado com runner simples (ex.: `node-pg-migrate`), ou ORM/query builder com migrations próprias (Drizzle, Prisma, Kysely).

## 6. Dívida técnica / pontos de atenção
- **TypeScript 6.0 em vez de 7.0.** Atualizar quando o typescript-eslint suportar. Risco baixo.
- **Injeção por tipo no Vitest não testada.** Quando surgir o primeiro provider injetado pelo construtor, pode ser necessário `unplugin-swc` para `emitDecoratorMetadata`. Risco: teste falhar na Fase 02; correção conhecida.
- **`pnpm --filter @interview-lab/api dev` não tem watch** (compila e inicia). Recarregamento automático fica para quando houver desenvolvimento ativo na API.
- **Health check não consulta o banco.** O contrato do template pede "aplicação e banco disponíveis"; o banco entra na Fase 02.
- **Formato padrão de erro da API** (`code`, `message`, `details`) ainda não implementado; entra com o primeiro endpoint que retorna erro (Fase 02).
- **Kit de UI do frontend** (o template usa Ant Design) não decidido; necessário na Fase 06.
- **Clone novo não tem os documentos internos de `template/`** (D-15).

## 7. Próximo passo proposto
- Após sua aprovação: push, PR, CI verde, merge feito por você.
- Em seguida, **Fase 01 — Banco de demonstração e usuário read-only**, que exige D-05 e a decisão sobre migrations (§5, itens 4 e 5).
