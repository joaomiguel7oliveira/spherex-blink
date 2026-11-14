# SPHEREx Blink

Ferramenta web que mostra as imagens do telescópio SPHEREx (NASA) como animação ao longo do tempo, para qualquer pessoa encontrar objetos que se movem ou mudam de brilho no céu. Protótipo para o NASA Space Apps Challenge 2026, desafio "Planet X and SPHEREx".

Ideia central: **a máquina filtra, o humano decide.**

## Como rodar

Testado com Python 3.14 no Windows.

```bash
python -m venv .venv
```

```bash
.venv/Scripts/python -m pip install -r requirements.txt
```

```bash
.venv/Scripts/python -m uvicorn backend.api:app --port 8000
```

Abra http://localhost:8000. No Linux ou macOS, troque `.venv/Scripts/python` por `.venv/bin/python`.

O cache dos 5 alvos de teste (`data/cache`, ~350 MB) não vai no repositório. Gere uma vez, antes de abrir a demo (baixa do IRSA; depois ela abre sem depender dele):

```bash
.venv/Scripts/python -m backend.pregen
```

```bash
.venv/Scripts/python -m backend.candidates
```

## O que dá para fazer

**Explorar**

- Panorama 360° do céu de fundo: arrastar para olhar em volta, rolar para zoom, clicar num ponto para abrir as imagens dali. A imagem do SPHEREx abre encaixada no próprio céu, na posição e escala certas, e acompanha o zoom e o arrasto; o céu em volta continua visível para comparar. Com o céu afastado, você está ao lado do SPHEREx, a 700 km de altura, e a Terra aparece embaixo em tamanho real (`frontend/js/globe.js`): uma calota de 64° de raio desenhada pixel a pixel na mesma projeção do céu, então ela acompanha o arrasto, o giro e o zoom, e esconde de verdade o céu atrás dela (clicar nela não escolhe ponto). A Terra fica em pé: o eixo dela é paralelo ao eixo do céu, e o céu fica sempre com o norte para cima. A região de perto usa blocos de ~2 km por pixel do NASA GIBS. Ilustrativo: lá embaixo fica a Índia, e a posição do satélite na órbita é escolhida para a vista. A luz é a do horário de agora: cada lugar do mapa está de dia ou de noite como está de verdade (ponto subsolar pela posição do Sol e pelo tempo sideral), com as luzes das cidades no lado da noite. Ela some ao aproximar (campo menor que ~22°). Com a Terra ligada, o céu abre no máximo até 70° (mais que isso deforma demais tão perto dela; sem a Terra, até 230°). Com o cursor sobre o céu, a roda é o zoom normal do panorama; com o cursor sobre a Terra, a roda afasta ou aproxima a câmera na linha do ponto sob o cursor (até a distância da Lua, sem descer abaixo de 700 km). Os botões − e + fazem o mesmo em linha reta, e o ⌂ volta para a vista inicial ao lado do satélite. A Lua aparece na posição e na fase de agora (fórmula de baixa precisão do Astronomical Almanac, ~0,3°), em tamanho real, com o mapa LROC WAC; o atalho "Lua, agora" nos Exemplos voa até ela. O botão "Terra" liga e desliga; ela começa desligada. O fundo pode ser luz visível (DSS), infravermelho (2MASS) ou **o céu inteiro do próprio SPHEREx (DR1)**, com uma régua que percorre os 102 comprimentos de onda, de 0,75 a 5,0 µm.
- Mini Terra no canto (`frontend/js/earthview.js`): gira junto com a sua vista, como um giroscópio, com você em dourado e o cone mostrando para onde você olha. Na primeira vez que o céu inteiro aparece, o planeta já abre assim, no centro da tela e virado para a sua região; depois, clicar na miniatura abre de novo. O planeta fica em tela cheia sem interface, com o panorama à vista atrás. Controles no estilo do Google Earth: arrastar puxa a superfície, a roda ou a pinça aproxima na direção do cursor, botão direito (ou Ctrl/Shift) arrastando gira e inclina, duplo clique aproxima. Um clique fora do planeta (ou Esc) encolhe de volta. Os jogadores online aparecem **na superfície**, cada um na sua região aproximada, na cor do rastro escolhido no Hangar; você é o anel dourado. Passar o mouse mostra apelido, nível, região e missão. Quem está online é real (cada aba manda um sinal a cada 30 s para `/api/presence`, com um id aleatório e o apelido; fica só na memória do servidor por 90 s). **A posição é segura por construção:** não há GPS nem consulta de IP. O navegador parte do próprio fuso horário (ex.: `America/Sao_Paulo` → coordenada de referência da zona, de `frontend/js/tzcoords.js`, gerado do `zone1970.tab` do tzdata), desloca o ponto de 120 a 300 km numa direção sorteada pelo id e arredonda a 0,1°. O que aparece é o país ou a região, nunca onde a pessoa está. Para a rede não parecer vazia numa demonstração, há também 8 jogadores **simulados**, sempre rotulados assim (na miniatura e na dica), com nomes, níveis e missões inventados; eles não entram em ranking nenhum e somem com `?sim=0`.
- Buscar por nome (SIMBAD) ou coordenadas, em graus ou `hh mm ss ±dd mm ss`.
- Ver a animação por épocas (uma imagem limpa por passagem do telescópio) ou por exposição individual, com data e comprimento de onda de cada quadro.
- Blink entre dois quadros, diferença A − B, soma de todas as exposições e cor falsa com três bandas.
- Ajustar campo (2′ a 30′), banda (6 detectores), brilho, cores e zoom.
- Clicar em um objeto e receber: deslocamento medido entre épocas, curva de luz, espectro (uma banda ou as 6) e flags daquele pixel.
- Ligar camadas do Gaia DR3 e do CatWISE2020, com posições corrigidas pelo movimento próprio.
- Marcar um candidato com seu apelido e exportar as marcações em CSV.
- Compartilhar: o estado fica na URL (`?ra=&dec=&fov=&band=&view=&frames=`). Com `&embed=1` sobra só a imagem e o player, para iframe ou sala de aula.

