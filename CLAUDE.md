# Harpa de Ar

Instrumento musical no navegador controlado pelas mãos via câmera. O usuário estica "cordas" de luz entre as duas mãos (gesto de pinça), elas ficam fixas na tela e são tocadas passando o dedo indicador por elas. O comprimento da corda define a nota (longa = grave, curta = aguda).

Inspirado num vídeo do criador `sonicdeadhorse` (TikTok): esqueleto da mão em pontos vermelhos/linhas verdes, cordas brilhantes com terminais nas pontas, faíscas ao tocar.

Uso principal: **Safari no iPhone**, câmera frontal. Também roda no desktop (Chrome/Safari), inclusive com iPhone como webcam via Câmera de Continuidade no Mac.

## Stack

- Um único arquivo: `index.html` (HTML + CSS + JS module inline). Sem build, sem bundler, sem dependências locais.
- **MediaPipe Tasks Vision** `@mediapipe/tasks-vision@0.10.14` via jsDelivr (ESM `vision_bundle.mjs` + `wasm/`).
- Modelo: `hand_landmarker.task` (float16) do `storage.googleapis.com/mediapipe-models`.
- Canvas 2D para todo o desenho. Web Audio API para o som (síntese Karplus-Strong, sem samples).
- Hospedagem: GitHub Pages (`https://kelvinjavorski.github.io/<repo>/`), branch `main`, raiz. Repo precisa ser público para o Pages no plano free.

## Rodar localmente

```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```

A câmera exige **contexto seguro** (`https://` ou `localhost`). Abrir via `file://` não funciona. Para testar no iPhone pela rede local é preciso https (ex.: `npx localtunnel --port 8000`, ngrok, ou simplesmente dar push e testar no GitHub Pages).

## Arquitetura do `index.html`

Ordem das seções no `<script type="module">`:

1. **Estado global**: `opt` (toggles, inclusive `synth`), `strings[]` (cordas fixas), `particles[]`, `hand{}` (estado por mão: pinça, `grab`, posição anterior, rastro), `stretch` (corda sendo esticada).
2. **Áudio**: `initAudio()` cria o `AudioContext` (precisa ser chamado dentro do clique do botão Iniciar, exigência do iOS) e a cadeia `master → (delay de colcheia pontuada + reverb por convolução com IR gerada) → duck → compressor`; a bateria vai por `drums → compressor`. Três timbres (botão "Timbre", `opt.timbre` indexa `TIMBRES`): `synthVoice` (2 serras desafinadas + sub quadrada, lowpass ressonante), `bellVoice` (FM, razão 3,5) e `pluckVoice` (Karplus-Strong via `pluckBuffer`). `playString(s, vel, pan)`: a velocidade do dedo controla volume, brilho e um *pitch bend* inicial que volta à nota (corda esticada). Vozes ativas em `voices[]` (máx. 10); `retune(s)` faz as vozes de uma corda deslizarem para a nova nota.
   - **Batida** (botão "Batida", `setBeat`): sequenciador de 16 passos a `BPM` 112, padrões em `PAT` (bumbo, palma, chimbal, tique, baixo em Dó pentatônico). `scheduleBeat()` roda em `setInterval` de 25 ms e agenda ~120 ms à frente no relógio do áudio (não depende do `requestAnimationFrame`). Cada bumbo faz *sidechain* no `duck` (cordas "respiram") e entra em `kickTimes` para o pulso visual (`pulse` no loop). Desligar "Som" desliga a batida.
3. **Nota**: `noteFor(lenPx)` → `{f, name, hue}`. Comprimento relativo à diagonal da tela, mapeado em log (física de corda: f ∝ 1/L) para 3 oitavas (Dó2 a Dó5), quantizado na pentatônica maior (`PENTA`).
4. **MediaPipe + câmera**: `loadModel()` tenta delegate GPU e cai para CPU. `openCamera(deviceId?)` abre a câmera em 640×480 (o modelo reduz para ~224 px de qualquer forma), detecta `facingMode` para decidir espelhamento (classe `.mirror` no `<video>`), lista dispositivos para o botão "Trocar câmera".
5. **Geometria**: `frameBox()` reproduz o "object-fit: cover" do `<video>`; `toScreen()` converte landmark normalizado → pixel do canvas (com espelho). `crossAt()` = interseção de segmentos, retorna a posição 0..1 ao longo da corda. `endPt`, `strLen`, `nearestEnd` (ponta mais próxima não agarrada), `moveEnd` (move a ponta e recalcula a nota).
6. **Desenho**: `glowLine()` (3 traços sobrepostos com `globalCompositeOperation='lighter'` em vez de `shadowBlur`, que é lento no iOS), `jagged()` (raio por deslocamento de ponto médio, usado na corda sendo esticada), `orb()` (sprite de gradiente radial pré-renderizado e cacheado por matiz em `glowSprite`, para as pontas brilhantes), `bolt()` (raio que segue a curva da corda, sorteado de novo a cada frame, com ponto do meio extra para aspecto fractal), `drawString()` (halo + núcleo + 1–2 raios + orbes; ao ser tocada começa em V no ponto do toque, na direção do dedo, e vira onda `sin(πt)` decaindo; a amplitude abre os raios), `spawn()` partículas.
7. **`loop()`** por frame:
   1. detecta mãos só quando `video.currentTime` muda (`fresh`); mede o tempo da detecção para o HUD;
   2. `clearRect` no canvas (o vídeo é exibido pelo próprio `<video>` + `#shade` por CSS, não redesenhado);
   3. atualiza estado de cada mão (identidade estável por `handedness` Left/Right);
   4. **agarrar**: pinça que *começa* perto de uma ponta (`grabR`) agarra essa ponta e a move; ao soltar, se ficou < 50px, apaga a corda;
   5. **esticar/fixar**: duas pinças livres (sem `grab`) → `stretch`; quando uma solta → vira corda fixa (mínimo 50px);
   6. **tocar** (só em frame `fresh`): segmento anterior → atual do indicador de mão sem pinça cruzando uma corda, com cooldown; velocidade normalizada por tempo;
   7. desenha cordas, pontas agarradas/agarráveis, corda em esticamento + nota, rastro, esqueleto, partículas;
   8. HUD: fps, ms de detecção, mãos, cordas.

