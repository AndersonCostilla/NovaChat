// vad-processor.js
// AudioWorkletProcessor que vive en el hilo de audio del contextProcessing (16 kHz).
// Responsabilidad ÚNICA: acumular el audio mono en bloques de 4096 muestras
// (256 ms a 16 kHz), calcular su RMS y mandárselo al hilo principal.
// La decisión de qué es voz y qué es silencio la toma offscreen.js, no este archivo.
//
// OJO: este archivo se carga con audioWorklet.addModule() y NO admite
// import/export; se registra directamente con registerProcessor().

const TAMANIO_BLOQUE = 4096; // muestras por bloque (256 ms a 16 kHz)

class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffer interno de acumulación y cuántas muestras lleva escritas.
    this.buffer = new Float32Array(TAMANIO_BLOQUE);
    this.escritas = 0;
  }

  // El navegador llama a process() cada 128 muestras (quantum de render).
  process(inputs) {
    const entrada = inputs[0];

    // Sin entrada conectada todavía: seguimos vivos esperando audio.
    if (!entrada || entrada.length === 0) return true;

    const canal = entrada[0]; // sólo el canal 0 (mono)
    if (!canal || canal.length === 0) return true;

    for (let i = 0; i < canal.length; i++) {
      this.buffer[this.escritas++] = canal[i];

      // Buffer lleno: calculamos RMS y lo enviamos al hilo principal.
      if (this.escritas === TAMANIO_BLOQUE) {
        let suma = 0;
        for (let j = 0; j < TAMANIO_BLOQUE; j++) {
          suma += this.buffer[j] * this.buffer[j];
        }
        const rms = Math.sqrt(suma / TAMANIO_BLOQUE);

        // Copia: el buffer interno se reutiliza inmediatamente.
        const copia = new Float32Array(this.buffer);
        this.port.postMessage(
          { event: 'chunk', buffer: copia, rms },
          [copia.buffer] // transferible: cero copias extra al pasar de hilo
        );

        this.escritas = 0; // vaciamos y seguimos
      }
    }

    return true; // mantener vivo el procesador
  }
}

registerProcessor('vad-processor', VadProcessor);
