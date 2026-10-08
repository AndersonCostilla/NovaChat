// test-rendimiento-voz.mjs
// Prueba del banco de medición de la voz (Fase 5.1).
//
// Lo valioso de esta prueba: se alimenta con las MEDICIONES REALES que Anderson
// sacó de su i5-12400 el 7 de octubre de 2026. No son números inventados para
// que la prueba pase: son los que provocaron este cambio. Si el banco no
// declara "insuficiente" ante esos datos, el banco no sirve.
//
// Ejecutar:  node livedub/tests/test-rendimiento-voz.mjs

import { crearBancoVoz, VEREDICTO } from '../rendimiento-voz.js';
import { VOZ, archivoOnnxVoz } from '../messages.js';

let pasadas = 0;
let fallidas = 0;

function comprobar(descripcion, condicion, detalle = '') {
  if (condicion) {
    pasadas++;
    console.log(`  ✔ ${descripcion}`);
  } else {
    fallidas++;
    console.error(`  ✘ ${descripcion}${detalle ? ` — ${detalle}` : ''}`);
  }
}

function bloque(titulo) {
  console.log(`\n── ${titulo} ──`);
}

/* ------------------------------------------------------------------ */
/* Datos reales medidos en Chrome, i5-12400, motor cuantizado int8     */
/* ------------------------------------------------------------------ */
// { frase, segundos de audio generados, ms que costó generarlos }
const MEDIDAS_REALES = [
  [1, 3.34, 6684],
  [2, 4.99, 9916],
  [3, 14.79, 29656],
  [4, 15.62, 30572],
  [7, 20.15, 58415],
  [8, 7.9, 28754],
  [9, 11.3, 41427],
  [10, 16.42, 58372]
];

/* ------------------------------------------------------------------ */

bloque('La métrica ms/segundo es estable, el "x tiempo real" no');
{
  const banco = crearBancoVoz();
  // Frases 3 y 8: una el doble de larga que la otra. El "x tiempo real" las
  // pinta muy distintas (0.50 vs 0.27) aunque el equipo hiciera lo mismo.
  const larga = banco.registrar({ id: 3, caracteres: 200, msSintesis: 29656, segundosAudio: 14.79 });
  const corta = banco.registrar({ id: 8, caracteres: 110, msSintesis: 28754, segundosAudio: 7.9 });

  comprobar('frase larga: ~2005 ms por segundo de audio', larga.msPorSegundo === 2005, `fue ${larga.msPorSegundo}`);
  comprobar('frase corta: ~3640 ms por segundo de audio', corta.msPorSegundo === 3640, `fue ${corta.msPorSegundo}`);
  comprobar(
    'el rtf de la frase corta es peor pese a ser más corta (por eso engaña)',
    corta.rtf < larga.rtf,
    `corta ${corta.rtf.toFixed(2)} vs larga ${larga.rtf.toFixed(2)}`
  );
}

bloque('Con los datos reales del i5-12400 el veredicto es INSUFICIENTE');
{
  const veredictos = [];
  const banco = crearBancoVoz({ onVeredicto: (info) => veredictos.push(info.veredicto) });

  for (const [id, segundosAudio, msSintesis] of MEDIDAS_REALES) {
    banco.registrar({ id, caracteres: Math.round(segundosAudio * 14), msSintesis, segundosAudio });
  }

  const r = banco.resumen();
  comprobar('veredicto = insuficiente', r.veredicto === VEREDICTO.INSUFICIENTE, `fue ${r.veredicto}`);
  comprobar('se registraron las 8 muestras', r.muestras === 8, `fueron ${r.muestras}`);
  comprobar(
    'la mediana está entre 2000 y 3700 ms por segundo',
    r.msPorSegundoAudio > 2000 && r.msPorSegundoAudio < 3700,
    `fue ${r.msPorSegundoAudio}`
  );
  comprobar('el veredicto se emite una sola vez, no por frase', veredictos.length === 1, `fueron ${veredictos.length}`);
  comprobar(
    'la explicación no dice que esté roto',
    /no da abasto/.test(banco.explicacion()) && /subtítulos siguen funcionando/.test(banco.explicacion()),
    banco.explicacion()
  );
}

