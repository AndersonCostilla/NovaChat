# Dónde estamos — LiveDub, 9 de octubre de 2026

Resumen de situación. Si vuelves al proyecto dentro de una semana, lee esto
primero.

---

## 1. Qué es esto

Una extensión de Chrome que **dobla al español, en voz alta y en directo, el
audio en inglés de la pestaña que estés viendo**. Todo ocurre dentro de tu
ordenador: sin servidores, sin cuentas, sin API keys, sin que salga nada a
internet.

El objetivo, con tus palabras: *«poder entender contenido hablado en otro
idioma sin tener que leer subtítulos todo el tiempo»*.

## 2. Cómo funciona, en cuatro pasos

```
audio de la pestaña  →  [1] se detecta cuándo hay voz y se corta en frases
                     →  [2] Whisper escribe lo que se dijo (en inglés)
                     →  [3] el traductor lo pasa a español
                     →  [4] la voz del sistema lo lee en alto
```

Cada paso tarda. Sumados, el doblaje va **entre 10 y 18 segundos por detrás**
del vídeo. Eso ya lo aceptaste: doblaje continuo, no sincronía labial.

## 3. Lo que ya funciona

- **Captura, troceado por voz, transcripción y traducción**: cerrado y
  verificado en Chrome.
- **La voz**: funcionando con el motor del sistema, sólo voces locales.
- **Instrumentación**: un cronómetro que mide cada frase en cada paso. Es lo
  que ha permitido todo lo demás.

Pausado a propósito: el **overlay** (los subtítulos en pantalla).

## 4. El problema que nos ocupa desde hace días

**No se pierde calidad: se pierde contenido.** Hubo una sesión en la que
**el 47 % de lo que se dijo nunca llegó a sonar**. Esa es la prioridad por
encima de todo lo demás, y la causa resultó no ser una sino una cadena:

**Whisper a veces alucina.** Ante un silencio, música o ruido, en vez de no
escribir nada, se engancha y repite: *«Es interesante. Es interesante. Es
interesante…»* ×111. Eso dispara tres daños seguidos:

1. **Tarda muchísimo en generarlo** (hasta 20 s en una frase de 12 s).
2. **El traductor traduce esa parrafada entera.**
3. **La voz la lee en alto durante minuto y medio** — y mientras habla, las
   frases reales que llegan detrás se descartan por falta de sitio.

Una sola alucinación se llevó por delante **14 frases legítimas seguidas**.

## 5. Lo que hemos construido contra eso

| pieza | qué hace | estado |
|---|---|---|
| **Detector de alucinaciones** | mira cada transcripción y decide si es habla o es un bucle | **encendido y validado a mano por ti**: 3 cortes, 3 alucinaciones reales, **cero falsos positivos** |
| **Tope de voz larga** | corta la locución si se pasa de lo razonable | apagado — se probará aislado después |
| **`max_new_tokens: 180`** | techo a lo que Whisper puede escribir de una frase | **aplicado**, pero **todavía sin validar** (ver abajo) |
| **Aviso de truncamiento** | avisa si ese techo corta una frase a medias | activo; en la tanda 4 **pasó por vacío** |

### Por qué el tope se aplicó hoy y no antes

Porque un techo mal puesto **corta habla real sin que nadie se entere**, y
eso es exactamente lo que este proyecto no puede hacer. Así que primero se
midió:

- Se ajustó con tus datos lo que cuesta Whisper: **3.243 ms fijos + 9,92 ms
  por carácter**.
- Se hizo una herramienta (`probarTope`) que, sobre tus grabaciones ya
  hechas, dice **una por una** qué frases habría cortado ese techo y si el
  detector las consideraba habla normal.
- Se corrió en **tres tandas** (1, 58 y 75 frases, la última con otro vídeo
  a propósito). Las únicas frases tocadas fueron alucinaciones **que tú
  confirmaste leyéndolas**. Margen sobre el habla real más larga: **x3,3**.

Antes de aplicarlo fijamos el listón —margen mínimo x2— para no poder
ablandarlo después con el resultado ya delante.

## 6. Lo que se descubrió por el camino, y conviene no olvidar

- **Cuatro de cinco «cortes» de una tanda eran un error mío de contabilidad**:
  al detector le llegaba el reloj de Whisper donde esperaba la duración del
  audio. Corregido, y escrito en `CONTABILIDAD-CORTES.md`.
- **La medición de «se degrada con el tiempo» usaba el control equivocado**:
  comparaba duración de audio cuando lo que mueve el reloj es el texto.
  Corregido en `DEGRADACION.md`.
- **No todo es la alucinación.** La frase #11 de ayer: **35 caracteres,
  20.392 ms**, justo detrás de una alucinación grande. El texto no explica
  eso. Hay un **segundo mecanismo** —llamadas vecinas que se estorban— que
  el tope no toca. Investigación abierta en `CONTENCION-WHISPER.md`.

## 6 bis. La tanda 4 no validó el tope, y hay que decirlo así

Se corrió la primera tanda con el tope puesto. **Resultado: no concluyente.**
El material era habla casi continua —14 de 16 frases cerraron por agotar los
12 s, no por silencio—, así que **no hubo ni una alucinación, ni una llamada
de Whisper por encima de 12 s, ni una intervención del detector**. Un arreglo
no se valida en una sesión donde el problema no aparece.

`truncadas()` dio 0 de 16, pero **eso no es un aprobado**: la frase más larga
tenía 251 caracteres y el tope está en ~720. Nadie pasó por delante del
guardia.

Y una predicción mía falló, escrita de antemano y anotada como fallida: dije
que el R² subiría del 0,333 y **bajó a 0**. En esta sesión el tamaño del
texto no explica nada del tiempo de Whisper. Por qué, es pregunta abierta.

Detalle en `TANDA-4.md`; la revisión del modelo de coste, en
`COSTE-WHISPER-REVISION.md`.

## 7. Qué toca ahora

**La tanda 5: conseguir por fin una sesión donde el problema aparezca.** Con
silencios, música o ruido entre tramos de habla, que es lo que hace alucinar
a Whisper. El protocolo está **preregistrado** en `TANDA-5.md` —escrito
antes de grabar, incluido qué resultado sería otra vez «no concluyente»—
para que después no se pueda confundir con un aprobado.

Lo que hay que mirar, por orden de importancia:

1. **`truncadas()`** — ¿el techo cortó alguna frase a medias? Si alguna no
   era alucinación, **se revierte**. Parada dura.
2. **`cortes()`** — leídos a mano, no fiarse del informe automático.
3. **`solape()`** — la medida sin modelo de la segunda causa.
4. **`contencion()`** — sólo si el ajuste de la sesión informa; si no, la
   propia herramienta se niega a opinar.

**La expectativa está fijada por escrito de antemano:** deben desaparecer los
eventos lentos **con texto masivo detrás**; **no** tienen por qué desaparecer
todos los de 16 s o más. Si quedan algunos del segundo tipo, el arreglo
funciona igual.

## 8. Después, por orden, y nada por iniciativa propia

1. Tanda aislada del **tope de voz larga** (un solo cambio por medición).
2. `simularRecorte()` y `ALCANCE-DOBLAJE.md`, **congelados** hasta entonces.
3. Bajar el desfase de 15-18 s. Pendiente, no olvidado.
4. El overlay.
