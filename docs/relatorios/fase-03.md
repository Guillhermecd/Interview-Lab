# Relatório — Fase 03: Guarda SQL

**Branch:** `feature/fase-03-guarda-sql`  **Data:** 2026-10-02

## 1. O que foi feito
- **`SqlGuard`** (`apps/api/src/sql-guard/sql-guard.ts`): parseia o SQL com `libpg-query`, valida a árvore e devolve o texto que pode ser executado.
- **`AstValidator`** (`ast-validator.ts`): percorre a árvore inteira e recusa tudo o que não está liberado.
- **`ast-schema.ts`:** lista de tipos de nó aceitos e, dentro de cada um, dos campos aceitos.
- **`allowlists.ts`:** tabelas expostas, funções, tipos de conversão e palavras-chave de data/hora permitidas.
- **`GuardedQueryService`** (`src/query/guarded-query.service.ts`): único ponto de entrada para executar SQL — guarda, depois executor. O `QueryExecutor` deixou de ser exportado pelo módulo.
- **Endpoint interno** passa a usar o `GuardedQueryService`; recusas saem como `422 QUERY_REJECTED` com o motivo em `details`.
- **`libpg-query` fixado em `17.7.4`** (D-24). O parser é carregado uma vez na inicialização da aplicação.
- **Testes:** 249 unitários da guarda (corpus de ataques e de consultas legítimas) e 39 de integração novos. O teste de fumaça do parser da Fase 00 foi removido: o corpus o substitui.
- **Documentação:** D-23, D-24 e D-25 em `DECISOES.md`; tabela "O que a guarda SQL aceita" no `README.md`; `.env.example`; Fase 03 marcada `CONCLUÍDA` no `PLANO.md` (vale com o merge).

## 2. Por que foi feito assim
Entregas do `PLANO.md` e como cada uma foi atendida:

| Regra | Implementação |
|---|---|
| Validação sobre AST, nunca regex | Nenhuma decisão olha o texto; `SELECT 'DROP TABLE x'` passa, `dElEtE` e `U&"\0070g_sleep"` são recusados |
| Um único statement | O parser devolve a lista de statements; mais de um é recusado |
| Apenas `SELECT` e CTEs de leitura | Raiz precisa ser `SelectStmt`; CTE só pode conter `SelectStmt` |
| Bloqueio de DDL/DML | Qualquer outro tipo de statement é recusado |
| Limite de JOINs | 5, contados na query inteira (D-23) |
| `LIMIT` obrigatório | Injetado quando ausente, reduzido quando acima do teto (D-25) |
| Allowlist de tabelas | Só as cinco tabelas de `sales`, ou CTE em escopo |
| Funções perigosas | Allowlist de funções (D-23): o que não está na lista é recusado |
| `FOR UPDATE` e `INTO` | Recusados por não estarem entre os campos aceitos do `SELECT` |
| Motivo legível | Mensagem em português, específica (nome da tabela, da função, quantidade de JOINs) |

Decisões de desenho:
- **Recusar por padrão, em dois níveis.** A guarda não procura coisas proibidas; ela só aceita tipos de nó e campos listados. Isso importa porque cláusulas perigosas nem sempre são um nó próprio: `SELECT ... INTO` é o campo `intoClause`, `FOR UPDATE` é `lockingClause`, CTE recursiva é uma flag. Construção nova ou esquecida cai na recusa sem precisar de regra.
- **Percurso genérico.** Todos os campos de todos os nós são percorridos. Não há lista manual de "onde procurar subquery", então uma tabela proibida em `HAVING`, `ORDER BY`, condição de `JOIN`, `FILTER` ou janela é encontrada do mesmo jeito.
- **Escopo exato de CTE.** Um nome só vale como CTE onde o PostgreSQL também o enxerga como CTE. Sem isso, um nome declarado como CTE em um ponto e usado fora dele seria aceito pela guarda e resolvido pelo banco para uma tabela real. Nomes de CTE começando com `pg_` são recusados.
- **O que executa é o que foi validado.** O texto final — original ou reescrito — passa pela guarda inteira antes de ser devolvido, e o `GuardedQueryService` executa esse texto, nunca a entrada.
- **Parser na mesma versão do banco (D-24).**

