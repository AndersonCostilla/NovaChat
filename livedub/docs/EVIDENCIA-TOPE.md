# Evidencia acumulada para `max_new_tokens: 180`

Registro de las muestras independientes que respaldan (o tumbarían) el tope.
**Se rellena con lo que sale en el equipo de Anderson, no con estimaciones.**

| tanda | vídeo | frases con texto | se habrían cortado | de ellas, habla real | veredicto |
|---|---|---|---|---|---|
| 1 (9-oct) | el de siempre | 1 útil | 1 (#22) | **0** | SÍ — muestra demasiado pequeña |
| 2 (9-oct) | el de siempre | **58** | 2 (#29, #33) | **0** | SÍ — y **confirmado a mano** |
| 3 (pendiente) | **otro distinto** | — | — | — | — |

## Lo que ya está confirmado por lectura manual

- Los **3 cortes del detector** de la tanda 2 —incluida la **#29**, recortada
  parcialmente— son **alucinaciones reales**. **Cero falsos positivos.**
- Las **2 frases** que el tope habría tocado son esas mismas alucinaciones.
- El veredicto del detector que quedaba pendiente del 8-oct **queda resuelto
  a favor del detector.**

Esto cierra la **regla del falso positivo**: no hay ninguno que reportar, el
detector se queda encendido y el umbral no se toca.

## Por qué hace falta una tercera, y con otro vídeo

Las dos muestras **vienen del mismo vídeo**. Si ese vídeo tiene un ritmo de
habla por debajo de la media, las dos tandas dicen lo mismo por la misma
razón equivocada. **Dos muestras del mismo material no son dos muestras
independientes.** Un vídeo distinto —más rápido, con más acento, con música
de fondo, con dos personas hablando a la vez— es lo que puede producir la
transcripción densa que tumbaría el tope.

Es exactamente la cautela que pide el propio informe:

> *«Una sola sesión no basta: si ninguna frase real se acerca al tope aquí,
> puede acercarse en otro vídeo. Mira el margen de la frase más larga NO
> sospechosa.»*

## El dato de la tanda 3 que más importa

No es el veredicto `SÍ/NO` —con dos tandas limpias ya se espera `SÍ`—, es
esta línea:

```
frase más larga NO sospechosa: #N: XXX caracteres ≈ YY tokens
                               (margen hasta el tope: xZ.Z)
```

**Si ese margen cae por debajo de x1,5 en el vídeo nuevo, el tope de 180 es
demasiado estrecho** aunque el veredicto diga `SÍ`, y hay que subirlo a 224.
Con margen x2 o más, 180 está holgado.

## Lo que pasa después de aplicarlo

El tope corta por tokens, no por oraciones: puede partir una frase **a mitad
de palabra sin que nadie se entere**. Por eso el cambio no va solo. Ya está
implementado y probado el aviso:

```js
livedub.truncadas()
```

Marca las frases que llegaron **al borde del tope y no terminan en signo de
cierre** — las dos condiciones a la vez. Es una **señal, no una prueba**: se
deduce del texto, no del contador de tokens del worker. Hoy no hace nada,
porque `TOPE_TOKENS_ASR` está en `null` en `offscreen.js`; al aplicar el tope
hay que poner ahí **el mismo número** que en el transcriptor.
