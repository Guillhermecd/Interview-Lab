# Fase 10 — Hardening, deploy, avaliação e apresentação

> A antiga Fase 10 ("Observabilidade, hardening, deploy e README") foi dividida em seis
> sub-fases, **numeradas na ordem de execução**. Cada sub-fase é uma branch
> `feature/fase-10x-nome`, um PR e um relatório em `docs/relatorios/`.
>
> **Congelamento:** qualquer feature nova fica suspensa até a 10c (deploy) estar concluída.
> Ver D-64. As Fases 09d (chat suspenso) e 09f (ocultar valores) foram concluídas antes do
> congelamento e não são afetadas.

| Sub-fase | Nome | Depende de | Status |
|---|---|---|---|
| 10a | Limites de recurso no executor | — | Concluída |
| 10b | Ajustes de segurança | — | Pendente |
| 10c | Deploy e demo pública | 10a, 10b | Pendente |
| 10d | Avaliação automatizada da LLM | — | Pendente |
| 10e | Observabilidade | 10c | Pendente |
| 10f | README e apresentação | 10c, 10d, 10e | Pendente |

Os números de decisão abaixo (D-64 a D-73) já estão ajustados ao `DECISOES.md`, que ia até
a D-63 quando este plano entrou. Cada decisão é registrada lá no início da sub-fase em que
se aplica; as tomadas na preparação (2026-10-07) estão na D-64.

---

## 10a — Limites de recurso no executor

**Branch:** `feature/fase-10a-limites-recurso`

**Objetivo:** garantir que o SQL aprovado pela guarda não consiga esgotar o banco: o
`LIMIT` restringe as linhas devolvidas, não o trabalho feito para produzi-las.

### Entregas

1. **Tamanho próprio para o pool de `app_readonly`** (`READONLY_POOL_MAX`, padrão 5). O
   pool dedicado já existia desde a Fase 02 (`query/readonly-pool.ts`), separado do pool da
   aplicação (`app_rw`) e do pool do cadastro, mas os três liam o mesmo tamanho. Saturar o
   pool somente leitura não afeta login, histórico nem `/api/health`.
   - **Decidido no início da 10a (D-65):** as leituras fixas do código — dashboard,
     cadastro, `/api/schema` e `/api/health` — ganham um segundo pool, também como
     `app_readonly` (`FIXED_READ_POOL_MAX`, padrão 5). O chat saturado não as afeta.
2. **Limite de execuções simultâneas por usuário** (`EXEC_MAX_INFLIGHT_PER_USER`, padrão 1),
   controlado no Redis com `INCR`/`DECR` e um TTL de segurança, liberado em `finally`
   (sucesso, erro, timeout e cancelamento pelo cliente). Acima do limite: `429` com
   `code: "EXECUTION_IN_PROGRESS"`, antes de qualquer chamada à LLM.
3. **Verificação de custo estimado:** depois da guarda e antes de executar, o backend roda
   `EXPLAIN (FORMAT JSON)` (sem `ANALYZE`) como `app_readonly`.
   - Recusa quando `Total Cost` > `QUERY_MAX_COST`.
   - Recusa quando o plano tiver `Nested Loop` sem condição de junção (produto cartesiano)
     estimado em mais de 1 milhão de linhas. O piso existe porque cruzamentos pequenos são
     legítimos (toda região contra todo mês); a busca por índice no lado interno conta como
     condição de junção.
   - A recusa é `422 QUERY_REJECTED`, com um motivo legível em `details`, e entra no ciclo
     de nova tentativa da LLM.
   - O `EXPLAIN` continua proibido para o usuário na guarda: só o backend o executa.
4. **Revisão da allowlist de funções:** `generate_series`, a única função que gera linhas
   ainda permitida, **fica** (decidido no início da 10a, D-65): ela serve para calendários,
   e o abuso — duas séries grandes cruzadas — passa a ser recusado pela verificação de
   custo. `repeat`, `lpad`, `rpad` e `format` já estão fora desde a Fase 03.
