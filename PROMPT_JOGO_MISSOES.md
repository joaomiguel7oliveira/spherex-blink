# Prompt de implementação: modo jogo "Central de Missões" do SPHEREx Blink

> Este arquivo é um prompt para um agente de programação (ou uma pessoa) implementar o modo jogo
> dentro do SPHEREx Blink que já existe. Leia o arquivo inteiro antes de começar. Não reescreva o
> projeto: o jogo é uma camada nova por cima das ferramentas que já funcionam.

---

## 1. A ideia em uma frase

Cada jogador é dono de um **satélite fictício** em órbita da Terra. Uma **Central de Comando** manda
**missões** de observação com dados reais do SPHEREx. Ao cumprir as missões, o jogador ganha
experiência e créditos, sobe de nível e **personaliza o satélite**. Os outros jogadores online aparecem
como pontinhos no globo.

O objetivo continua sendo o do desafio "Planet X and SPHEREx": fazer mais gente olhar as imagens do
SPHEREx e achar objetos que se movem ou mudam de brilho. **A máquina filtra, o humano decide.** O jogo
existe para guiar e motivar esse trabalho, não para substituí-lo.

## 2. O que já existe (use, não refaça)

Stack: backend **FastAPI** (`backend/api.py`) e frontend em **JavaScript puro com módulos ES**
(`frontend/js/*.js`), sem bundler, interface em português do Brasil, tema escuro.

| Peça | Onde | O que faz hoje |
| --- | --- | --- |
| Panorama 360° | `skysphere.js`, `aladin.js` | Aladin Lite 3.8.2: arrastar, zoom, clicar para abrir a região; norte sempre para cima |
| Terra no panorama | `globe.js` | Terra em tamanho real a 700 km, satélite ao lado da câmera, Lua na posição e fase reais; luz do Sol no horário de agora. `snapshot()` dá a posição da câmera, do satélite e da vista |
| Mini Terra e rede | `earthview.js` | Miniatura que gira como um giroscópio; clique abre o globo grande com controles do tipo Google Earth, você em dourado com o cone da vista e os jogadores online em verde |
| Presença | `POST /api/presence`, `GET /api/online`; `api.ping()` | id aleatório por navegador (`spx_sid`) + apelido, sinal a cada 30 s, online = últimos 90 s, só na memória |
| Visualizador | `viewer.js`, `science.js`, `plot.js` | Animação por épocas, blink, diferença, soma, cor falsa; clique mede deslocamento (″/ano e direção), curva de luz, espectro e flags |
| Fila de candidatos | `queue.js`, `data/candidates/queue.json` | Voto "se move" / "não se move" / "é defeito" (teclas 1–3); candidatos com `control: true` são objetos conhecidos e revelados depois do voto |
| Votos e mural | `POST /api/vote`, `GET /api/votes`, SQLite `data/votes.sqlite` | Consenso (3 votos, 2/3 de acordo), ranking por apelido |
| Marcações | `POST /api/mark`, `GET /api/marks`, CSV | Marca um ponto com apelido e nota |
| Apelido | `api.getNick()` / `setNick()` | Sem login. O apelido fica no `localStorage` |
| Alvos de teste | `data/targets.json`, `data/cache/` | Estrela de Barnard, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis, já com cubos prontos |

Regras que continuam valendo:

- **Sem login.** O jogador é o par `spx_sid` (id aleatório) + apelido. Nada de e-mail, senha ou conta.
- **Honestidade com os dados.** Tudo o que for inventado para o jogo (órbitas, satélites, peças,
  histórias da Central) é marcado como **ilustrativo** na interface. Medições e imagens são reais e
  nunca são alteradas pelo jogo: uma peça "melhor" não deixa a imagem mais nítida.
- **Sem assets externos novos que precisem de download local.** Use CSS, SVG e three.js (já carregado
  do jsDelivr). Se precisar de imagem, peça antes.
