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

1. **Estado global**: `opt` (toggles), `strings[]` (cordas fixas), `particles[]`, `hand{}` (estado por mão), `stretch` (corda sendo esticada).
2. **Áudio**: `initAudio()` cria o `AudioContext` (precisa ser chamado dentro do clique do botão Iniciar, exigência do iOS), `pluckBuffer(f)` gera e cacheia o buffer Karplus-Strong por frequência, `playString(s, vel, pan)` toca com volume pela velocidade do dedo e pan pela posição X.
3. **Nota**: `noteFor(lenPx)` → `{f, name, hue}`. Comprimento relativo à diagonal da tela, mapeado em log (física de corda: f ∝ 1/L) para 3 oitavas (Dó2 a Dó5), quantizado na pentatônica maior (`PENTA`).
4. **MediaPipe + câmera**: `loadModel()` tenta delegate GPU e cai para CPU. `openCamera(deviceId?)` abre a câmera, detecta `facingMode` para decidir espelhamento, lista dispositivos para o botão "Trocar câmera".
5. **Geometria**: `frameBox()` faz o mapeamento "object-fit: cover" do vídeo na tela; `toScreen()` converte landmark normalizado → pixel do canvas (com espelho). `crossAt()` = interseção de segmentos, retorna a posição 0..1 ao longo da corda.
6. **Desenho**: `glowLine()` (3 traços sobrepostos com `globalCompositeOperation='lighter'` em vez de `shadowBlur`, que é lento no iOS), `jagged()` (raio por deslocamento de ponto médio), `drawString()` (onda estacionária `sin(πt)` com amplitude decaindo), `spawn()` partículas.
7. **`loop()`** por frame:
   1. detecta mãos só quando `video.currentTime` muda;
   2. desenha vídeo escurecido;
   3. atualiza estado de cada mão (identidade estável por `handedness` Left/Right);
   4. **esticar/fixar**: duas mãos em pinça → `stretch`; quando uma solta → vira corda fixa (mínimo 50px);
   5. **tocar**: segmento (posição anterior → atual) do indicador cruzando uma corda, com cooldown;
   6. desenha cordas, corda em esticamento + rótulo da nota, rastro, esqueleto, partículas;
   7. HUD de fps.

### Convenções importantes

- Coordenadas das cordas são guardadas **normalizadas** (`ax, ay, bx, by` em 0..1 da tela) para sobreviver a resize/rotação. Converter com `* W` / `* H` ao desenhar.
- Tudo que é tamanho em pixel é multiplicado por `dpr` (cap em 2).
- Landmarks MediaPipe usados: `0` pulso, `4` ponta do polegar, `8` ponta do indicador, `9` base do dedo médio (`dist(0,9)` = escala da mão).
- `HandLandmarker.HAND_CONNECTIONS` é array de `{start, end}`.
- Mão em pinça **não** toca cordas; nada é tocado enquanto há uma corda sendo esticada.
- Textos de UI em **português (pt-BR)**.

## Parâmetros de calibração

| O quê | Onde | Valor atual |
|---|---|---|
| Entrar em pinça | `st.pinch` no loop | `dist(4,8) < size * .28` |
| Sair da pinça (histerese) | idem | `dist(4,8) < size * .45` |
| Comprimento mínimo da corda | bloco "esticar / fixar" | `50 * dpr` |
| Máximo de cordas | idem | 30 (remove a mais antiga) |
| Cooldown entre toques na mesma corda | bloco "tocar" | 140 ms |
| Velocidade → volume | `vel = speed / (40 * dpr)` | clamp 0..1 |
| Faixa de notas | `noteFor` | Dó2 (MIDI 36) a Dó5, pentatônica |
| Sustain do som | `pluckBuffer` `decay` | `.996`, buffer de 2,5 s |
| Decaimento visual da vibração | `drawString` | `exp(-age * 2.2)` |
| Escurecimento do vídeo | loop | `rgba(0,0,0,.35)` |

## Restrições de plataforma (iOS)

- `getUserMedia` só após gesto do usuário e em contexto seguro. `<video>` precisa de `playsinline muted autoplay`.
- `AudioContext` precisa ser criado/retomado dentro de um gesto. `initAudio()` toca um oscilador mudo para destravar.
- **Chave de silencioso ligada corta o Web Audio** no iPhone. Avisar o usuário.
- Evitar `shadowBlur` e filtros de canvas (performance). Preferir traços sobrepostos com `lighter`.
- Delegate GPU do MediaPipe pode falhar em iOS antigo; o fallback CPU já existe.

## Testes

Não há testes automatizados. Checagem mínima antes de commitar:

```bash
python3 -c "import re;s=open('index.html').read();open('/tmp/t.mjs','w').write(re.search(r'<script type=\"module\">(.*)</script>',s,re.S).group(1))" && node --check /tmp/t.mjs
```

Teste real precisa de câmera: rodar em `localhost` no desktop e validar no iPhone via GitHub Pages.

## Ideias / próximos passos

- Arrastar ou apagar uma corda existente (ex.: pinça perto de uma corda a agarra; punho fechado apaga).
- Escolha de escala/tom e de timbre (harpa, synth, sino).
- Tocar com qualquer ponta de dedo, não só o indicador.
- Persistir as cordas em `localStorage`.
- Gravar a performance (canvas `captureStream` + `MediaRecorder` com o áudio do `master`).
