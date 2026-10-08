# Rendimiento del doblaje por voz (Fase 5.1)

Este documento recoge la **primera medición real** del doblaje en Chrome, el
diagnóstico que salió de ella y las decisiones que se tomaron. Está escrito
para que dentro de seis meses se entienda por qué el doblaje viene apagado de
fábrica.

---

## 1. La medición

**Equipo:** Intel Core i5-12400, sin GPU dedicada, Windows.
**Fecha:** 7 de octubre de 2026.
**Configuración entonces:** motor cuantizado int8, reproducción a velocidad
normal, 120 ms de silencio entre oraciones.

| Frase | Audio generado | Tiempo | ms por segundo de audio |
|------:|---------------:|-------:|------------------------:|
| 1  | 3,34 s  | 6.684 ms  | 2.001 |
| 2  | 4,99 s  | 9.916 ms  | 1.987 |
| 3  | 14,79 s | 29.656 ms | 2.005 |
| 4  | 15,62 s | 30.572 ms | 1.957 |
| 7  | 20,15 s | 58.415 ms | 2.899 |
| 8  | **7,90 s** | 28.754 ms | **3.640** |
| 9  | 11,30 s | 41.427 ms | 3.666 |
| 10 | 16,42 s | 58.372 ms | 3.555 |

Estos ocho pares alimentan `tests/test-rendimiento-voz.mjs`. No son números de
ejemplo: son la prueba de regresión.

---

## 2. Dos problemas, no uno

### 2.1 Velocidad: la síntesis va a menos de la mitad de tiempo real

Hacen falta ~2.000 ms de cálculo por cada segundo de voz, es decir **0,5×
tiempo real**. Para seguir un vídeo haría falta estar cómodamente por debajo
de 1.000.

**El ritmo empeora con el tiempo, y no por el motivo evidente.** Las cuatro
primeras frases cuestan 1.957–2.005 ms/s (±2 %, asombrosamente estable). Las
últimas, ~3.550. No es que las frases tardías sean más largas: **la frase 8
tiene la mitad de audio que la 3 y tardó casi lo mismo**. Es un salto
escalonado, no una degradación gradual — el perfil de una **contención de
CPU**, no de una fuga de memoria. Al principio Whisper y el traductor estaban
ociosos entre frases; en cuanto los tres modelos trabajan de continuo compiten
por un único hilo.

### 2.2 Duración: el doblaje dura más que el original

Las frases generadas duran **14,79 s · 15,62 s · 20,15 s**. El VAD corta los
fragmentos de origen a **12 s como máximo**. O sea: hasta **1,7× más audio del
que hay hueco para reproducir**.

**Esto no lo arregla ninguna CPU.** Aunque la síntesis fuese instantánea, por
cada 12 s de vídeo habría 20 s de voz que reproducir, y el retraso se
acumularía frase a frase hasta el infinito.

Tres causas sumadas:

1. El español traducido necesita ~20-25 % más sílabas que el inglés.
2. MMS-TTS habla pausado.
3. LiveDub insertaba 120 ms de silencio entre cada oración (culpa nuestra).

---

## 3. Por qué NO se puede recomendar un procesador concreto

Era la petición más razonable del mundo: «di que hace falta un i7 de 12ª o un
M1». **No se puede, y decirlo sería engañar al usuario.**

El cuello de botella es **WebAssembly en un solo hilo**. LiveDub no puede usar
varios núcleos: haría falta el binario `ort-wasm-simd-threaded.wasm` (que no
está vendorizado) **y** aislamiento de origen cruzado, que una extensión MV3 no
obtiene fácilmente. Está en `env.backends.onnx.wasm.numThreads = 1`, en los
tres workers.

Y aquí está el problema: **el rendimiento de un solo núcleo apenas varía entre
procesadores de consumo.** Un i5-12400 ya es un buen monohilo. Entre él y lo
más rápido que se puede comprar hoy para escritorio hay aproximadamente un
**1,3-1,5×**. Un M1 está en su misma liga.

Pero para pasar de 3.550 ms/s a los <850 ms/s que exige el doblaje haría falta
**más de 4×**.

> **Ningún procesador de consumo cubre esa diferencia.** Recomendar «un i7 de
> 12ª generación o superior» llevaría a alguien a gastarse dinero para obtener
> un 30 % donde necesita un 400 %.

Por eso la advertencia **no nombra ningún procesador**. En su lugar, LiveDub
**mide el equipo que tiene delante** y da un veredicto sobre ese equipo
concreto. Es más honesto y más útil: no hay que adivinar nada.

---

