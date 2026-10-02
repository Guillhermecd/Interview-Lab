# CLAUDE.md — Protocolo de execução

Este arquivo é lido automaticamente pelo Claude Code. As regras abaixo valem para
**toda** sessão de trabalho neste repositório e não podem ser puladas.

## 1. Antes de qualquer ação

1. Ler **todos** os arquivos da pasta `template/`, começando por `template/RECOMENDACOES.md`.
2. Ler `PLANO.md` e identificar a fase atual (primeira fase com status diferente de `CONCLUÍDA`).
3. Ler `DECISOES.md`. Se a fase atual depender de uma decisão com status `PENDENTE`,
   **parar** e perguntar ao Guilherme antes de escrever qualquer código.
4. Confirmar em uma mensagem curta: fase atual, o que será feito, decisões já tomadas
   que se aplicam. Aguardar o "ok" antes de começar.

## 2. Regra de decisão — o Claude não decide, pergunta

O Claude **pergunta e aguarda resposta** sempre que houver:

- escolha de biblioteca, framework, ferramenta ou serviço;
- mudança de estrutura de pastas, arquitetura, contrato de API ou schema de banco;
- qualquer item que contradiga `PLANO.md`, `DECISOES.md` ou `template/`;
- trade-off com mais de um caminho razoável;
- erro cuja correção exija mudar algo fora do escopo da fase;
- qualquer ação irreversível ou externa (push, abrir PR, merge, deploy, apagar arquivos).

Ao perguntar: apresentar as opções, o custo de cada uma e uma recomendação — mas
**não executar** até receber a resposta. Toda decisão tomada é registrada em `DECISOES.md`.

Detalhes de implementação dentro de uma decisão já tomada (nome de variável local,
organização interna de uma função) **não** exigem pergunta, mas devem aparecer no relatório.

## 3. Fluxo de trabalho por fase

1. Atualizar `main` e criar a branch da fase: `feature/fase-XX-nome-curto`.
2. Implementar em commits pequenos, no padrão **Conventional Commits**.
3. Ao terminar, rodar a verificação local completa (ver `template/RECOMENDACOES.md` §Verificação):
   lint → typecheck → testes unitários → testes de integração → build.
4. Se algo falhar: **não** contornar (nada de `skip`, `--no-verify`, comentar teste).
   Registrar o erro no relatório e perguntar como seguir.
5. Com tudo verde, gerar o relatório da etapa em `docs/relatorios/fase-XX.md`
   usando `template/RELATORIO_ETAPA.md` e apresentá-lo ao Guilherme.
6. Somente após aprovação explícita: push e abertura do PR usando
   `.github/pull_request_template.md`.
7. O merge só acontece com o CI verde e é feito pelo Guilherme.

## 4. Proibido

- Commitar segredos, `.env`, chaves de API.
- Alterar arquivos da pasta `template/` sem pedido explícito.
- Trabalhar direto na `main`.
- Iniciar a próxima fase sem o relatório da fase anterior aprovado.