**Fila de candidatos**

O script `backend/candidates.py` compara épocas em 4 regiões pequenas, procura fontes na imagem de diferença, descarta o que cai em cima de fontes de catálogo e o que parece defeito, e monta a fila. O usuário vota "se move", "não se move" ou "é defeito" (teclas 1, 2, 3). Objetos rápidos já conhecidos entram como controles e são revelados depois do voto.

**Mural**

Votos por candidato, consenso (3 votos, dois terços de acordo), ranking de participantes e marcações.

Não há login: o apelido fica no navegador e acompanha cada voto.

## Modo missões

Aba **Missões** (`frontend/js/command.js`, `frontend/js/hunt.js`, `frontend/js/missions.js`, `backend/game.py`, `backend/hunt.py`, missões em `data/missions.json`). A experiência pega emprestado o **estilo** de jogos como o GeoGuessr (rodadas curtas, até 5.000 pontos por rodada pela precisão, placar que conta na tela, resultado com a resposta certa ao lado da sua), mas as mecânicas são as do próprio projeto: piscar épocas e medir o céu. As imagens e as medidas são sempre as do SPHEREx real, e o jogo nunca altera uma medida. O que é inventado (satélite, Hangar, jogadores simulados) é rotulado como ilustrativo.

A página abre com dois jeitos de jogar:

**Caça ao movimento** (partida rápida, 5 rodadas, até 25.000 pontos).

- Cada rodada pisca as épocas de um recorte de 64 × 64 pixels (3,3′) de um alvo de exemplo. O enquadramento, a rotação e o espelhamento são sorteados, então o objeto nunca fica no centro nem no mesmo lugar. O sorteio só usa recortes com dado em pelo menos 97% da área.
- A pergunta é "o que se move?" (Barnard, Epsilon Indi B, WISE 0855) ou "o que muda de brilho?" (R Draconis, RW Aurigae). Você clica no objeto e confirma.
- Pontos: `5000 × exp(−0,693 × (d / t)²)`, com `d` a distância em segundos de arco e `t` a tolerância. `t` é 12″ para objetos pontuais e cresce com o tamanho da mancha das estrelas saturadas (Barnard ~25″, R Draconis ~36″), para que clicar na própria estrela valha.
- Ferramentas: **Piscar** ou **Diferença** (última época menos a primeira, a mesma vista do modo Céu). Pista paga: mostrar o quarto da imagem onde está o objeto (−25%, contada no servidor).
- Depois do clique aparecem a posição certa, a linha até o seu palpite, o nome do objeto e o que ele é. No fim, o total da partida e o ranking no Mural.
- As imagens saem do servidor por um id de partida; a posição certa só volta depois do palpite.

