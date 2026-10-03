# Relatório — Fase 06: Frontend

**Branch:** `feature/fase-06-frontend`  **Data:** 2026-10-03

## 1. O que foi feito
- **Página de chat** (`apps/web/src/pages/ChatPage`):
  - Lista de conversas e botão "Nova conversa".
  - Campo de pergunta: Enter envia, Shift+Enter quebra linha; botão "Parar" durante a resposta.
  - Resposta em streaming: explicação aparecendo aos poucos, SQL, gráfico e tabela.
  - Estados de carregamento, erro e vazio, com perguntas de exemplo no estado vazio.
  - Histórico ao abrir uma conversa existente.
- **Componentes** (`src/components`):
  - `ResultTable` — tabela com colunas numéricas alinhadas à direita.
  - `ResultChart` — barra ou linha, com Recharts (D-06).
  - `SqlViewer` — CodeMirror 6 somente leitura, realce PostgreSQL (D-30).
  - `Button`, `Spinner`, `ErrorMessage`.
- **Camada de API** (`src/api/modules`):
  - `api.ts` — cliente central, erros no formato padrão viram `ApiError`.
  - `sse.ts` — leitor de Server-Sent Events sobre `fetch`. O `EventSource` do navegador só faz GET, e a pergunta é um POST.
  - `conversation.service.ts` — chamadas de conversas.
- **Tema claro e escuro** com Tailwind CSS (D-29): cores definidas uma única vez como variáveis em `src/index.css`; preferência salva no navegador, padrão vindo do sistema.
- **Formatação só de exibição** (`src/utils/format.ts`): números no padrão brasileiro, datas com fuso no horário local, eixo do gráfico abreviado ("45 mi").
- **Testes:**
  - Componentes: 41 testes (Vitest + Testing Library + jsdom).
  - E2E: 4 testes (Playwright, com o backend simulado no próprio navegador).
- **Verificação:** `pnpm test:e2e` virou a 6ª etapa do `pnpm verify` e do CI, que agora instala o Chromium e guarda os traces do Playwright quando falha.
- **Documentação:** D-06 e D-29 a D-31 em `DECISOES.md`; tabela de comandos em `template/RECOMENDACOES.md`; `README.md`; Fase 06 marcada `CONCLUÍDA` no `PLANO.md` (vale com o merge).

## 2. Por que foi feito assim
Entregas do `PLANO.md` e como cada uma foi atendida:

| Entrega | Implementação |
|---|---|
| React + TS + Vite; SSE com renderização incremental | Leitor de SSE próprio; cada evento atualiza a resposta na tela |
| Tabela, gráfico, explicação, lista de conversas | `ResultTable`, `ResultChart`, explicação com `aria-live`, barra lateral |
| Estados de carregamento, erro e vazio | Indicadores por etapa ("Gerando o SQL…", "Executando a consulta…", "Escrevendo a explicação…"), erros no formato padrão, estado vazio com exemplos |

Decisões aplicadas: **D-06** (Recharts), **D-29** (Tailwind CSS), **D-30** (CodeMirror 6), **D-31** (Vitest + Testing Library + Playwright).

Fronteira com o backend (regra do template):
- **O frontend não calcula nem decide nada.** O tipo de gráfico e as colunas dos eixos vêm do backend; o frontend só desenha o que recebeu. Se as colunas não existirem no resultado, o gráfico não aparece.
- **Formatação é só para exibição:** números e datas no padrão brasileiro; os valores não são recalculados.
- **A validação do tamanho da pergunta** espelha o limite do backend apenas para dar retorno imediato; o backend valida de novo.
- **Texto vindo do banco ou da LLM é sempre renderizado como texto,** nunca como HTML. Há teste com `<img onerror>` dentro de uma célula.

Detalhes escolhidos sem pergunta:
- **Sem roteador:** a aplicação tem uma única tela; a conversa selecionada fica no estado da página. Rotas (ex.: `/conversas/:id`) podem entrar quando houver login (Fase 08).
- **A conversa é criada na primeira pergunta**, não ao clicar em "Nova conversa", para não gerar conversas vazias.
- **Respostas carregadas do histórico** mostram explicação, SQL e quantidade de linhas, com o aviso de que as linhas não ficam salvas (decisão da Fase 05).
- **Quando a primeira consulta é recusada,** a tela mostra o SQL corrigido com um aviso.
- **Indicação de truncamento** quando a consulta tinha mais linhas que o limite.
- **Paleta própria em tons de azul,** com contraste conferido visualmente nos dois temas (capturas abaixo).
- **E2E com o backend simulado por interceptação de rede no navegador,** sem subir API nem banco, como pede o `PLANO.md`.

## 3. Verificação
Executado com `pnpm verify` em Windows 11, pnpm 12.8.1, Docker 29.1.2 e **Node 24.21** (ver §4).

| Etapa | Resultado | Observação |
|---|---|---|
| Lint | ✅ | ESLint sem erros (inclui regras de hooks do React); Prettier sem diferenças |
| Typecheck | ✅ | `shared`, `api`, `web` |
| Testes unitários | ✅ | 446 passaram / 446 total (API 405, web 41) |
| Testes de integração | ✅ | 151 passaram / 151 total |
| Build | ✅ | `shared`, `api`, `web` |
| Testes E2E | ✅ | 4 passaram / 4 total |

