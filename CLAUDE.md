# Harpa de Ar

Instrumento musical no navegador controlado pelas mãos via câmera. O usuário estica "cordas" de luz entre as duas mãos (gesto de pinça), elas ficam fixas na tela e são tocadas passando o dedo indicador por elas. O comprimento da corda define a nota (longa = grave, curta = aguda).

Inspirado num vídeo do criador `sonicdeadhorse` (TikTok): esqueleto da mão em pontos vermelhos/linhas verdes, cordas brilhantes com terminais nas pontas, faíscas ao tocar.

Uso principal: **Safari no iPhone**, câmera frontal. Também roda no desktop (Chrome/Safari), inclusive com o celular como webcam (Câmera de Continuidade no Mac; no Windows, apps como Camo/Iriun). Nesse caso a detecção roda no PC (mais rápida) e dá para usar a câmera traseira; o botão "Espelhar" corrige o espelho, já que câmeras virtuais não informam `facingMode`.

## Stack

- `index.html` (HTML + CSS + import map) e módulos ES nativos em `js/`. Sem build, sem bundler, sem dependências locais.
- **MediaPipe Tasks Vision** `@mediapipe/tasks-vision@0.10.14` via jsDelivr (ESM `vision_bundle.mjs` + `wasm/`).
- Modelo: `hand_landmarker.task` (float16) do `storage.googleapis.com/mediapipe-models`.
- Canvas 2D para todo o desenho. Web Audio API para o som (síntese, sem samples).
- Hospedagem: GitHub Pages (`https://kelvinjavorski.github.io/MediaPipe-Hands/`), branch `main`, raiz. Repo precisa ser público para o Pages no plano free.
- Import maps exigem iOS 16.4+ / Safari 16.4+.

## Rodar localmente

```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```

A câmera exige **contexto seguro** (`https://` ou `localhost`). Abrir via `file://` não funciona. Para testar no iPhone pela rede local é preciso https (ex.: `npx localtunnel --port 8000`, ngrok, ou simplesmente dar push e testar no GitHub Pages).

## Arquitetura

`index.html` tem só a marcação, o CSS e um import map que mapeia cada `./js/X.js` para `./js/X.js?v=N`; os módulos importam uns aos outros por caminho relativo simples (`./audio.js`) e o import map aplica a versão.