- Acessível no celular (≥ 360 px de largura) e no desktop. Teclado funciona em tudo que é clicável.

## 3. O ciclo do jogo

1. **Briefing.** A Central de Comando mostra as missões disponíveis: objetivo, alvo, banda sugerida,
   recompensa e uma dica curta.
2. **Aceitar.** O jogador aceita uma missão. O satélite dele "aponta" para o alvo: o panorama voa até
   lá (`sky.flyTo`) e o cone dourado no globo grande vira para o alvo.
3. **Observar.** O jogador usa as ferramentas que já existem (blink, diferença, curva de luz, medir).
4. **Relatar.** O jogador envia o relatório: o valor medido ou a resposta.
5. **Avaliação.** O servidor confere o relatório e devolve o resultado e a explicação científica (o
   texto `legend` dos alvos, o valor do SIMBAD e a ressalva da medida).
6. **Recompensa.** XP e créditos. Ao subir de nível, novas missões e peças são liberadas.

## 4. Missões

Cada missão é um registro em `data/missions.json` (versionado no repositório, editável sem mexer no
código). Formato:

```json
{
  "id": "m-barnard-1",
  "act": 1,
  "title": "A estrela que corre",
  "target": "barnard",
  "band": "D4",
  "kind": "measure_motion",
  "brief": "Meça quanto a Estrela de Barnard andou entre as épocas.",
  "hint": "Use a vista Diferença e clique no centro da mancha.",
  "check": { "pm_arcsec_yr": [8.5, 12.0], "pa_deg": [340, 20] },
  "reward": { "xp": 120, "credits": 40 },
  "requires": [],
  "explain": "SIMBAD: 10,4″/ano para o norte. A ferramenta mede ~9,6″/ano na D4; o miolo está saturado, então a posição vem do contorno."
}
```

Tipos de missão (`kind`) e como cada um é conferido:

| kind | O jogador envia | Como o servidor confere |
| --- | --- | --- |
| `measure_motion` | ″/ano e direção medidos pelo `viewer.js` | Os dois valores dentro das faixas de `check`. Ângulos comparados por diferença circular |
| `measure_variability` | variação de brilho (%) entre épocas | Valor ≥ `check.min_pct` na banda pedida |
| `pick_band` | a banda em que o objeto aparece melhor | Resposta igual a `check.band` (ex.: WISE 0855 → D6) |
| `classify` | "se move", "não se move" ou "defeito" para N candidatos da fila | Candidatos de controle têm resposta certa. Candidatos sem resposta conhecida dão **pontos de participação**, nunca "certo" ou "errado" |
| `mark` | uma marcação (`/api/mark`) dentro de um raio do alvo | Distância angular ≤ `check.radius_arcsec` |
| `explore` | ter aberto N regiões novas pelo panorama | Contagem de regiões distintas abertas pelo jogador |

Missões iniciais, baseadas nos 5 alvos de teste do desafio (os números vêm do `README.md`, seção
"Resultados medidos nos alvos de teste"):

**Ato 1: treinamento**

1. *Primeiro contato*: abrir qualquer alvo de exemplo e tocar a animação (`explore`, N = 1).
2. *A estrela que corre*: Estrela de Barnard, D4, medir movimento (referência 10,4″/ano para o
   norte; aceitar 8,5 a 12″/ano e direção dentro de ±20° do norte).
3. *Quem pisca*: R Draconis, D6, medir a variação (aceitar ≥ 40 %; a ferramenta mede ~70 %).

**Ato 2: objetos difíceis**

4. *Par escondido*: Epsilon Indi B, D2, medir movimento (referência 4,7″/ano a 122°; aceitar 3,8 a
   5,6″/ano e ±20°).
5. *A anã mais fria*: WISE 0855, primeiro `pick_band` (resposta D6), depois `measure_motion` (aceitar
   6,5 a 10,5″/ano, direção 275° ± 25°). Avise na explicação que o intervalo de 5 meses mistura
   paralaxe.