Testes de componentes (critério do `PLANO.md`):
- **Leitor de SSE:** vários eventos por pedaço; evento quebrado entre pedaços, inclusive no meio de um caractere acentuado; quebras de linha `\r\n`; evento incompleto no fim é ignorado.
- **Tabela:** cabeçalhos repetidos, formatação, estado vazio, HTML do banco exibido como texto.
- **Gráfico:** barra com uma barra por linha numérica, linha, nada quando a sugestão é tabela, coluna inexistente ou nenhum valor numérico.
- **Visualizador de SQL:** conteúdo, somente leitura, atualização.
- **Página:** estado vazio; criação da conversa na primeira pergunta e resposta completa; evento `error`; erro antes do stream; histórico; falha ao carregar histórico; botão "Parar"; falha ao carregar a lista.

E2E (critério do `PLANO.md`) — Chromium, backend simulado:
- **Fluxo principal:** pergunta → SQL → gráfico com 5 barras → tabela com 5 linhas → explicação → conversa na lista com a pergunta como título.
- Pergunta de exemplo com SQL recusado duas vezes: erro com o motivo e o aviso de consulta corrigida.
- Abrir conversa antiga, ver o histórico e continuar.
- Troca de tema.

**Teste manual com tudo real** (API, PostgreSQL, Gemini `gemini-3.5-flash-lite` e Chromium):
- "Qual o faturamento total por categoria de produto?" → SQL, gráfico de barras, tabela com 5 linhas e explicação; nenhum erro no console do navegador.
- Capturas de tela nos dois temas conferidas.
- **A explicação da LLM citou um número errado:** "Livros 1.722.744,49" quando a tabela mostra 1.722.274,49. A tabela, que vem do banco, estava certa; o erro é do modelo ao transcrever (ver §6).

Clone limpo: `pnpm install --frozen-lockfile` + `pnpm verify` — resultado em §4.

## 4. Erros e problemas encontrados
- **Bug encontrado pelo E2E: a primeira pergunta de uma conversa nova era cancelada pela própria tela.** Ao criar a conversa, a tela passava a selecioná-la, e a regra "trocou de conversa, cancela a resposta em andamento" abortava o stream que tinha acabado de começar. Os testes de componente não pegaram porque o `fetch` falso ignorava o cancelamento. Correção: a resposta guarda a conversa a que pertence, e selecionar essa mesma conversa não cancela nada. O `fetch` falso dos testes passou a respeitar o cancelamento; confirmei que, com o bug reintroduzido, tanto o teste de componente quanto o E2E falham.
- **Segundo bug, achado ao reforçar o teste:** quando a resposta terminava, o cartão trocava de identificador (do provisório para o id gravado no banco) e o React recriava o cartão inteiro, com gráfico e editor sendo desenhados de novo. Agora o identificador na tela é estável e o id da mensagem fica num campo separado.
- **Node 24.15 da máquina:** a verificação foi feita com o Node 24.21 portátil (pasta temporária) por causa da queda intermitente diagnosticada na Fase 05. Seu Node instalado continua 24.15.
- **Clone limpo:** PREENCHER.
- **Um falso alarme investigado:** na captura do tema escuro, o item selecionado da lista parecia claro. Medi o estilo calculado e era a transição de cor de 150 ms capturada no meio. Não é defeito.

## 5. Decisões que preciso que você tome
Ação sua, fora do código (repetida da Fase 05):
- **Atualizar o Node.js da máquina para 24.21 ou mais recente.**

Para a Fase 07 (revisar e editar o SQL antes de executar):
1. **Modo de revisão: sempre ou opcional?** Opções: (a) uma chave "revisar antes de executar" na tela, desligada por padrão — quem quer agilidade continua com o fluxo atual; (b) sempre revisar. Recomendo (a).
2. **Contrato da API para a revisão.** Proposta: a pergunta passa a aceitar `mode: "review"`; nesse modo o stream termina com um evento `review` trazendo o SQL gerado, sem executar. A execução do SQL aprovado ou editado vai para um novo endpoint, `POST /api/internal/conversations/:id/messages/:messageId/execute`, que passa pela mesma guarda SQL e grava se o SQL foi editado (auditoria). Alternativa: um endpoint só para "gerar SQL" e outro para "executar". Recomendo a proposta, por reaproveitar o stream e o histórico.

## 6. Dívida técnica / pontos de atenção
- **A explicação da LLM pode errar números,** como no teste manual. A tabela e o gráfico vêm direto do banco e são a fonte confiável. Mitigações possíveis: instruir o modelo a citar menos números, ou a explicação apontar para a tabela. Fica registrado para avaliar com mais uso.
- **Tabela sem paginação nem ordenação:** até 1000 linhas em rolagem.
- **Realce do SQL no tema escuro** usa as cores padrão do CodeMirror, pensadas para fundo claro; legível, mas com contraste menor nas palavras-chave.
- **Sem roteador:** recarregar a página volta para a tela inicial (a conversa continua na lista).
- **Endpoints internos sem autenticação** até a Fase 08 (D-28); o frontend depende da flag `INTERNAL_QUERY_ENDPOINT_ENABLED=true`.
- **Bundle:** Recharts e CodeMirror aumentam o pacote do frontend; divisão de código não foi feita.
- **Dívidas herdadas:** TypeScript 6.0, `dev` da API sem watch, tokens do resumo e de respostas com erro não contabilizados.

## 7. Próximo passo proposto
- Push, PR, CI verde e squash merge conforme a D-12.
- **Fase 07 — Human-in-the-loop**, depois das respostas de §5.