**Campanha** (Missão 1 a Missão 10, em 3 capítulos).

- Capítulos: Treinamento (abrir um exemplo, medir a Estrela de Barnard, medir o brilho de R Draconis), Objetos difíceis (Epsilon Indi B, WISE 0855 em duas partes, RW Aurigae) e Caça ao Planeta X (classificar 5 candidatos da fila, chegar a um consenso, marcar algo numa região nova).
- **Fluxo em um botão.** "Jogar" leva ao alvo na banda certa. A faixa no modo Céu mostra a missão e um único botão que muda sozinho: Ir até o alvo → Trocar de banda → Medir → Enviar 9,6″/ano. Ao chegar no alvo certo, a medida sai sozinha no centro do recorte.
- **Pontos pela precisão.** A medida fora da faixa aceita não conclui a missão (mostra o que errou e uma dica que fica mais específica a cada tentativa). Dentro da faixa, vale de 2.500 a 5.000: mais perto do centro da faixa, mais pontos. Ex.: Barnard em D4 aceita 8,5 a 12″/ano rumo ao norte; 9,6″/ano a 1° dá 4.768.
- **Tela de resultado** a cada envio: pontos contando até o valor, barra até 5.000 e uma figura com a sua medida e a esperada (bússola para movimento, régua para brilho). A seta dourada é o centro da faixa aceita, não o valor de catálogo; o valor de catálogo vem escrito logo abaixo.
- **Jogar de novo vale a pena.** Repetir uma missão já feita soma a diferença quando você melhora o seu recorde.
- **O capítulo 3 nunca afirma descoberta.** Classificar e marcar dão pontos por participação e por acerto nos controles. Candidatos marcados ficam registrados para revisão, e ninguém confirmou nenhum.
- **No ambiente.** As missões com lugar fixo aparecem como marcadores no próprio céu (`frontend/js/skyorders.js`), e uma seta na borda aponta o alvo da missão atual. No globo, um feixe sai do seu satélite (ilustrativo) na direção do alvo, com "Missão N" na ponta.

**Progresso.** Pontos, nível (`floor(sqrt(pontos / 2500)) + 1`, com nomes de Cadete a Comandante de órbita), créditos e insígnias por capítulo. Fica no servidor (SQLite), ligado ao id aleatório do navegador e ao apelido; sem servidor, a campanha roda no navegador com `localStorage` (sem a Caça ao movimento). O **Hangar** personaliza o satélite ilustrativo com créditos. O **Diário** guarda o que você mediu, os pontos e o valor de catálogo.

**API.** Campanha: `GET /api/missions` (sem as faixas de resposta), `GET /api/player`, `POST /api/mission/accept`, `/abandon`, `/report` (até 10 por minuto), `POST /api/player/region`, `POST /api/player/satellite`, `GET /api/leaderboard`. Caça ao movimento: `POST /api/hunt/new`, `/hint`, `/guess`, `GET /api/hunt/img/{partida}/{rodada}/{época}` (a época seguinte à última é a Diferença), `GET /api/hunt/leaderboard`.

## Resultados medidos nos alvos de teste

Medidas feitas pela própria ferramenta (clique no centro do alvo), comparadas com o SIMBAD:

| Alvo | Banda | Medido | Referência (SIMBAD) |
| --- | --- | --- | --- |
| Estrela de Barnard | D4 | 9,6″/ano para o norte | 10,4″/ano |
| Epsilon Indi B | D2 | 4,5″/ano, direção 127° | 4,7″/ano, direção 122° |
| WISE 0855 | D6 | 8,9″/ano, direção 288° | 8,2″/ano, direção 275° |
| RW Aurigae | D6 | brilho variou 58% entre épocas | variável (T Tauri) |
| R Draconis | D6 | brilho variou 70% entre épocas | variável (Mira) |