5. **Calibração do `QUERY_MAX_COST`:** documentada no relatório da fase, com o custo
   máximo observado nas perguntas de avaliação × 10.

### Verificação

- [x] Integração: um `CROSS JOIN` entre `orders` e `order_items` é recusado sem chegar a
      executar — como produto cartesiano, com ou sem agregação; uma junção com condição que
      multiplica as linhas é recusada por custo.
- [x] Integração: duas requisições simultâneas do mesmo usuário → a segunda recebe `429
      EXECUTION_IN_PROGRESS`; usuários diferentes não se bloqueiam.
- [x] Integração: o contador de execuções volta a 0 depois de erro, timeout e cliente
      desconectado.
- [x] Integração: com o pool do readonly ocupado por queries lentas, `/api/health`,
      `/api/auth/me`, `/api/schema` e o dashboard respondem normalmente.
- [x] Integração: duas `generate_series` de 100 mil cruzadas são recusadas sem executar
      (substitui "as funções removidas da allowlist são recusadas": nenhuma foi removida).
- [x] As 10 perguntas do `eval:llm` executam sem recusa por custo (maior custo: 16.639,
      contra o limite de 170.000).
- [x] `pnpm verify` verde.

### Decisões

- **D-65:** custo estimado via `EXPLAIN` como heurística complementar; o timeout continua
  sendo a rede de segurança (o estimador pode errar nos dois sentidos). Inclui o segundo
  pool para as leituras fixas e a permanência de `generate_series`.
- **D-66:** limite de concorrência por usuário no Redis (e não em memória), para funcionar
  com mais de uma instância da API.

---

## 10b — Ajustes de segurança

**Branch:** `feature/fase-10b-ajustes-seguranca`

**Objetivo:** fechar as lacunas conhecidas antes de expor a aplicação publicamente.

### Entregas

1. **Permissão por coluna para `app_readonly`:**
   - `sales.customers` hoje só tem `id`, `name`, `region_id` e `created_at`. Uma migration
     acrescenta `email` e `phone`, e o seed passa a preenchê-las.
   - Outra migration substitui o `GRANT SELECT` de tabela inteira em `sales.customers` por
     colunas explícitas, deixando `email` e `phone` de fora.
   - O dashboard e o cadastro não leem essas colunas e não mudam.
2. **Schema exposto limitado às colunas concedidas:** `/api/schema` e o prompt da LLM já
   leem o catálogo do banco (`query/schema-catalog.service.ts`); passam a listar apenas as
   colunas que `app_readonly` pode ler, pelo privilégio de coluna (nada de lista fixa no
   código).
3. **Erro de permissão vira recusa:** `permission denied` (SQLSTATE `42501`) é convertido em
   `422 QUERY_REJECTED`, com um motivo que a LLM consegue usar na nova tentativa (por
   exemplo, "use colunas explícitas em vez de `SELECT *`").
4. **Rate limit de login por IP**, além do limite por e-mail que já existe
   (`LOGIN_ATTEMPTS_PER_MINUTE`, padrão 5, janela fixa de 1 minuto — D-37). Variáveis novas:
   `LOGIN_IP_MAX_ATTEMPTS` (padrão 20) e `LOGIN_IP_WINDOW_SECONDS` (padrão 900).
5. **`trustProxy` do Fastify** configurado por variável (`TRUST_PROXY`), para que o IP real
   chegue atrás do Nginx.
6. **Escopo de dados na chave do cache:** as chaves passam a incluir um segmento de escopo
   (hoje sempre `global`), mantendo o formato atual: `cache:sql:{schema}:...` vira
   `cache:sql:{schema}:scope:global:...`, e o mesmo para `cache:result`.

### Verificação

- [ ] Integração: com `app_readonly`, `SELECT * FROM sales.customers` e
      `SELECT email FROM sales.customers` falham; `SELECT id, name FROM sales.customers`
      funciona.
