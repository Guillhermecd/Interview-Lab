# Handoff: Converse com seus dados (Rota Materiais)

## Visão geral
Uma aplicação web B2B com duas telas:
1. **Dashboard operacional** para os gerentes de operações e comercial.
2. **Chat "Converse com seus dados"**: o usuário pergunta em linguagem natural, a IA gera o SQL, o usuário revisa e aprova (human-in-the-loop), e o resultado volta como tabela, gráfico e explicação em streaming.

O chat também fica disponível dentro do dashboard como **janela suspensa**.

## Sobre os arquivos de design
Os arquivos em `design/` são **protótipos em HTML que servem de referência** de aparência e comportamento. Não são código de produção. A tarefa é **recriá-los no ambiente do repositório** (React + TypeScript, com os padrões e bibliotecas já usados). Para ver os protótipos, abra os `.dc.html` no navegador; eles precisam do `support.js` na mesma pasta.

## Fidelidade
**Alta fidelidade.** Cores, tipografia, espaçamentos, estados e interações são finais. Recrie fielmente.

---

## Design tokens

### Cores (claro / escuro)
| Token | Claro | Escuro | Uso |
|---|---|---|---|
| --bg | #f3f3f0 | #0e0f11 | Fundo da página |
| --surface | #ffffff | #16171a | Cards, painéis |
| --surface-2 | #f8f8f6 | #1b1d20 | Cabeçalhos de tabela, barras |
| --surface-3 | #efefeb | #24262a | Hover, segmentado, bolha do usuário |
| --line | #e3e2dc | #2a2c30 | Bordas |
| --line-2 | #cfcec7 | #3a3d42 | Bordas de inputs e botões secundários |
| --text | #16171a | #ececed | Texto principal |
| --text-2 | #53565c | #a6a9af | Texto secundário |
| --text-3 | #73767c | #8a8d94 | Rótulos, metadados |
| --accent | #3346d3 | #7486ff | Destaque único: ações primárias, série atual |
| --accent-hover | #2a3bb8 | #8a99ff | |
| --accent-soft | #eaecfb | #1d2240 | Fundo de destaque |
| --accent-text | #2c3cb5 | #a3aeff | Texto em destaque |
| --on-accent | #ffffff | #0e0f11 | Texto sobre o accent |
| --crit / --crit-soft | #c42f28 / #fbebea | #f0675f / #341b1a | Crítico, bloqueado, variação ruim |
| --warn / --warn-soft | #9a5b00 / #fbf0dc | #e5a33c / #33270f | Atenção, timeout, rate limit |
| --ok / --ok-soft | #1c7548 / #e4f2ea | #4cc48b / #12301f | OK, validado, variação boa |
| --code-bg | #f7f7f4 | #121315 | Fundo do SQL |
| --prev | #c3c2bb | #4a4d53 | Série do período anterior |
| --c1…--c5 | #3346d3 #58a6e0 #8f74d9 #5fae9b #cda86a | #7486ff #5fb4ec #a68cf0 #6cc2ad #d6b77c | Séries categóricas (categorias de material) |
| Syntax: kw / fn / str / num / com / id | #3346d3 #8b3fb8 #1c7548 #b0520a #8b8d92 #16171a | #8b9bff #d199f0 #6fd3a0 #f0a868 #6c7077 #dfe0e2 | Highlight SQL. Comandos perigosos (DELETE, UPDATE, INSERT, DROP, TRUNCATE, ALTER) usam --crit em 600 |

**Semântica fixa:** crítico/atenção/ok são usados apenas para status; validado = ok; bloqueado = crit; editado = accent.

### Tipografia
- UI: **Instrument Sans** 400/500/600/700. Números de KPI e gráficos usam `font-variant-numeric: tabular-nums`.
- **JetBrains Mono** apenas para SQL, nomes de coluna, números de tabela, datas em tabela e metadados.
- Escala: título da página 20/600 (−0.015em); título de card 14/600; corpo 13–14; rótulos 12–12.5; metadados 11.5; valor de KPI 24/600; SQL 12.5/1.65.

### Espaçamento, raio e sombra
- Padding da página 24px; gap entre cards 12px; padding de card 14–16px.
- Raios: card 8px; botão 6px; badge 4px; janela suspensa 12px; composer 10–12px; chip 13px (pill).
- Altura dos controles: 26px (pequeno), 28px, 32px (filtros), 44px (botão flutuante).
- Sombra elevada: `0 12px 40px rgba(20,20,30,.16)` no claro e `0 16px 48px rgba(0,0,0,.5)` no escuro.

---

