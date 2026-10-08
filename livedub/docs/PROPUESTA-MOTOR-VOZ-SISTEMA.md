# Propuesta: motor de voz del sistema

**Estado: PROPUESTA. No se ha escrito nada del motor nuevo.**
Fecha: 7 de octubre de 2026. Responde al resultado del paso 0.

---

## 0. Dos matices sobre tu medición, antes de nada

El resultado es bueno. Pero hay dos cosas en tus tablas que **cambian el
diseño**, y prefiero decirlas ahora que descubrirlas construyendo.

### 0.1 El parámetro `rate` NO funcionó

| velocidad | duración esperada | medida | ¿coincide? |
|---|---|---|---|
| x1,0 | 10,97 s | 10,97 s | sí |
| x1,2 | **9,14 s** | **10,95 s** | **NO** |
| x1,4 | 7,84 s | 9,84 s | NO |

A x1,2 el audio dura **exactamente lo mismo** que a x1 (10,95 vs 10,97). El
parámetro no tuvo ningún efecto; a x1,4 tuvo mucho menos del proporcional.

**Consecuencia de diseño: no se puede contar con `rate` para comprimir el
doblaje.** Hay que diseñar asumiendo velocidad natural. Lo volveremos a medir
con `chrome.tts`, que es otra implementación y podría comportarse distinto.

### 0.2 El margen es más fino de lo que parece

La frase de la sonda tiene 189 caracteres. La voz va a **17,2 caracteres por
segundo**. Pero 12 s de habla inglesa real producen más texto en español:

| | caracteres | duración | ¿cabe en 12 s? |
|---|---|---|---|
| Frase de la sonda | 189 | 10,97 s | **sí** |
| 12 s de habla normal | ~210 | 12,19 s | **no, por poco** |
| 12 s de habla rápida | ~240 | 13,93 s | **no** |

**Esto no invalida el plan**, por una razón importante: **en un vídeo real no
se habla todo el rato.** Entre frases hay pausas, música, silencios. Si el
habla ocupa el 70 % del tiempo, el presupuesto efectivo por frase de 12 s es
de unos 17 s, no 12. El doblaje recupera terreno en los silencios.

Pero significa que **el margen real hay que medirlo con vídeo de verdad**, no
darlo por bueno desde la sonda. Es el objetivo de la prueba de 5 minutos.

---

## 1. ¿Abandonar MMS-TTS? — No. Degradarlo a reserva

**Recomendación: la voz del sistema pasa a ser el motor por defecto, y
MMS-TTS se queda como reserva seleccionable.**

Razones para no borrarlo:

1. **Regla del proyecto:** no se borra nada sin preguntar. Y aquí ni siquiera
   hace falta preguntarlo, porque tiene utilidad.
2. **Es el único motor para quien no tenga voz española instalada.** Tú la
   tienes; otro Windows puede no tenerla.
3. **Ya está construido, probado y documentado.** Mantenerlo cuesta poco:
   queda detrás de un selector y nadie lo toca.
4. **Es la única opción si algún día se quiere control fino del audio**
   (mezclar la voz con el audio original en un mismo contexto, guardar el
   doblaje a un archivo…). La voz del sistema no da las muestras.

Lo honesto es decir también el coste: **dos motores es más superficie que
mantener**. Lo asumo porque la alternativa es dejar sin doblaje a quien no
tenga voz instalada.

---

## 2. Decisión de arquitectura pendiente: `speechSynthesis` vs `chrome.tts`

Hay **dos formas** de usar la voz de Windows, y la diferencia entre ellas es
grande. **No sé cuál funciona** y propongo medirlo antes de elegir.

| | `speechSynthesis` en el offscreen | `chrome.tts` en el service worker |
|---|---|---|
| Permiso nuevo en el manifiesto | **ninguno** | `"tts"` |
| Dónde vive | **junto al ducking** | separado: hay que mensajear |
| Riesgo de la política de autoplay | **sí, es el riesgo** | no la sufre |
| Service worker suspendido a los 30 s | no le afecta | **sí le afecta** |
| Documentado para este uso | no explícitamente | sí |

### Por qué `speechSynthesis` en el offscreen sería mucho mejor