Leia estes números com as ressalvas abaixo. A WISE 0855 foi medida com só 5 meses de intervalo, então o valor inclui a paralaxe.

## Limitações conhecidas

- **Saturação.** Estrela de Barnard, RW Aurigae e R Draconis saturam o detector em todas as bandas. O miolo vira uma mancha lisa (creme na tela). Nesses casos a posição é medida pelo contorno da mancha, e o brilho pelas "asas" (o halo em volta). A fotometria das asas é só relativa e tem piso de erro perto de 10%, medido na Estrela de Barnard, que é estável.
- **RW Aurigae.** A variação de 58% aparece só na banda D6. Nas bandas D1, D2 e D4 a variação medida (13 a 15%) fica dentro da incerteza. Não verifiquei o resultado da D6 contra outra fonte.
- **Poucas épocas.** Há 3 ou 4 épocas por região (maio de 2025 a outubro de 2026). Objetos com menos de ~3″/ano ficam abaixo da precisão.
- **Fila pequena.** São 9 candidatos em 4 campos: 2 controles e 7 sem explicação de catálogo, que ninguém revisou ainda. Vários devem ser defeitos.
- **Votos sem login.** A mesma pessoa pode votar mais de uma vez trocando de apelido.
- **Hospedagem estática não testada.** O frontend lê os cubos do cache como arquivos estáticos, mas só testei servindo pelo FastAPI.
- **Panorama 360° depende da internet.** O céu de fundo é o Aladin Lite 3.8.2 (via jsDelivr) mostrando o DSS colorido, o 2MASS e o cubo do SPHEREx espelhados no IRSA (`frontend/js/aladin.js`). O cubo do SPHEREx tem 12,9″ por pixel e soma todas as épocas: serve para se situar e comparar comprimentos de onda, não para ver movimento. O endereço antigo do CDS (`aladin.cds.unistra.fr/.../latest`) e o alasky estavam fora do ar em 14/11/2026. Sem Aladin ou sem WebGL2, a página cai sozinha num mapa plano desenhado com 2.847 estrelas do Yale BSC; `?sky=plano` força esse modo.
- **Modo missões confia no cliente.** As medidas do relatório saem do navegador, então dá para digitar um valor dentro da faixa sem medir. Regiões, marcações, votos e consenso o servidor confere sozinho. Como não há login, trocar de navegador começa do zero. É um jogo de aprendizado, não um sistema de pontuação seguro.
- **Modo missões sem servidor.** Na hospedagem estática, o navegador lê `data/missions.json` com as faixas de resposta, a missão de consenso fica indisponível e não há ranking.
- **Jogadores simulados.** Os 8 jogadores extras no globo (em cidades inventadas para eles) são inventados para demonstração (rotulados "simulados"; `?sim=0` tira).
- **Escolha das flags.** A lista de bits tratados como "pixel ruim" (`BAD_BITS` em `backend/config.py`) é uma escolha deste protótipo, não uma recomendação oficial da missão.

## Como atualizar os dados

```bash
.venv/Scripts/python -m backend.refresh
```

O script reconsulta o índice do IRSA para cada região do cache, refaz os cubos que ganharam exposições e regenera a fila. Para incluir um novo lançamento, acrescente a coleção em `SIA_COLLECTIONS` (`backend/config.py`) e rode de novo. O frontend não muda.

## De onde vêm os dados

