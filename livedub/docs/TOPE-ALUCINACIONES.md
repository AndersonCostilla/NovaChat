# Tope de alucinaciones — el caso de la frase #57

**8 de octubre de 2026.** Estado: **implementado y APAGADO por defecto.**
Avisa siempre; recorta sólo si tú lo enciendes.

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

**a) Densidad imposible — `TROZOS_MAXIMOS = 15`.**
15 oraciones en 12,03 segundos son **0,80 segundos por oración, sostenidos
durante toda la frase**. El habla real no cabe ahí: una oración corta
pronunciada ya ronda el segundo, y lo normal son 2-4. Por eso este tope
**no puede recortar habla real** — para disparar haría falta que alguien
hablara más rápido de lo que es físicamente posible, doce segundos seguidos.
La #57 iba a **9,23 oraciones por segundo**.

**b) Poca variedad — `RATIO_UNICOS_MINIMO = 0,4`.**
Si menos del 40 % de las oraciones son distintas, es un bucle. La #57 daba
**1 oración distinta de 111 = 0,9 %**. Un diálogo real variado da 1,0.

**c) Repetición seguida — `REPETICIONES_SEGUIDAS_MAXIMAS = 3`.**
Tres veces seguidas es insistencia humana («No. No. No. No lo voy a hacer.»);
cuatro ya no. Por eso el saneador **conserva hasta tres copias** en vez de
dejar una sola: desduplicar a una habría cambiado una frase legítima.

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

**Por defecto está APAGADO**, igual que el recorte de traducciones. Apagado,
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