6. *Poeira no disco*: RW Aurigae, D6, `measure_variability` (≥ 30 %). Avise que nas bandas D1, D2 e
   D4 a variação fica dentro do erro.

**Ato 3: caça ao Planeta X (aberto)**

7. *Patrulha*: classificar 5 candidatos da fila (`classify`). Os 2 controles valem acerto; os outros
   valem participação.
8. *Consenso*: ter um voto em um candidato que chegue ao consenso (2/3 de 3 votos ou mais).
9. *Campo novo*: abrir 3 regiões novas pelo panorama e marcar algo que pareça mover (`mark`). Não há
   resposta certa; a recompensa é de participação, e a marcação entra no CSV para revisão humana.

Missões do ato 3 nunca dizem que o jogador "descobriu" algo. O texto padrão é: "Candidato registrado
para revisão. Ninguém confirmou ainda."

## 5. Progressão

- **XP e nível:** nível = `floor(sqrt(xp / 100)) + 1`. Cada ato libera quando todas as missões do
  anterior estão feitas, ou com nível mínimo definido em `requires`.
- **Créditos:** gastos só em peças cosméticas e em slots de missão. Não existe compra com dinheiro.
- **Insígnias:** uma por ato, mais "Primeiro voto em consenso" e "Marcou um campo novo".
- **Ranking:** soma de XP por apelido no Mural, ao lado do ranking de votos que já existe.
- **Diário de bordo:** lista das missões feitas, com o valor que o jogador mediu e a referência.

## 6. Personalização do satélite (ilustrativa)

O modelo 3D está em `buildSpherex(THREE, envMap)` (`intro.js`), o mesmo usado no panorama
(`globe.js`). Adicione parâmetros a essa função em vez de criar outro modelo.

| Item | Efeito visual | Custo |
| --- | --- | --- |
| Nome do satélite | aparece no globo grande ao passar o mouse e na lista de online | grátis |
| Cor do escudo solar (6 opções) | material do cone externo | 20 créditos |
| Emblema (SVG simples, 8 opções) | decal no corpo e ícone na lista | 30 créditos |
| Cor do rastro de órbita | linha da órbita no globo grande | 25 créditos |
| Painel solar extra | geometria a mais, só visual | nível 3 |
| Pintura dourada | material metálico | insígnia do ato 3 |

A interface diz, ao lado da loja: "Peças são só visuais. As imagens e medições são sempre as do
SPHEREx real."

No globo grande (`earthview.js`), o pontinho de cada jogador pode ganhar a cor de rastro e o emblema
escolhidos. Para isso, `/api/presence` passa a devolver também `{color, emblem, level}`.

## 7. Backend

Acrescente em `backend/api.py`, com tabelas novas no mesmo SQLite (`_db()`):

```text
players(sid TEXT PRIMARY KEY, nickname TEXT, xp INT, credits INT, sat_json TEXT, created REAL, seen REAL)
progress(sid TEXT, mission TEXT, status TEXT, answer_json TEXT, score INT, ts REAL, PRIMARY KEY(sid, mission))
```

Endpoints:

| Método e rota | Corpo ou resposta |
| --- | --- |
| `GET /api/missions` | lista de `data/missions.json` sem o campo `check` (o cliente não vê a resposta) |
| `GET /api/player?sid=` | xp, nível, créditos, satélite, missões feitas; cria o jogador na primeira vez |
| `POST /api/mission/accept` | `{sid, mission}`; confere `requires` |
| `POST /api/mission/report` | `{sid, mission, answer}`; confere com `check`, grava, devolve `{ok, score, xp, credits, explain}` |
| `POST /api/player/satellite` | `{sid, item}`; confere créditos e nível, grava em `sat_json` |
| `GET /api/leaderboard` | top 50 por XP (apelido, nível, insígnias) |