- [ ] Integração: `/api/schema` não lista as colunas não concedidas.
- [ ] Integração: o erro `42501` chega como `422 QUERY_REJECTED`, com motivo.
- [ ] Integração: N+1 logins errados vindos do mesmo IP, com e-mails diferentes → `429`.
- [ ] Unitário: com `TRUST_PROXY` ligado, o IP vem de `X-Forwarded-For`; desligado, vem do
      socket.
- [ ] Unitário: as chaves de cache contêm o segmento de escopo.
- [ ] `pnpm verify` verde.

### Decisões

- **D-67:** permissão por coluna no banco como fronteira, e não filtro na guarda.
- **D-68:** cache com escopo `global` enquanto todos os usuários enxergam os mesmos dados;
  se entrar filtro por usuário ou RLS, o escopo passa a ser o usuário.

---

## 10c — Deploy e demo pública

**Branch:** `feature/fase-10c-deploy`

**Objetivo:** ter uma demo pública, segura e com custo controlado, que qualquer pessoa
consiga usar sem instalar nada.

### Entregas

1. **Imagens Docker de produção** da API (multi-stage, usuário não-root) e do web (build
   estático servido pelo Nginx).
2. **`docker-compose.prod.yml`** com api, web/nginx, Postgres 17 e Redis. Postgres e Redis
   sem portas expostas para fora da rede interna.
3. **Instância no AWS Lightsail**, com HTTPS (Certbot, renovação automática) e subdomínio
   próprio.
4. **CI/CD no GitHub Actions:** `pnpm verify` → build e push das imagens → deploy por SSH →
   `db:migrate` → smoke test em `/api/health`. Os segredos ficam só nos GitHub Secrets.
5. **Configuração de produção:** cookie `Secure`, `ALLOWED_ORIGINS` só com o domínio da demo,
   `INTERNAL_QUERY_ENDPOINT_ENABLED=false`, `TRUST_PROXY` ligado.
6. **Conta de visitante:**
   - Um botão "Entrar como visitante" cria um usuário temporário.
   - Cotas próprias para visitantes (`DEMO_QUESTIONS_PER_MINUTE`, padrão 3;
     `DEMO_DAILY_TOKENS`, padrão 20 000).
   - Modo revisão ligado por padrão.
   - Visitante nunca é administrador: `/cadastro` fica inacessível.
7. **Proteção de custo:**
   - Cota global diária de tokens no Redis (`GLOBAL_DAILY_TOKEN_BUDGET`). Quando estoura,
     o chat responde `503` com uma mensagem amigável e o dashboard continua funcionando.
   - **Provedor:** a demo usa a camada gratuita do Gemini (decisão de 2026-10-07, D-64).
     Não há limite de gasto a configurar; o que limita é a cota de requisições do
     provedor, registrada no relatório da fase.
   - **Aviso visível** na tela de entrada e no chat: as perguntas são enviadas ao Google,
     que na camada gratuita as usa para melhorar seus produtos (ponto de atenção da D-03).
   - Quando o provedor recusar por cota (`429`), o chat mostra a mesma mensagem amigável
     da cota global.
8. **Reset diário** (cron): `db:seed` e remoção de visitantes com mais de 24 horas, com suas
   conversas e o consumo registrado.
9. **Backup** do schema `app` (contas reais), ou registro explícito de que a demo não guarda
   dados que precisem de backup.

### Ações manuais do Guilherme

O Claude não cria contas nem altera configurações da AWS, do DNS ou do GitHub:

- conta AWS e instância Lightsail criadas, com IP fixo;
- subdomínio apontando para a instância;
- chave SSH de deploy gerada, com a parte pública na instância;
- GitHub Secrets preenchidos (chave SSH, host, senhas do banco, segredo do JWT, chave do
  Gemini).

### Verificação

- [ ] Um push na `main` com o CI verde faz o deploy sem passo manual.
- [ ] `https://<subdomínio>/api/health` responde `200`; HTTP redireciona para HTTPS.
- [ ] Postgres e Redis não respondem a partir de fora da instância (testado com `nc`).
- [ ] Um visitante consegue perguntar, revisar, editar e executar; não acessa `/cadastro`
      (`403`).