El ducking vive en el offscreen, porque ahí está el `GainNode` del audio
original. Si la voz vive **en el mismo sitio**, agachar y hablar es una
función de diez líneas. Si vive en el service worker, hay que mandar mensajes
de ida y vuelta para cada frase y sincronizar dos contextos. Además no haría
falta tocar el manifiesto.

### Por qué podría no funcionar

Chrome exige **interacción del usuario** antes de dejar hablar. El documento
offscreen nunca recibe un clic. A favor: el offscreen se crea con un motivo de
audio y las páginas de extensión suelen tener un trato más laxo. **Es una
duda real y se resuelve en treinta segundos probándolo.**

### Paso 0.5 — Sonda del offscreen (zero código, 30 segundos)

Con LiveDub **capturando**, abre la consola del documento offscreen y pega:

```js
speechSynthesis.getVoices().filter(v => /^es/i.test(v.lang) && v.localService).length
```

Si devuelve **0**, el offscreen no ve las voces → directo a `chrome.tts`.
Si devuelve **2** (tus Raul y Sabina), sigue:

```js
(() => {
  const u = new SpeechSynthesisUtterance('Probando la voz desde el documento offscreen de LiveDub.');
  u.voice = speechSynthesis.getVoices().find(v => /^es/i.test(v.lang) && v.localService);
  u.onstart = () => console.log('%c✔ HABLA. Arquitectura simple viable.', 'color:lime;font-weight:bold');
  u.onerror = (e) => console.error('✘ NO habla:', e.error, '→ hay que usar chrome.tts');
  setTimeout(() => { if (!speechSynthesis.speaking) console.error('✘ silencio sin error → política de autoplay. Hay que usar chrome.tts'); }, 2000);
  speechSynthesis.cancel(); speechSynthesis.speak(u);
})();
```

**Si lo oyes hablar**, la arquitectura se simplifica mucho y no hace falta
ningún permiso nuevo. **Si no**, vamos por `chrome.tts` y el manifiesto.

---

## 3. Tamaño real del cambio (tu pregunta 2)

No es solo el worker. Esto es el inventario honesto:

| Archivo | Qué le pasa | Tamaño |
|---|---|---|
| `voz-sistema.js` | **nuevo.** Envuelve la voz del sistema con la misma interfaz que `sintetizador.js` | ~150 líneas |
| `sintetizador.js` | **sin tocar.** Pasa a ser «el motor de reserva» | 0 |
| `sintetizador-worker.js` | **sin tocar** | 0 |
| `reproductor-doblaje.js` | **se parte en dos.** El ducking se queda; la reproducción de muestras (`createBuffer`, `createBufferSource`, `playbackRate`) **sobra**, porque la voz del sistema no devuelve audio: habla sola | ~60 líneas fuera |
| `offscreen.js` | elegir motor, cablear ducking a los eventos de la voz | ~60 líneas |
| `messages.js` | constantes del motor y del reloj de medios | ~30 líneas |
| `popup/` | selector de motor; quitar «EXPERIMENTAL» si se confirma | ~40 líneas |
| `manifest.json` | permiso `"tts"` **sólo si el paso 0.5 falla** | 1 línea |
| `tests/` | pruebas del motor nuevo y del informe | ~250 líneas |

**La pieza que más me preocupa no es ninguna de ésas.** Es que `reproductor-
doblaje.js` deja de controlar cuándo suena la voz: hoy sabe exactamente
cuándo empieza y acaba porque él la reproduce. Con la voz del sistema depende
de los eventos `start`/`end`, **y hay informes de que esos eventos no siempre
llegan**. Si no llega un `end`, el audio original se queda agachado para
siempre. Hay que poner una red de seguridad por tiempo estimado.

Lo digo porque es exactamente el tipo de detalle que convierte una tarea de
dos horas en una de dos días.

---

## 4. El permiso `"tts"` (tu pregunta 3)

Si hace falta:

- **No muestra aviso al usuario al instalar.** No está en la lista de permisos
  que Chrome considera sensibles (a diferencia de `tabs`, `history` o el
  acceso a todos los sitios). No da acceso a datos; solo deja hablar.
- **No añade escrutinio en la tienda.** El permiso que sí llama la atención de
  un revisor en esta extensión es `tabCapture`, que ya está.