bloque('Un equipo rápido sale APTO (y no se apaga nada)');
{
  const banco = crearBancoVoz();
  // 400 ms de cálculo por segundo de voz: 2,5x tiempo real.
  for (let i = 1; i <= 4; i++) {
    banco.registrar({ id: i, caracteres: 140, msSintesis: 4000, segundosAudio: 10 });
  }
  const r = banco.resumen();
  comprobar('veredicto = apto', r.veredicto === VEREDICTO.APTO, `fue ${r.veredicto}`);
  comprobar('2.5 veces tiempo real', r.vecesTiempoReal === 2.5, `fue ${r.vecesTiempoReal}`);
  comprobar('la explicación dice que va sobrado', /sobrado/.test(banco.explicacion()));
}

bloque('La zona intermedia se llama JUSTO, no se oculta');
{
  const banco = crearBancoVoz();
  // 920 ms/s: por debajo de tiempo real (1000) pero por encima del margen (850).
  for (let i = 1; i <= 3; i++) {
    banco.registrar({ id: i, caracteres: 140, msSintesis: 9200, segundosAudio: 10 });
  }
  comprobar('veredicto = justo', banco.obtenerVeredicto() === VEREDICTO.JUSTO, banco.obtenerVeredicto());
  comprobar('avisa de que puede haber frases sin doblar', /frases sueltas sin doblar/.test(banco.explicacion()));
}

bloque('No se opina sin muestras suficientes');
{
  const banco = crearBancoVoz();
  banco.registrar({ id: 1, caracteres: 100, msSintesis: 30000, segundosAudio: 5 });
  comprobar(
    `con 1 muestra (de ${VOZ.MUESTRAS_PARA_VEREDICTO} necesarias) sigue midiendo`,
    banco.obtenerVeredicto() === VEREDICTO.MIDIENDO,
    banco.obtenerVeredicto()
  );
  banco.registrar({ id: 2, caracteres: 100, msSintesis: 30000, segundosAudio: 5 });
  comprobar('con 2 muestras sigue midiendo', banco.obtenerVeredicto() === VEREDICTO.MIDIENDO);
  banco.registrar({ id: 3, caracteres: 100, msSintesis: 30000, segundosAudio: 5 });
  comprobar('con 3 ya se moja', banco.obtenerVeredicto() === VEREDICTO.INSUFICIENTE);
}

bloque('Decidir ANTES de sintetizar (el gasto que se evita)');
{
  const banco = crearBancoVoz();

  const primera = banco.evaluarAntesDeSintetizar({ caracteres: 200, segundosOrigen: 10 });
  comprobar('la primera frase SIEMPRE se intenta (hay que medir algo)', primera.adelante === true, primera.motivo);

  // Calibramos con el ritmo real del i5: ~200 ms por carácter.
  banco.registrar({ id: 1, caracteres: 150, msSintesis: 30000, segundosAudio: 15 });

  const larga = banco.evaluarAntesDeSintetizar({ caracteres: 300, segundosOrigen: 8 });
  comprobar('una frase larga se rechaza sin gastar CPU', larga.adelante === false, larga.motivo);
  comprobar('y dice cuánto habría costado', /s de síntesis/.test(larga.motivo), larga.motivo);
  comprobar('con una estimación en milisegundos', typeof larga.msEstimados === 'number' && larga.msEstimados > 0);

  comprobar(
    'el texto vacío se rechaza',
    banco.evaluarAntesDeSintetizar({ caracteres: 0 }).adelante === false
  );
}

bloque('Tras el veredicto insuficiente no se intenta ni una frase más');
{
  const banco = crearBancoVoz();
  for (const [id, segundosAudio, msSintesis] of MEDIDAS_REALES.slice(0, 4)) {
    banco.registrar({ id, caracteres: 100, msSintesis, segundosAudio });
  }
  const decision = banco.evaluarAntesDeSintetizar({ caracteres: 10, segundosOrigen: 10 });
  comprobar('ni siquiera una frase de 10 letras', decision.adelante === false, decision.motivo);
  comprobar('y el motivo cita la medición', /ms por segundo de voz/.test(decision.motivo), decision.motivo);
}

