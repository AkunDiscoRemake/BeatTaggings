# BEAT TAGGINGS

Jogo de ritmo em **WebXR para o Oculus Go**, com **um único sabre roxo** na mão direita. Ele roda direto no navegador do headset, sem APK, sideload nem instalação. Corte os blocos coloridos no ritmo, não encoste o sabre nos blocos pretos e use o touchpad para desviar das paredes pretas. As músicas e os mapas vêm da comunidade, pelo **BeatSaver**.

> Inspirado no gênero dos jogos de ritmo com sabres. Todos os modelos, texturas, efeitos, sons e a música inclusa ("Neon Tag") são **originais e gerados por código**. Não há nenhum asset proprietário no repositório.

---

## Como jogar

| | Oculus Go | Tela (desktop/celular) |
|---|---|---|
| Sabre | orientação do controle (3DoF) | mouse / toque |
| Selecionar | gatilho | clique |
| Mover para os lados / desviar | touchpad (esquerda/direita) | A/D ou ←/→ |
| Rolar listas | deslizar no touchpad (cima/baixo) | roda do mouse, ↑/↓ |
| Pausar / voltar | botão Voltar, ou segurar o gatilho por 1 s | Esc / P |
| Agachar (barreiras no alto) | abaixar o corpo (acelerômetro) ou curvar a cabeça para baixo | S / C |
| Inclinar o corpo | inclinar o corpo / tombar a cabeça para o lado | Q / E |

* **Blocos coloridos** (magenta e violeta): corte-os. A seta indica a direção ideal do golpe e o ponto aceita qualquer direção. Golpes rápidos e que passam pelo centro do bloco valem mais (até 115 pontos × multiplicador).
* **Combo e multiplicador**: x1 → x2 → x4 → x8. Um erro reseta o combo e desce um nível do multiplicador.
* **Blocos pretos com X**: são obstáculos. Tocar neles com o sabre tira energia.
* **Paredes pretas**: desvie movendo o corpo com o touchpad. Ficar dentro de uma parede drena energia.
* **Barreiras**: paredes pretas laterais (desvie para o lado) e **barras no alto** (abaixe-se para passar por baixo). O HUD avisa **ABAIXE!** / **DESVIE**. Com **Barreiras extras** ligado, trechos sem notas de qualquer mapa viram uma pista de obstáculos no ritmo da música.
* **Energia**: se zerar, a música falha (a menos que **Sem falha** esteja ligado).
* No fim aparecem pontuação, precisão, rank (SS/S/A/B/C/D), combo máximo e recorde local.

---

## Executar

O jogo é um site estático, sem etapa de build.

```bash
npm start            # http://localhost:8080  (node tools/serve.mjs)
npm test             # testes de unidade (parser de mapas, síntese da música demo)
npm run test:e2e     # E2E com Playwright: menus + partida completa (node tests/e2e.mjs --full)
```

**No Oculus Go o WebXR exige HTTPS.** Opções:

1. **GitHub Pages** (recomendado): o workflow `.github/workflows/pages.yml` publica o site a cada push na `main`. Ative em *Settings → Pages → Source: GitHub Actions* e abra `https://<usuario>.github.io/<repo>/` no navegador do Go.
2. Qualquer hospedagem estática com HTTPS (Netlify, Vercel, Cloudflare Pages…).
3. Na rede local: um túnel HTTPS para `npm start`.

Depois, no Go: abra a URL → **ENTRAR NO VR** → **JOGAR** → escolha uma música → dificuldade → **JOGAR ▶**.

Parâmetros de depuração: `?autoplay=1` (o sabre e o desvio jogam sozinhos) e `?demo=Normal` (inicia direto a música offline).

---

## Pesquisa feita antes da implementação

### "OpenSaver"
Não encontrei nenhum serviço, API ou projeto público chamado **OpenSaver** (busquei na web e no GitHub). O pedido descreve um repositório aberto de músicas e mapas rítmicos com busca, capa e mapas compatíveis. Isso corresponde ao **BeatSaver** (`beatsaver.com`), o repositório comunitário de mapas aberto do gênero. Usei ele como fonte. A integração está isolada em `js/songs/beatsaver.js`, então trocar de fonte depois significa trocar um único módulo.

Endpoints **verificados ao vivo** antes do uso (nenhum foi inventado):

| Endpoint | Uso |
|---|---|
| `GET https://api.beatsaver.com/search/text/{page}?q=&sortOrder=Rating\|Curated\|Latest\|Relevance` | biblioteca e busca (`{docs, info:{total,pages}}`, 20 por página) |
| `GET https://api.beatsaver.com/maps/id/{id}` | detalhes de um mapa |
| `versions[0].downloadURL` (r2cdn) | `.zip` do mapa |
| `versions[0].coverURL` / `previewURL` (cfcdn) | capa e prévia em áudio |

