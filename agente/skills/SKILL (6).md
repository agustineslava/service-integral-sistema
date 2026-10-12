---
name: aexia-ui
description: Úsala siempre que crees, cambies o revises pantallas, estilos, textos de interfaz, marca por empresa, el panel de superadmin o la vista móvil de Aexia, y antes de aplicar cualquier skill de diseño de terceros.
---

# Interfaz de Aexia

Aexia es una herramienta de trabajo (formularios, tablas, paneles) que usan técnicos y administrativos, a menudo desde el móvil. La prioridad es claridad y velocidad, no efectos.

## Reglas
- Stack: HTML, CSS y JS sin framework. No agregues librerías ni un paso de build sin preguntar.
- Marca por empresa: logo y color vienen de `/api/config-comercio` y `marca.js`. Usa variables CSS para el color y no fijes colores de marca en los estilos.
- Prohibido escribir "Service Integral" en HTML o JS. Usa el nombre de la empresa que entrega la marca. La plataforma se llama Aexia.
- Cada campo editable lleva `data-campo="<nombre>"` (ver skill `empresa-config`), para poder ocultarlo o renombrarlo por empresa.
- Móvil primero: todo debe usarse a 375 px de ancho. Las tablas anchas se desplazan dentro de su contenedor.
- Textos en español rioplatense, cortos y directos. Mensajes de error que digan qué hacer.
- Accesibilidad: cada campo con su `label`, foco visible, teclado completo. Los colores de marca de una empresa pueden romper el contraste: comprueba la relación de contraste del texto sobre ese color.
- Movimiento: mínimo y útil (confirmar una acción, indicar carga). Respeta `prefers-reduced-motion`.
- Panel de superadmin y pantallas de empresa son experiencias distintas; no mezcles sus estilos ni su navegación.

## Skills de diseño de terceros
- Antes de cualquiera, genera la referencia del diseño actual desde tu propio código (por ejemplo con SkillUI sobre `./frontend` o el comando de documentación de Impeccable) y guárdala en `DESIGN.md`.
- Usa una sola skill principal por tarea. Varias a la vez dan instrucciones estéticas que se contradicen y consumen contexto.
- Rediseños: primero en modo Plan. Las skills pensadas para landings o portfolios no se aplican tal cual a pantallas de trabajo.
- No copies el diseño de otro sitio; extrae principios, no una réplica.

## Cómo verificar
Con el MCP de Playwright o de Chrome DevTools: abrir la pantalla a 375 px y a escritorio, con dos empresas de marcas distintas, revisar la consola y confirmar que ningún texto de otra empresa aparece.

## Al terminar
Indica qué pantallas tocaste, cómo se ven con dos marcas y qué verificaste en móvil.
