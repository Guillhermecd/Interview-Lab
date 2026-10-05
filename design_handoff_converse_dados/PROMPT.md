# Prompt para o Claude Code (cole no terminal, na raiz do projeto)

> Antes: copie a pasta `design_handoff_converse_dados/` para a raiz do repositório.

---

Você vai implementar no projeto o design do produto **"Converse com seus dados"** da empresa fictícia **Rota Materiais**: um dashboard operacional e um chat com IA que gera SQL, pede revisão humana, executa e devolve tabela, gráfico e explicação em streaming.

A especificação completa está em `design_handoff_converse_dados/README.md`. Os arquivos em `design_handoff_converse_dados/design/*.dc.html` são **referências visuais em HTML**: abra-os no navegador para ver aparência e comportamento, mas **não copie esse código**. Recrie tudo com as convenções deste repositório.

## Passo 0: entenda o projeto antes de escrever código
1. Leia `package.json`, a estrutura de pastas, o roteador, a solução de estilos (CSS Modules, Tailwind, styled-components etc.), a biblioteca de gráficos (se houver) e como o projeto chama APIs.
2. Leia o `README.md` do handoff inteiro.
3. Antes de implementar, me mostre um plano curto com: arquivos que vai criar ou alterar, onde ficam os tokens de tema, qual lib de gráficos vai usar (prefira a que já existe; senão, Recharts) e como vai simular a API. **Espere minha aprovação.**

## Escopo, em etapas (um commit por etapa)
1. **Tokens e tema**: variáveis de cor claro/escuro exatamente como no README (`--bg`, `--surface`, `--accent`, `--crit`, `--warn`, `--ok` etc.), fontes Instrument Sans (UI) e JetBrains Mono (somente SQL, nomes de coluna e números de tabela), toggle de tema persistido em `localStorage`.
2. **Componentes base**, em React + TypeScript, com as props do README:
   - `KpiCard`: valor, variação, sparkline, botão "Perguntar sobre isto". A cor da variação vem de `sentiment`, não da direção.
   - `SqlBlock`: syntax highlight; selos Validado/Bloqueado com motivo; selo "Editado por você"; modos `generating | review | running | view`; editor para editar; botões Executar, Editar e Copiar; rodapé de revisão com Cancelar, Editar e Aprovar e executar.
   - `Alert`: variantes `crit | warn | ok | info`, com contagem regressiva, medidor e ações opcionais.
   - `AiMessage`: indicador de etapas (SQL → Revisão → Execução → Resultado → Explicação), SqlBlock, resultado em abas Tabela/Gráfico (tipo sugerido e trocável: Barras, Linha, Rosca; Rosca desabilitada com mais de uma série), explicação token a token com cursor e metadados (tempo, linhas, tokens, selo "Resposta do cache"). Estados: `generating, review, running, streaming, done, blocked, timeout, empty, ratelimit, quota`.
3. **Página Dashboard** (`/dashboard`): filtros globais fixos no topo, 6 KPIs, 5 gráficos, 2 tabelas, grid responsivo (1440 e 834) conforme o README.
4. **Chat suspenso no dashboard**: botão flutuante "Converse com seus dados" no canto inferior direito. Ele abre uma **janela suspensa** de 420 × 680px (`right: 24px; bottom: 24px`, raio de 12px, sombra) por cima do conteúdo, sem empurrar o layout. O cabeçalho tem os botões Tela cheia (link para `/chat`), Minimizar (recolhe a uma aba de 48px e mantém a conversa) e Fechar (volta ao botão flutuante). Todo "Perguntar sobre isto" abre a janela expandida com o chip de contexto e a pergunta preenchida no composer.
5. **Página Chat** (`/chat`): lista de conversas à esquerda (264px), conversa no centro (máx. 900px), painel de schema à direita (300px, recolhível, fechado por padrão abaixo de 1200px), medidor de tokens do dia no cabeçalho, composer com o interruptor "Revisar SQL antes de executar" e estado de conversa vazia com 6 sugestões.
6. **Camada de dados**: crie um serviço `chatApi` com interface tipada para gerar SQL, validar, executar e receber a explicação em streaming. Por enquanto, implemente com mocks usando os dados de exemplo do README. Para o streaming, use um async generator ou `ReadableStream`. A interface deve permitir trocar o mock pelo backend real sem mexer nos componentes.

## Regras
- Interface em pt-BR; valores em R$ com `Intl.NumberFormat('pt-BR')`; datas no formato dd/mm/aaaa.
- Nunca execute SQL sem aprovação quando a revisão estiver ligada. Quando a consulta for bloqueada, o botão Executar fica desabilitado.
- Acessibilidade: botões com `aria-label`, `role="switch"` no interruptor de revisão, foco visível, contraste AA.
- Sem dependências novas além da lib de gráficos e, se necessário, de um highlighter leve. Pergunte antes de adicionar qualquer outra.
- Se o projeto tiver testes, escreva testes para: transições de estado do `AiMessage`, `SqlBlock` marcando "editado" após salvar alteração e bloqueio de execução quando `status="blocked"`.

## Critérios de aceite
- O dashboard em 1440px e em 834px bate com `design/Dashboard Desktop e Tablet.dc.html`.
- O fluxo completo funciona no chat: pergunta → SQL gerado → revisão → aprovar/editar/cancelar → execução → tabela/gráfico → explicação em streaming → metadados.
- Todos os quadros de `design/Estados do Chat.dc.html` podem ser reproduzidos forçando o estado do `AiMessage`.
- Os temas claro e escuro funcionam em todas as telas.
- Lint e typecheck passam.

Ao terminar cada etapa, resuma o que mudou e o que falta.
