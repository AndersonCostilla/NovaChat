# Tanda de confirmación del tope de alucinaciones

**8 de octubre de 2026, noche.** El corte está **ENCENDIDO por defecto**.

**Esta tanda la tienes que correr tú.** En el sandbox donde trabajo no hay
Chrome, ni captura de pestaña, ni tarjeta de sonido: todo lo que yo puedo
decir del corte es que las reglas hacen lo que dicen sobre 21 comprobaciones
sintéticas. **Si eran alucinaciones de verdad sólo se sabe leyéndolas.**

---

## 1. Antes de empezar

```powershell
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

Recarga la extensión en `chrome://extensions` y abre la consola del documento
offscreen.

**Elige un vídeo con tramos de música o silencio largo**, que es donde
Whisper alucina. Una intro musical de 20-30 s al principio es el caso ideal.

Comprueba el estado antes de arrancar:

```js
livedub.toparAlucinaciones()   // debe decir activo: true
livedub.latenciaReiniciar()
```

**Opcional, y te recomiendo hacerlo en una segunda tanda, no en ésta:**

```js
livedub.toparVozLarga(true)
```

Es el otro mecanismo (el que corta una frase que ya está sonando). Lo dejo
apagado a propósito para que esta tanda mida **una sola cosa**. Si enciendes
los dos a la vez y el resultado mejora, no sabrás cuál de los dos lo hizo.

---

## 2. Graba 5 minutos y luego pide los cuatro informes

```js
livedub.cortes()          // ← EL IMPORTANTE DE HOY
livedub.perdidas()
livedub.deriva()
livedub.latenciaTexto()
```

---

## 3. Qué mirar en `livedub.cortes()`

Sale una tabla con una fila por corte:

| columna | qué te dice |
|---|---|
| `#` | la frase |
| `audio (s)` | lo que duraba el original |
| `motivos` | por qué saltó |
| `voz estimada antes (s)` / `después (s)` | cuánto habla se ha evitado |
| `oraciones` | `111 → 3` |
| **`¿pudo perder algo real?`** | **la columna que hay que mirar** |

Esa última columna distingue los dos tipos de corte, y **no son iguales de
graves**:

- **`no (sólo repeticiones)`** — se quitaron copias idénticas de algo que
  sigue estando. Por construcción no se ha perdido nada.
- **`SÍ — revisar`** — se cortó por el tope de cantidad o de duración. **Aquí
  sí se puede haber tirado algo real.** Son éstas las que hay que leer.

Para leer los textos enteros:

```js
const c = livedub.cortes();
c.filter(x => x['¿pudo perder algo real?'].startsWith('SÍ'))
 .forEach(x => console.log('#'+x['#'] + '\nANTES: ' + x.ANTES + '\nDESPUÉS: ' + x.DESPUES + '\n'));
```

**Revisa 3-5 a mano**, como pediste. La pregunta para cada una es sencilla:
*lo que desapareció entre ANTES y DESPUÉS, ¿lo dijo alguien en el vídeo?*

---

## 4. Qué hago con cada resultado — escrito ANTES de ver los números

Esta tabla va aquí para no poder interpretarla a conveniencia después.

| Lo que salga | Qué significa | Qué hago |
|---|---|---|
| **0 cortes** y 0 eventos catastróficos | el vídeo no alucinó; la tanda no prueba nada sobre el corte | repetirla con un vídeo con más música, **no** declarar victoria |
| Cortes, **todos** `no (sólo repeticiones)`, pérdida baja | el caso bueno: se evitó el daño sin tirar nada | se queda encendido; **se descongela `simularRecorte()`** |
| Cortes con `SÍ — revisar` y al leerlos **eran alucinación** | funciona, y además el tope de duración hacía falta | se queda encendido; lo anoto en este documento con los ejemplos |
| Cortes con `SÍ — revisar` y al leerlos **había habla real** | **falso positivo: lo peor que puede pasar** | **lo apago yo mismo** y subo `PROPORCION_CORTE`; no se queda encendido «a ver si cuela» |
| Sigue habiendo eventos catastróficos | el corte no era suficiente | toca el tope de voz larga, y hay que hablarlo |

**El cuarto caso es el que importa.** Un falso positivo es contenido que
desaparece sin que te enteres, que es exactamente lo que llevamos dos días
intentando eliminar. Si aparece uno solo, el tope se apaga.

---

## 5. Y la cifra que de verdad responde

```js
livedub.perdidas()
```

La referencia a batir es **47,1 % de la sesión del fallo** (16 de 34). La
pérdida estructural de fondo, sin eventos, era **7,1 %**.

- Si baja a **cerca del 7 %**: el problema eran los eventos catastróficos y
  están atajados.
- Si se queda **muy por encima**: queda algo más, y lo siguiente que miraría
  es `livedub.deriva()`.

Ojo con una trampa: **las frases cortadas cuentan como pérdida** (a
propósito). Así que una tanda con muchos cortes puede enseñar un porcentaje
de pérdida alto **y aun así ser mucho mejor que antes**, porque lo perdido es
basura en vez de habla. Por eso hay que mirar `cortes()` antes que el
porcentaje, y no al revés.
