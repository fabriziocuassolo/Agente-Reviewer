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