| O quê | Fonte | Como é usado |
| --- | --- | --- |
| Lista de exposições | IRSA SIA2, `https://irsa.ipac.caltech.edu/SIA`, coleções `spherex_dr1` e `spherex_qr3` | uma linha por imagem espectral nível 2 que cobre o ponto |
| Pixels | espelho público do IRSA na AWS, `https://nasa-irsa-spherex.s3.amazonaws.com/` | leitura por faixa de bytes, só o pedaço necessário |
| Pixels (reserva) | serviço de recortes do IRSA, `?center=RA,DEC&size=` na URL da imagem | usado se a AWS falhar |
| Nomes e movimento próprio | Sesame / SIMBAD (CDS) | posição J2000 levada até 2026.0 |
| Objetos conhecidos | Gaia DR3 (`I/355/gaiadr3`) e CatWISE2020 (`II/365/catwise`) via VizieR | camadas e filtro da fila |
| Panorama 360° | Aladin Lite 3.8.2 (CDS) com HiPS do IRSA: DSS2 colorido, 2MASS colorido e `SPHEREx/spherex_allsky_cube` (DR1, 102 quadros, publicado em 01/11/2026) | fundo do modo Céu; os comprimentos de onda vêm do arquivo `properties` do HiPS |

Documentação consultada em 14/11/2026:

- Tutorial de recortes: https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/
- Tutorial de introdução (extensões FITS, flags, WCS espectral): https://caltech-ipac.github.io/irsa-tutorials/spherex-intro/
- Serviço de recortes: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html
- Página da missão no IRSA: https://irsa.ipac.caltech.edu/Missions/spherex.html

Observações do dia do desenvolvimento: o TAP do IRSA estava fora do ar e o SIA respondia com erro 502 de forma intermitente, por isso o código repete a consulta e guarda o índice em `data/index`. O servidor principal do VizieR também estava fora, então a consulta passa pelos espelhos de Harvard e do IDIA. Nos espelhos, o CatWISE só respondeu pedindo todas as colunas.

As coordenadas da WISE 0855 no enunciado (08h55m10.831s, −07°14′42.53″) são de cerca de 2010. O exemplo é centrado na posição de 2026 (SIMBAD mais movimento próprio), e a posição do enunciado aparece marcada com um X.

## Fontes e créditos

Lista completa de dados, serviços e ferramentas usados, para a submissão. Todas as imagens são dados reais; nada é simulado. Os mesmos textos estão no botão "Créditos" do site.

**Dados**

| Fonte | Uso | Referência e agradecimento |
| --- | --- | --- |
| SPHEREx DR1 e QR3, imagens espectrais nível 2 | animações, medições, fila | DOI 10.26131/IRSA678; Bock et al. 2026; Akeson et al. 2026. "This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration." |
| SPHEREx DR1 Spectral All-Sky Cube (HiPS) | panorama, régua de 102 comprimentos de onda | DOI 10.26131/IRSA679, mesmo agradecimento acima |
| NASA/IPAC Infrared Science Archive (IRSA) | SIA2, recortes, espelho AWS, HiPS | "This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the National Aeronautics and Space Administration and operated by the California Institute of Technology." |
| 2MASS (HiPS colorido no IRSA) | panorama em infravermelho, céu de referência | Skrutskie et al. 2006, AJ 131, 1163. "This publication makes use of data products from the Two Micron All Sky Survey, which is a joint project of the University of Massachusetts and the Infrared Processing and Analysis Center/California Institute of Technology, funded by the National Aeronautics and Space Administration and the National Science Foundation." |
| DSS2 colorido (HiPS do CDS, espelhado no IRSA) | panorama em luz visível | Lasker et al. 1996. "Digitized Sky Survey - STScI/NASA, Colored & Healpixed by CDS". Texto completo no `obs_ack` do arquivo `properties` do HiPS, começando por "The Digitized Sky Surveys were produced at the Space Telescope Science Institute under U.S. Government grant NAG W-2166." |
| Gaia DR3 (VizieR I/355) | camada e filtro da fila | "This work presents results from the European Space Agency (ESA) space mission Gaia. Gaia data are being processed by the Gaia Data Processing and Analysis Consortium (DPAC). Funding for the DPAC is provided by national institutions, in particular the institutions participating in the Gaia MultiLateral Agreement (MLA)." |
| CatWISE2020 (VizieR II/365) | camada e filtro da fila | Marocco et al. 2021, ApJS 253, 8 |
| SIMBAD e Sesame (CDS) | nomes, posições, movimento próprio | Wenger et al. 2000. "This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France." |
| VizieR (CDS) e espelhos de Harvard e IDIA | acesso a Gaia, CatWISE e BSC | Ochsenbein et al. 2000, DOI 10.26093/cds/vizier |
| Yale Bright Star Catalogue (VizieR V/50) | mapa plano de reserva | Hoffleit & Warren 1991 |

