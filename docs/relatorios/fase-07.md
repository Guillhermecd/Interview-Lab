# Relatório — Fase 07: Human-in-the-loop (revisar e editar o SQL)

**Branch:** `feature/fase-07-human-in-the-loop`  **Data:** 2026-10-03

## 1. O que foi feito
- **Modo revisão no backend** (D-33):
  - `POST /conversations/:id/messages` aceita `mode: "review"`: o SQL é gerado, passa pela guarda **sem executar**, e o stream termina com o evento `review` (`messageId`, `sql`).
  - Novo `POST /conversations/:id/messages/:messageId/execute` recebe o SQL aprovado ou editado e responde no mesmo formato de stream (`rows` → `token`… → `done`, com `edited`).
- **Auditoria:** migration `1790899200004_add-review-mode.sql` acrescenta o status `pending_review` e as colunas `generated_sql` e `edited` em `app.messages`. Ao executar, ficam gravados o SQL que rodou, o SQL que a LLM gerou e se houve edição.
- **`AskService`** (`apps/api/src/ask/ask.service.ts`): ganhou `streamReview` (gera e só valida) e `streamReviewedExecution` (executa o SQL revisado e explica). O trecho de geração com nova tentativa foi extraído para ser comum aos dois modos.
- **`GuardedQueryService.check`:** roda só a guarda, sem executar.
- **Leitura de corpo de requisição** reunida em `src/http/request-readers.ts` (pergunta, modo, SQL).
- **Frontend:**
  - Chave "Revisar o SQL antes de executar", desligada por padrão e lembrada no navegador (D-32).
  - `ReviewPanel` — editor CodeMirror editável, "Executar" / "Executar SQL editado" e "Desfazer edição".
  - Selo "Editado por você" e acesso ao SQL gerado originalmente nas respostas executadas após edição.
  - Revisões deixadas pendentes reaparecem no histórico, prontas para executar.
- **Componente `SqlEditor`** substituiu o `SqlViewer`: somente leitura por padrão, editável quando recebe `onChange`.
- **Correção da corrida registrada na Fase 06:** escolher outra conversa enquanto a primeira pergunta ainda cria a conversa nova não puxa mais o usuário de volta para ela.
- **Testes:**
  - API: unitários de 405 para 411; integração de 151 para 179.
  - Web: componentes de 41 para 52; E2E de 4 para 6.
- **Documentação:** D-32 e D-33 em `DECISOES.md`; seção "Revisar o SQL antes de executar" e rotas no `README.md`; Fase 07 marcada `CONCLUÍDA` no `PLANO.md` (vale com o merge).

## 2. Por que foi feito assim
Entregas do `PLANO.md` e como cada uma foi atendida:

| Entrega | Implementação |
|---|---|
| Modo "revisar antes de executar": aprovar, editar ou cancelar | Chave na tela; editor com "Executar" / "Executar SQL editado" / "Desfazer edição". "Cancelar" é simplesmente não executar: a revisão fica pendente no histórico |
| SQL editado passa pela mesma guarda no backend | O endpoint de execução usa o `GuardedQueryService`, o mesmo caminho do modo automático; não existe atalho |
| Registro de que a query foi editada (auditoria) | `edited` + `generated_sql` em `app.messages`; o `done` e o histórico informam |

Decisões aplicadas: **D-32** (revisão opcional, desligada por padrão), **D-33** (stream com pausa + endpoint de execução).

Pontos de segurança:
- **O frontend não é fronteira:** o servidor não confia no SQL recebido, nem no fato de ele ter vindo de uma revisão. Revalida tudo, exatamente como se a LLM tivesse acabado de gerar.
- **O SQL mostrado para revisão já passou pela guarda uma vez:** se a LLM gerar algo recusado, ela recebe o motivo e tenta de novo antes de o usuário ver.
- **Só executa o que está pendente:** o endpoint exige uma mensagem desta conversa com status `pending_review`; executar de novo uma revisão concluída, de outra conversa ou inexistente responde `404`.
- **Execução simultânea da mesma revisão** responde `409`.
- **SQL do usuário recusado não gera nova tentativa da LLM:** volta para o usuário corrigir.

