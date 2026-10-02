# Relatório — Fase 01: Banco de demonstração e usuário read-only

**Branch:** `feature/fase-01-banco-demo`  **Data:** 2026-10-02

## 1. O que foi feito
- **Migrations em SQL puro** (`apps/api/db/migrations`), com `up` e `down`:
  - `1790899200000_create-roles-and-schemas.sql`: roles `app_readonly` e `app_rw`, schemas `sales` e `app`, revogação dos privilégios de `PUBLIC`, padrões de sessão da role read-only.
  - `1790899200001_create-sales-tables.sql`: `regions`, `products`, `customers`, `orders`, `order_items`, índices e `GRANT SELECT` tabela por tabela para `app_readonly`.
- **Seed** (`apps/api/db/seed.sql`): 5 regiões, 40 produtos, 500 clientes, 20.000 pedidos em 24 meses, de 1 a 4 itens por pedido. Idempotente e com datas relativas a `now()`.
- **Código** (`apps/api/src/database`):
  - `migrate.ts` — executa as migrations pelo `node-pg-migrate`; histórico no schema `migrations`.
  - `provision-roles.ts` — define as senhas das roles a partir de variáveis de ambiente.
  - `seed.ts`, `database-env.ts` (validação das variáveis `DB_*`), `roles.ts`, `cli.ts`.
- **Scripts:** `db:setup`, `db:migrate`, `db:migrate:down`, `db:provision`, `db:seed`.
- **`.env.example` e `docker-compose.yml`:** variáveis renomeadas de `POSTGRES_*` para `DB_*`, usadas tanto pelo compose quanto pela API.
- **Testes:** 36 de integração e 9 unitários novos (validação das variáveis `DB_*`) (detalhe em §3). O teste de fumaça `test/postgres.integration.test.ts` da Fase 00 foi removido: a checagem de versão do PostgreSQL passou para `migrations.integration.test.ts`.
- **Documentação:** D-20 e exceção da D-12 em `DECISOES.md`; seção "Banco de dados" e comandos `db:*` no `README.md`; Fase 01 marcada `CONCLUÍDA` no `PLANO.md` (vale com o merge).

## 2. Por que foi feito assim
- **D-05:** schema próprio de vendas com seed gerado. **D-19:** driver `pg` + `node-pg-migrate` com SQL puro. **D-20:** schemas separados no mesmo banco. **D-18:** PostgreSQL 17.
- **A fronteira real são os privilégios, não os padrões da role.** `default_transaction_read_only` e `statement_timeout` definidos com `ALTER ROLE ... SET` são apenas valores iniciais da sessão; qualquer sessão os sobrescreve com `SET`. Por isso:
  - `REVOKE ALL ON DATABASE ... FROM PUBLIC` e `REVOKE ALL ON SCHEMA public FROM PUBLIC`. Sem isso, `CREATE TEMP TABLE` funcionaria para `app_readonly` assim que a sessão desligasse o modo read-only.
  - `SELECT` concedido tabela por tabela. Não há `ALTER DEFAULT PRIVILEGES` para `app_readonly`: uma tabela nova nunca fica exposta por acidente (regra 4 de segurança).
  - O histórico de migrations fica em schema próprio, fora do alcance da role.
- **Senhas fora das migrations.** As roles nascem com `LOGIN` e sem senha; `db:provision` aplica as senhas vindas do ambiente. Regra "nunca valores sensíveis no código".
- **Seed é script, não migration.** Migration aplicada é imutável; as datas relativas a "agora" ficariam congeladas no dia da primeira execução.

Detalhes escolhidos sem pergunta:
- **`statement_timeout` de 5s** na role read-only.
- **`search_path`** de `app_readonly` fixado em `sales`, para a IA poder escrever `FROM orders` sem qualificar.
- **Nomes de roles fixos no código** (`app_readonly`, `app_rw`); só as senhas vêm do ambiente, porque as migrations concedem privilégios pelo nome.
- **`app_rw` não pode criar tabelas** em `app`: a estrutura muda só por migration (usuário administrador). Recebe DML nas tabelas futuras via `ALTER DEFAULT PRIVILEGES`.
- **`order_items.unit_price`** guarda o preço no momento do pedido, separado de `products.price`.
- **Chaves `bigint` com `GENERATED ALWAYS AS IDENTITY`**, datas em `timestamptz`, tabelas em `snake_case` plural (padrões do template).
- **Volumes do seed fixos no SQL** e distribuição determinística (`setseed`).
- **Variáveis `DB_HOST`, `DB_PORT`, `DB_NAME`** seguem os nomes do template; `DB_ADMIN_*`, `DB_READONLY_PASSWORD` e `DB_APP_PASSWORD` são novas.

## 3. Verificação
Executado com `pnpm verify` em Windows 11, Node 24.15, pnpm 12.8.1, Docker 29.1.2.

| Etapa | Resultado | Observação |
|---|---|---|
| Lint | ✅ | ESLint sem erros; Prettier sem diferenças |
| Typecheck | ✅ | `shared`, `api`, `web` |
| Testes unitários | ✅ | 20 passaram / 20 total (API 19, web 1) |
| Testes de integração | ✅ | 36 passaram / 36 total |
| Build | ✅ | `shared`, `api`, `web` |

