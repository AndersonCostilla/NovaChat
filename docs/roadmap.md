# Roadmap de NovaChat

Este documento propone una evolución progresiva del prototipo hacia una aplicación funcional, priorizando alternativas gratuitas y evitando gastos mientras el proyecto esté en etapa de validación.

## Estado actual — Prototipo visual

- Interfaz web responsiva.
- Chats y grupos simulados.
- Envío de mensajes en memoria durante la sesión.
- Estados y llamadas como demostración visual.

No almacena datos personales, no requiere cuentas y no genera costos.

## Fase 1 — Mensajería funcional gratuita

**Objetivo:** permitir a usuarios reales registrarse y conversar en tiempo real.

Propuesta inicial:

- **Frontend:** mantener HTML/CSS/JavaScript o migrar posteriormente a React.
- **Autenticación y datos:** usar una plataforma con plan gratuito, como Firebase o Supabase, según las necesidades finales.
- **Chat en tiempo real:** base de datos con actualizaciones en tiempo real.
- **Contenido inicial:** texto, foto y archivos pequeños con límites definidos.
- **Despliegue:** GitHub Pages para la interfaz estática o alternativas gratuitas compatibles con el backend elegido.

> El acceso por correo puede ser gratuito dentro de los límites del proveedor. El acceso por número telefónico mediante SMS/OTP suele tener costo después de una cuota promocional, ya que los mensajes de verificación los cobran los operadores.

## Fase 2 — Acceso por número de teléfono

**Objetivo:** ofrecer un flujo parecido a WhatsApp mediante código SMS.

Antes de activarlo se deben definir:

1. Países a los que se enviarán códigos.
2. Límite de verificaciones por usuario y por día.
3. Presupuesto o patrocinio para los SMS.
4. Políticas de privacidad, términos de uso y mecanismo antiabuso.

Para mantener la etapa de desarrollo sin costo, se pueden usar números de prueba o inicio de sesión por correo mientras se valida la app.

## Fase 3 — Funciones sociales

- Grupos reales y administración de participantes.
- Estados con publicación y vencimiento automático.
- Reacciones, respuesta a mensajes y mensajes fijados.
- Indicadores de entrega y lectura.
- Notificaciones web/push.
- Bloqueo y reporte de usuarios.

## Fase 4 — Llamadas y seguridad

- Llamadas de voz y vídeo basadas en WebRTC.
- Servicio de señalización y servidores TURN/STUN: indispensables para una conexión confiable; estos componentes normalmente introducen costos a escala.
- Evaluación profesional de cifrado de extremo a extremo.
- Copias de seguridad, moderación y monitoreo.

## Principios de producto

- No afirmar que hay cifrado de extremo a extremo hasta que esté implementado y auditado.
- Solicitar solo los datos imprescindibles.
- Implementar límites de uso, reportes y bloqueo antes de abrir el servicio al público.
- Mantener claves y variables privadas fuera del repositorio mediante archivos `.env`.