O CORS foi conferido: a API, os zips e as capas respondem `Access-Control-Allow-Origin: *`. A prévia `.mp3` **não** envia CORS, por isso ela toca num `<audio>` simples, sem passar pelo Web Audio.

**Formato do pacote** (conferido baixando mapas reais): um zip com `Info.dat` (v2.x ou v4.x), um `.dat` por dificuldade (v2: `_notes/_obstacles`; v3: `colorNotes/bombNotes/obstacles/bpmEvents`; v4: arrays indexados `colorNotes` + `colorNotesData`…), áudio `.egg`/`.ogg` (Ogg Vorbis) e a capa. O parser (`js/songs/mapparser.js`) aceita v2, v3 (inclusive mudanças de BPM) e v4. Ele foi testado com mapas reais v2 e v3.

### Navegador do Oculus Go
* A documentação da Oculus informa que o **Oculus Browser suporta WebXR a partir da versão 7.0**, e que o **WebVR foi descontinuado**. O jogo usa WebXR (`immersive-vr`). Em versões antigas que só têm WebVR 1.1 (`navigator.getVRDisplays`), ele carrega o **webxr-polyfill** oficial do Immersive Web como ponte.
* Para não depender de APIs novas que o Chromium antigo do Go não tem, usei o **Three.js r128**. O código não usa `?.`, `??`, campos de classe nem CSS `inset`.
* O Go é **3DoF**: só há orientação da cabeça e do controle, sem posição. O jogo **ignora deliberadamente** a posição emulada do controle. Ele usa um "arm model" próprio: o sabre gira em torno de um ponto fixo do lado direito do corpo e só a orientação importa. A cabeça não se desloca, então o desvio lateral é feito pelo touchpad. As paredes que só dariam para evitar agachando (largura total da pista) são removidas dos mapas.
* Espaço de referência: tenta `local-floor` e cai para `local`, compensando a altura (1,6 m).
* O controle (WebXR gamepad) usa `buttons[0]` para o gatilho, o touchpad em `axes[0..1]` (ou `[2..3]`) com clique em `buttons[2]`/`[1]`, e qualquer outro botão exposto como **Voltar**. Como o navegador nem sempre expõe o botão Voltar, também dá para **segurar o gatilho por 1 s** para pausar. A pausa também é automática quando a sessão perde a visibilidade (botão Oculus).

---

## Arquitetura

```
index.html, css/            página inicial (verificação de VR, botões Entrar no VR / Jogar na tela)
vendor/                     three.js r128, fflate (unzip), webxr-polyfill — com licenças
js/main.js                  bootstrap, sessão WebXR, máquina de estados, loop de frame
js/core/                    config (layout da pista, pontuação, presets de qualidade), settings + recordes (localStorage)
js/render/                  textures (todas procedurais), environment, saber, objects (instancing), particles
js/audio/audio.js           Web Audio: relógio da música preciso, SFX sintetizados, prévia
js/input/input.js           controle do Go (3DoF), touchpad/swipe, voltar; mouse/teclado
js/gameplay/                game (timeline, spawn, colisão varrida, obstáculos), scoring (combo/multiplicador/energia/rank)
js/songs/                   beatsaver (API), loader (download/unzip/decode), mapparser (v2/v3/v4 + adaptação 1 sabre), demo (música + mapas originais)
js/ui/                      panel (canvas → textura, widgets, raycast), menu (todas as telas), hud
tests/                      parser.test.mjs (Node), e2e.mjs (Playwright)
tools/serve.mjs             servidor estático local
```

**Sincronia:** o tempo da música vem de `AudioContext.getOutputTimestamp()`, que já desconta a latência de saída. Há uma opção de ajuste fino ("Atraso do áudio"). A posição de cada bloco é calculada a cada frame a partir desse relógio (`z = hitZ + (t − t_nota) × velocidade`), então os blocos não acumulam deriva.

**Colisão:** um teste de segmento contra AABB é varrido entre a lâmina do frame anterior e a atual, em 5 amostras, com o bloco interpolado na própria trajetória. Assim nenhum corte se perde, mesmo com FPS baixo. A pontuação considera o pico de velocidade do golpe, a passagem mais próxima do centro (medida durante ~70 ms de follow-through) e a direção.

**Um sabre só:** mapas de 2 mãos são adaptados. Notas simultâneas viram uma, notas rápidas demais para uma mão são afinadas e blocos pretos que ficariam no caminho das notas mantidas são removidos. Mapas com a característica **OneSaber** são preferidos quando existem. A adaptação pode ser desligada nas configurações.