## Tela 1: Dashboard (`design/Dashboard.dc.html`)
- **Top bar** (52px, fundo surface): logo "Rota Materiais", navegação (Dashboard | Converse com seus dados, aba ativa com borda inferior de 2px em accent), toggle de tema, avatar "CS · Carla Souza · Gerente de operações".
- **Título**: "Operações e vendas" + "Dados até 30/09/2026 23:59 · atualizado há 4 min" + dica do ícone de perguntar.
- **Filtros fixos** (`position: sticky`): segmentado de período (7 dias, 30 dias, Mês, Trimestre, Ano, Personalizado), botão de intervalo "01/09/2026 – 30/09/2026 vs. agosto" com popover De/Até, dropdowns Centro de distribuição / Região / Categoria (o filtro ativo fica com borda accent e fundo accent-soft) e "Limpar filtros".
- **KPIs**: `grid-template-columns: repeat(auto-fit, minmax(190px, 1fr))`.
  - Faturamento do período: R$ 43,80 mi, −1,8%, ruim.
  - Pedidos de venda: 2.384, −1,9%; ticket médio R$ 18.372.
  - Valor total em estoque: R$ 128,4 mi, +2,6%, neutro.
  - Giro de estoque: 36 dias, +3 dias, ruim.
  - Itens abaixo do estoque mínimo: 47, +18; 12 críticos.
  - Pedidos entregues no prazo: 92,4%, −1,8 p.p.; meta de 95%.
- **Gráficos**: `repeat(auto-fit, minmax(min(100%, 370px), 1fr))`.
  1. Faturamento ao longo do tempo (linha, `grid-column: span 2`): setembro em accent, sólido e com área a 8%; agosto tracejado em text-3. Alterna entre Diário e Acumulado e mostra tooltip por dia com a variação.
  2. Faturamento por região: barras horizontais (atual 12px em accent, anterior 4px em --prev) com valor e variação colorida.
  3. Top 10 materiais: ranking com barras finas coloridas por categoria.
  4. Estoque por CD: barras horizontais empilhadas pelas 5 categorias (c1…c5), 9 CDs.
  5. Curva ABC: curva acumulada com faixas A (0–20%), B (20–50%) e C; resumo A 436 SKUs 80,0% · B 654 SKUs 10,8% · C 1.090 SKUs 9,2%.
- **Tabelas**: `repeat(auto-fit, minmax(min(100%, 560px), 1fr))`.
  - Alertas de ruptura: Material, CD, Estoque atual (com mini barra de % do mínimo), Mínimo, Cobertura, Status (pill). Chips de filtro: Todos 56, Crítico 12, Atenção 35, OK 9.
  - Últimas movimentações: Data/hora, Tipo (Entrada, Saída, Transferência, Ajuste), Material, CD (origem → destino na transferência), Quantidade com sinal, Responsável + documento. Chips de filtro por tipo.
- **Cada card e gráfico** tem o botão "Perguntar sobre isto"/"Perguntar". Ele abre o chat suspenso com contexto (ex.: "Faturamento por região · Set/2026") e pergunta sugerida (ex.: "Por que o faturamento do Sudeste caiu em setembro?").
- **Tablet (834)**: KPIs em 3 por linha, gráficos em 2 colunas (o de linha ocupa a largura toda), tabelas empilhadas, filtros quebram em várias linhas. Veja `design/Dashboard Desktop e Tablet.dc.html`.

### Chat suspenso no dashboard
- **Fechado**: botão flutuante `position: fixed; right: 24px; bottom: 24px`, 44px de altura, pill em accent, com ícone e "Converse com seus dados".
- **Aberto**: janela `position: fixed; right: 24px; bottom: 24px; width: min(420px, 100vw − 32px); height: 680px; max-height: calc(100vh − 48px)`, raio 12px, borda --line-2, sombra elevada, sobreposta sem deslocar o layout.
  - Cabeçalho (48px, surface-2): ícone, título (clicável, alterna minimizar), "Tela cheia" (→ /chat), Minimizar (chevron que gira 180° quando minimizado) e Fechar.
  - Corpo: sem mensagens, mostra introdução e 4 sugestões; com mensagens, mostra bolha do usuário (com "Contexto: …") e AiMessage.
  - Composer: chip de contexto removível, textarea (Enter envia, Shift+Enter quebra linha), botão de envio de 32px e interruptor "Revisar SQL antes de executar".
- **Minimizado**: só o cabeçalho, com 48px de altura. Estado preservado.

## Tela 2: Chat (`design/Chat.dc.html`)
- Layout de 3 colunas abaixo da top bar: **conversas** (264px, surface-2), **conversa** (flex, conteúdo com máx. 900px), **schema** (300px, recolhível; fechado por padrão em telas com menos de 1200px).
- **Lista**: botão "Nova conversa", busca, grupos Hoje / Ontem / Últimos 7 dias. Cada item tem badge de estado (Aguardando revisão, Bloqueada, Timeout).
- **Cabeçalho da conversa**: título, medidor "Tokens hoje" (barra de 120px; accent, warn acima de 75%, crit acima de 90%; "182.430 / 500.000") e toggle Schema. O cabeçalho quebra em várias linhas quando falta largura.
- **Mensagens**: bolha do usuário à direita (surface-3, raio 12 12 3 12) com "Você · hh:mm"; abaixo, o AiMessage.
- **Composer**: textarea, interruptor de revisão, dica de teclado, botão Enviar. Abaixo: "A IA só lê dados. Toda consulta passa pela validação de segurança antes de ser executada."
- **Schema**: 7 tabelas e 2 views, expansíveis, com colunas, tipos e marcadores PK/FK. Um ponto em accent marca as tabelas usadas na última consulta. Rodapé "Fora do escopo da IA" com as tabelas bloqueadas.
- **Conversa vazia**: título "O que você quer saber sobre a operação?" e 6 sugestões em grid. Clicar numa sugestão envia a pergunta.