Detalhes escolhidos sem pergunta:
- **Lista de funções permitidas:** agregadas, de janela, matemáticas, de texto, de data e `generate_series`. Ficaram de fora de propósito `repeat`, `lpad`, `rpad` e `format` (montam textos gigantes a partir de uma query pequena) e `current_setting`, `version`, `current_database` (revelam o ambiente).
- **Palavras-chave de sessão recusadas:** `CURRENT_USER`, `SESSION_USER`, `CURRENT_CATALOG`, `CURRENT_SCHEMA`, `CURRENT_ROLE`.
- **Tipos de conversão permitidos:** numéricos, texto, booleano, data/hora e intervalo. `regclass` e os demais `reg*` ficam de fora porque consultam o catálogo.
- **Operadores:** só os nativos, escritos direto ou como `OPERATOR(pg_catalog.+)`.
- **Construções recusadas além do pedido:** `WITH RECURSIVE`, `TABLESAMPLE`, parâmetros `$1`, `COLLATE`, índice de array, seleção de campo de linha, argumentos nomeados, `VARIADIC`, XML e JSON.
- **`LIMIT` precisa ser inteiro literal não negativo**; expressão, subquery ou `WITH TIES` são recusados.
- **Profundidade máxima da árvore:** 150 níveis.
- **Códigos de erro:** recusa da guarda vira `QUERY_REJECTED`; erro de sintaxe continua `QUERY_SYNTAX_ERROR`, agora detectado antes do banco.

## 3. Verificação
Executado com `pnpm verify` em Windows 11, Node 24.15, pnpm 12.8.1, Docker 29.1.2.

| Etapa | Resultado | Observação |
|---|---|---|
| Lint | ✅ | ESLint sem erros; Prettier sem diferenças |
| Typecheck | ✅ | `shared`, `api`, `web` |
| Testes unitários | ✅ | 303 passaram / 303 total (API 302, web 1) |
| Testes de integração | ✅ | 118 passaram / 118 total |
| Build | ✅ | `shared`, `api`, `web` |

Corpus de ataques (critério do `PLANO.md`), todos recusados:
- **Múltiplos statements:** dois `SELECT`, `SELECT` + `DROP`, statement escondido depois de comentário de linha e de bloco, `SET` antes do `SELECT`.
- **Comentários e texto:** palavras-chave SQL dentro de string e de `$$...$$` não disparam nada; comentário no fim não engole o `LIMIT` injetado.
- **CTE com DML:** `INSERT`, `UPDATE` e `DELETE` em CTE, inclusive aninhada.
- **Casing misto e identificadores:** `dElEtE`, `PG_SLEEP`, `"pg_sleep"`, `U&"\0070g_sleep"`.
- **Funções perigosas:** 46 casos, incluindo `pg_sleep` em 15 formas e posições diferentes da query, `pg_read_file`, `dblink`, `lo_*`, `set_config`, `query_to_xml`, `pg_terminate_backend`.
- **Tabelas:** 25 casos, incluindo catálogo qualificado e não qualificado, `information_schema`, schema `app`, e tabela proibida em cada cláusula (`WHERE`, `HAVING`, `ORDER BY`, `JOIN`, `LIMIT`, `UNION`, janela, `FILTER`, `CASE`, `VALUES`).
- **Contrabando por CTE:** nome de catálogo, uso fora do escopo, referência a CTE posterior, auto-referência.
- **JOINs:** 6 JOINs explícitos, por vírgula, mistos, e divididos entre subquery, CTE, ramos de `UNION` e subquery de `WHERE`.
- **`LIMIT`:** expressão, subquery, string, conversão, negativo, `WITH TIES`; `LIMIT` de subquery ou de um ramo de `UNION` não conta como limite de topo.
- **Complexidade:** 400 chamadas de função aninhadas e 200 subqueries aninhadas são recusadas sem derrubar o processo, e a guarda continua funcionando depois.

Consultas legítimas (critério do `PLANO.md`), todas aceitas:
- 15 consultas de negócio, entre elas "faturamento por região no último trimestre", total acumulado com janela, ranking por categoria, `ROLLUP`, calendário com `generate_series`.
- As mesmas 15 são executadas no PostgreSQL 17 real depois de reescritas pela guarda.