### O sabre roxo
* O cabo é modelado com `LatheGeometry`: pomo cromado, empunhadura emborrachada com estrias, corpo e emissor cromados, 3 anéis roxos, garras no emissor, botão de ativação e janela de energia. O sombreamento é matcap (aparência metálica **sem nenhuma luz** na cena).
* A lâmina tem 3 camadas (núcleo branco, interna lilás, halo roxo) com shader fresnel aditivo, pulso de energia e cintilação. É um "bloom" sem pós-processamento.
* Tem flares no emissor e na ponta, rastro luminoso (ribbon com fade), partículas quando o sabre se move rápido, brilho projetado no chão, animação de ignição e flash a cada acerto. Os blocos cortados se partem em duas metades orientadas pelo golpe.

### Postura: agachar e inclinar (`js/input/posture.js`)
O Oculus Go tem uma IMU (acelerômetro, giroscópio e magnetômetro), mas o WebXR entrega à página só a **rotação**. Por isso o jogo combina duas fontes:
1. **Acelerômetro**, via `DeviceMotionEvent`, quando o navegador o fornece. A aceleração vertical vem da **magnitude** do vetor medido menos a gravidade estimada, o que a torna imune a girar ou balançar a cabeça. Uma integração dupla "vazada" transforma a aceleração no deslocamento de curto prazo de um agachamento (volta sozinha a zero quando você para). O eixo lateral, com a gravidade removida, dá a inclinação do corpo.
2. **Inclinação da cabeça** (sempre disponível): curvar a cabeça para baixo agacha, e tombar para o lado inclina.

O modo padrão "Acelerômetro + cabeça" usa o maior sinal dos dois. Também há os modos "Inclinar a cabeça", "Touchpad (baixo)" e "Desligado", além de sensibilidade Baixa/Média/Alta. A tela **Configurações → TESTAR POSTURA** mostra ao vivo qual sensor está chegando, as leituras e as barras de agachar e inclinar. Com o agachar desligado, as barras superiores são removidas dos mapas.

### Performance (Snapdragon 821 / Adreno 530)
* Nenhuma luz dinâmica, nenhum pós-processamento e nenhuma sombra. Só materiais unlit, matcap e shaders curtos.
* Os blocos, os blocos pretos e os detritos usam `InstancedMesh` (1 draw call por tipo). As partículas são um único `Points` com buffer fixo. Os arcos de neon são um único mesh mesclado.
* Pools e buffers são pré-alocados, sem alocação por frame no gameplay (vetores temporários reutilizados, compactação in-place das listas ativas).
* Os painéis em canvas são redesenhados só quando algo muda (o HUD no máximo ~10×/s).
* Os presets de qualidade (Baixa/Média/Alta) ajustam a escala do framebuffer XR, o *fixed foveation* do Oculus Browser, o limite de partículas, o rastro e as estrelas. Se disponível, o jogo pede 72 Hz (`updateTargetFrameRate`).

---

## Testes realizados

* `npm test`: o parser v2/v3/v4, os BPM events, a adaptação para 1 sabre e a síntese da música passam. Também validei com 3 mapas reais baixados do BeatSaver (v2 e v3).
* `npm run test:e2e` (Chromium headless, WebGL por software):
  * A navegação nos menus 3D por cliques do ponteiro funciona (biblioteca do BeatSaver ao vivo → aba Offline → detalhes → Jogar), assim como a pausa.
  * A música "Neon Tag" (Normal) foi jogada inteira com `?autoplay=1`, inclusive barreiras laterais e superiores (agachando): **123/123 (full combo), 0 barreiras atingidas**, tela de resultados exibida e nenhum erro de JS.
* Testes de unidade da postura: um agachamento simulado no acelerômetro (~45 cm) é detectado e volta a "em pé". A inclinação da cabeça também é testada (curvar → agachar, tombar → inclinar).
  * Um mapa real do BeatSaver foi baixado (9,6 MB), descompactado, teve o `.egg` decodificado e foi jogado sem erros.
* **Ainda não testado num Oculus Go físico** (não havia headset disponível). Recomendo, no primeiro uso, calibrar o "Atraso do áudio" e escolher a qualidade gráfica. O preset Médio é o padrão.

---

## Licenças de terceiros
* three.js r128 — MIT (`vendor/LICENSE.three.txt`)
* fflate 0.8.2 — MIT (`vendor/LICENSE.fflate.txt`)
* webxr-polyfill 2.0.3 — Apache-2.0 (`vendor/LICENSE.webxr-polyfill.txt`)

Os mapas e as músicas do BeatSaver pertencem aos seus autores. Eles são baixados sob demanda pelo jogador e **nada é redistribuído** por este repositório.
