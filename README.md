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
- Mini Terra no canto (`frontend/js/earthview.js`): gira junto com a sua vista, como um giroscópio, com você em dourado e o cone mostrando para onde você olha. Clicar nela faz a miniatura crescer até a tela cheia, com o planeta no centro e sem interface; o panorama continua à vista atrás. Controles no estilo do Google Earth: arrastar puxa a superfície, a roda ou a pinça aproxima na direção do cursor, botão direito (ou Ctrl/Shift) arrastando gira e inclina, duplo clique aproxima. Um clique fora do planeta (ou Esc) encolhe de volta. Os satélites dos jogadores aparecem em órbita na cor do rastro escolhido no Hangar; passar o mouse mostra apelido, nível e missão. Quem está online é real (cada aba manda um sinal a cada 30 s para `/api/presence`, com um id aleatório e o apelido; fica só na memória do servidor por 90 s); a órbita de cada um é inventada a partir do id. Para a rede não parecer vazia numa demonstração, há também 8 jogadores **simulados**, sempre rotulados assim (na miniatura e na dica), com nomes, níveis e missões inventados; eles não entram em ranking nenhum e somem com `?sim=0`.
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

Aba **Missões** (`frontend/js/command.js`, `frontend/js/missions.js`, `backend/game.py`, missões em `data/missions.json`). Cada jogador opera um satélite fictício e recebe missões de uma Central de Comando. Tudo o que é inventado (satélite, peças, falas da Central, jogadores simulados) é rotulado como ilustrativo; as imagens e as medidas são sempre as do SPHEREx real, e o jogo nunca altera uma medida.

**As ordens ficam no próprio ambiente.**

- **No céu** (`frontend/js/skyorders.js`): cada ordem com lugar fixo é um marcador na posição real do alvo no panorama, com código, título e recompensa.
  - Os marcadores mudam conforme a ordem: abertos em azul, a ordem ativa com uma mira dourada pulsando, as cumpridas com ✓ verde e as bloqueadas com 🔒.
  - As ordens de patrulha ficam na região da fila.
  - Clicar num marcador abre o cartão da ordem ali mesmo, ao lado do alvo, com os botões para confirmar, abrir as imagens ou transmitir.
  - Com o alvo da ordem ativa fora da vista, uma seta na borda da tela aponta o caminho e mostra a distância em graus no céu. Clicar nela gira o céu até o alvo.
- **No satélite** (globo em tela cheia e miniatura): um feixe dourado sai do seu satélite na direção do alvo da ordem ativa, com o código da ordem na ponta. A câmera abre de lado para o feixe aparecer inteiro. Quando a linha de visada cruza a Terra, o rótulo avisa "alvo atrás da Terra".

**Diegético.** Além disso, a interface do jogo fala de dentro do mundo, sem mudar o resto do site:

- Você tem um **indicativo de chamada**: o nome registrado no Hangar ou, sem nome, `SPX-` mais três letras do id da aba. **Subir de nível é uma promoção de patente:** Cadete, Operador júnior, Operador, Observador, Observador sênior, Navegador e Comandante de órbita.
- O **canal com a Central** guarda as mensagens no navegador. Entram ali:
  - a ordem confirmada;
  - "alvo adquirido" (avisa se a banda está errada);
  - "telemetria recebida" com a medida feita;
  - o pacote que você transmitiu e a resposta;
  - promoções, insígnias, requisições do Hangar e a próxima ordem sugerida.
- As missões são **ordens** numeradas (OP-01 a OP-10). A ordem ativa aparece no modo Céu com a última fala da Central e uma lista de etapas que marca sozinha o que já está feito (alvo, banda, medida).
- O relatório é **transmitido por downlink**, com uma animação curta que some com movimento reduzido. A cada falha, a Central manda uma dica mais específica (`hints` em `data/missions.json`).
- A **telemetria** junta duas fontes. A órbita (700 km, polar) é ilustrativa e a passagem é contada pelo período de 98,6 min. O apontamento e a banda são os reais da tela.

- **3 atos, 10 missões.** Treinamento (abrir um exemplo, medir a Estrela de Barnard, medir o brilho de R Draconis), Objetos difíceis (Epsilon Indi B, WISE 0855 em duas partes, RW Aurigae) e Caça ao Planeta X (classificar 5 candidatos da fila, chegar a um consenso, marcar algo numa região nova). Um ato abre quando o anterior termina ou no nível 2 + ato.
- **Como funciona.** Aceitar leva ao alvo, na banda da missão. Uma faixa no modo Céu mostra o objetivo e a dica. Ao clicar no objeto, a mesma medida mostrada na aba Medição vai para o relatório (evento `spx:measure`), já preenchida. A Central confere contra uma faixa de valores aceitos e explica o resultado com a referência do catálogo. Ex.: Barnard em D4 aceita 8,5 a 12″/ano rumo ao norte; 2″/ano volta "fora da faixa".
- **Ato 3 nunca afirma descoberta.** Classificar e marcar dão XP por participação e por acerto nos controles; nada diz que alguém achou um planeta. Candidatos marcados ficam registrados para revisão, e ninguém confirmou nenhum.
- **Progresso.** XP, nível (`floor(sqrt(xp/100)) + 1`), créditos e insígnias por ato. Fica no servidor (SQLite), ligado ao id aleatório da aba e ao apelido; sem servidor, roda inteiro no navegador com `localStorage`.
- **Hangar.** Nome, cor do escudo, emblema, cor do rastro, painel extra (nível 3) e acabamento dourado (insígnia do ato 3). Cada peça é desbloqueada uma vez com créditos. As peças são só visuais: aparecem no Hangar e, a cor do rastro, no globo dos jogadores.
- **Diário de bordo** com o que você mediu e o valor de referência de cada missão cumprida. **Ranking de XP** no Mural.
- **API.** `GET /api/missions` (sem as faixas de resposta), `GET /api/player`, `POST /api/mission/accept`, `/abandon`, `/report` (até 10 por minuto), `POST /api/player/region`, `POST /api/player/satellite`, `GET /api/leaderboard`. `/api/online` passou a trazer nível, cor, emblema e missão ativa.

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
- **Jogadores simulados.** Os 8 satélites extras no globo são inventados para demonstração (rotulados "simulados"; `?sim=0` tira).
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