Validação: use Pydantic como nos modelos `Vote` e `Ping`; `sid` com o mesmo padrão `^[A-Za-z0-9-]+$`.
Limite de 10 relatórios por minuto por `sid`. Sem login a trapaça é possível (o valor medido vem do
cliente). Diga isso na seção de limitações do README, como já é dito para os votos.

Sem a API (hospedagem estática), o jogo funciona no modo local: progresso no `localStorage` e
conferência no cliente, com o aviso "Modo offline: seu progresso fica só neste navegador". Siga o
padrão de fallback de `api.js` (`getVotes`/`sendVote`).

## 8. Frontend

Arquivos novos:

- `frontend/js/missions.js`: estado do jogador, chamadas aos endpoints, fallback local.
- `frontend/js/command.js`: tela da Central de Comando.

Interface:

- Nova aba **"Missões"** no topo, ao lado de Céu, Fila e Mural, com o mesmo padrão de `?tab=`.
- **Central de Comando:** cartões de missão por ato (bloqueadas em cinza com o motivo), barra de XP,
  créditos e nível. O botão "Aceitar" leva ao alvo.
- **Faixa da missão ativa:** fixa no rodapé do modo Céu, com o objetivo, a dica e o botão "Enviar
  relatório". O formulário do relatório vem pré-preenchido com a última medida do `viewer.js`. Para
  isso, `viewer.js` emite o evento `spx:measure` com `{pm, pa, varPct, band, target}`.
- **Hangar:** pré-visualização 3D do satélite girando (reaproveite `buildSpherex`) e a loja de peças.
- **Globo grande:** mostra a missão ativa de cada jogador online ao passar o mouse sobre o pontinho
  (ex.: "Ana, Ato 2, Epsilon Indi B").
- Mensagens da Central em tom de controle de missão, curtas e em português simples. Nada de "você
  descobriu um planeta".

Acessibilidade: todos os cartões e botões funcionam por teclado, com foco visível. As recompensas são
anunciadas com `aria-live="polite"`. Animações são reduzidas com `prefers-reduced-motion`.

## 9. Critérios de aceite

1. Um jogador novo (apelido escolhido, sem login) consegue fazer as 3 missões do ato 1 em menos de 10
   minutos, só com as dicas da interface.
2. Na Estrela de Barnard em D4, clicar no centro e enviar a medida dá sucesso. Enviar 2″/ano dá
   "fora da faixa", com a explicação e o valor de referência.
3. `GET /api/missions` nunca expõe o campo `check`.
4. Candidatos sem resposta conhecida nunca são marcados como certos ou errados.
5. Recarregar a página mantém o progresso (servidor ou `localStorage`).
6. Comprar uma peça muda o satélite no panorama, no Hangar e no globo grande dos outros jogadores (em
   até 30 s).
7. Nenhuma peça ou nível altera pixels, medições ou a fila.
8. Toda informação inventada tem o rótulo "ilustrativo" visível.
9. Funciona em 375 × 812 (celular) e 1440 × 900, sem erros no console.
10. O README ganha a seção "Modo missões" e as novas limitações. Os créditos continuam completos.

## 10. Fora do escopo agora

- Login, contas, e-mail, pagamentos.
- Chat entre jogadores.
- Órbitas físicas reais por jogador (as órbitas continuam inventadas a partir do id).
- Missões geradas por IA ou textos que afirmem descobertas.
- Reescrever o projeto em outro framework.

## 11. Ordem sugerida

1. `data/missions.json` com as 9 missões e os endpoints de missões e jogador, com testes rápidos via
   `/api/docs`.
2. `missions.js`, com o fallback local.
3. O evento `spx:measure` no `viewer.js` e a faixa da missão ativa.
4. Aba Missões e Central de Comando.
5. Hangar, loja e parâmetros em `buildSpherex`.
6. Presença com cor, emblema e nível, e o hover no globo grande.
7. README, créditos e verificação no navegador (desktop e celular).
