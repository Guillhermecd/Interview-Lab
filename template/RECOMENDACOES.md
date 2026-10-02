# template/RECOMENDACOES.md

> Lido pelo Claude Code antes de qualquer execução. Versão inicial — o Guilherme pode
> substituir ou complementar com o próprio template de padrões.

## Princípios
- Clean Code e SOLID; funções pequenas, nomes descritivos em inglês no código, documentação em português.
- TypeScript `strict`, sem `any` sem justificativa no PR.
- Configuração via variáveis de ambiente validadas na inicialização; nunca valores sensíveis no código.
- Cada módulo testável isoladamente (dependências injetadas, provedor de LLM atrás de interface).

## Segurança — regras inegociáveis
1. **Defesa em camadas.** O usuário read-only do banco é a fronteira real; a guarda SQL é a segunda camada;
   timeout e limite de linhas são a terceira. Nenhuma camada substitui outra.
2. Toda query — gerada pela IA **ou editada pelo usuário** — passa pela guarda SQL no backend.
3. Validação sempre sobre AST do parser, nunca por regex/string.
4. A role read-only só enxerga as tabelas expostas; tabelas da aplicação (usuários, tokens) ficam fora do alcance dela.
5. Dados retornados do banco são enviados à LLM só para explicação e tratados como conteúdo não confiável
   (podem conter texto tentando instruir a IA — prompt injection).
6. Logs nunca contêm chave de API, JWT ou linhas de resultado.
7. Rate limit e cota checados **antes** de chamar a LLM.

## Verificação local (obrigatória antes de propor PR)
Executar na ordem, tudo deve passar:
1. lint
2. typecheck
3. testes unitários
4. testes de integração (Postgres real via container)
5. build de todos os apps

Comandos (definidos na Fase 00), executados na raiz do repositório:

| Etapa | Comando |
|---|---|
| 1. lint | `pnpm lint` (ESLint + checagem do Prettier) |
| 2. typecheck | `pnpm typecheck` |
| 3. testes unitários | `pnpm test` |
| 4. testes de integração | `pnpm test:integration` (exige Docker em execução) |
| 5. build | `pnpm build` |

`pnpm verify` roda as cinco etapas na ordem e para na primeira falha. O CI
(`.github/workflows/ci.yml`) executa os mesmos comandos.

## Testes
- Toda regra da guarda SQL tem teste positivo e negativo.
- Bug corrigido → teste que reproduz o bug antes da correção.
- Proibido: `skip`, `only`, apagar ou enfraquecer asserção para o CI passar.

## Commits e PR
- Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`).
- PR pequeno, uma fase por PR, descrição usando `.github/pull_request_template.md`.

## Checklist de segurança (revisado na Fase 09)
- [ ] Role read-only testada contra DDL/DML
- [ ] `statement_timeout` na role e timeout na aplicação
- [ ] Guarda SQL com corpus de ataques passando
- [ ] SQL editado revalidado no backend
- [ ] Segredos apenas em variáveis de ambiente / secrets do CI
- [ ] Rate limit e cota ativos
- [ ] Erros do banco não vazam detalhes internos
