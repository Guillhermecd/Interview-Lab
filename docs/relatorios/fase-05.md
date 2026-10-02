# Relatório — Fase 05: Streaming SSE, histórico e memória resumida

**Branch:** `feature/fase-05-streaming-historico`  **Data:** 2026-10-02

## 1. O que foi feito
- **Migration** `1790899200003_create-conversations.sql`: tabelas `app.conversations` e `app.messages`.
- **Módulo de conversas** (`apps/api/src/conversation`):
  - `conversation.repository.ts` — persistência, com a role `app_rw`.
  - `conversation.service.ts` — grava as mensagens, monta a memória e transforma a resposta em eventos.
  - `conversation.controller.ts` — endpoints REST e o endpoint SSE.
  - `conversation-memory.ts` — a regra de memória (D-27).
  - `app-pool.ts` — pool separado para os dados da aplicação.
- **`AskService` em streaming** (`src/ask/ask.service.ts`): `stream()` emite `sql`, `rows` e `token` conforme acontecem; `ask()` continua existindo para quem só quer a resposta final.
- **Provedor de LLM com streaming e cancelamento:** `LlmProvider.streamText` e `AbortSignal` em todas as chamadas; implementado no `GeminiLlmProvider`.
- **Cancelamento no executor:** `QueryExecutor.execute(sql, signal)` cancela a consulta no banco quando o sinal é abortado; novo código `QUERY_CANCELLED`.
- **Erros da LLM no formato padrão** (`src/http/error-response.ts`): a mesma função serve às respostas HTTP comuns e ao evento `error` do stream.
- **`packages/shared`:** tipos das conversas e dos eventos do stream (`AnswerStreamEvents`).
- **Configuração:** a API passa a exigir `DB_APP_PASSWORD` (já existia no `.env.example`).
- **Testes:** unitários passaram de 375 para 406; integração de 127 para 151.
- **Documentação:** D-07 (parcial), D-27 e D-28 em `DECISOES.md`; rotas e eventos no `README.md`; Fase 05 marcada `CONCLUÍDA` no `PLANO.md` (vale com o merge).

## 2. Por que foi feito assim
Entregas do `PLANO.md` e como cada uma foi atendida:

| Entrega | Implementação |
|---|---|
| Endpoint SSE com eventos tipados | `POST /api/internal/conversations/:id/messages`; eventos `sql`, `rows`, `token`, `done`, `error` |
| Persistência de conversas e mensagens | `app.conversations` e `app.messages`; endpoints para criar, listar e ler o histórico |
| Memória: últimas N + resumo | Resumo das mensagens antigas + de 6 a 11 mensagens recentes na íntegra; o resumo é regenerado quando 6 ou mais mensagens ficam fora da janela das 6 mais recentes (D-27) |
| Cancelamento na desconexão | O fechamento da conexão aborta a chamada à LLM e cancela a consulta no banco |

Decisões aplicadas: **D-07** (histórico no Postgres), **D-27** (regra de memória), **D-28** (conversas sem dono, endpoints atrás da flag interna).

Mudança de desenho em relação à Fase 04:
- **A sugestão de visualização passou a vir junto com o SQL**, e não mais com a explicação. Assim a explicação pode ser texto puro transmitido palavra a palavra, e o total continua em duas chamadas à LLM por pergunta. A sugestão continua sendo validada contra as colunas reais do resultado.

Pontos de segurança:
- **O histórico não guarda linhas de resultado.** Ficam a pergunta, o SQL, a explicação, o tipo de gráfico e a contagem de linhas.
- **Dados da aplicação com outra role.** O pool das conversas conecta como `app_rw`, que não lê `sales`; o SQL do usuário continua rodando só como `app_readonly`, que não lê `app`.
- **Histórico da conversa é conteúdo não confiável no prompt:** vai em bloco próprio, com mensagens cortadas em 500 caracteres, e a instrução diz que serve só para entender a pergunta atual.
- **Erros no meio do stream** saem como evento `error` no formato padrão; falha inesperada vira `INTERNAL_ERROR` genérico, sem mensagem interna.
- **Validação antes do stream:** corpo inválido e conversa inexistente respondem `400`/`404` normais; o stream só começa depois.

