# Tanda 4 — primera tanda con el tope activo

**9 de octubre de 2026.** Tope `max_new_tokens: 180` activo (commit
`1ca77ae`). Ejecutada por Anderson en su equipo.

## Veredicto

> **NO CONCLUYENTE para el tope. Sin eventos catastróficos.**
>
> No lo valida y no lo refuta. **No cuenta como pase.**

La sesión no contenía el fenómeno que el tope ataca. No hubo ni una
alucinación, ni una llamada de Whisper por encima de 12 s, ni una sola
intervención del detector. **Un arreglo no se puede validar en una sesión
donde el problema no aparece.**

## La muestra

| | |
|---|---|
| grabaciones | 2; **la primera se descarta** (2 frases, muestra insuficiente) |
| frases analizadas | **16** (ids 12-27; entraron 18, 2 en curso al cerrar) |
| cierres por **tope de 12 s** | **14 de 16** |
| cierres por silencio | 2 (#13 a 1,28 s y #14 a 3,33 s) |

Catorce de dieciséis frases cerraron porque se acabó el tiempo, no porque
alguien dejara de hablar: **audio prácticamente continuo**, sin los
silencios y la música que produjeron las alucinaciones de la tanda 3. Esa es
la razón de que no haya nada que medir aquí, y es un dato sobre **el
material**, no sobre el tope.

## Lo que salió por cada herramienta

| comando | resultado | lectura |
|---|---|---|
| `cortes()` | el detector no intervino | no había nada que cortar |
| `truncadas()` | **0 de 16** | **pasa por vacío** — ver abajo |
| `probarTope(180)` | 0 cortes; más larga NO sospechosa **#19, 251 car ≈ 63 tokens, margen x2,9** | coherente con las tandas 1-3 |
| Whisper máximo | **5.525 ms** | muy lejos de los 16-20 s de antes |
| `deriva()` | x0,83 al final | ruido, no degradación |
| `costeWhisper()` | **fijo 4.349 ms · 0,15 ms/car · R² = 0** | ver abajo |
| `contencion()` | 0 frases pegadas a vecina pesada → `NO SE PUEDE DECIR` | el umbral no ve este caso |
| pérdidas | **1** (#25, cola de voz, 5,6 %) | «no da abasto»: doblaje 13,86 s contra un hueco de 12,03 s. Es el desfase, ya en la lista. **No se toca ahora.** |

### `truncadas()` pasó por vacío

**0 de 16 no significa «el tope no corta habla real».** Significa que
**ninguna frase se acercó siquiera al borde**: la más larga tenía 251
caracteres y el tope está en ~720. La prueba no llegó a ejecutarse de
verdad; el guardia estaba de servicio pero no pasó nadie por delante.

Para que `truncadas()` diga algo hace falta una sesión con transcripciones
largas. Eso es, precisamente, una sesión con alucinaciones.

### La expectativa del R²: **NO CUMPLIDA**

En `TANDA-3.md` quedó escrito, antes de medir:

> *«`costeWhisper()` → **el R² debería subir** respecto al 0,333 de la tanda
> 3, porque desaparece el punto extremo de los 1.889 caracteres.»*

| | tanda 3 | tanda 4 |
|---|---|---|
| coste fijo | 3.243 ms | **4.349 ms** |
| por carácter | 9,92 ms | **0,15 ms** |
| R² | 0,333 | **0** |

**Bajó a cero.** La predicción era mía y falló; se queda escrita como falló,
sin reinterpretarla para que parezca que acerté.

Lo único que se puede afirmar con esto es lo que dice la propia herramienta:
**en esta sesión el tamaño del texto no explica nada del tiempo de Whisper.**
Qué significa eso —si los 9,92 ms/carácter de antes eran sólo el tirón de
los puntos de alucinación, o si aquí falta rango— es una pregunta abierta,
no una conclusión. Está en `COSTE-WHISPER-REVISION.md`.

## Consecuencias

1. **El tope sigue puesto y sigue sin validar.** Hacen falta datos del
   escenario que ataca. Protocolo preregistrado en `TANDA-5.md`.
2. **`contencion()` estaba informando con un ajuste inservible.** Con R² = 0
   la columna «esperado por su texto» es poco más que la media de la sesión,
   así que «de más» no significa lo que su nombre promete. Corregido: ahora
   la herramienta se niega a presentarlo como dato cuando el ajuste no
   informa.
3. **Pista con n = 2, que no es evidencia:** las dos frases más lentas para
   su tamaño (#14, +1.168 ms; #13, +1.089 ms) son **las dos únicas que
   llegaron solapadas con su vecina anterior**. El umbral «pesada ≥ 12 s» se
   diseñó para el caso catastrófico y no ve nada de esto. Seguimiento en
   `CONTENCION-WHISPER.md`.
