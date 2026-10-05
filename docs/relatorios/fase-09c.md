# Relatório — Fase 09c: Design — dashboard operacional

**Branch:** `feature/fase-09c-dashboard`  **Data:** 2026-10-05

Segunda parte da Fase 09. Pela D-49 veio antes da 09b e trouxe o roteador e a barra
superior.

## 1. O que foi feito
- **Plano e decisões:** nova ordem dos PRs (09c → 09e → 09b → 09d) e a Fase 09e "Cadastro" no `PLANO.md`; decisões D-49 a D-57 no `DECISOES.md`.
- **Banco (migration `1790899200006_add-distribution-and-stock.sql`):**
  - tabelas novas `sales.distribution_centers`, `sales.stock_levels` e `sales.stock_movements`;
  - `sales.products` ganhou `sku`, `unit`, `cost` e `active`; `sales.orders` ganhou `distribution_center_id`, `expected_delivery_at` e `delivered_at`;
  - regras no próprio banco: quantidade positiva (só ajuste tem sinal), destino obrigatório e diferente da origem só em transferência, entrega nunca antes do pedido;
  - `GRANT SELECT` das tabelas novas à `app_readonly`.
- **Seed "Rota Materiais":** 5 regiões, 9 centros de distribuição, 200 materiais em 5 categorias, 500 clientes, 20 mil pedidos em 24 meses e cerca de 147 mil movimentações. Todo saldo de estoque é a soma das suas movimentações.
- **Guarda SQL e IA:** as três tabelas novas entraram na allowlist; a IA passa a enxergá-las no contexto do prompt.
- **API — quatro rotas, para qualquer usuário autenticado:**
  - `GET /api/dashboard/filters`: opções dos filtros;
  - `GET /api/dashboard/overview`: 6 indicadores, série de faturamento, faturamento por região, top 10, estoque por centro e curva ABC, para um período e comparados ao anterior;
  - `GET /api/dashboard/stock-alerts`: materiais abaixo ou perto do mínimo, com contagem por status;
  - `GET /api/dashboard/stock-movements`: últimas movimentações.
- **Web:**
  - roteador (`react-router-dom`): `/dashboard` (tela inicial) e `/chat`, cada tela carregada sob demanda;
  - barra superior com marca, navegação, tema, iniciais e nome do usuário, e "Sair";
  - página do dashboard: filtros fixos (período, intervalo personalizado, centro, região, categoria), 6 indicadores com `KpiCard`, 5 gráficos, 2 tabelas com chips de filtro, grid responsivo;
  - "Perguntar" em cada card leva ao chat com a pergunta e o contexto escritos no composer.
- **Testes:** API unitários de 448 para 511 e integração de 204 para 250; web de 149 para 179; E2E de 7 para 11.
- **Documentação:** `README.md` (banco, rotas, telas, fases) e `.env.example` (`ON_TIME_DELIVERY_TARGET_PERCENT`).

## 2. Por que foi feito assim
- **Todo número vem do backend (D-57).** Totais, variações, tendência, cor da variação, status dos alertas, classes ABC, série acumulada e o próprio período de comparação são calculados na API. O frontend só formata e desenha. As regras estão em `apps/api/src/dashboard/dashboard-rules.ts` e foram registradas na D-57 para você revisar: são regras de negócio que escolhi na implementação.
- **Leitura pelo pool somente leitura (D-54), por um serviço novo.** O `FixedReadQuery` executa SQL escrito no código, com valores sempre por parâmetro, como `app_readonly`, em transação somente leitura e com o mesmo `statement_timeout`. **Mudei de propósito um teste de fronteira de segurança:** `query.module.test.ts` travava a lista de exports do módulo de consulta em três itens; agora são quatro, e acrescentei um teste que garante que o pool e o executor sem guarda continuam fora dos exports. Texto vindo do usuário ou da IA continua passando só pela guarda.
- **Estoque do passado reconstruído pelas movimentações.** Variação do valor em estoque, "abaixo do mínimo" no início do período e os minigráficos saem do saldo de hoje menos o que movimentou depois. Onde não há como calcular (período sem saída, sem entrega), o indicador mostra "—" e não há minigráfico, em vez de um número inventado.
- **Saldo do seed igual à soma das movimentações.** É o que a 09e precisa: lá o saldo será atualizado a cada lançamento, e partir de um saldo que não fecha seria um erro permanente. Há teste de integração provando que fecha.
- **`products.active` já nesta migration.** A D-56 escolheu arquivar em vez de excluir; criar a coluna agora evita outra migration que apaga dados na 09e.
- **Detalhes escolhidos sem pergunta:**
  - Período padrão "Mês" (do dia 1 até hoje), como no handoff. No início do mês a tela fica com poucos dias.
  - Filtros são aplicados de verdade (nova consulta); o protótipo só esmaecia os itens fora do filtro.
  - As consultas de cada tela rodam em lotes de até quatro, porque o pool somente leitura é dividido com o chat.
  - Movimentação pertence a um centro quando ele é origem ou destino.
  - Valores monetários somados no backend e arredondados a centavos.
  - Código dividido por rota: o aviso de bundle acima de 500 kB da 09a sumiu (maior arquivo: 376 kB).

