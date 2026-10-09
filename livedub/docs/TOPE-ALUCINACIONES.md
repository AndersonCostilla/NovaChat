# Tope de alucinaciones — el caso de la frase #57

**8 de octubre de 2026.** Estado: **ENCENDIDO por defecto desde la noche del
8-oct**, autorizado por Anderson con dos aciertos en casos reales (#57 y #23)
y ningún falso positivo. Se apaga con `livedub.toparAlucinaciones(false)`.
Procedimiento de la tanda de confirmación en `docs/TANDA-CONFIRMACION.md`.

---

## 1. Qué pasó

En tu tanda del 8 de octubre, la frase **#57**:

| | |
|---|---|
| Audio de origen | **12,03 s** (el tope del VAD, frase cortada) |
| Texto reconocido | «Es interesante.» repetido **111 veces** |
| Whisper | 20,7 s |
| Traducción | 13,5 s |
| **Voz** | **102,95 s** |
| Proporción voz ÷ audio | **8,56×** → ocupación **856 %** |

Mientras esos 102,95 segundos sonaban, la cola de voz estaba ocupada. Las
frases que llegaron detrás se descartaron una tras otra: **ids 58 a 68, al
menos 14 frases legítimas perdidas en cascada**.

Dos cosas que conviene no confundir:

- **La alucinación la produjo Whisper**, no nosotros. Es un fallo conocido de
  los modelos Whisper sobre audio con poco habla (música, ruido, silencio):
  se enganchan en un bucle y repiten la misma frase. No lo podemos arreglar
  desde fuera del modelo.
- **El daño no lo hizo la alucinación: lo hizo que la dejáramos hablar.**
  111 oraciones de basura no molestan a nadie si no se pronuncian. Lo que
  costó 14 frases fue ocupar el altavoz un minuto y 43 segundos.

Y un aviso sobre el lote-con-continuación que pusimos antes: **no protegió de
esto, sólo le cambió la forma.** Antes el síntoma era un worker parado ~50 s;
ahora es un altavoz ocupado 102,95 s. **Acotar el tiempo de traducción no
acota la cantidad de habla generada.** Hacía falta un límite sobre la salida.

---

## 2. Tres sitios donde se podía poner el límite

| | Dónde | Qué ahorra | Qué cuesta |
|---|---|---|---|
| **A** | **Sobre el texto inglés, antes de traducir** | los 13,5 s de traducción **y** los 102,95 s de voz | hay que decidir con el texto en inglés, antes de ver el resultado |
| B | Sobre el texto español, después de traducir | sólo los 102,95 s de voz | paga la traducción igual; la basura ya costó 13,5 s de worker |
| C | En la cola de voz: «ninguna frase puede hablar más de N segundos» | corta el daño siempre, venga de donde venga | **corta a mitad de palabra**; no distingue alucinación de frase larga legítima, así que sí puede comerse habla real |

**Elegida la A.** Es la única que ataca el problema donde nace y la única que
ahorra las dos facturas. La C sigue siendo una red de seguridad razonable si
algún día aparece un caso que la A no vea, pero como medida principal es mala:
no sabe lo que está cortando.

---

## 3. Qué mira exactamente (y por qué esos números)

En `detector-alucinacion.js`. Tres criterios, cada uno con su aritmética:

**a) Densidad imposible — `TROZOS_AVISO = 8`.**

> **Revisado el 8-oct-2026 por la tarde.** Estaba en 15 y **se le escapó la
> frase #3**: 12 trozos, 12 < 15, no avisó, y esa traducción se comió 30 s y
> arrastró ocho frases. 12 oraciones en 12,03 s es **una oración por segundo
> sostenida**: no es habla.

Ahora hay **dos umbrales distintos, y es a propósito**:

| | valor | qué provoca | si me equivoco |
|---|---|---|---|
| `TROZOS_AVISO` | **8** | una línea en la consola | una línea de más |
| `TROZOS_MAXIMOS` | **15** | se descarta texto (sólo con el tope activo) | **el usuario pierde algo y no se entera** |