- [ ] Ao passar da cota do visitante → `429`; ao passar da cota global → `503` no chat e o
      dashboard funciona.
- [ ] `/api/internal/queries/execute` responde `404` em produção.
- [ ] Depois do reset, os visitantes antigos somem e os dados de demonstração voltam ao
      estado do seed.
- [ ] O cookie de sessão sai com `Secure`, `HttpOnly` e `SameSite=Strict` (conferido no
      navegador).
- [ ] O aviso sobre o envio das perguntas ao Google aparece para o visitante antes da
      primeira pergunta.

### Decisões

- **D-69:** Lightsail com `docker compose` (Postgres no mesmo host) em vez de banco
  gerenciado — custo e simplicidade numa demo, com os limites registrados. Fecha a D-11.
- **D-70:** modelo de visitante (contas temporárias, cotas próprias, reset diário).

---

## 10d — Avaliação automatizada da LLM

**Branch:** `feature/fase-10d-eval`

**Objetivo:** medir a qualidade do texto → SQL com um número reproduzível, e detectar
regressão quando o prompt, o modelo ou o schema mudar.

### Entregas

1. **`apps/api/eval/golden.json`** com pelo menos 25 casos: `id`, `question`,
   `referenceSql`, `orderMatters`, `followUpOf` (opcional) e `expect` (`"result"` ou
   `"rejected"`).
   - Cobertura mínima: agregação, JOINs, filtro de período, ranking/top N, estoque,
     perguntas de continuação e pelo menos 3 perguntas que devem ser recusadas (escrita,
     tabela fora da allowlist, função proibida).
2. **`eval:run`**, que para cada caso:
   - executa o `referenceSql` como `app_readonly` e guarda o resultado esperado;
   - faz a pergunta pelo `AskService` real;
   - compara os **resultados**, não o texto do SQL, depois de normalizar: números
     arredondados a 2 casas, nomes de coluna ignorados, ordem ignorada quando
     `orderMatters: false`.
3. **Relatório `eval-report.md`** com: acerto na 1ª tentativa, acerto final, recusas
   corretas, falhas (pergunta, SQL gerado, diferença), tokens e latência (p50/p95).
4. **Workflow `eval.yml`** com `workflow_dispatch` (manual, porque gasta tokens), que
   publica o relatório como artefato do Actions.
5. **Teste unitário do comparador** de resultados (casos de ordem, arredondamento e
   colunas renomeadas).

### Verificação

- [ ] `pnpm --filter @interview-lab/api eval:run` gera o `eval-report.md` localmente.
- [ ] Todos os `referenceSql` passam pela guarda e executam (um teste garante isso sem
      chamar a LLM).
- [ ] O comparador tem testes unitários e entra no `pnpm test`.
- [ ] O workflow roda manualmente e publica o artefato.
- [ ] O relatório da fase registra a primeira medição (modelo, data, acerto).

### Decisões

- **D-71:** *execution accuracy* (comparar resultados) em vez de comparar o texto do SQL.
- **D-72:** o eval fica fora do CI obrigatório por custo; roda manualmente antes de mudar
  prompt ou modelo.

---

## 10e — Observabilidade

**Branch:** `feature/fase-10e-observabilidade`

**Objetivo:** saber, com dados, quanto tempo e quanto custa cada pergunta e onde ela falha.

### Entregas

1. **Tabela `app.query_runs`** (migration), sem nenhuma linha de resultado, com:
   `user_id`, `conversation_id`, `message_id`, `llm_ms`, `db_ms`, `total_ms`, `attempts`,
   `guard_rejected`, `rejection_reason`, `cost_estimate`, `cache_hit_sql`,
   `cache_hit_result`, `tokens_in`, `tokens_out`, `status` e `created_at`.
2. **Logs estruturados (`pino`)** com um `requestId` propagado da requisição até a execução
   da query. Redact de `authorization`, `cookie`, `set-cookie` e de qualquer chave de API.
