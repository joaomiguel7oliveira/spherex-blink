# Contexto para agente: ferramenta web SPHEREx

Nov 14, 2026 · @João Miguel de Oliveira

## Sua missão

Construir um protótipo funcional de uma ferramenta web pública que mostra imagens do telescópio SPHEREx (NASA) como animação ao longo do tempo, para que qualquer pessoa encontre objetos que se movem no céu. O projeto é para o hackathon NASA Space Apps Challenge 2026 (desafio "Planet X and SPHEREx", nível avançado).

Priorize uma demo que funcione de ponta a ponta em poucos alvos sobre amplitude de recursos.

## O desafio

Desde maio de 2025, o SPHEREx mapeia o céu inteiro a cada seis meses em 102 bandas de infravermelho próximo, com imagens de mais de um bilhão de objetos. Objetos próximos (asteroides, cometas, anãs marrons, estrelas vizinhas) mudam de posição entre imagens. O volume é grande demais para cientistas sozinhos, então a NASA quer ferramentas para o público ajudar.

Requisitos obrigatórios:

- Ferramenta web pública.
- O usuário informa coordenadas (Ascensão Reta e Declinação).
- A ferramenta exibe a série de imagens dessa região como um pequeno vídeo.

Alvos de teste (resolver as coordenadas via SIMBAD/Sesame, exceto a WISE 0855):

| Alvo | Tipo | O que deve aparecer |
| --- | --- | --- |
| Estrela de Barnard | Estrela próxima, alto movimento próprio | Deslocamento claro |
| Epsilon Indi B | Par de anãs marrons orbitando uma estrela | Deslocamento |
| WISE 0855 (RA 08h55m10.831s, Dec −07°14′42.53″) | Anã marrom rápida | Deslocamento claro |
| RW Aurigae | Estrela variável | Mudança de brilho |
| R Draconis | Estrela variável | Mudança de brilho |

Extras valorizados: fácil atualização com novos dados, uso criativo das 102 bandas (soma por detector, espectros na hora), somar e subtrair épocas, campo de visão ajustável, sobreposição de Gaia/WISE, coordenadas na URL, metadados como flags de contaminação.

## A solução

Dois modos, com a fila de candidatos como diferencial do pitch.

**Modo explorar (requisito do desafio):** coordenadas ou nome do objeto → recortes alinhados de todas as épocas → animação com controles. Estado sempre na URL.

**Modo fila de candidatos (diferencial):** o sistema leva os candidatos ao usuário, em vez de ele procurar no céu inteiro.

1. Comparar imagens de épocas diferentes e detectar fontes que mudaram (subtração + detecção de fontes).
2. Cruzar com Gaia e WISE/CatWISE e descartar o que já é conhecido.
3. Montar uma fila com o que sobrar.
4. O usuário vê um candidato por vez e classifica: "se move", "não se move" ou "é defeito".
5. Candidatos com consenso sobem para revisão de astrônomos.

Síntese: a máquina filtra, o humano decide.

## Público e jornada do usuário

Público misto: leigos (querem ver e aprender), estudantes e entusiastas (querem caçar e marcar candidatos) e pesquisadores (querem ferramentas avançadas e exportação). Interface simples por padrão, recursos avançados em painéis opcionais.

Jornada:

1. Chega na home e clica em um exemplo pronto (sem precisar saber coordenadas).
2. A animação começa sozinha e uma legenda explica o que se move e por quê.
3. Usa os controles: pausar, quadro a quadro, data de cada imagem, tamanho do campo.
4. Busca outra região por nome ou coordenadas e compartilha o link.
5. Opcionalmente usa subtração, soma e seleção de banda.
6. Clica em um ponto e vê o espectro com explicação simples.
7. Liga camadas Gaia/WISE para ver o que já é conhecido.
8. Marca um candidato ou classifica candidatos da fila.

Motivação: curiosidade, chance real de descoberta, contribuir com a ciência. Recompensa: crédito registrado (quem marcou primeiro e quando), avisos de confirmação, mural de descobertas, conquistas.

## Funcionalidades por prioridade

| Prioridade | Funcionalidade |
| --- | --- |
| P0 | Entrada de RA/Dec (graus e h:m:s) e busca por nome via SIMBAD/Sesame |
| P0 | Recortes do SPHEREx alinhados no mesmo WCS e ordenados por data |
| P0 | Player: play/pausa, velocidade, quadro a quadro, slider, data de cada quadro |
| P0 | Parâmetros na URL (`?ra=&dec=&fov=&band=`) e botões com os 5 alvos de teste |
| P1 | Blink entre dois quadros, imagem diferença (A − B) e soma de épocas |
| P1 | Campo de visão ajustável e seletor de banda/detector, composição RGB falsa |
| P1 | Espectro por clique (fluxo × comprimento de onda) |
| P1 | Fila de candidatos em uma região pequena (em torno da WISE 0855) |
| P2 | Sobreposição Gaia e WISE/CatWISE via Aladin Lite |
| P2 | Marcar candidato e exportar CSV; flags de contaminação visíveis |
| P2 | Embed (iframe) e modo sala de aula |

## Arquitetura e dados

Stack sugerida (pode ajustar se houver motivo):

- **Frontend:** JavaScript (React ou JS puro), Aladin Lite (CDS) para o céu e camadas, Plotly para espectros.
- **Backend:** Python com FastAPI, `astropy`, `astroquery`, `reproject` e `photutils` (detecção de fontes).
- **Dados:** arquivo do SPHEREx no IRSA/IPAC (serviços IVOA como SIA/TAP). Confirme na documentação atual do IRSA os endpoints e o formato dos produtos.
- **Cache:** recortes guardados em disco ou bucket, indexados por posição, campo, banda e época.
- **Ingestão:** script periódico que detecta novos lançamentos de dados e atualiza o índice, sem mudar o frontend.

Fluxo de uma consulta: coordenadas → busca de imagens que cobrem o ponto → recorte → reprojeção para um WCS comum → normalização de brilho igual entre quadros → PNG/JSON para o frontend.

Pré-gere os recortes dos 5 alvos de teste, para a demo funcionar mesmo com a API lenta ou fora do ar.

## Restrições, cuidados e critérios de pronto

Cuidados:

- **Alinhamento:** sem reprojeção para um WCS comum, tudo parece se mover.
- **Poucas épocas:** com cobertura a cada seis meses, há poucos quadros por região. Mostre a data de cada quadro e ofereça diferença e soma.
- **Artefatos:** trate máscaras e flags (raios cósmicos, fontes vizinhas, bordas do detector).
- **Escopo:** a fila de candidatos roda só em uma região pequena; não tente o céu inteiro.
- **Campo de visão:** limite o tamanho máximo para controlar o tempo de download.
- **Fatos:** não invente endpoints, nomes de produtos ou coordenadas. Consulte a documentação do IRSA e o SIMBAD e registre as fontes no README.

Critérios de pronto:

- [ ] WISE 0855 e Estrela de Barnard mostram deslocamento visível na animação.
- [ ] RW Aurigae e R Draconis mostram variação de brilho.
- [ ] Abrir uma URL com `ra`, `dec` e `fov` carrega a região certa.
- [ ] A demo dos alvos de teste funciona a partir do cache.
- [ ] README explica como rodar, como atualizar os dados e de onde eles vêm.