Detalhes escolhidos sem pergunta:
- **"Editado"** compara o SQL enviado com o gerado ignorando espaços nas pontas; qualquer outra diferença conta como edição.
- **Falha durante a execução de uma revisão** (recusa da guarda, erro do banco, falha da LLM ou cancelamento) deixa a mensagem pendente; nada é gravado como erro, e o usuário pode corrigir e executar de novo. A tela mantém o último SQL que ele tentou.
- **A sugestão de gráfico da revisão** é a proposta da LLM para o SQL gerado; ao executar, ela é conferida contra as colunas reais do SQL que rodou. Se o usuário mudou as colunas, vira tabela.
- **Mensagens pendentes não expõem a sugestão de gráfico** no histórico: ela só aparece depois de validada.
- **Proteção contra execução simultânea em memória do processo:** suficiente com uma instância da API (ver §6).
- **A pergunta usada na explicação** é a pergunta do usuário imediatamente anterior à mensagem revisada.

## 3. Verificação
Executado com `pnpm verify` em Windows 11, pnpm 12.8.1, Docker 29.1.2 e Node 24.21.

| Etapa | Resultado | Observação |
|---|---|---|
| Lint | ✅ | ESLint sem erros; Prettier sem diferenças |
| Typecheck | ✅ | `shared`, `api`, `web` |
| Testes unitários | ✅ | 463 passaram / 463 total (API 411, web 52) |
| Testes de integração | ✅ | 179 passaram / 179 total |
| Build | ✅ | `shared`, `api`, `web` |
| Testes E2E | ✅ | 6 passaram / 6 total |

**Critério do `PLANO.md` — SQL malicioso enviado direto à API, simulando edição, é rejeitado.** Dez casos, cada um em uma revisão real pendente:
- `DELETE`, `DROP TABLE`, `UPDATE` escondido em CTE, segundo statement.
- `pg_authid`, dados da aplicação (`app.messages`), `pg_sleep(30)`, `set_config`, `SELECT INTO`, `lo_from_bytea`.

Para todos:
- a resposta é `QUERY_REJECTED` com o motivo;
- a recusa acontece em menos de 2s (o `pg_sleep` não chegou ao banco);
- as 5 regiões continuam lá;
- a mensagem continua `pending_review`;
- logo depois, o SQL original executa normalmente.

Outros testes de integração:
- O modo revisão para no evento `review`, não executa nem chama a LLM para explicar, e grava a mensagem pendente sem sugestão de gráfico.
- SQL gerado recusado pela guarda é refeito antes de chegar à revisão.
- Execução sem edição grava `edited: false`; com edição grava `edited: true` e o SQL gerado.
- O SQL editado passa pelas regras de `LIMIT` (`LIMIT 50000` vira 1000 linhas com `truncated`).
- `409` para execução simultânea; `404` para revisão já executada, mensagem que não está pendente, revisão de outra conversa e ids inválidos; `400` para SQL ausente, vazio, não textual ou grande demais e para modo desconhecido.

Testes de componentes e E2E:
- Chave desligada por padrão e lembrada.
- Pergunta em modo revisão sem execução.
- Aprovação sem edição.
- Recusa mantém a revisão aberta com o motivo.
- Selo de edição e revisão pendente vindas do histórico.
- Corrida da criação de conversa: o teste falha com a correção removida.
- **E2E no Chromium, com edição real no editor:** acrescentar um `WHERE` e executar envia o SQL editado e mostra o selo; trocar tudo por `DELETE` mostra a recusa, e "Desfazer edição" volta ao SQL gerado.