3. **`GET /api/admin/metrics`** (só administrador): p50/p95 de latência total, da LLM e do
   banco; taxa de recusa da guarda; acerto na 2ª tentativa; hit rate do cache; tokens por
   dia. Período configurável.
4. **Card de métricas** no dashboard, visível só para administradores.
5. **Retenção:** `query_runs` com mais de 90 dias é apagada pelo cron do reset.

### Verificação

- [ ] Integração: uma pergunta gera exatamente uma linha em `query_runs`, com os tempos
      preenchidos.
- [ ] Integração: pergunta recusada, servida do cache e cancelada pelo cliente são
      registradas com o `status` correto.
- [ ] Teste: os logs de uma requisição autenticada não contêm o JWT nem a chave da LLM.
- [ ] Teste: `query_runs` não tem nenhuma coluna com linhas de resultado (asserção sobre o
      schema).
- [ ] `/api/admin/metrics` responde `403` para quem não é administrador.
- [ ] `pnpm verify` verde.

### Decisões

- **D-73:** métricas numa tabela própria em vez de OpenTelemetry e uma stack externa —
  suficiente para o volume da demo e sem infraestrutura extra.

---

## 10f — README e apresentação

**Branch:** `feature/fase-10f-readme`

**Objetivo:** fazer quem chega ao repositório entender o projeto em 30 segundos.

### Entregas

1. **Topo do README:**
   - título e uma frase de descrição;
   - link da demo;
   - GIF de 20 a 30 segundos (pergunta → revisão do SQL → gráfico);
   - diagrama do fluxo em Mermaid;
   - tabela das 3 camadas de segurança;
   - números do eval e de latência.
2. **Seção "Limitações conhecidas":** custo estimado é heurística, cache com escopo global,
   dados de demonstração, LLM pode errar a explicação (a tabela é a fonte da verdade), a
   demo usa a camada gratuita do Gemini (perguntas enviadas ao Google; pode parar por cota).
3. **Referência movida para `docs/`:** `docs/api.md` (rotas e eventos SSE),
   `docs/guarda-sql.md`, `docs/banco.md` (schemas, roles, comandos `db:*`) e
   `docs/memoria.md`. O README fica só com os links.
4. **Roadmap reorganizado:** as fases de design agrupadas como "09 — Design (a–f)", em
   ordem cronológica, todas concluídas.
5. **README em inglês** (`README.en.md`) — opcional.

### Verificação

- [ ] O README principal tem no máximo cerca de 150 linhas.
- [ ] Todos os links internos funcionam (checagem automática no CI, por exemplo com
      `lychee` ou `markdown-link-check`).
- [ ] O GIF carrega no GitHub e tem menos de 5 MB.
- [ ] O diagrama Mermaid renderiza no GitHub.
- [ ] Os números do README batem com o último `eval-report.md` e com `/api/admin/metrics`.

---

## Decisão de escopo

- **D-64:** congelamento de features novas até a 10c estar concluída, para priorizar a demo
  pública sobre novas telas. A 09d e a 09f, concluídas antes, não entram no congelamento.

## Novas variáveis de ambiente

| Variável | Sub-fase | Padrão |
|---|---|---|
| `READONLY_POOL_MAX` | 10a | `5` |
| `FIXED_READ_POOL_MAX` | 10a | `5` |
| `EXEC_MAX_INFLIGHT_PER_USER` | 10a | `1` |
| `QUERY_MAX_COST` | 10a | `170000` (calibrado na fase) |
| `LOGIN_IP_MAX_ATTEMPTS` | 10b | `20` |
| `LOGIN_IP_WINDOW_SECONDS` | 10b | `900` |
| `TRUST_PROXY` | 10b | `false` (`true` em produção) |
| `DEMO_QUESTIONS_PER_MINUTE` | 10c | `3` |
| `DEMO_DAILY_TOKENS` | 10c | `20000` |
| `GLOBAL_DAILY_TOKEN_BUDGET` | 10c | definido na fase |

Todas entram no `.env.example` e na validação de configuração da API.