## Componentes (`design/Componentes.dc.html`)
### KpiCard
`label, value, delta, trend ('up'|'down'|'flat'), sentiment ('good'|'bad'|'neutral'), compareLabel, sub?, spark: number[], onAsk()`

### SqlBlock
`sql, mode ('generating'|'review'|'running'|'view'), status ('validated'|'blocked'), reason?, edited, blockedToken?, visibleChars?, elapsed?, onApprove({sql, edited}), onCancel(), onRun({sql, edited}), onEdit(sql)`
- Cabeçalho: "SQL · PostgreSQL · réplica de leitura", selo, motivo (ex.: "Somente leitura · LIMIT 1000 aplicado"; "Revalidado após sua edição"; "Comando DELETE não permitido · apenas SELECT"), selo "Editado por você" e ações.
- `review`: borda em accent a 45% e rodapé em accent-soft: "Revisão necessária. Confira a consulta antes de executar no banco." + Cancelar / Editar / Aprovar e executar.
- `running`: spinner, "Executando consulta… 2,4 s · limite de 30 s", Interromper.
- `blocked`: borda crit, linha ofensiva com fundo crit-soft, Executar desabilitado, rodapé "Não executada…".
- `view` com mais de 8 linhas: mostra as 4 primeiras e o link "Mostrar consulta completa · N linhas".
- Edição: textarea mono com outline em accent; "Descartar" / "Salvar alterações"; salvar uma alteração ativa `edited`.

### AiMessage
`state, data/scenario, autoplay, reviewEnabled, time, onDone(tokens)`
- Ordem: etapas → SqlBlock → (esqueleto enquanto executa) → resultado (Tabela | Gráfico, "Sugerido: Barras", segmentado Barras/Linha/Rosca, "Exportar CSV", "Mostrando 6 de 47 linhas · Ver todas") → explicação com cursor → metadados.
- Transições: generating → (bloqueado ? blocked : reviewEnabled ? review : running); aprovar → running → (timeout ? timeout : streaming) → done; cancelar → cancelled ("Revisar de novo").
- Streaming: 1 palavra a cada ~38 ms; o contador de tokens sobe proporcionalmente; cursor de 7px em accent piscando (`steps(1)`, 1 s).

### Alert
`variant ('crit'|'warn'|'ok'|'info'), title, body, countdown? (s), countdownLabel, meterUsed?, meterTotal?, actions: string[], onAction(label)`
- Fundo soft, borda com a cor semântica a 28%, ícone semântico. Contagem em mono: mm:ss, ou h:mm:ss acima de 1 h.

## Estados obrigatórios (`design/Estados do Chat.dc.html`)
Conversa vazia · Gerando SQL · Aguardando revisão · Revisão com SQL editado · Executando · Explicação em streaming · Resposta do cache · Bloqueado (DELETE) · Timeout (30 s) · Resultado vazio · Rate limit (20/min, fila, 00:42) · Cota de tokens (500.000, renova à meia-noite, composer bloqueado) · versões no tema escuro.

## Dados de exemplo
Os textos, SQLs e linhas estão em `design/AiMessage.dc.html` (constante `D`) e `design/Dashboard.dc.html` (constantes `REGIONS`, `TOP`, `STOCK`, `ALERTS`, `MOVES`). Exemplo principal (Sudeste, ago → set 2026): Duque de Caxias 3.210.700 → 2.601.300 (−19,0%), Contagem 4.820.300 → 3.912.150 (−18,8%), Campinas 6.105.900 → 5.987.400 (−1,9%), Serra 1.480.100 → 1.462.900 (−1,2%), Guarulhos 5.430.200 → 5.512.800 (+1,5%).

## Ícones
Ícones de traço desenhados inline: 16×16 no viewBox, traço de 1.6, pontas arredondadas. Pode trocar pela biblioteca de ícones do projeto (ex.: Lucide), usando os equivalentes: message-square, play, pencil, copy, shield-check, shield-x, clock, rows, hexagon, zap, alert-triangle, database, arrow-up, chevron-down, x, maximize, lock.

## Arquivos
- `design/Dashboard.dc.html`: dashboard + chat suspenso
- `design/Chat.dc.html`: tela do chat
- `design/AiMessage.dc.html`, `design/SqlBlock.dc.html`, `design/KpiCard.dc.html`, `design/Alert.dc.html`: componentes
- `design/Estados do Chat.dc.html`: prancha de estados
- `design/Componentes.dc.html`: prancha de componentes e tokens
- `design/Dashboard Desktop e Tablet.dc.html`: comparação responsiva
- `PROMPT.md`: prompt pronto para o Claude Code