| Módulo | Responsabilidade |
|---|---|
| `js/state.js` | `VERSION` (lida do `?v=` da própria URL), `opt` (toggles), `TIMBRES` (mesma ordem de `VOICES` em `audio.js`). |
| `js/view.js` | Canvas, `ctx`, `W`/`H`/`dpr` (live bindings) e `resize()`. |
| `js/geom.js` | `dist`, `mid`, `clamp`, `crossAt` (interseção de segmentos → posição 0..1 na corda). |
| `js/audio.js` | `initAudio()` (precisa estar dentro do clique em Iniciar, exigência do iOS) e a cadeia `master → (delay de colcheia pontuada + reverb com IR gerada) → duck → compressor`. `BPM`/`BEAT` variam com `setTempo()`. `shaper()` = saturação tanh (`distCurve`). Timbres em `VOICES`: `synthVoice` (2 serras + sub, lowpass ressonante), `reeseVoice` (serras bem desafinadas + sub, saturação, lowpass com LFO: dark/Rezz), `acidVoice` (serra, filtro muito ressonante varrendo, saturação: 303), `bellVoice` (FM, razão 3,5), `pluckVoice` (Karplus-Strong). `playString(s, vel, pan)`: força do dedo → volume, brilho e *pitch bend* que volta à nota. `retune(s)` desliza as vozes de uma corda quando a nota muda. |
| `js/beat.js` | Sequenciador de 16 passos com 3 estilos em `STYLES` (cada um: `bpm`, `scale` das cordas, `bassType` `pluck`/`reese`, profundidade do sidechain `duck`, padrões `kick`/`clap`/`hat` (`o` = chimbal aberto)/`tick`/`bass`): **House** 112 maior, **Rezz** 100 menor meio-tempo com baixo reese e bumbo saturado, **Techno** 126 menor. `scheduleBeat()` roda em `setInterval` de 25 ms e agenda ~120 ms à frente no relógio do áudio. `setBeat(idx)` (−1 desliga; tempo e escala ficam no último estilo), `beatPulse()` (0..1 para as cordas piscarem). |
| `js/strings.js` | `strings[]`, `noteFor(lenPx)` (comprimento relativo à diagonal, log, 3 oitavas Dó2–Dó5, pentatônica de Dó maior ou menor), `setScale(nome)` (reafina as cordas existentes), `endPt`, `strLen`, `nearestEnd`, `moveEnd`. |
| `js/camera.js` | `startWorker()` (sobe `js/detector.js` como Web Worker e só aceita se ele conseguiu GPU; senão retorna null), `loadModel()` (thread principal, GPU com fallback CPU), `delegate`, `openCamera()` (640×480), `nextCamera()`, `toggleMirror()`, `frameBox()`/`toScreen()` (mapeamento "object-fit: cover" com espelho). |
| `js/detector.js` | Web Worker (módulo) que roda o HandLandmarker. Recebe `{bitmap, t}` (ImageBitmap transferido) e devolve `{type: 'result', landmarks, handedness, ms}`. O MediaPipe usa `importScripts` para o loader do WASM, que não existe em worker de módulo: o worker baixa o loader antes e substitui `importScripts` por um `eval` global. Não está no import map: é carregado com o mesmo `?v=` do `camera.js`. |
| `js/draw.js` | Primitivas (`strokePts`, `glowLine`, `jagged`, `orb` com sprite de gradiente cacheado por matiz, `bolt` raio fractal, `ring`, `label`, `dot`), partículas, `drawString` (halo + núcleo + raios + orbes; ao tocar começa em V no ponto do toque e vira onda `sin(πt)` decaindo), `drawStretch`, `drawTrail`, `drawSkeleton`. |
| `js/main.js` | Botões e `loop()` por frame. |

`loop()` por frame:
1. **detecção**: com worker, manda `createImageBitmap(video)` só quando o worker terminou o anterior (sem fila) e marca `fresh` quando chega resultado; sem worker, chama `detectForVideo` direto quando `video.currentTime` muda. Mede ms de detecção e detecções/s para o HUD;
2. `clearRect` no canvas (o vídeo é exibido pelo próprio `<video>` + `#shade` por CSS, não redesenhado);
3. atualiza estado de cada mão (identidade estável por `handedness` Left/Right);
4. **agarrar**: pinça que *começa* perto de uma ponta (`grabR`) agarra essa ponta e a move; ao soltar, se ficou < 50px, apaga a corda;
5. **esticar/fixar**: duas pinças livres (sem `grab`) → `stretch`; quando uma solta → vira corda fixa (mínimo 50px);
6. **tocar** (só em frame `fresh`): segmento anterior → atual do indicador de mão sem pinça cruzando uma corda, com cooldown; velocidade normalizada por tempo;
7. desenha cordas, pontas agarradas/agarráveis, corda em esticamento, rastro, esqueleto, partículas;
8. HUD: versão, fps de desenho, detecções/s, ms de detecção e modo (`worker GPU` / `principal GPU|CPU`), cordas.

### Convenções importantes

- Coordenadas das cordas são guardadas **normalizadas** (`ax, ay, bx, by` em 0..1 da tela) para sobreviver a resize/rotação. Converter com `endPt(s, 'a'|'b')`.
- Tudo que é tamanho em pixel é multiplicado por `dpr` (cap em 1.5, por desempenho).
- Landmarks MediaPipe usados: `0` pulso, `4` ponta do polegar, `8` ponta do indicador, `9` base do dedo médio (`dist(0,9)` = escala da mão). `worldLandmarks` (metros, centrados na mão) são usados para a distância real da pinça; o HUD mostra essa distância em cm por mão.
- `HandLandmarker.HAND_CONNECTIONS` é array de `{start, end}`.
- Mão em pinça **não** toca cordas. Uma mão pode segurar a ponta de uma corda enquanto a outra toca (inclusive a mesma corda).
- Textos de UI em **português (pt-BR)**.

## Parâmetros de calibração

