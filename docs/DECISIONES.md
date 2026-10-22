# Decisiones de diseño — Storefront Guardian

<!--
  Esqueleto para completar. Los comentarios HTML como este son notas de las
  decisiones técnicas tomadas durante la implementación, para desarrollar
  con tus palabras. Se pueden borrar al terminar.
-->

## 1. Qué parte del ciclo ataqué y por qué

<!--
  - Revisión de código (núcleo) + decisión de si el cambio avanza (núcleo) + preguntas sobre el código (secundaria).
  - El momento elegido es ANTES del push (hook pre-push) y en el PR (GitHub Action):
    se detecta el problema lo más temprano posible sin cambiar el flujo del equipo.
-->

## 2. Diseño del sistema

<!--
  - CLI `guardian` que corre dentro de cualquier repo git, desde la terminal del IDE.
  - Pipeline de review: recolector → chequeos determinísticos → contexto → agente LLM → gate determinístico.
-->

## 3. Decisiones y alternativas descartadas

<!--
  Fase 1 — storefront-demo:
  - Monorepo con npm workspaces (sin pnpm/turbo): cero herramientas extra para el evaluador.
  - Express 5 en vez de 4: captura errores de handlers async sin wrappers.
  - Precios en centavos enteros en todo el backend; el frontend solo divide por 100 al mostrar.
  - Servicios de negocio separados de Express (`services/`), testeables sin servidor.
  - `Inventory` con métodos async aunque esté en memoria: simula una DB real y hace que
    "olvidarse un await" sea un bug realista (base del escenario 04-subtle).
  - zod para validar toda entrada de la API (misma librería que usa el agente para validar al LLM).
  - El storefront corre con `tsx` (sin paso de build); el CLI sí se compila con `tsc` para `npm link`.
  - ESLint sin reglas "type-aware": más rápido y simple. Consecuencia: errores como una promesa
    sin await no los atrapa el linter → justamente es lo que debe encontrar el agente LLM.
  - Node 22 LTS (el requisito mínimo declarado es Node 20).
  - `.gitattributes` fuerza LF para que los patches de demo apliquen igual en Windows y Unix.

  Fase 2 — CLI y chequeos determinísticos:
  - `child_process` (execFileSync con git) en vez de simple-git: una dependencia menos y
    los comandos git quedan visibles/explicables en el código.
  - Qué se revisa (git.ts): --base explícito > cambios sin commitear vs HEAD > commits de la
    rama vs main (caso pre-push). Los archivos nuevos sin trackear se incluyen con un diff sintético.
  - Detector de secretos por regex solo sobre líneas AGREGADAS del diff (no castiga código viejo).
    El reporte enmascara el valor (primeros 4 caracteres) para no volver a filtrarlo en logs de CI.
  - Lint/tipos/tests se autodetectan desde package.json y se pueden sobreescribir o desactivar
    (null) en .guardian/config.json. Corren EN PARALELO: el costo de tiempo es el del más lento.
  - Severidades fijas de los chequeos: tipos y tests rotos = crítico (bloquea); lint = alto.
  - Gate como lista ordenada de reglas {severidad, mínimo, decisión}. Las de BLOQUEADO se
    evalúan primero (gana la más estricta). La respuesta siempre dice qué regla se aplicó.
    Alternativa descartada: que el LLM decida → no auditable ni reproducible.
  - IDs de hallazgo = hash del contenido SIN número de línea, para que `dismiss` sobreviva
    a que el código se mueva.
  - Exit codes: 0 aprobado/advertencia, 1 bloqueado, 2 error de la herramienta.
  - La config se valida con zod y los errores se muestran con la ruta exacta del campo.
-->

## 4. Cómo balanceé costo, tiempo, privacidad y operabilidad

<!--
  - Costo:
  - Tiempo de respuesta:
  - Privacidad:
  - Operabilidad:
-->

## 5. Qué haría con más tiempo

<!--
-->

## 6. Qué hice con apoyo de IA y qué es mío

<!--
-->
