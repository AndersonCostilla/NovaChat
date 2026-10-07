// Prueba del corte forzado del VAD con habla continua.
// OJO: esto es una RÉPLICA de la máquina de estados de offscreen.js (allí no es
// exportable sin tocar la cadena de audio). Si cambias el VAD, actualiza este archivo.
const FRECUENCIA = 16000, TAM = 4096;
const VAD_THRESHOLD = 0.005, MAX_SILENCE_CHUNKS = 3, MAX_FRASE_CHUNKS = 47;

let isSpeaking = false, speechChunks = [], silenceCounter = 0;
const frases = [];
const ensamblar = (cs) => { let t = 0; for (const c of cs) t += c.length;
  const s = new Float32Array(t); let o = 0; for (const c of cs) { s.set(c, o); o += c.length; } return s; };
const onFrase = (a) => frases.push(+(a.length / FRECUENCIA).toFixed(3));

function procesarChunkVad(buffer, rms) {
  if (!buffer) return;
  if (rms > VAD_THRESHOLD) {
    isSpeaking = true; silenceCounter = 0; speechChunks.push(buffer);
    if (speechChunks.length >= MAX_FRASE_CHUNKS) {
      const f = ensamblar(speechChunks); speechChunks = []; silenceCounter = 0; onFrase(f);
    }
    return;
  }
  if (!isSpeaking) return;
  silenceCounter++; speechChunks.push(buffer);
  if (silenceCounter >= MAX_SILENCE_CHUNKS) {
    isSpeaking = false; const f = ensamblar(speechChunks);
    speechChunks = []; silenceCounter = 0; onFrase(f);
  }
}

const b = () => new Float32Array(TAM);
// 120 bloques seguidos de voz (~30 s sin una sola pausa) + cierre con silencio
for (let i = 0; i < 120; i++) procesarChunkVad(b(), 0.05);
for (let i = 0; i < 3; i++) procesarChunkVad(b(), 0.001);

console.log('frases (s):', frases);
const maxima = Math.max(...frases);
console.log(`frase más larga: ${maxima} s (límite teórico ${(MAX_FRASE_CHUNKS * TAM / FRECUENCIA).toFixed(3)} s)`);
console.log('estado final:', { isSpeaking, pendientes: speechChunks.length, silenceCounter });

const ok = frases.length === 3 && maxima <= 12.1 && !isSpeaking && speechChunks.length === 0;
console.log(ok ? '\nRESULTADO: TODO CORRECTO ✔' : '\nRESULTADO: FALLA ✘');
process.exit(ok ? 0 : 1);