Testes de integração específicos:
- **Lista de tabelas confere com o banco:** `EXPOSED_TABLES` é comparada com os `GRANT`s reais de `app_readonly`.
- **`LIMIT` de ponta a ponta:** `SELECT id FROM orders` devolve 1000 linhas com `truncated: true`; `LIMIT 5000` e `LIMIT ALL` idem; `LIMIT 1000` devolve 1000 sem `truncated`; `LIMIT 7` devolve 7.
- **Query embrulhada:** mantém o `ORDER BY` e aceita colunas com o mesmo nome.
- **Recusas não chegam ao banco:** `SELECT pg_sleep(30)` é recusado em menos de 1s.
- **HTTP:** `UPDATE`, `pg_sleep`, `pg_authid` e dois statements enviados direto ao endpoint voltam `422 QUERY_REJECTED`.

Clone limpo: `pnpm install --frozen-lockfile` + `pnpm verify` — resultado em §4.

## 4. Erros e problemas encontrados
- **A guarda aceitava `LIMIT -1`.** O teste do corpus pegou. Não era brecha (o PostgreSQL recusa `LIMIT` negativo na execução), mas a guarda agora recusa.
- **Três testes meus estavam errados e foram corrigidos, sem enfraquecer a verificação:**
  - Um caso de "JOINs escondidos em subquery" somava 5 JOINs, não 6; acrescentei um JOIN.
  - Esperei que 400 parênteses aninhados fossem recusados; o parser descarta parênteses redundantes, então a árvore não fica profunda. O teste passou a afirmar que isso é aceito, e a profundidade é exercitada com chamadas de função aninhadas.
  - Um teste de integração esperava uma promise rejeitada, mas `GuardedQueryService.run` lançava a exceção de forma síncrona. Corrigi o serviço (agora `async`), não o teste.
- **Parser na versão errada**, detectado antes de escrever a guarda e resolvido pela D-24.
- **Tipos TypeScript:** a versão 17 do `libpg-query` devolve a árvore como `any`. A guarda trata a árvore como `unknown` e confere cada formato em tempo de execução, o que combina com a estratégia de recusar o desconhecido.

## 5. Decisões que preciso que você tome
1. **Push e abertura do PR da Fase 03.** Nada foi enviado.
2. **Push também vira regra permanente?** Hoje a regra registrada na D-12 cobre o merge com CI verde. Se quiser, passo a fazer push e PR ao fim de cada fase sem perguntar, e você revisa pelo relatório no PR.
3. **D-03 — provedor de LLM**, necessária para a Fase 04. Opções do `DECISOES.md`: Anthropic | OpenAI | interface com os dois. Recomendação registrada: interface própria + um provedor implementado. Preciso saber qual provedor e, para os testes manuais com o provedor real, de uma chave de API no `.env` local (nunca commitada).

## 6. Dívida técnica / pontos de atenção
- **A lista de funções vai precisar crescer com o uso.** Uma função legítima fora da lista é recusada com motivo claro; a LLM (Fase 04) tem uma nova tentativa com esse motivo.
- **A lista de tabelas está no código.** Um teste de integração falha se ela divergir dos `GRANT`s, mas tabela nova exige mexer na migration e em `allowlists.ts`. A Fase 04 prevê introspecção do schema para o prompt; vale reavaliar lá.
- **`generate_series` e `JOIN`s cruzados** ainda podem gerar consultas caras; o limite real é o timeout (Fase 02).
- **Expressões regulares** (`~`, `SIMILAR TO`) são aceitas; uma expressão patológica é limitada pelo timeout.
- **`ORDER BY` em query embrulhada** depende de comportamento do PostgreSQL, não do padrão SQL (D-25). Coberto por teste.
- **Endpoint interno sem autenticação nem rate limit** até a Fase 08; continua atrás da flag (D-22).
- **Falha intermitente do processo de teste no Windows** (relatório da Fase 02): status em §4.
- **Dívidas herdadas:** TypeScript 6.0, `dev` da API sem watch.

## 7. Próximo passo proposto
- Após sua aprovação: push, PR, CI verde, squash merge (D-12).
- **Fase 04 — Integração com LLM:** camada de provedor atrás de interface, introspecção do schema, fluxo gerar SQL → guarda → nova tentativa com o erro → executar → explicar, contagem de tokens. Depende da D-03.