bloque('Expansión: el doblaje dura más que el original');
{
  const banco = crearBancoVoz();
  // 12 s de vídeo original -> 18 s de doblaje. Esto solo ya acumula retraso.
  const m = banco.registrar({ id: 1, caracteres: 250, msSintesis: 5000, segundosAudio: 18, segundosOrigen: 12 });
  comprobar('expansión = 1.5', Math.abs(m.expansion - 1.5) < 0.001, String(m.expansion));

  banco.registrar({ id: 2, caracteres: 250, msSintesis: 5000, segundosAudio: 12, segundosOrigen: 12 });
  comprobar('expansión media = 1.25', banco.resumen().expansionMedia === 1.25, String(banco.resumen().expansionMedia));
  comprobar(
    'la explicación menciona la expansión',
    /el doblaje dura 1\.25× lo que el original/.test(banco.explicacion()),
    banco.explicacion()
  );
}

bloque('Reiniciar borra el historial (para comparar motores sin recargar)');
{
  const banco = crearBancoVoz();
  for (const [id, segundosAudio, msSintesis] of MEDIDAS_REALES) {
    banco.registrar({ id, caracteres: 100, msSintesis, segundosAudio });
  }
  comprobar('antes de reiniciar: insuficiente', banco.obtenerVeredicto() === VEREDICTO.INSUFICIENTE);
  banco.reiniciar();
  comprobar('después: vuelve a medir', banco.obtenerVeredicto() === VEREDICTO.MIDIENDO);
  comprobar('sin muestras', banco.resumen().muestras === 0);
  comprobar('y vuelve a intentar frases', banco.evaluarAntesDeSintetizar({ caracteres: 200 }).adelante === true);
}

bloque('Robustez: datos basura no envenenan la media');
{
  const banco = crearBancoVoz();
  banco.registrar({ id: 1, caracteres: 100, msSintesis: 0, segundosAudio: 0 });
  banco.registrar({ id: 2, caracteres: 100, msSintesis: 5000, segundosAudio: 0 });
  banco.registrar({ id: 3, caracteres: 100, msSintesis: undefined, segundosAudio: 10 });
  comprobar('las frases sin audio no cuentan', banco.resumen().muestras === 0, String(banco.resumen().muestras));
  comprobar('y no revienta', banco.resumen().msPorSegundoAudio === null);
  comprobar('la explicación lo dice con palabras', /Todavía no se ha generado/.test(banco.explicacion()));
}

bloque('El interruptor de motor (VOZ.USAR_CUANTIZADO) resuelve bien el archivo');
{
  comprobar('true  → model_quantized.onnx', archivoOnnxVoz(true) === 'onnx/model_quantized.onnx', archivoOnnxVoz(true));
  comprobar('false → model.onnx', archivoOnnxVoz(false) === 'onnx/model.onnx', archivoOnnxVoz(false));
  // MEDIDO 7-oct-2026: int8 ~3.550 ms/s, float32 4.057 ms/s. La hipótesis de
  // que float32 sería más rápido en VITS se probó y resultó falsa.
  comprobar(
    'por defecto va el int8, que es el que midió más rápido',
    VOZ.USAR_CUANTIZADO === true && archivoOnnxVoz() === 'onnx/model_quantized.onnx'
  );
  comprobar(
    'la velocidad por defecto compensa la expansión del español',
    VOZ.VELOCIDAD > 1 && VOZ.VELOCIDAD <= VOZ.VELOCIDAD_MAX,
    String(VOZ.VELOCIDAD)
  );
  comprobar('la pausa entre oraciones bajó de los 120 ms originales', VOZ.PAUSA_ENTRE_ORACIONES_S < 0.12);
}

/* ------------------------------------------------------------------ */

console.log(`\n${'='.repeat(58)}`);
console.log(`Resultado: ${pasadas} pasadas, ${fallidas} fallidas`);
console.log('='.repeat(58));
process.exit(fallidas === 0 ? 0 : 1);