## 4. Qué se cambió

| Medida | Dónde | Qué ataca |
|---|---|---|
| Motor conmutable int8 ⇄ float32, por defecto **float32** | `messages.js` → `VOZ.USAR_CUANTIZADO` | Velocidad (§2.1) |
| Reproducción a **1,2×** | `reproductor-doblaje.js` | Duración (§2.2) |
| Silencio entre oraciones: 120 ms → **40 ms** | `VOZ.PAUSA_ENTRE_ORACIONES_S` | Duración (§2.2) |
| **Decidir antes de sintetizar** si la frase cabe | `rendimiento-voz.js` | No malgastar 30 s de CPU para tirar el resultado |
| Banco de medición + **veredicto automático** | `rendimiento-voz.js` | Que el usuario no crea que está roto |

### Por qué float32 puede ser MÁS RÁPIDO que int8

Suena al revés, pero en VITS es plausible: su decodificador es casi todo
convoluciones, y ONNX Runtime **no ejecuta varias de ellas en int8**. Lo que
hace es insertar conversiones int8↔float32 alrededor de cada capa que no
soporta. El resultado puede ser más lento que no cuantizar nada, con peor
calidad de voz además. El ejemplo oficial de `Xenova/mms-tts-spa` usa
`quantized: false`.

**Es una hipótesis, no un hecho medido.** Por eso el motor es conmutable y hay
un banco de medición: para decidirlo con datos en vez de con teoría.

### Por qué acelerar la reproducción y no la síntesis

Lo ideal sería que el modelo hablase más rápido (`speaking_rate` de VITS):
menos audio que generar, menos cálculo **y** sin cambiar el tono. Se comprobó:
**el bundle vendorizado de transformers.js no implementa ese parámetro**
(cero apariciones de `speaking_rate`, `length_scale` o `noise_scale`).

La alternativa es `playbackRate` en el nodo de audio. Cuesta cero CPU, pero es
acelerar la cinta: **el tono sube** (1,20 ≈ tres semitonos). Es un compromiso
consciente y ajustable en caliente con `livedub.setVelocidadVoz(1.1)`.

---

## 5. El veredicto automático

Tras `VOZ.MUESTRAS_PARA_VEREDICTO` frases (3 por defecto), LiveDub calcula la
**mediana** de ms por segundo de audio —mediana y no media, para que un pico
puntual de CPU no condene al equipo— y dictamina:

| Veredicto | Umbral | Qué hace |
|---|---|---|
| `apto` | ≤ 850 ms/s | Nada, va sobrado |
| `justo` | ≤ 1.000 ms/s | Avisa de que puede saltarse frases |
| `insuficiente` | > 1.000 ms/s | **Apaga el doblaje y lo explica** |

**Decisión de producto (de Anderson, 7-oct-2026):** antes que un doblaje
impredecible —unas frases sí y otras no—, se apaga y se dice por qué. Un
doblaje intermitente genera más desconfianza que un «esta función necesita más
potencia de la que tiene tu equipo». Los subtítulos funcionan bien por sí
solos; no hay que forzar el doblaje a cualquier precio.

La insignia se pone **ámbar, no roja**: no es un fallo del programa.

---

## 6. Comandos de diagnóstico

En la consola del **documento offscreen**:

| Comando | Qué da |
|---|---|
| `livedub.rendimiento()` | Tabla: motor, velocidad, ms/s, expansión, veredicto |
| `livedub.rendimientoDetalle()` | Los números crudos, frase a frase |
| `livedub.setVelocidadVoz(1.1)` | Cambia la velocidad en caliente |
| `livedub.reintentarVoz()` | Borra las mediciones y reactiva el doblaje |
| `livedub.doblaje()` | Dónde se pierde la señal del interruptor |

---

## 7. Lo que sigue sin saberse

- **Si float32 es realmente más rápido que int8 aquí.** Es la hipótesis
  central de esta fase y **no está verificada**. Sólo lo dirá una medición en
  Chrome real.
- **Cuánto se gana con las tres medidas juntas.** Si float32 da un 2× y la
  aceleración + la pausa recortan un 20 % de duración, el i5-12400 quedaría
  cerca de `justo`. Es aritmética esperanzada, no una medición.
- **Cuánta CPU le está robando el doblaje a la transcripción.** Se puede medir
  comparando la latencia de transcripción con el doblaje encendido y apagado.
- Si nada de esto alcanza, la conclusión honesta es que **el doblaje en tiempo
  real no cabe en un solo hilo de WebAssembly** junto a Whisper y un traductor,
  y así habrá que escribirlo.