No tiene ningún sentido que los dos usen el mismo número. Avisar es gratis y
reversible; cortar no lo es. **Por eso bajar la detección es seguro: el corte
no se ha movido.** Una frase como la #3 ahora avisa, y aun con el tope
encendido no se le quitaría ni un carácter (12 < 15, y sus 12 oraciones son
todas distintas).

- **8** son 1,5 s por oración sostenidos, y es **el doble del peor caso de
  habla real medido** (`segmentador.js` da 1-2 trozos por frase; 3-4 en una
  frase tope a ritmo rápido).
- **15** son 0,80 s por oración. Ahí el habla real ya no cabe de ninguna
  manera, que es exactamente lo que se le pide a un umbral que corta.

La #57 iba a **9,23 oraciones por segundo**; la #3, a **1,00**.

**b) Poca variedad — `RATIO_UNICOS_MINIMO = 0,4`.**
Si menos del 40 % de las oraciones son distintas, es un bucle. La #57 daba
**1 oración distinta de 111 = 0,9 %**. Un diálogo real variado da 1,0.

**c) Repetición seguida — `REPETICIONES_SEGUIDAS_MAXIMAS = 3`.**
Tres veces seguidas es insistencia humana («No. No. No. No lo voy a hacer.»);
cuatro ya no. Por eso el saneador **conserva hasta tres copias** en vez de
dejar una sola: desduplicar a una habría cambiado una frase legítima.

**d) Repetición NO seguida — `DOMINANCIA_MAXIMA = 0,5`** *(nuevo, 8-oct tarde)*.
Whisper también alucina **alternando**: «A. B. A. C. A. D. A. E.» tiene un
ratio de únicos de 0,63 (por encima del 0,4) y no repite dos veces seguidas
nunca, así que **los dos criterios anteriores la dejaban pasar entera** — y
sin embargo la mitad de la frase es la misma oración. Ahora se mira también
qué proporción ocupa la oración más frecuente, estén o no sus repeticiones
juntas.

Y una guarda: con **menos de 6 oraciones** no se evalúa nada. «Sí. Sí.» no
puede ser sospechoso de nada.

---

## 4. Qué hace cuando salta

Dos pasos, **informados por separado a propósito**, porque no son igual de
seguros:

1. **Quitar repeticiones seguidas de más de tres.** Esto **no pierde nada
   real**: lo que quita es, por construcción, texto idéntico al que queda.
   A la #57 la deja en 3 oraciones — de 102,95 s de voz a **~1 s**.
2. **Cortar a 15 oraciones.** Esto **sí puede cortar contenido**, aunque el
   cálculo del punto 3a dice que no debería. Por eso se informa aparte
   (`seCorto: true`) y lo descartado se anota como pérdida en `perdidas()`.

Que lo descartado cuente como pérdida es deliberado: si algún día resulta que
era habla de verdad, tiene que **salir en el recuento** y no desaparecer en
silencio.

---

## 5. Cómo usarlo

En la consola de `offscreen.html`:

```js
livedub.toparAlucinaciones()        // sólo informa: ¿está activo?
livedub.toparAlucinaciones(true)    // enciende el recorte
livedub.toparAlucinaciones(false)   // lo apaga
```

**Sigue APAGADO**, y en este encargo **no se ha tocado**: lo que ha cambiado
es sólo la detección. **Por defecto está APAGADO**, igual que el recorte de traducciones. Apagado,
el detector **sigue funcionando y sigue avisando** por consola:

```
[LiveDub] ⚠ frase #57 SOSPECHOSA DE ALUCINACIÓN: 111 oraciones en 12.03 s
(9.23 por segundo). El tope plausible son 15. sólo 1 oraciones distintas de
111 (1 %). la misma oración 111 veces seguidas. NO se recorta: el tope está
apagado. Actívalo con livedub.toparAlucinaciones(true).
```