| O quê | Onde | Valor atual |
|---|---|---|
| Entrar em pinça | `updatePinch` em `main.js` | 3D (`worldLandmarks`, metros) `< PINCH_IN_M` 3 cm **e** 2D `< size * .35` |
| Sair da pinça (histerese) | idem | 3D `> PINCH_OUT_M` 5 cm **ou** 2D `> size * .5` |
| Confirmação da pinça | `PINCH_FRAMES` | 2 leituras seguidas para entrar ou sair (uma leitura errada isolada é ignorada) |
| Raio para agarrar ponta | `grabR` | `max(40 * dpr, size * .6)` |
| Comprimento mínimo da corda | blocos "agarrar" e "esticar" | `50 * dpr` (abaixo disso, apaga/não cria) |
| Máximo de cordas | idem | 30 (remove a mais antiga) |
| Cooldown entre toques na mesma corda | bloco "tocar" | 140 ms |
| Velocidade → intensidade | `vel = px * (33/dt) / (40 * dpr)` | clamp 0..1 |
| Pitch bend pela força | `synthVoice` / `pluckVoice` | até +2 / +1 semitom, volta em ~80 ms |
| Delay | `initAudio` | `BEAT * .75` (colcheia pontuada), feedback .38, wet .3 |
| Reverb | `initAudio` | IR de 2,4 s, wet .28 |
| Tempo / sidechain | `STYLES` em `beat.js` | House 112 / Rezz 100 / Techno 126 BPM; cordas caem para 50% / 35% / 45% no bumbo |
| Faixa de notas | `noteFor` | Dó2 (MIDI 36) a Dó5, pentatônica maior ou menor (definida pelo estilo da batida) |
| Decaimento visual da vibração | `drawString` | `exp(-age * 2.2)` |
| Escurecimento do vídeo | `#shade` (CSS) | `rgba(0,0,0,.35)` |
| Máximo de partículas / vozes | `MAX_PARTICLES` / `MAX_VOICES` | 300 / 10 |

## Desempenho

- O vídeo é mostrado pelo `<video>` (compositor da GPU), não com `drawImage` no canvas.
- A detecção roda num Web Worker com GPU quando possível (`worker GPU` no HUD): o desenho segue a 60 fps e as mãos atualizam no ritmo que o aparelho consegue. GPU em worker exige OffscreenCanvas com WebGL2 (Safari 17+); sem isso, cai para o thread principal (`principal GPU|CPU`), onde cada detecção trava o desenho.
- A primeira detecção na GPU leva ~2 s (compilação de shaders); depois, poucos ms no desktop.
- React não ajudaria: não há árvore de UI para reconciliar.

## Restrições de plataforma (iOS)

- `getUserMedia` só após gesto do usuário e em contexto seguro. `<video>` precisa de `playsinline muted autoplay`.
- `AudioContext` precisa ser criado/retomado dentro de um gesto. `initAudio()` toca um oscilador mudo para destravar.
- **Chave de silencioso ligada corta o Web Audio** no iPhone. Avisar o usuário.
- Evitar `shadowBlur` e filtros de canvas (performance). Preferir traços sobrepostos com `lighter`.
- Delegate GPU do MediaPipe pode falhar em iOS antigo; o fallback CPU já existe.

## Versão

A versão fica **só no import map do `index.html`** (`?v=N` em todas as linhas). Ela força o Safari a baixar os módulos novos e é exibida na tela inicial (`#ver`) e no HUD. **Aumentar a cada mudança publicada** (v5, v6, …) para o usuário confirmar no iPhone que o Pages já serve a versão nova. Todo módulo novo precisa de uma linha no import map.

## Testes

Não há testes automatizados. Checagem mínima antes de commitar:

```bash
for f in js/*.js; do node --check "$f"; done
```

Teste real precisa de câmera: rodar em `localhost` no desktop e validar no iPhone via GitHub Pages.

## Ideias / próximos passos

- Escolha de tom (hoje sempre Dó) e escala independente da batida.
- Tocar com qualquer ponta de dedo, não só o indicador.
- Persistir as cordas em `localStorage`.
- Gravar a performance (canvas `captureStream` + `MediaRecorder` com o áudio do `master`).
