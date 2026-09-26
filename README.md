# NovaChat

> Prototipo web navegable de una aplicación de mensajería moderna, diseñado con una interfaz oscura y responsiva.

![Estado](https://img.shields.io/badge/estado-prototipo-9b7cff?style=flat-square)
![Costo](https://img.shields.io/badge/dependencias-ninguna-4fdea2?style=flat-square)

## Características actuales

- Chats directos y grupos de demostración.
- Envío de mensajes con respuesta simulada.
- Buscador de conversaciones.
- Secciones de **Chats**, **Estados** y **Llamadas**.
- Simulación visual de llamadas de voz y vídeo.
- Creación de chats de demostración.
- Diseño adaptable a dispositivos móviles y escritorio.
- Sin dependencias, servicios externos ni costos de ejecución.

> Este repositorio contiene un **prototipo de interfaz**. Los mensajes, llamadas y contactos se ejecutan localmente en el navegador; aún no hay registro con teléfono, servidor ni base de datos.

## Estructura del proyecto

```text
NovaChat/
├── index.html          # Punto de entrada de la aplicación
├── src/
│   ├── css/
│   │   └── main.css    # Diseño responsivo y tema visual
│   └── js/
│       └── app.js      # Interacciones y datos simulados
├── docs/
│   └── roadmap.md      # Fases para una versión funcional
├── .gitignore
└── README.md
```

## Ejecutarlo localmente

No requiere instalación. Puedes abrir `index.html` directamente en un navegador.

Para servirlo localmente (recomendado), desde la raíz del repositorio ejecuta:

```bash
python3 -m http.server 8080
```

Después abre [http://localhost:8080](http://localhost:8080).

## Publicarlo gratis con GitHub Pages

1. Sube estos archivos a la rama `main`.
2. En GitHub, entra a **Settings → Pages**.
3. En **Build and deployment**, selecciona **Deploy from a branch**.
4. Elige la rama `main` y la carpeta `/(root)`.
5. Guarda los cambios.

GitHub publicará el sitio sin costo en una URL similar a:

```text
https://andersoncostilla.github.io/NovaChat/
```

## Próximos pasos

Consulta el [roadmap técnico](docs/roadmap.md) para conocer una ruta gradual hacia una aplicación funcional, empezando por alternativas con planes gratuitos.

## Tecnologías

- HTML5
- CSS3
- JavaScript nativo

---

Hecho para **NovaChat**.