O que os testes de integração provam (PostgreSQL 17 real, via Testcontainers):
- **Critério do `PLANO.md` — DDL/DML falham.** `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `DROP TABLE`, `ALTER TABLE`, `CREATE TABLE` (em `sales` e em `public`), `CREATE TEMP TABLE`, `CREATE SCHEMA` e `CREATE ROLE` são negados com erro `42501` (privilégio insuficiente) **depois de a sessão executar `SET default_transaction_read_only = off`**. Ou seja: falham por privilégio, não pelo padrão de sessão.
- **Padrão read-only ativo:** sem mexer na sessão, `INSERT` falha com `25006` (transação somente leitura).
- **Critério do `PLANO.md` — query longa cancelada.** `SELECT pg_sleep(30)` é cancelado com `57014` entre 5s e 8s.
- **Isolamento:** `app_readonly` recebe `42501` ao ler `app.secrets` e `migrations.pgmigrations`; `app_rw` recebe `42501` ao ler `sales` e ao criar tabela em `app`.
- **Leitura:** `app_readonly` lê as cinco tabelas de `sales`, inclusive sem qualificar o schema.
- **Migrations:** aplicam, são no-op na segunda vez, desfazem tudo (`down`) e reaplicam; uma role sem senha provisionada não autentica (`28P01`).
- **Seed:** volumes esperados, todo pedido tem item, as 5 regiões têm pedidos no último trimestre, 24+ meses distintos, mesma contagem ao rodar duas vezes.

Verificações adicionais:
- **Teste com dente:** removendo os `REVOKE ... FROM PUBLIC` da migration, o teste `denies CREATE TEMP TABLE` falha; restaurado, passa.
- **Fluxo real pelo `docker compose`** (porta alternativa 5455): `db:setup` aplicou migrations, senhas e seed; conectado como `app_readonly`, "faturamento por região no último trimestre" retornou 5 linhas e `INSERT` foi recusado. Segunda execução de `db:setup`: `No migrations to run!`. Com `DB_READONLY_PASSWORD` vazio, o comando recusa iniciar (`InvalidEnvError`). Container e volume de teste removidos ao final.

## 4. Erros e problemas encontrados
- **Porta 5432 ocupada na máquina** por outro serviço. Não é erro do projeto; validação manual feita na porta 5455 e orientação adicionada ao README.
- Nenhum outro.

## 5. Decisões que preciso que você tome
1. **Push e abertura do PR da Fase 01.** Nada foi enviado.
2. **Bloquear funções de large object no banco?** Verifiquei que `app_readonly` consegue executar `SELECT lo_create(0)` depois de desligar o read-only da sessão: cria um large object, ou seja, grava no banco sem ter privilégio em nenhuma tabela.
   - **Opção A (recomendada):** nova migration com `REVOKE EXECUTE` das funções `lo_*` de `PUBLIC`, mais teste. Fecha a brecha na camada do banco. Custo: nenhuma role comum usa large objects neste banco (o projeto não usa).
   - **Opção B:** deixar para a guarda SQL (Fase 03), que já prevê bloquear `lo_*`. Custo: até lá, e se a guarda falhar, a brecha existe.
   - Posso incluir a opção A neste mesmo PR ou em um PR separado.
3. **D-03 não bloqueia a Fase 02**, que não depende de decisão pendente. Só registro que D-03 (provedor de LLM) será necessária na Fase 04.

## 6. Dívida técnica / pontos de atenção
- **A role sozinha não torna o banco "somente leitura".** Uma sessão consegue: desligar `default_transaction_read_only`; zerar o `statement_timeout` (`SET` ou `set_config`); criar large objects (item 2 acima). Tabelas e estrutura continuam protegidas por privilégio. É exatamente por isso que a Fase 02 adiciona timeout na aplicação e a Fase 03 a guarda SQL (um único `SELECT`, sem `SET`, sem funções perigosas).
- **Catálogo do Postgres visível.** `app_readonly` lê `pg_class` e `pg_roles`: enxerga nomes de tabelas de `app` e nomes de roles, não dados nem hashes de senha (`pg_authid` é negado). Consequência conhecida da D-20; a allowlist de tabelas da Fase 03 cobre.
- **Funções executáveis por `PUBLIC`** (`pg_sleep` e outras) continuam disponíveis; bloqueio previsto na guarda SQL.
- **`db:provision` envia a senha em um `ALTER ROLE`**; se o servidor registrar statements em log (`log_statement`), a senha aparece no log do banco. Padrão do Postgres local não registra. Rever no deploy (Fase 09).
- **`DROP ROLE` no `down`** falha se a role tiver privilégios em outro banco do mesmo cluster. Só afeta quem compartilhar o cluster entre bancos.
- **Health check ainda não consulta o banco**; a conexão da API com o Postgres entra na Fase 02.
- **Dívidas herdadas da Fase 00** continuam: TypeScript 6.0, injeção por tipo no Vitest ainda não exercitada, `dev` da API sem watch.

## 7. Próximo passo proposto
- Após sua aprovação: push, PR, CI verde, merge.
- **Fase 02 — Executor de queries seguro:** pool usando só `app_readonly`, timeout na aplicação, limite de linhas, erros do Postgres traduzidos. Sem decisão pendente no `DECISOES.md`.
