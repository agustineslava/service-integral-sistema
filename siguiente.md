---
description: Aexia · Ejecuta el siguiente paso pendiente del ROADMAP, pidiendo mi aprobación antes de modificar (opcional - /siguiente R3)
agent: aexia
---
Ejecuta el siguiente paso pendiente de docs/ROADMAP.md. Si escribí algo aquí, es el ítem que quiero trabajar: $ARGUMENTS

1. Lee AGENTS.md, MEMORY.md y docs/ROADMAP.md. No leas archivos completos del código: usa grep y rangos.
2. Elige el primer paso `[ ]` cuyas dependencias estén resueltas (o el que indiqué). Dime en 3 líneas cuál es y por qué.
3. Si el ítem tiene decisiones marcadas PENDIENTE, pregúntamelas de una en una antes de seguir. Para el resto, usa las decisiones registradas en el ROADMAP.
4. Lee el plan indicado (docs/plan-*.md) y las skills que correspondan (tenant-isolation, db-migrations, aexia-security, aexia-ui, empresa-config).
5. Antes de modificar nada, muéstrame los archivos que vas a tocar y qué cambia en cada uno. Espera mi OK.
6. Implementa SOLO ese paso. Nunca encadenes el siguiente.
7. Verifica solo en desarrollo, con dos empresas (la legada y una de prueba). Antes de reiniciar el servidor, correr verificadores o tocar bases, confirma conmigo que es desarrollo. Nada contra producción. No edites el .env: dime qué debo cambiar yo.
8. Al terminar: marca el paso en docs/ROADMAP.md, actualiza MEMORY.md (máximo ~50 líneas) y propón un mensaje de commit corto. Si lo apruebo, haz `git add` solo de los archivos de este paso y el commit. No hagas push.
9. Si llevas muchas lecturas (unas 80) y el contexto crece, guarda el avance en la nota del paso y dime que abra /new y vuelva a usar /siguiente.
10. Termina con un resumen de máximo 12 líneas: qué cambió, qué probaste y qué decisiones debo revisar. Después detente.