Detalhes escolhidos sem pergunta:
- **Identificador de conversa em UUID** gerado pelo banco; id malformado responde `404`.
- **Título da conversa** = primeira pergunta, cortada em 80 caracteres.
- **Pergunta com no máximo 1000 caracteres.**
- **Resposta interrompida não é gravada;** a pergunta fica. Resposta com erro é gravada com `status: "error"` e a mensagem do erro.
- **"Não é possível responder"** vira um evento `token` com o motivo, seguido de `done` com `status: "not_answerable"`.
- **O resumo é regenerado depois que a resposta termina de ser enviada,** para o cliente não esperar por ele. Se falhar, só é registrado em log e tentado de novo na próxima resposta.
- **Listagem de conversas** limitada às 50 mais recentes, sem paginação.
- **A mesma flag** `INTERNAL_QUERY_ENDPOINT_ENABLED` liga os endpoints de conversa (D-28); o nome da variável não foi alterado.
- **Cabeçalho `X-Accel-Buffering: no`** no stream, para proxies não segurarem os eventos.

## 3. Verificação
Executado com `pnpm verify` em Windows 11, Node 24.15, pnpm 12.8.1, Docker 29.1.2.

| Etapa | Resultado | Observação |
|---|---|---|
| Lint | ✅ | ESLint sem erros; Prettier sem diferenças |
| Typecheck | ✅ | `shared`, `api`, `web` |
| Testes unitários | ✅ | 406 passaram / 406 total (API 405, web 1) |
| Testes de integração | ✅ | 151 passaram / 151 total |
| Build | ✅ | `shared`, `api`, `web` |

Testes de integração do SSE (critério do `PLANO.md`) — HTTP, persistência, guarda, executor e PostgreSQL reais; LLM simulada:
- **Ordem dos eventos:** `sql → rows → token… → done`; com SQL recusado na primeira tentativa, `sql → sql → rows → token… → done`; pergunta não respondível, `token → done`.
- **Erro no meio do fluxo:** duas tentativas recusadas terminam em `sql → sql → error`; falha da LLM depois das linhas enviadas termina em `sql → rows → error`; falha inesperada vira `INTERNAL_ERROR` sem vazar a mensagem; chave ausente vira `LLM_NOT_CONFIGURED`.
- **Desconexão:**
  - Cliente sai durante a explicação: o stream da LLM é abortado e a resposta interrompida não é gravada.
  - Cliente sai durante uma consulta lenta: o teste confere em `pg_stat_activity` que a consulta estava rodando e que deixou de rodar em menos de 2s, bem antes do timeout de 5s.

Teste da regra de resumo (critério do `PLANO.md`):
- **Unitário:** não resume com 0, 1, 6 ou 11 mensagens; com 12, resume as 6 mais antigas; nunca resume as 6 mais recentes; conta só o que ainda está fora do resumo.
- **Integração:** em uma conversa real, nenhuma chamada de resumo até a 5ª rodada; na 6ª (12 mensagens) o resumo é gerado com as mensagens 1 a 6 e sem a 7ª em diante; a pergunta seguinte recebe o resumo mais as 6 mensagens recentes.

Outros testes:
- **Histórico:** grava pergunta e resposta, sem linhas de resultado; grava resposta com erro; título e ordenação da lista; a segunda pergunta recebe a primeira como contexto.
- **Executor:** cancelamento por `AbortSignal`, recusa imediata se o sinal já veio abortado, pool íntegro depois.
- **Provedor Gemini** (cliente falso): streaming com tokens no final, pedido sem JSON, erro no meio do stream, cancelamento.
- **Validação:** corpo inválido `400`, conversa inexistente ou id malformado `404`, endpoints ausentes com a configuração padrão.

