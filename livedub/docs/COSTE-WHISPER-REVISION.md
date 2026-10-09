# Revisión del modelo de coste de Whisper

**9 de octubre de 2026**, tras la tanda 4. Trata una sola pregunta:
**¿de dónde salían los 9,92 ms por carácter?**

---

## 1. El problema

| tanda | coste fijo | por carácter | R² |
|---|---|---|---|
| 2 | 3.243 ms | **9,92 ms** | 0,646 |
| 3 | 3.243 ms | **9,92 ms** | 0,333 |
| **4** | 4.349 ms | **0,15 ms** | **0** |

De 9,92 a 0,15. **La pendiente no es una propiedad estable de la máquina: en
la tanda 4 desaparece.** Y con ella, el R² a cero: en esa sesión el tamaño
del texto no explica **nada** del tiempo de Whisper.

## 2. La hipótesis a comprobar

> Los 9,92 ms/carácter venían de los puntos de alucinación —#10, con 1.889
> caracteres y 20.051 ms— que tiraban de la recta. Sin esos puntos, la
> pendiente se desploma.

Es coherente con lo que se ve: en la tanda 4 **no hubo ni una alucinación**,
el texto más largo tenía 251 caracteres, y la pendiente se fue a cero. Un
ajuste cuyo rango útil lo aporta un puñado de valores extremos **es un
ajuste que describe esos valores extremos**, no el comportamiento normal.

## 3. **No se puede comprobar. Los datos no existen.**

Esto es lo que hay que decir, y no hay vuelta de hoja:

- El historial del cronómetro vive en **`const historial = []`, en memoria
  del documento offscreen**. No se persiste en `chrome.storage`, no se
  escribe en disco, **no hay comando de exportación**.
- `reiniciar()` lo vacía, y recargar la extensión también.
- En el repositorio **no hay ningún fichero de datos por frase** de las
  tandas 1, 2 o 3. Lo único que sobrevive de aquellas sesiones son las
  cifras que Anderson copió al chat y que están citadas en los documentos:
  los agregados (fijo, pendiente, R²) y **dos frases sueltas**, la #10 y la
  #11.
- Con dos puntos no se reajusta nada. **Dos puntos siempre dan una recta**,
  y ya cometí ese error una vez esta semana.

**Por tanto: la hipótesis queda ABIERTA, sin comprobar.** No la doy por
buena aunque me lo parezca, y no reconstruyo los datos que faltan.

### Lo que sí se puede decir, y es poco

- La pendiente **no es reproducible entre sesiones**. Eso ya basta para no
  volver a usarla como si fuera una constante del sistema.
- Los dos valores altos conocidos (#10: 1.889 car / 20.051 ms) están
  **exactamente** en el extremo que se sospecha responsable.

## 4. Una corrección a la explicación alternativa

Anderson propuso antes que el coste fijo domina porque *«el audio de ~12 s
es casi todo el trabajo»*. **Él mismo la ha marcado como débil, y tiene
razón:** `transcriptor-worker.js` usa `chunk_length_s: 30`, así que Whisper
**rellena hasta 30 s pase lo que pase**. El encoder procesa la misma ventana
tanto si el audio dura 12 s como si dura 3. Que el audio dure más o menos no
debería mover el coste fijo — y por eso esa explicación no sirve para
justificar la diferencia de 3.243 a 4.349 ms entre tandas.

Qué mueve entonces el coste fijo entre sesiones, **no se sabe**.

## 5. Qué afirmaciones dependían de los 9,92 ms/carácter

Auditoría de los dos documentos que soportaron la decisión del tope.

### Dependen de la pendiente — **quedan en cuarentena**

| afirmación | dónde |
|---|---|
| tabla de topes: 80 tok → 6,4 s, 180 tok → **10,4 s**, 224 tok → 12,1 s | `PROPUESTA-MAX-TOKENS.md` §2 |
| «la #22 bajaría de 18,7 s a ~10,4 s, **se ahorran 8,3 s**» | `PROPUESTA-MAX-TOKENS.md` §2 |
| «cada 100 caracteres que no se generen son unos 992 ms» | salida de `costeWhisper()` |
| «#22 ≈ 1.555 caracteres ≈ 389 tokens» (deducido del tiempo) | `WHISPER-COSTE.md` |
| «la #10 encaja con el modelo: 3.243 + 1.889 × 9,92 ≈ 21.983 ms» | `CONTENCION-WHISPER.md` §1 |
| «la #11 predice ≈3.590 ms, **sobran 16.800 ms**» | `CONTENCION-WHISPER.md` §1 |
| la columna «esperado por su texto» de `contencion()` | código |

**Todas éstas son estimaciones de TIEMPO, y todas son ahora inciertas.** El
techo real del tope podría no ser 10,4 s.

### **No** dependen de la pendiente — **siguen en pie**

| afirmación | por qué aguanta |
|---|---|
| 180 tokens ≈ **720 caracteres** | aritmética de tokenización (~4 car/token), no del reloj |
| `probarTope(180)`: qué frases habría cortado | **cuenta caracteres**, no usa tiempos |
| margen **x3,3** sobre el habla real más larga | ídem |
| «las frases tocadas eran alucinaciones» | **lectura manual de Anderson** |
| el tope acota el peor caso | el techo duro de 448 posiciones es del modelo |

**Esto es lo importante: la decisión de aplicar el tope se apoyó en
recuentos de caracteres y en tu lectura a mano, no en la recta.** La recta
servía para estimar *cuánto tiempo* se ahorraría. Ese número está en duda;
**la seguridad del tope, no.**

Por eso esta revisión **no cambia el tope** y no justifica revertirlo.

## 6. Qué haría falta para cerrar esto

Una sesión con alucinaciones **y** con los datos por frase conservados. La
primera parte la busca `TANDA-5.md`. La segunda **no existe hoy**: si quieres
que las tandas se puedan reanalizar después —reajustar excluyendo puntos,
comparar sesiones— hace falta un comando que vuelque el historial a un
fichero, y eso es una decisión tuya, no la tomo yo.
