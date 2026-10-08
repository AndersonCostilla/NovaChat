# Cómo comparar el recorte de verdad

**8-oct-2026.** Escrito después de una tanda que dio **cero pérdidas** y que
**no demuestra nada**, por las razones que tú mismo diste: no había grupo
`off` con el que contrastar, y el recorte aplicado fue del **1,8 %**, muy por
debajo del 9,9 % que haría falta. Con una proporción mediana de **1,09** en
ese tramo, lo más probable es que el mérito sea del vídeo y no del recorte.

**El diagnóstico previo NO se toca.** Sigue escrito que el recorte, por sí
solo, es insuficiente: hace falta un 9,9 % y se consigue un 1,8-3,5 %. No se
confirma ni se desmiente hasta tener una comparación que lo sostenga.

---

## 1. La inconsistencia de las dos cifras: aclarada

Tenías razón en que parecían contradecirse. No se contradicen: **miden cosas
distintas y ninguna de las dos lo decía en su nombre.** Ya lo dicen:

| Etiqueta nueva | Qué es | Por qué existe |
|---|---|---|
| `recorte: MEDIANA por frase` | La frase del medio | No la mueve una frase rara |
| `recorte: MEDIA por frase` | Promedio de los porcentajes | Se deja ver la asimetría |
| `recorte AGREGADO (caracteres totales)` | Caracteres ahorrados ÷ caracteres totales | **Es la que hay que comparar con el 9,9 %** |
| `frases a las que NO les quitó nada` | Cuenta cruda | El dato que lo explica todo |

**La cifra que vale es la AGREGADA**, porque lo que ocupa tiempo es el total
de habla, no el porcentaje medio por frase.

### Y la diferencia entre ellas es el hallazgo

Que la **mediana sea 0,0 %** mientras la media no lo es significa una cosa muy
concreta: **a más de la mitad de las frases el recorte no les quita ni un
carácter.** Lo poco que ahorra sale de unas pocas frases con rodeos.

Eso explica por sí solo por qué no llega al 9,9 %, y **no se arregla
afinando**: el habla espontánea de un vídeo no está llena de «con el fin de»
y «debido al hecho de que». Esos giros son de prosa escrita.

---

## 2. Tres formas de comparar, de mejor a peor

### ✅ Vía 1 (RECOMENDADA): el contrafactual, sobre las mismas frases

```js
livedub.simularRecorte()
```

Coge las frases **reales ya medidas en esta sesión** y calcula cuánto habría
durado cada una **con** el texto recortado y **sin** él.

**Por qué es la más fiable: elimina el confundidor por completo.** No compara
dos tramos de vídeo distintos — compara las mismas frases consigo mismas. La
proporción particular de tu contenido deja de importar, porque está en las dos
columnas por igual.

Además no estima la duración con una constante global: usa el **ritmo real de
cada frase** (milisegundos que tardó en decirse ÷ sus caracteres).

Y te dice **cuánto recorte habría hecho falta** además de cuánto hay:

```
proporción ES/EN SIN recorte (mediana):  1.09
proporción ES/EN CON recorte (mediana):  1.07
recorte AGREGADO (caracteres totales):   1.8 %
recorte necesario para bajar de 1:       8.3 %
VEREDICTO: EL RECORTE NO BASTA: ...
```

**Limitación, y no la escondo:** supone que, dentro de una misma frase, el
tiempo de habla es proporcional a los caracteres. Es buena aproximación con un
motor a ritmo fijo, pero las pausas de puntuación no escalan igual. **Da la
magnitud correcta; no sustituye a oírlo.**

**Funciona con la tanda que ya tienes**, si no has reiniciado el contador.

---

### ✅ Vía 2 (CONFIRMACIÓN): el mismo vídeo dos veces, en la misma sesión

**La regla de «no toques el interruptor» ya no aplica**, y conviene que sepas
por qué: esa regla existía porque no se podía distinguir qué fila era de qué
estado. **Ahora cada frase lleva su columna `recorte`.** Cambió el instrumento,
así que cambia la regla.

1. `livedub.latenciaReiniciar()`
2. `livedub.recorte(false)` → el vídeo desde el **minuto 0**, 3-4 min
3. **Pausa el vídeo y vuélvelo al minuto 0** (sin recargar nada)
4. `livedub.recorte(true)` → **el mismo tramo otra vez**, 3-4 min
5. `livedub.comparar()`

Ahora sí habrá grupo `on` y grupo `off` en la misma sesión, con **el mismo
contenido exacto** en los dos.

**Ventaja sobre la vía 1:** las duraciones son **medidas de verdad**, no
estimadas. Es la confirmación con audio real.

**Limitaciones:** el VAD no corta siempre por el mismo sitio en dos pasadas, así
que las frases no serán idénticas una a una (sí el contenido global). Y son
8 minutos tuyos.

---

### ⚠ Vía 3 (LA MÁS DÉBIL): acumular sesiones históricas

Comparar la mediana de todas las tandas `off` contra todas las `on`, aunque
sean de vídeos distintos.

**No la recomiendo, y con una razón concreta:** el efecto que buscamos es de
unos pocos puntos porcentuales, y **la variación entre vídeos es mayor que
eso** — este mismo tramo dio 1,09 cuando los anteriores daban 1,11. Con tres o
cuatro tandas, el ruido se come la señal. Haría falta una decena de cada tipo
para que dijera algo, y aun así sería correlación, no comparación.

**Si quieres usarla, que sea para apoyar, nunca para concluir.** Y además hoy
no se puede: las tandas no se guardan entre recargas. Añadir esa persistencia
tendría sentido si eligieras esta vía; dímelo y la hago.

---

## 3. Qué te pido

**Hazlo en este orden.** Si la vía 1 ya es concluyente, te ahorras la vía 2.

```
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

**Primero, gratis:** si todavía tienes la sesión anterior abierta y no has
reiniciado, pégame directamente:

```js
livedub.simularRecorte()
```

**Si ya la perdiste:** vídeo de habla continua, 4-5 min con el recorte
encendido, y luego `livedub.simularRecorte()`.

**Y si el resultado sale ajustado** (proporción con recorte entre 0,97 y 1,03),
entonces sí merece la pena la vía 2, porque ahí la estimación por caracteres ya
no es bastante fina para decidir.

---

## 4. Lo que pasará con cada resultado, escrito de antemano

| `simularRecorte()` dice | Qué significa | Qué hago |
|---|---|---|
| CON recorte **≥ 1,00** | El diagnóstico se confirma | Te pongo delante la decisión: pérdida residual o búfer |
| CON recorte **0,97 – 0,99** | Baja de 1, pero sin margen | Pido la vía 2 antes de concluir nada |
| CON recorte **< 0,97** | **Me he equivocado** | Lo digo, corrijo el diagnóstico escrito y el búfer deja de hacer falta |
| SIN recorte **≤ 1,00** | Ese tramo no era el caso difícil | Hace falta otro vídeo, más denso |

Lo dejo escrito antes de ver el número para no poder acomodarlo después.