### Convenções importantes

- Coordenadas das cordas são guardadas **normalizadas** (`ax, ay, bx, by` em 0..1 da tela) para sobreviver a resize/rotação. Converter com `endPt(s, 'a'|'b')`.
- Tudo que é tamanho em pixel é multiplicado por `dpr` (cap em 1.5, por desempenho).
- Landmarks MediaPipe usados: `0` pulso, `4` ponta do polegar, `8` ponta do indicador, `9` base do dedo médio (`dist(0,9)` = escala da mão).
- `HandLandmarker.HAND_CONNECTIONS` é array de `{start, end}`.
- Mão em pinça **não** toca cordas. Uma mão pode segurar a ponta de uma corda enquanto a outra toca (inclusive a mesma corda).
- Textos de UI em **português (pt-BR)**.

## Parâmetros de calibração

| O quê | Onde | Valor atual |
|---|---|---|
| Entrar em pinça | `st.pinch` no loop | `dist(4,8) < size * .28` |
| Sair da pinça (histerese) | idem | `dist(4,8) < size * .45` |
| Raio para agarrar ponta | `grabR` | `max(40 * dpr, size * .6)` |
| Comprimento mínimo da corda | blocos "agarrar" e "esticar" | `50 * dpr` (abaixo disso, apaga/não cria) |
| Máximo de cordas | idem | 30 (remove a mais antiga) |
| Cooldown entre toques na mesma corda | bloco "tocar" | 140 ms |
| Velocidade → intensidade | `vel = px * (33/dt) / (40 * dpr)` | clamp 0..1 |
| Pitch bend pela força | `synthVoice` / `pluckVoice` | até +2 / +1 semitom, volta em ~80 ms |
| Delay | `initAudio` | `BEAT * .75` (colcheia pontuada), feedback .38, wet .3 |
| Reverb | `initAudio` | IR de 2,4 s, wet .28 |
| Tempo / sidechain | `BPM`, `kick()` | 112 BPM; cordas caem para 50% no bumbo |
| Faixa de notas | `noteFor` | Dó2 (MIDI 36) a Dó5, pentatônica |
| Decaimento visual da vibração | `drawString` | `exp(-age * 2.2)` |
| Escurecimento do vídeo | `#shade` (CSS) | `rgba(0,0,0,.35)` |
| Máximo de partículas / vozes | `MAX_PARTICLES` / `MAX_VOICES` | 300 / 10 |

## Desempenho

- O vídeo é mostrado pelo `<video>` (compositor da GPU), não com `drawImage` no canvas.
- O gargalo restante é `detectForVideo` no thread principal (ver "detecção X ms" no HUD). Se continuar lento, próximo passo é mover o MediaPipe para um Web Worker. React não ajudaria: não há árvore de UI para reconciliar.

## Restrições de plataforma (iOS)

- `getUserMedia` só após gesto do usuário e em contexto seguro. `<video>` precisa de `playsinline muted autoplay`.
- `AudioContext` precisa ser criado/retomado dentro de um gesto. `initAudio()` toca um oscilador mudo para destravar.
- **Chave de silencioso ligada corta o Web Audio** no iPhone. Avisar o usuário.
- Evitar `shadowBlur` e filtros de canvas (performance). Preferir traços sobrepostos com `lighter`.
- Delegate GPU do MediaPipe pode falhar em iOS antigo; o fallback CPU já existe.

## Versão

`const VERSION` no topo do script aparece na tela inicial (`#ver`) e no HUD. **Aumentar a cada mudança publicada** (v4, v5, …) para o usuário confirmar no iPhone que o Pages já serve a versão nova.

## Testes

Não há testes automatizados. Checagem mínima antes de commitar:

```bash
python3 -c "import re;s=open('index.html').read();open('/tmp/t.mjs','w').write(re.search(r'<script type=\"module\">(.*)</script>',s,re.S).group(1))" && node --check /tmp/t.mjs
```

Teste real precisa de câmera: rodar em `localhost` no desktop e validar no iPhone via GitHub Pages.

## Ideias / próximos passos

- Escolha de escala/tom e mais timbres.
- Tocar com qualquer ponta de dedo, não só o indicador.
- Persistir as cordas em `localStorage`.
- Gravar a performance (canvas `captureStream` + `MediaRecorder` com o áudio do `master`).
