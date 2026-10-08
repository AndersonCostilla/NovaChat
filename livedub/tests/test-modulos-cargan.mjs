// test-modulos-cargan.mjs
// Comprueba que CADA módulo del proyecto se puede importar de verdad.
//
// POR QUÉ EXISTE ESTA SUITE
// `node --check` dio VERDE sobre un cronometro.js que tenía una cadena de
// texto sin cerrar y que reventaba al importarlo. Analiza el archivo como
// script clásico, no como módulo ES, y hay errores que se le escapan.
//
// Importar de verdad es la única comprobación que no se deja engañar.
// Los módulos que tocan chrome.* o el DOM no se pueden importar aquí, así
// que se listan aparte con su motivo, para que la exclusión sea explícita
// y no un olvido.

import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const RAIZ = new URL('../', import.meta.url);

// Módulos que NO se pueden importar fuera de Chrome, con el motivo.
const EXCLUIDOS = {
  'background.js': 'service worker: usa chrome.* en el nivel superior',
  'offscreen.js': 'documento offscreen: usa chrome.* y el DOM',
  'vad-processor.js': 'AudioWorklet: usa registerProcessor()',
  'transcriptor-worker.js': 'worker: usa self.onmessage e importa transformers',
  'traductor-worker.js': 'worker: usa self.onmessage e importa transformers',
  'sintetizador-worker.js': 'worker: usa self.onmessage e importa transformers',
  'popup.js': 'usa el DOM y chrome.*'
};

let pasadas = 0;
let fallidas = 0;

async function listarJs(dir, base = '') {
  const salida = [];
  for (const entrada of await readdir(new URL(dir, RAIZ), { withFileTypes: true })) {
    const rel = path.posix.join(base, entrada.name);
    if (entrada.isDirectory()) {
      if (['libs', 'models', 'tests', 'docs', 'icons'].includes(entrada.name)) continue;
      salida.push(...(await listarJs(rel + '/', rel)));
    } else if (entrada.name.endsWith('.js')) {
      salida.push(rel);
    }
  }
  return salida;
}

const archivos = (await listarJs('./')).sort();
console.log(`Módulos encontrados: ${archivos.length}\n`);

for (const rel of archivos) {
  const nombre = path.posix.basename(rel);
  if (EXCLUIDOS[nombre]) {
    console.log(`  — ${rel} (no se importa: ${EXCLUIDOS[nombre]})`);
    continue;
  }
  try {
    await import(pathToFileURL(new URL(rel, RAIZ).pathname).href);
    console.log(`  ✔ ${rel}`);
    pasadas++;
  } catch (error) {
    console.log(`  ✘ ${rel} — ${error.message}`);
    fallidas++;
  }
}

console.log(`\n==========================================================`);
console.log(`Resultado: ${pasadas} módulos cargan, ${fallidas} rotos`);
console.log(`==========================================================`);
process.exit(fallidas === 0 ? 0 : 1);