## 3. Verificação
`pnpm verify` completo, com Node 24.21.

| Etapa | Resultado | Observação |
|---|---|---|
| Lint | ✅ | ESLint + Prettier |
| Typecheck | ✅ | |
| Testes unitários | ✅ | 690 passaram / 690 total (API 511, web 179) |
| Testes de integração | ✅ | 250 passaram / 250 total |
| Build | ✅ | sem aviso de tamanho |
| E2E | ✅ | 11 passaram / 11 total |

Os testes de integração do dashboard usam um conjunto pequeno de dados feito à mão, com
cada resultado conferido no comentário do teste (faturamento, estoque reconstruído,
cobertura, status, ABC, fuso horário, filtros). Um segundo bloco roda as mesmas rotas
sobre o seed completo, para provar que cabem no limite de 5 s.

Conferência visual por capturas de tela com a API e o seed reais: 1440 px (claro e
escuro) e 834 px.

## 4. Erros e problemas encontrados
- **Três testes de integração antigos falharam** por descreverem o schema anterior (lista de tabelas e colunas de `orders`). Atualizados para o schema novo; nenhuma asserção foi removida.
- **Teste E2E da navegação para o chat falhava** por causa do seletor: com o campo já preenchido, a busca pelo rótulo "Pergunta" não o encontrava e ainda casava com os botões "Perguntar sobre isto". A tela estava certa; troquei o seletor para o papel `textbox`.
- **API local não reiniciou na primeira tentativa:** o processo antigo continuou segurando a porta 3000. Encerrei o processo que eu mesmo tinha iniciado nesta sessão e subi de novo.
- **Tipo errado numa linha do repositório:** `quantity` vinha do banco como texto (inteiro menos uma soma `bigint`) e estava declarado como número. O lint acusou; corrigido.
- **Ajustes vistos nas capturas:** selo de variação quebrava linha, coluna "Material" ficava cortada, e as últimas movimentações do seed tinham todas o mesmo horário. Corrigidos.

## 5. Decisões que preciso que você tome
- **Revisar as regras da D-57.** Em especial: limiares dos alertas (crítico até 5 dias de cobertura; "OK" até 20% acima do mínimo), classes ABC (80% / 95%), "Mês" como mês corrente até hoje, e comparação sempre com o período anterior de mesma duração. Estão implementadas e testadas; mudar qualquer uma é trocar uma constante.
- **Merge deste PR:** `! gh pr merge <número> --squash`, com o CI verde.
- **Antes da 09e (cadastro), duas confirmações:** o nome da variável do e-mail do administrador (proponho `ADMIN_EMAIL`) e o nome da role de escrita no banco (proponho `app_catalog_rw`). Nada da 09e foi executado.

## 6. Dívida técnica / pontos de atenção
- **Seu banco local foi migrado e recarregado.** Rodei `db:migrate` e `db:seed` no ambiente local para conferir a tela: os dados de demonstração antigos de `sales` foram substituídos, como previsto na D-50. Usuários e conversas não foram tocados.
- **O prompt da IA ficou maior** (8 tabelas em vez de 5), então cada pergunta gasta mais tokens. **Não testei o chat com a IA real:** a `GEMINI_API_KEY` está vazia no `.env` local. Vale rodar a avaliação da Fase 04 de novo quando houver chave.
- **`evaluation-questions.ts` ainda fala em "categoria de produto"**, que continua válido, mas as perguntas não cobrem estoque nem centros de distribuição.
- **Seed mais lento:** cerca de 11 s (antes, 1 a 2 s). Ele roda em seis suítes de integração.
- **Diferenças em relação ao handoff:**
  - "Perguntar" navega para `/chat`; a janela suspensa é a 09d.
  - Sem "atualizado há 4 min": a tela mostra "Dados até" com a hora da resposta.
  - Rótulos de comparação genéricos ("vs. anterior", "Período anterior") em vez de "vs. agosto".
  - Sem tooltip por dia com a variação no gráfico de linha; o tooltip mostra os dois valores e as duas datas.
  - "Ver todos" e "Ver histórico" não existem: as tabelas mostram 8 linhas.
  - O avatar mostra iniciais e nome, sem cargo (D-48).
- **Larguras das barras são calculadas no frontend** (cada valor contra o maior da tela). É só desenho, a mesma exceção consciente da rosca na 09a.
- **Região do faturamento é a do centro de distribuição (D-52).** A região do cliente continua no banco, e a IA pode usar qualquer uma das duas numa resposta; os números do chat e do dashboard podem diferir se a pergunta não disser qual.
- **Limiares e fuso são constantes no código**, não configuração.

## 7. Próximo passo proposto
- **Fase 09e — Cadastro de materiais e movimentações (D-56):** role de escrita própria e pool separado, papel de administrador, CRUD de materiais (excluir arquiva), lançamento de movimentações que atualiza o saldo na mesma transação, tela "Cadastro" e invalidação do cache a cada escrita. Depende das duas confirmações do §5.
