# Relatório — Fase 08: Autenticação, tokens por usuário, rate limit e cache

**Branch:** `feature/fase-08-auth-limites`  **Data:** 2026-10-03

## 1. O que foi feito
- **Decisões registradas** em `DECISOES.md`: D-08 (JWT próprio em cookie `HttpOnly`), D-07b (Redis), D-34 (10 perguntas/min e 200 mil tokens/dia por usuário), D-35 (conversas antigas ficam sem dono), D-36 (`jose`, `@fastify/cookie`, `ioredis`) e D-37 (rate limit próprio, janela fixa de 1 minuto).
- **Migration `1790899200005_add-users-and-usage.sql`:**
  - `app.users` (e-mail único em minúsculas, nome, hash da senha);
  - `app.conversations.owner_id`, com chave estrangeira e índice por dono + data;
  - `app.token_usage`: consumo por usuário, conversa e tipo de chamada (`answer`, `review`, `execution`, `summary`).
- **Configuração** (`src/config/security-env.ts`): `JWT_SECRET` obrigatório, com no mínimo 32 caracteres e recusado em produção se for o valor de exemplo; validade, origens permitidas, URL do Redis, limites e TTLs do cache.
- **Autenticação** (`src/auth/`):
  - `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
  - Senhas com `scrypt` (N = 2^17, salt aleatório, comparação em tempo constante).
  - JWT HS256 assinado com `jose`, no cookie `interview_lab_session` (`HttpOnly`, `SameSite=Strict`, `Path=/api`, `Secure` em produção).
  - `AuthGuard` e `@CurrentUser` nas rotas protegidas.
  - `OriginGuard` global contra CSRF.
- **Limites** (`src/limits/`):
  - Rate limit por usuário no Redis (`MULTI INCR + EXPIRE`) e por e-mail no login.
  - Cota diária de tokens calculada a partir de `app.token_usage` (dia UTC).
  - `GET /api/usage` com o consumo de hoje, total e por conversa.
  - Registro do consumo de todas as chamadas à LLM: resposta, revisão, execução revisada e resumo da memória.
- **Conversas por dono:** rotas movidas de `/api/internal/conversations` para `/api/conversations`, exigindo sessão; listar, ler e responder só funcionam para o dono (`404` para os demais).
- **Cache no Redis** (`src/ask/answer-cache.ts`):
  - SQL gerado por pergunta normalizada (1 hora).
  - Resultado por SQL (5 minutos).
  - Chaves com a versão do schema (hash da descrição do catálogo).
- **Endpoint interno de SQL:** continua atrás da flag e agora também exige sessão.
- **Frontend:**
  - Tela de login e cadastro, com erros por campo vindos da API.
  - Verificação da sessão ao abrir; volta ao login em qualquer `401`.
  - Rodapé da lista de conversas com "Uso hoje: X de Y tokens", nome do usuário e botão "Sair".
- **Infra:** serviço `redis` (redis:7-alpine) no `docker-compose.yml`; variáveis novas no `.env.example`.
- **Testes:**
  - API: unitários de 416 para 448; integração de 180 para 204.
  - Web: componentes de 52 para 59; E2E de 6 para 7.
  - Os testes de integração sobem Redis próprio via Testcontainers; o CI não precisou mudar.
- **Documentação:** `README.md` com autenticação, limites, cache, rotas novas e o `curl` com cookie; Fase 08 marcada `CONCLUÍDA` no `PLANO.md` (vale com o merge).

## 2. Por que foi feito assim
Entregas do `PLANO.md` e como cada uma foi atendida:

| Entrega | Implementação |
|---|---|
| Cadastro/login (JWT) | `jose` + cookie `HttpOnly` (D-08, D-36) |
| Tokens consumidos por usuário e por conversa | `app.token_usage`, gravado a cada chamada à LLM; `GET /api/usage` e indicador na tela |
| Rate limit por usuário e cota diária | Verificados **antes** de chamar a LLM (regra 7); acima disso, `429` com `RATE_LIMITED` ou `QUOTA_EXCEEDED` |
| Cache de perguntas repetidas | SQL por pergunta normalizada e resultado por SQL, no Redis (D-07b) |

**Contradição com o template:** `template/docs/api-contract.md` prevê o token no header `Authorization` e guardado no `localStorage`. Você escolheu o cookie `HttpOnly` (D-08), que segue esta implementação; o template não foi alterado. O preço do cookie é a proteção contra CSRF, feita em duas camadas:
- `SameSite=Strict`: o navegador não envia o cookie em requisições vindas de outro site.
- `OriginGuard`: requisições que alteram dados com um `Origin` fora de `ALLOWED_ORIGINS` recebem `403`. Requisições sem `Origin` (curl, testes) passam, porque não vêm de um navegador em outro site.

Pontos de segurança:
- **Login não revela se o e-mail existe:** mesma mensagem e mesmo trabalho de `scrypt` (com um hash fictício) para e-mail inexistente e senha errada.
- **Tentativas de login limitadas** a 5 por minuto por e-mail.
- **A cota é verificada antes do rate limit**, para que uma requisição recusada pela cota não gaste a franquia do minuto.
- **O rate limit falha fechado:** se o Redis não responde, a pergunta é recusada com erro antes de chamar a LLM. Esse caso decorre da ordem do código e não tem teste dedicado.
- **O cache falha aberto:** erro no Redis só é registrado no log; a pergunta segue sem cache.
- **SQL vindo do cache passa pela guarda de novo**, como qualquer SQL gerado.
- **O cache de SQL só vale para perguntas sem histórico:** uma continuação ("e no ano anterior?") depende da conversa e sempre vai à LLM.
- **Mudança no banco invalida o cache:** a versão do schema faz parte das chaves.
- **Conversas de outro usuário respondem `404`**, não `403`, para não confirmar que o id existe.

Detalhes escolhidos sem pergunta:
- **Validade do token:** 24 horas (`JWT_EXPIRES_IN=86400`), como no `template/docs/environment.md`.
- **Cadastro:** nome até 100 caracteres, senha de 8 a 128, e-mail guardado em minúsculas.
- **Consumo da memória (resumo)** é contado como uma chamada à LLM do tipo `summary`, ligada à conversa.
- **Resultado em cache é compartilhado entre usuários:** todos consultam o mesmo banco somente leitura com o mesmo papel (`app_readonly`), então o resultado de um SQL é igual para qualquer um.
- **A pergunta é normalizada** para a chave do cache: Unicode NFKC, minúsculas, espaços colapsados, `?` e `!` finais removidos.
- **Testes de integração** usam limites altos e cache desligado por padrão; cada teste de limite ou de cache liga o que precisa.

## 3. Verificação
Executado com `pnpm verify` em Windows 11, pnpm 12.8.1, Docker 29.1.2 e Node 24.21.

| Etapa | Resultado | Observação |
|---|---|---|
| Lint | ✅ | ESLint sem erros; Prettier sem diferenças |
| Typecheck | ✅ | `shared`, `api`, `web` |
| Testes unitários | ✅ | 507 passaram / 507 total (API 448, web 59) |
| Testes de integração | ✅ | 204 passaram / 204 total |
| Build | ✅ | `shared`, `api`, `web` |
| Testes E2E | ✅ | 7 passaram / 7 total |

**Critérios do `PLANO.md`:**
- **Usuário A não vê conversas do usuário B:** a conversa de A não aparece na lista de B; ler o histórico, perguntar e executar uma revisão na conversa de A como B respondem `404`.
- **Rate limit retorna 429 e não chama a LLM:** com limite de 2 perguntas por minuto, a terceira recebe `429 RATE_LIMITED` e o contador de chamadas da LLM falsa não muda. Com a cota esgotada, `429 QUOTA_EXCEEDED`, também sem chamada.

Outros testes de integração (`test/auth/security.integration.test.ts`, 24 testes):
- Cadastro: cookie com os atributos certos e token fora do corpo da resposta; e-mail duplicado em qualquer caixa (`409`); campos inválidos (`400` com detalhes); só o hash da senha no banco.
- Login: senha errada e e-mail inexistente com a mesma resposta; limite de tentativas, que bloqueia até a senha certa no mesmo minuto.
- Sessão: sem cookie, com token sem assinatura (`alg: none`) ou com lixo, `/auth/me`, `/conversations` e `/usage` respondem `401`; logout apaga o cookie; a sessão de uma conta apagada deixa de valer.
- CSRF: `POST` com `Origin` de outro site recebe `403` mesmo com sessão válida; da origem permitida, passa.
- Conversas criadas antes da autenticação não aparecem para ninguém.
- Consumo: `GET /api/usage` soma o dia, no total e por conversa. O registro do resumo da memória é coberto pelo teste de memória da conversa.
- Cache: a mesma pergunta (com outra caixa e espaços) reusa o SQL e o resultado, sem chamar a LLM para gerar; depois de mudar o schema, nada é reusado; continuação de conversa não usa o cache de SQL.

Testes unitários novos:
- Senha: hash com salt diferente a cada vez, senha errada e hash malformado recusados.
- Token: assinado com outra chave, adulterado, expirado, sem assinatura e lixo são recusados.
- `OriginGuard`: métodos de leitura passam; alteração passa da origem permitida e sem `Origin`; é recusada de outro site, de host parecido (`localhost:5173.evil.example`), de outra porta e da origem `null`.
- Cache: normalização da pergunta e versão do schema; SQL do cache usado sem chamar a LLM; SQL do cache recusado pela guarda é apagado e gerado de novo.

Testes de componentes e E2E:
- Tela de login quando não há sessão; chat direto com sessão válida, mostrando nome e consumo.
- Login, senha errada, erros por campo no cadastro, logout e volta ao login quando a sessão expira.
- E2E no Chromium: login pela tela, chat com o consumo do dia e logout.

**Teste manual com tudo real** (API, PostgreSQL, Redis, Gemini, Chromium):
- Cadastro pela tela; o cookie ficou `HttpOnly`, `SameSite=Strict`, `Path=/api` (sem `Secure` em desenvolvimento), e `document.cookie` não enxerga o token.
- A primeira pergunta levou 2390 ms; a mesma pergunta com outra escrita levou 1364 ms.
- No banco: a primeira gravou 2 chamadas e 1571 tokens; a segunda, 1 chamada (só a explicação) e 388 tokens. O cache evitou a geração do SQL.
- A tela mostrou "Uso hoje: 1.959 de 200.000 tokens"; o Redis ficou com 2 chaves de cache.
- No console, apenas dois `401` de "Failed to load resource": são a verificação de sessão antes do login, esperados. O navegador registra todo `401` no console, mesmo tratado.
- API e Vite iniciados como processos rastreados e encerrados ao final; portas 3000 e 5173 livres.

Clone limpo (Node 24.21): `pnpm install --frozen-lockfile` + `pnpm verify` passaram por completo, inclusive o E2E.

## 4. Erros e problemas encontrados
- **Teste de limite de login instável:** a janela do rate limit é fixa por minuto do relógio; se o teste começasse perto da virada, as tentativas caíam em duas janelas e o limite não era atingido. O teste agora espera a janela seguinte quando faltam menos de 15 segundos para a virada. Três execuções seguidas passaram. O comportamento é próprio da janela fixa (D-37), não um defeito.
- **Texto de D-36 e D-37 apagado** por um script de edição com crases dentro do shell. Corrigido em commit separado; os scripts de edição agora são escritos em arquivo antes de rodar.
- **Wrapper de sessão dos testes** sobrescrevia o cookie passado explicitamente, e o teste "exige usuário logado" recebia `201`. Corrigido para que o cabeçalho explícito prevaleça.

## 5. Decisões que preciso que você tome
Ação sua, fora do código (repetida):
- **Atualizar o Node.js da máquina para 24.21 ou mais recente.**

Para a Fase 09 (observabilidade, hardening, deploy e README final):
1. **D-11 — deploy (PENDENTE).** O app precisa de API, web estático, PostgreSQL 17 e Redis. Preços aproximados, a confirmar na hora de contratar:

   | Opção | Custo | Esforço e trade-offs |
   |---|---|---|
   | VPS com Docker + Traefik (Hetzner, DigitalOcean etc.) | ~US$ 5–7/mês, tudo numa máquina | O `docker-compose` vira o deploy; Traefik emite o TLS (Let's Encrypt) sozinho. Fica com você: atualizações do sistema, backup do Postgres, firewall |
   | AWS Lightsail | ~US$ 5–10/mês a instância; Postgres gerenciado à parte (~US$ 15/mês) | Mesmo modelo da VPS se tudo rodar em containers na instância; o banco gerenciado tira o backup das suas mãos, mas encarece. Bom se você quer AWS no portfólio |
   | Outra: PaaS (Render, Railway, Fly.io) | Gratuito a ~US$ 20/mês, dependendo de Postgres e Redis gerenciados | Menos operação (TLS, deploy por push); planos gratuitos dormem ou expiram o banco, e cada serviço é cobrado separado |

   **Recomendação:** VPS com Docker + Traefik — menor custo, reaproveita o `docker-compose` que já existe. Domínio é opcional (sem ele, dá para usar um subdomínio gratuito do tipo `sslip.io`). Preciso da escolha antes de qualquer código da fase.

## 6. Dívida técnica / pontos de atenção
- **JWT sem revogação:** logout apaga o cookie, mas um token copiado continua válido até expirar (24h). Trocar senha também não invalida tokens. Não há troca de senha nesta versão.
- **Janela fixa:** perto da virada do minuto, um usuário pode fazer até o dobro do limite em poucos segundos (D-37).
- **Cota com verificação antes do gasto:** perguntas simultâneas no fim da cota podem passar todas e ultrapassá-la por uma resposta cada.
- **Limite de login só por e-mail:** um atacante pode bloquear o login de alguém por um minuto, e tentativas espalhadas por muitos e-mails não são limitadas. Cadastro não tem limite.
- **Consumo de respostas que falharam** (erro da LLM ou do banco depois de gerar o SQL) não é registrado, como antes.
- **Conversas antigas sem dono** ficam no banco, invisíveis (D-35).
- **Cache de resultado** pode mostrar dados até 5 minutos desatualizados; não importa hoje porque o dataset é estático.
- **Pontos herdados:**
  - TypeScript 6.0.
  - `dev` da API sem watch.
  - A explicação da LLM pode errar números; a tabela é a fonte confiável.
  - Proteção contra execução simultânea de revisão em memória (uma instância).
  - Node 24.15 na máquina.

## 7. Próximo passo proposto
- Push, PR, CI verde e squash merge conforme a D-12.
- **Fase 09 — Observabilidade, hardening, deploy e README final**, depois da resposta de §5 (D-11).