- **No abre ninguna vía de datos:** `chrome.tts` envía texto al motor de voz
  del sistema. Con una voz `remote: false` no sale del equipo. Habría que
  **filtrar por `remote === false` en el código**, no dejarlo a elección del
  motor, o Chrome podría escoger una voz de red y mandar las traducciones a
  los servidores de Google. Eso sí sería una fuga, y es mi responsabilidad
  impedirla.

**Advertencia de alcance:** no estás publicando en la tienda (cargas la
extensión descomprimida), así que la parte de revisión es teórica. Y no puedo
verificar las políticas de la tienda desde aquí; lo de arriba es lo que sé,
no algo que haya comprobado hoy.

---

## 5. Sincronización (tu pregunta 4) — el cuello de botella NO era el que crees

Esto es lo más importante del documento.

> **Resolver la velocidad no acerca la voz a la imagen. Solo impide que la
> distancia crezca.**

El retraso de 15-20 s **no venía del sintetizador**. Viene de la causalidad:

| Componente | Segundos | ¿Lo arregla la voz del sistema? |
|---|---|---|
| Esperar a que acabe la frase (VAD) | hasta 12 | **No.** Y pediste no tocarlo |
| Transcribir (Whisper tiny) | 2 – 3 | No |
| Traducir (OPUS-MT) | 1 – 2 | No |
| Sintetizar | antes 25-45 s, **ahora ~0,2** | **Sí, y es todo lo que arregla** |

Antes del cambio el retraso **crecía sin límite** hasta que todo se
descartaba. Después, se queda **fijo en ~15-18 s**. Eso es la diferencia entre
inservible y utilizable. Pero sigue siendo 15-18 s.

**Mi recomendación es la tuya: mantenerlo simple.** No tocar el vídeo.
Razones:

1. Alinear imagen y voz exige la línea de retardo de vídeo (opción B), que
   rechazaste con buen criterio.
2. El `playbackRate` adaptativo (opción A) ya no hace falta como red de
   seguridad: con `r · C ≈ 0,3` la cadena no se satura. Era una muleta para
   un motor lento.
3. Añadir control del vídeo ahora sería resolver un problema que las
   mediciones dicen que ya no existe.

**Lo que sí propongo, y es barato:** un **reloj de medios**. Cada frase lleva
su marca de tiempo del audio original (`video.currentTime` al detectarla), y
subtítulo y voz se publican asociados a esa marca. No sincroniza con la
imagen, pero garantiza que **subtítulo y voz van juntos y en orden**, y
permite medir el retraso de verdad en vez de estimarlo. Es el criterio 8 de la
prueba de aceptación.

> **Que quede dicho con todas las letras:** con este plan la voz española irá
> permanentemente unos 15-18 s por detrás de la imagen. Será doblaje
> **continuo**, no doblaje **sincronizado**. Si al probarlo te resulta
> inutilizable, la única salida es la opción B, con sus costes.

---

## 6. Orden propuesto

| | Qué | Estado |
|---|---|---|
| ✅ | Arreglo de colas y timeouts | **HECHO** — commit `96b8633`, 21/21 |
| ⬜ | **Paso 0.5**: sonda del offscreen (30 s, cero código) | **te toca** |
| ⬜ | `voz-sistema.js` + selector de motor | tras el 0.5 |
| ⬜ | Partir `reproductor-doblaje.js` + red de seguridad del ducking | con lo anterior |
| ⬜ | Reloj de medios e informe de la prueba | después |
| ⬜ | Prueba de 5 minutos con los 9 criterios | al final |

---

## 7. Lo que sigue sin saberse

- **Si `speechSynthesis` habla desde el offscreen.** Decide la arquitectura.
  Lo resuelve el paso 0.5.
- **Si `rate` funciona en `chrome.tts`.** En `speechSynthesis` no funcionó.
- **Si los eventos `start`/`end` llegan siempre.** Si no, el ducking necesita
  red de seguridad por tiempo.
- **Cuánto habla de verdad un vídeo tuyo.** De eso depende todo el margen, y
  no se puede saber sin medirlo con material real.
- **Si 15-18 s de retraso te resultan utilizables.** Es un juicio tuyo, y no
  lo sabrás hasta oírlo.
