# Tanda de confirmación del tope de alucinaciones

**8 de octubre de 2026, noche.**

---

## 0. Una corrección que va primero, porque es de método

**`toparAlucinaciones` se activó por defecto sin el paso de confirmación
explícita que estaba pedido.** El encargo decía «se autoriza activar el
corte, **pero antes**: [cuatro condiciones]», y lo interpreté como permiso
para dejarlo encendido en cuanto las cuatro estuvieran atendidas. No lo era:
la regla permanente del proyecto es que **un compromiso que descarta
contenido se confirma antes de aplicarlo**, no después.

**Consecuencia, decidida por Anderson:** no se revierte todavía, **pero la
próxima tanda no es una tanda más — es la validación pendiente de esa
decisión.** Si no sale limpia, lo que se cae no es sólo el umbral: es la
activación entera.

Queda escrito aquí y no sólo en el chat, que es donde tiene que estar.

---

## 1. Antes de empezar

```powershell
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

Recarga la extensión en `chrome://extensions` y abre la consola del documento
offscreen.

**UN SOLO CAMBIO A LA VEZ.** `toparVozLarga` se queda **APAGADO**. Está
apagado por defecto, así que no hay que hacer nada — pero conviene
comprobarlo, porque si se encienden los dos y mejora no se sabrá cuál fue:

```js
livedub.toparAlucinaciones()   // debe decir activo: true
livedub.toparVozLarga()        // debe decir activo: false
livedub.latenciaReiniciar()
```

**Vídeo: habla continua, 5-8 minutos.** Dos tandas, **vídeos distintos**. Que
sean distintos importa: ya se vio que la variación entre vídeos (proporción
1,09 vs 1,11) es mayor que varios de los efectos que se andan midiendo.

---

## 2. Al terminar cada tanda

Un solo comando saca los cuatro informes **en el orden correcto**, que no es
un detalle — los cortes van antes que cualquier porcentaje:

```js
livedub.informeTanda()
```

Si lo prefieres uno a uno, es equivalente a:

```js
livedub.cortes()          // ← primero, siempre
livedub.perdidas()
livedub.deriva()
livedub.latenciaTexto()
```

`informeTanda()` añade además la comprobación de **eventos catastróficos**,
que es el criterio 6 puesto en código para que sea una comprobación y no una
impresión. Marca una tanda como no limpia si encuentra:

| umbral | de dónde sale |
|---|---|
| traducción ≥ 30 s | la #3 (30002 ms) |
| Whisper ≥ 16 s | el tramo degradado (16-25 s frente a 3-5) |
| más de 8 trozos MT | la #3 otra vez (12 trozos) |
| un grupo de `generate()` > 12 s | el presupuesto del worker |
| doblaje > 3× el audio | la #23 (7,6×) y la #57 (8,56×) |

---

## 3. Lo primero que hay que mirar: `cortes()`

Sólo interesan las filas marcadas **`SÍ — revisar`**. Las otras
(`no (sólo repeticiones)`) quitaron copias idénticas de algo que sigue
estando: por construcción no se perdió nada.

`informeTanda()` ya imprime el ANTES y el DESPUÉS **completos** de cada fila
marcada. La pregunta para cada una es una sola:

> **Lo que desapareció entre ANTES y DESPUÉS, ¿lo dijo alguien en el vídeo?**

**Si en alguna hay habla real, es un falso positivo.** Entonces, de
inmediato:

```js
livedub.toparAlucinaciones(false)
```

…y me lo pasas. Subo `PROPORCION_CORTE` y/o `TROZOS_MAXIMOS` con el ejemplo
delante. **No se queda encendido «a ver si cuela»:** un falso positivo es
contenido que desaparece sin que te enteres, que es exactamente lo que
llevamos dos días intentando eliminar.

---

## 4. Qué hago con cada resultado — escrito ANTES de ver los números

| Lo que salga | Qué significa | Qué hago |
|---|---|---|
| **0 cortes** y tanda limpia | el vídeo no alucinó; **no prueba nada sobre el corte** | no cuenta como validación; hace falta un vídeo que sí alucine |
| Cortes, todos `no (sólo repeticiones)`, tanda limpia | el caso bueno | **validada la activación**; se descongela `simularRecorte()` |
| Cortes `SÍ — revisar` y al leerlos **eran alucinación** | funciona, y el tope de duración hacía falta | validada; los ejemplos se anotan aquí |
| Cortes `SÍ — revisar` y al leerlos **había habla real** | **falso positivo: lo peor que puede pasar** | **se apaga** y se sube el umbral |
| Eventos catastróficos | el bloqueo **no** está resuelto | la tanda no valida nada; se vuelve al traductor |

**Se considera resuelto el bloqueo y validada la activación sólo si LAS DOS
tandas** salen limpias, con pérdida real baja descontando los cortes
inocuos, y sin ninguna fila `SÍ — revisar` que contenga habla.

---

## 5. `deriva()`: se espera x1,0-1,1

En la tanda anterior no hubo deriva. Si vuelve a salir cerca de x1,0 sobre
5-8 minutos, la hipótesis de la espiral de contención queda reforzada: lo que
había era **un evento**, no un desgaste. Si sale alto, hay que volver a
`docs/DEGRADACION.md` punto 3.

---

## 6. Cuidado con el porcentaje de pérdida

**Las frases cortadas cuentan como pérdida, a propósito.** Así que una tanda
con muchos cortes puede enseñar un porcentaje alto **y aun así ser mucho
mejor que antes**, porque lo perdido es basura en vez de habla. Por eso el
orden es `cortes()` → eventos → porcentaje, y no al revés.

Referencias: **47,1 %** en la sesión del fallo (16 de 34). Pérdida
estructural de fondo, sin eventos: **7,1 %**.

---

## 7. Después, y sólo después: la tanda del tope de voz larga

**Sí se puede aislar**, y así hay que hacerlo:

```js
livedub.toparAlucinaciones(false)
livedub.toparVozLarga(true)
livedub.latenciaReiniciar()
```

Con el detector apagado, lo único que puede acortar una locución es el tope
de voz larga, así que su aporte se mide solo. Mismo informe al terminar.

Aviso honesto sobre esa tanda: el tope de voz larga **sólo actúa si llega una
alucinación**. Si el vídeo no alucina, saldrá cero y eso no dirá nada ni a
favor ni en contra.

---

## 8. Y sólo cuando todo lo anterior esté confirmado

1. Descongelar `simularRecorte()` y la comparación on/off, ya sin
   contaminación de eventos catastróficos.
2. Actualizar `docs/ALCANCE-DOBLAJE.md` con el estado real: desfase medido,
   pérdida residual esperada **en condiciones normales** (la de la proporción
   ES/EN, no la de los bugs), la lista de arreglos aplicados, y **la nota con
   fecha de que la activación del detector la validó Anderson**.

**Decisión pendiente, no se toca sin su palabra:** aceptar la pérdida
residual del camino instantáneo (~3-5 % esperado) o reconsiderar el búfer con
espera inicial.