Así puedes ver en tu equipo cuántas veces salta y sobre qué frases **antes**
de dejar que descarte nada. La tabla de `latenciaTexto()` también gana una
columna `¿alucinación?`.

---

## 6. Lo que esto NO arregla

- **No evita que Whisper alucine.** Evita que la alucinación ocupe el altavoz.
- **No recupera las frases 58-68** de aquella tanda; sólo impide la próxima
  cascada.
- **No está verificado en Chrome.** Lo que hay son 9 comprobaciones en
  `tests/test-detector-alucinacion.mjs`, con la #57 reproducida exactamente y
  cinco muestras de habla normal que el detector deja intactas. La prueba de
  verdad es tu equipo, sobre un vídeo con música o silencios largos.


---

## 7. Congelado hasta nuevo aviso

`simularRecorte()` y la comparación del recorte on/off siguen **congelados**,
y con razón: no tiene sentido medir un ahorro del 3 % en una sesión en la que
un fallo se lleva el 47 %. Se retoman cuando una tanda de 5 minutos cumpla
las dos condiciones que pusiste: **el contador cuadra** y **no hay eventos
catastróficos**.


---

## 8. Segunda revisión (8-oct, noche): la fila #23

**8 trozos** —por debajo de cualquier umbral de cantidad— y **92 s de voz
para 12,03 s de audio: 735 % de ocupación.** Arrastró once frases.

Esto obligó a reconocer un error de planteamiento en todo lo anterior:
**contar oraciones nunca iba a bastar, porque el número de oraciones no es el
daño.** El daño es **el tiempo que se ocupa el altavoz**. La #57 (111 trozos
cortos) y la #23 (8 trozos larguísimos) son la misma avería con dos formas, y
sólo se parecen si se mide lo que de verdad importa.

**Criterio nuevo, y ahora el principal: duración estimada del habla.**

```
segundos de voz = caracteres × 1,11 ÷ 17,2
                              ^^^^    ^^^^
              inflación ES/EN medida  car/s medidos (RENDIMIENTO-VOZ.md)
```

Ninguna de las dos constantes es inventada: las dos están medidas en este
proyecto. Y otra vez dos umbrales:

| | valor | qué pasa |
|---|---|---|
| `PROPORCION_AVISO` | **3×** la duración del audio | se avisa |
| `PROPORCION_CORTE` | **4×** | se quitan oraciones por el final hasta que cabe |

La proporción medida con habla real es **1,11×** (medianas de dos tandas:
1,09 y 1,11). Avisar a 3× deja casi el triple de margen; cortar a 4×, casi el
cuádruple. La #23 iba a **7,6×**; la #57, a **8,56×**.

**Criterio nuevo 2: repetición dentro de un mismo trozo.** Si Whisper
devuelve `"it is interesting it is interesting it is interesting…"` **sin
puntuación**, `segmentador.js` entrega **un solo trozo** y los tres criterios
de repetición entre oraciones no ven absolutamente nada: el ratio de únicos
es 1 y la repetición seguida es 1. Ahora se busca un bloque corto de palabras
repetido seguido dentro del trozo, y se conservan tres copias — misma regla y
misma lógica que entre oraciones.

**Lo que se puede perder, ordenado de menos a más grave:**

| paso del saneado | ¿puede perder algo real? |
|---|---|
| repeticiones seguidas entre oraciones | **no** — lo quitado es idéntico a lo que queda |
| repetición interna de un trozo | **no** — misma razón |
| tope de cantidad (15 oraciones) | **sí**, y se informa aparte |
| tope de duración (4× el audio) | **sí**, y se informa aparte |

Los dos últimos marcan la frase como `¿pudo perder algo real? SÍ — revisar`
en `livedub.cortes()`. Son ésas, y sólo ésas, las que hay que leer a mano.
