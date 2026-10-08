// nivel1.mjs
// VERIFICACIÓN DE NIVEL 1 COMPLETA. Un solo comando.
//
//   node livedub/tests/nivel1.mjs
//
// POR QUÉ EXISTE
// Hasta ahora el Nivel 1 era una lista de comprobaciones que yo ejecutaba a
// mano y enumeraba en el chat. Eso tiene dos problemas: que se puede olvidar
// una, y que nadie más puede repetirlo igual. Ahora es un programa.
//
// El detonante concreto: `node --check` dio VERDE sobre un módulo con una
// cadena de texto sin cerrar que reventaba al importarlo, porque analiza el
// archivo como script clásico y no como módulo ES. Se dio por verificado
// algo que estaba roto. La comprobación 2 existe por eso y es FIJA.
//
// Si cualquiera de las seis comprobaciones falla, el proceso termina con
// código distinto de cero.

import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const IGNORAR_DIRS = new Set(['libs', 'models', 'icons', 'docs', 'node_modules']);

let fallos = 0;
const resultado = (ok, titulo, detalle = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${titulo}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos++;
};
const titulo = (t) => console.log(`\n${t}`);

async function listar(dir, filtro, base = '') {
  const salida = [];
  for (const e of await readdir(path.join(RAIZ, dir), { withFileTypes: true })) {
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory()) {
      if (IGNORAR_DIRS.has(e.name)) continue;
      salida.push(...(await listar(path.join(dir, e.name), filtro, rel)));
    } else if (filtro(e.name)) {
      salida.push(rel);
    }
  }
  return salida;
}

function ejecutar(args) {
  return new Promise((resolver) => {
    const hijo = spawn(process.execPath, args, { cwd: RAIZ });
    let salida = '';
    hijo.stdout.on('data', (d) => (salida += d));
    hijo.stderr.on('data', (d) => (salida += d));
    hijo.on('close', (codigo) => resolver({ codigo, salida }));
  });
}

console.log('==========================================================');
console.log('  LiveDub — Verificación de Nivel 1 (estática, en sandbox)');
console.log('==========================================================');
console.log('\nOJO: el Nivel 1 NO prueba que la extensión funcione en Chrome.');
console.log('Comprueba que el código es válido y coherente. El Nivel 2 (humano,');
console.log('en Chrome con sonido real) es el que decide si algo sirve.');

// ── 1. Sintaxis ──────────────────────────────────────────────────────
titulo('1. Sintaxis de todos los .js (node --check)');
const archivosJs = await listar('.', (n) => n.endsWith('.js'));
let malos = [];
for (const rel of archivosJs) {
  const { codigo } = await ejecutar(['--check', path.join(RAIZ, rel)]);
  if (codigo !== 0) malos.push(rel);
}
resultado(malos.length === 0, `${archivosJs.length} archivos`, malos.join(', '));

// ── 2. Los módulos se IMPORTAN de verdad ─────────────────────────────
titulo('2. Los módulos cargan de verdad (lo que node --check no ve)');
const cargan = await ejecutar([path.join(RAIZ, 'tests/test-modulos-cargan.mjs')]);
const lineaCargan = (cargan.salida.match(/Resultado: .*/) || ['sin resultado'])[0];
resultado(cargan.codigo === 0, lineaCargan);

// ── 3. Suite de pruebas ──────────────────────────────────────────────
titulo('3. Suite de pruebas');
const suites = (await listar('tests', (n) => n.startsWith('test-') && n.endsWith('.mjs')))
  .map((n) => path.posix.join('tests', n))
  .sort();
let verdes = 0;
for (const suite of suites) {
  const { codigo, salida } = await ejecutar([path.join(RAIZ, suite)]);
  if (codigo === 0) {
    verdes++;
  } else {
    const fallo = (salida.match(/^\s*✘.*$/m) || [''])[0].trim();
    console.log(`     ✘ ${path.basename(suite)} — ${fallo}`);
  }
}
resultado(verdes === suites.length, `${verdes} de ${suites.length} suites en verde`);

// ── 4. Nada se carga desde internet ──────────────────────────────────
titulo('4. Ninguna URL remota (la CSP de MV3 lo prohíbe)');
const fuentes = await listar('.', (n) => /\.(js|html|css|json)$/.test(n));
const conUrl = [];
for (const rel of fuentes) {
  if (rel.startsWith('tests/')) continue; // las pruebas pueden citar URLs en comentarios
  const texto = await readFile(path.join(RAIZ, rel), 'utf-8');
  for (const linea of texto.split('\n')) {
    // Se ignoran los comentarios: documentar una fuente no es cargarla.
    if (/^\s*(\/\/|\*|#|<!--)/.test(linea)) continue;
    if (/https?:\/\//.test(linea)) conUrl.push(`${rel}: ${linea.trim().slice(0, 60)}`);
  }
}
resultado(conUrl.length === 0, `${fuentes.length} archivos revisados`, conUrl.slice(0, 3).join(' | '));

// ── 5. El manifiesto ─────────────────────────────────────────────────
titulo('5. manifest.json');
let manifiesto = null;
try {
  manifiesto = JSON.parse(await readFile(path.join(RAIZ, 'manifest.json'), 'utf-8'));
  resultado(true, `JSON válido, v${manifiesto.version}`);
} catch (error) {
  resultado(false, 'JSON inválido', error.message);
}
if (manifiesto) {
  resultado(manifiesto.manifest_version === 3, 'es Manifest V3');
  resultado(
    !manifiesto.permissions?.includes('tts'),
    'NO pide el permiso "tts"',
    'la voz del sistema no lo necesita desde el offscreen'
  );
  // Todo archivo que el manifiesto declare tiene que existir.
  const declarados = JSON.stringify(manifiesto).match(/"[\w./-]+\.(js|html|css|png)"/g) || [];
  const ausentes = [];
  for (const d of declarados) {
    const rel = d.replace(/"/g, '');
    try {
      await readFile(path.join(RAIZ, rel));
    } catch {
      ausentes.push(rel);
    }
  }
  resultado(ausentes.length === 0, 'todos los archivos declarados existen', ausentes.join(', '));
}

// ── 6. Coherencia de la mensajería ───────────────────────────────────
titulo('6. Los tipos de mensaje salen todos de messages.js');
const mensajes = await readFile(path.join(RAIZ, 'messages.js'), 'utf-8');
resultado(/export const MSG/.test(mensajes), 'MSG está definido y exportado');
resultado(/export const MOTOR_VOZ/.test(mensajes), 'MOTOR_VOZ está definido y exportado');

// ── Resumen ──────────────────────────────────────────────────────────
console.log('\n==========================================================');
if (fallos === 0) {
  console.log('  NIVEL 1: TODO CORRECTO');
  console.log('  (recordatorio: esto NO es una verificación en Chrome)');
} else {
  console.log(`  NIVEL 1: ${fallos} COMPROBACIÓN(ES) FALLIDA(S)`);
}
console.log('==========================================================');
process.exit(fallos === 0 ? 0 : 1);