**Teste manual com o provedor real** (`gemini-3.5-flash-lite`, API compilada, banco do `docker compose`):
- "Qual o faturamento total por categoria de produto?" → eventos `sql`, `rows` (5 linhas, sugestão de barra), 6 eventos `token`, `done` com 1467/225 tokens.
- Pergunta de continuação **"E só da região Sul?"** → o SQL gerado manteve o agrupamento por categoria e acrescentou o filtro da região Sul, usando o contexto da conversa.
- Histórico lido pelo endpoint com as quatro mensagens. Log da API sem chave e sem texto das perguntas.

Clone limpo: `pnpm install --frozen-lockfile` + `pnpm verify` passaram por completo (406 unitários, 151 de integração).

## 4. Erros e problemas encontrados
- **Teste antigo que não provava nada (Fase 02).** O teste do timeout da aplicação conferia no `pg_stat_activity` que nenhuma consulta com `pg_sleep` continuava rodando. Como o executor usa cursor, o banco mostra `FETCH ...`, não o texto original; a contagem era sempre zero e a asserção passava de qualquer jeito. Corrigido: o filtro agora procura o `FETCH`, e o teste primeiro confirma que a consulta está rodando (contagem 1) e depois que parou (contagem 0). O comportamento estava correto; o que faltava era prova.
- **Dois testes novos de desconexão falharam por erro do teste:**
  - Um desconectava logo no primeiro evento (`sql`); o servidor cancelava corretamente antes de chegar à explicação, e o teste esperava ver o cancelamento do stream da LLM. Passou a desconectar depois do primeiro `token`.
  - O outro não tratava a rejeição da leitura do corpo depois do `abort`.
- Nenhum outro.

## 5. Decisões que preciso que você tome
Para a Fase 06 (frontend):
1. **D-06 — biblioteca de gráficos.** Opções: Recharts | Chart.js | ECharts. Recomendação registrada: Recharts.
2. **Kit de interface.** O template usa Ant Design; pela D-13 a stack segue o `PLANO.md`, que não define kit. Opções: (a) Ant Design, como no template — componentes prontos (tabela, layout, formulário), bundle maior; (b) Tailwind CSS com componentes próprios — mais leve e mais trabalho; (c) outro. Recomendo (a) pela aderência ao template e pela tabela de resultados pronta.
3. **Editor de SQL** (exibição na Fase 06, edição na Fase 07). Opções: (a) CodeMirror 6 — leve, com realce de SQL; (b) Monaco — o editor do VS Code, pesado; (c) `<textarea>` simples com realce só na exibição. Recomendo (a).
4. **Teste E2E.** A D-09 já definiu Playwright; confirmo que entra nesta fase com o backend simulado, como pede o `PLANO.md`.

## 6. Dívida técnica / pontos de atenção
- **Tokens do resumo não são contabilizados.** A chamada de resumo não pertence a nenhuma mensagem, então seu custo não fica registrado. Precisa ser resolvido na Fase 08, que contabiliza tokens por conversa.
- **Tokens de uma resposta com erro também não são registrados** (a contagem se perde quando o fluxo falha no meio).
- **Sem paginação** na lista de conversas (50 mais recentes) nem no histórico de mensagens (todas).
- **Resumo em corrida:** duas respostas simultâneas na mesma conversa poderiam gerar dois resumos; o último grava por cima. Sem dano aos dados, só uma chamada extra à LLM.
- **Conversas sem dono** e endpoints atrás da flag até a Fase 08 (D-28). Quem souber o UUID lê a conversa.
- **Abortar não desfaz o custo:** o provedor pode cobrar a chamada à LLM mesmo cancelada; o cancelamento evita trabalho no banco e tempo de conexão.
- **Qualidade do modelo** (`gemini-3.5-flash-lite`) e **cota da camada gratuita:** pontos da Fase 04 continuam.
- **Dívidas herdadas:** TypeScript 6.0, `dev` da API sem watch, listas da guarda no código.

## 7. Próximo passo proposto
- Push, PR, CI verde e squash merge conforme a D-12.
- **Fase 06 — Frontend:** chat consumindo o SSE, tabela, gráfico, explicação, lista de conversas, estados de carregamento, erro e vazio; testes de componentes e E2E. Depende das respostas de §5.