**Ferramentas**

| Ferramenta | Uso | Licença |
| --- | --- | --- |
| Aladin Lite 3.8.2 (CDS), via jsDelivr | panorama 360° e céu de referência | GPL-3; Boch & Fernique 2014 |
| three.js 0.160.0, via jsDelivr | cena 3D da tela inicial | MIT |
| Imagens da Terra Blue Marble e Black Marble (NASA Earth Observatory), do pacote three-globe 2.31.0 no jsDelivr | tela inicial e Terra do panorama | domínio público (NASA); pacote MIT |
| Mapa da Lua: mosaico LROC WAC (NASA/GSFC/Arizona State University), pelo WMS do USGS Astrogeology (planetarymaps.usgs.gov) | Lua no panorama | domínio público (NASA/USGS) |
| Blue Marble Next Generation em blocos do NASA GIBS (gibs.earthdata.nasa.gov, WMTS EPSG:4326, nível 5) | detalhe da Terra no panorama | domínio público (NASA) |
| Fontes Inter e JetBrains Mono, via Google Fonts | interface | SIL Open Font License 1.1 |
| Astropy, astroquery, reproject, photutils | FITS, WCS, consultas, reprojeção, fotometria | BSD-3 |
| NumPy, SciPy | cálculo | BSD-3 |
| FastAPI, Uvicorn | servidor e API | MIT / BSD-3 |
| requests, fsspec, aiohttp | leitura por faixa de bytes na AWS | Apache-2.0 / BSD-3 / Apache-2.0 |

O frontend é JavaScript sem framework, escrito para este projeto. Nenhum material com direitos autorais de terceiros foi usado além dos listados acima.

Os textos de agradecimento do SPHEREx, 2MASS, DSS e Gaia foram copiados das páginas oficiais em 14/11/2026. Os do IRSA, SIMBAD e VizieR seguem a forma padrão desses serviços, porque as páginas do CDS estavam fora do ar nesse dia.

## Como funciona

```
coordenadas → SIA (lista de exposições) → recorte de cada exposição (AWS)
  → remove luz zodiacal (extensão ZODI) e pixels com flags ruins
  → reprojeta para uma grade comum (TAN, norte para cima) → remove o fundo
  → cubo float32 + flags + metadados em data/cache/<chave>/
```

O navegador recebe o cubo inteiro e faz o resto localmente: épocas, medianas, blink, diferença, soma, cor, fotometria e centroides. Por isso trocar de visão é instantâneo.

| Arquivo | Papel |
| --- | --- |
| `backend/config.py` | fontes de dados, coleções, limites, bits de flag |
| `backend/spherex.py` | índice SIA e leitura dos pixels |
| `backend/pipeline.py` | reprojeção, cubo e cache |
| `backend/catalogs.py` | Sesame, Gaia, CatWISE, movimento próprio |
| `backend/candidates.py` | detecção e filtro da fila |
| `backend/pregen.py` | cache dos alvos de teste e `data/targets.json` |
| `backend/refresh.py` | ingestão de dados novos |
| `backend/api.py` | API, votos, marcações e arquivos estáticos |
| `frontend/js/viewer.js` | desenho, zoom, camadas, player |
| `frontend/js/science.js` | projeção, épocas, fotometria, centroides |
| `frontend/js/main.js` | modo Explorar e estado na URL |
| `frontend/js/queue.js` | fila e mural |

A API está documentada em http://localhost:8000/api/docs.

## Próximos passos

- Login de verdade (OAuth ou ORCID) para o consenso ser confiável.
- Fotometria por ajuste de PSF usando a extensão EPSF, para estrelas saturadas e campos cheios.
- Rodar a fila em mais regiões e somar bandas antes de detectar, para ir mais fundo.
- Avisos de confirmação e conquistas.
- Interface em inglês.