**Teste manual com tudo real** (API, PostgreSQL, Gemini, Chromium):
- "Quantos pedidos existem por status?" em modo revisão → editor com o SQL gerado; nada executado.
- Edição para excluir pedidos cancelados → tabela com 5 linhas, explicação mencionando a exclusão dos cancelados, selo "Editado por você"; nenhum erro no console.
- No banco: `status = answered`, `edited = true`, `generated_sql` com o SQL original e `sql` com o editado.

Clone limpo: resultado em §4.

## 4. Erros e problemas encontrados
- **Processos deixados rodando na Fase 06 (correção do relatório anterior).** O relatório da Fase 06 diz que os servidores do teste manual foram parados; não foram. O comando de encerramento atingiu o processo do shell, não o do Node, e a API e o Vite daquela verificação ficaram nas portas 3000 e 5173 desde 03/10 01:52. Isso apareceu agora: a primeira tentativa do teste manual desta fase falhou porque a API antiga respondeu sem o modo revisão. Encerrei os dois processos (identificados pela linha de comando e pelo horário de início). A verificação desta fase passou a iniciar a API e o Vite como processos rastreados e a encerrá-los ao final, conferindo que as portas ficaram livres.
- **Dois defeitos do próprio frontend, pegos pelos testes durante o desenvolvimento:**
  - O evento `review` sem um `sql` antes deixava a revisão sem SQL. Agora o SQL vem do próprio evento.
  - Depois de uma recusa, o painel de revisão reabria com o SQL recusado como se fosse o original, e "Desfazer edição" sumia. Agora o painel guarda o SQL gerado como referência e o último SQL enviado como rascunho.
- **Clone limpo:** PREENCHER.

## 5. Decisões que preciso que você tome
Ação sua, fora do código (repetida):
- **Atualizar o Node.js da máquina para 24.21 ou mais recente.**

Para a Fase 08 (autenticação, tokens por usuário, rate limit, cache):
1. **D-08 — autenticação.** Recomendação registrada: JWT próprio (cadastro e login), sem OAuth nesta versão. Confirma? Inclui decidir onde o token fica no navegador: `localStorage`, como o template (mais simples, exposto a XSS), ou cookie `HttpOnly` (mais seguro, exige proteção contra CSRF).
2. **D-07b — cache e rate limit:** Postgres ou Redis. Recomendação registrada: Redis.
3. **Limites:** quantas perguntas por minuto por usuário e qual cota diária de tokens. Sugestão inicial: 10 perguntas por minuto e 200 mil tokens por dia por usuário.
4. **Conversas existentes:** as conversas criadas até agora não têm dono. Opções: apagar na migration, ou deixar sem dono e invisíveis para todos.

## 6. Dívida técnica / pontos de atenção
- **Proteção contra execução simultânea só vale com uma instância da API.** Com várias instâncias, a mesma revisão poderia rodar duas vezes até uma delas gravar; a gravação final é condicional (`status = 'pending_review'`), então o histórico não fica inconsistente, só haveria uma chamada extra à LLM.
- **Tokens da execução de uma revisão** são somados aos da geração na mesma mensagem; tokens de uma execução que falhou não são registrados (como já acontecia com respostas com erro).
- **Sem expiração de revisões pendentes:** ficam no histórico até alguém executar.
- **Pendentes no resumo da conversa:** uma revisão nunca executada entra no histórico enviado à LLM só com o SQL, sem explicação.
- **Pontos herdados:**
  - TypeScript 6.0.
  - `dev` da API sem watch.
  - Tokens do resumo não contabilizados.
  - A explicação da LLM pode errar números; a tabela é a fonte confiável (Fase 06).
  - Node 24.15 na máquina.

## 7. Próximo passo proposto
- Push, PR, CI verde e squash merge conforme a D-12.
- **Fase 08 — Autenticação, tokens por usuário, rate limit e cache**, depois das respostas de §5.
