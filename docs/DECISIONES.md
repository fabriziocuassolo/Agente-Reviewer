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

  Fase 3 — Adapter de LLM y agente revisor:
  - Interfaz `LLMProvider` mínima (complete(system, prompt) → texto + tokens). El revisor no
    sabe qué proveedor usa: Gemini, Ollama y replay son intercambiables.
  - Gemini vía REST con fetch, sin SDK: una dependencia menos y se ve exactamente qué se envía.
    La key va en header (x-goog-api-key), nunca en la URL. Modo JSON nativo (responseMimeType).
  - Reintentos solo ante errores transitorios (429/500/503) con espera creciente; timeout con
    AbortSignal (LLM_TIMEOUT_MS).
  - Elección del modelo por medición, no por suposición (ver comentario en llm/provider.ts):
    3.8-flash era el mejor pero estaba saturado (~60-80 s); 3.5-flash-lite tardaba ~2 s pero
    explicó mal el bug y bajó la severidad; 3.6-flash (~11 s) es el equilibrio. Configurable.
  - Si los chequeos determinísticos ya encontraron un crítico, NO se llama al LLM: ya está
    bloqueado, gastar tokens y 10 s no cambia la decisión. Primero hay que arreglar eso.
  - Contexto por prioridad con presupuesto en caracteres (config.context.maxChars, ~4 chars/token):
    convenciones → diff → archivos modificados → imports directos (1 nivel). Lo que no entra
    se informa como "no enviado". Archivos con números de línea para que el modelo cite bien.
  - Redacción de secretos sobre TODO el contexto (no solo líneas nuevas) antes de que salga
    de la máquina. Siempre se excluyen .env*, node_modules, dist, binarios y lockfiles,
    más lo que diga .guardianignore (paquete `ignore`, misma sintaxis que .gitignore).
  - El ID del hallazgo lo genera Guardian (hash), no el modelo: estable y sin colisiones.
  - Validación con zod de la respuesta. Si es inválida, 1 reintento devolviéndole el error al
    modelo; si vuelve a fallar → degradación: decide solo lo determinístico + aviso visible.
    La revisión nunca se cae por culpa del LLM.
  - Hallazgos que citan archivos fuera del cambio se descartan (control de alucinaciones).
  - El reporte muestra tokens de entrada/salida: hace visible el costo de cada revisión.
  - El .env se carga desde la carpeta de Guardian, no del proyecto revisado. Las variables de
    entorno tienen prioridad (así la GitHub Action pasa la key como secret).

  Fase 4 — Escenarios, replay y --record:
  - Hallazgo clave al armar los escenarios: los tests de la tienda atrapaban los bugs "obvios"
    (flotantes en calculateTotals, await faltante en checkout()) → el LLM nunca se llamaba.
    Los escenarios 02 y 04 meten el bug en código SIN tests (rama mayorista ≥10 unidades,
    ruta nueva de compra rápida): es justamente el caso realista donde la IA aporta valor.
  - Escenario 03: el secreto lo bloquea el chequeo determinístico y, por la regla "crítico
    determinístico → no se llama al LLM", la XSS no se reporta en esa pasada (aparecería al
    sacar la key). Trade-off: menos costo vs. feedback en dos rondas. [decidir/defender]
  - Replay: cada grabación guarda TODAS las respuestas de una revisión en orden (incluye
    reintentos), indexada por nombre de escenario (o hash del prompt). Guarda el hash del
    prompt y avisa si el código cambió desde que se grabó. Graba respuestas del modelo, no código.
  - --record envuelve a cualquier proveedor real (patrón decorator): no toca Gemini ni Ollama.
  - El demo copia la tienda a .demo-work/<escenario> DENTRO del repo (ignorado por git):
    Node encuentra el node_modules de la raíz, así ESLint/tsc/vitest corren sin reinstalar.
  - Cuota real de la capa gratuita: 20 requests/día por modelo (gemini-3.6-flash). Por eso:
    el 429 no se reintenta (solo 500/503), y replay existe para no depender de la cuota.
    01-clean quedó grabado con gemini-3.5-flash-lite porque se agotó la cuota de 3.6-flash.
  - Si la IA se intentó y falló (caída, cuota, JSON inválido 2 veces), un APROBADO baja a
    ADVERTENCIA (regla "ia-no-disponible"): no frena al equipo por una caída de Google,
    pero tampoco da luz verde sin revisión. Con --no-llm explícito se mantiene APROBADO.
  - Ollama: num_ctx 16384 explícito (por defecto Ollama recorta el prompt en silencio a 2-4k
    tokens) y timeout mayor (180 s) porque un 7B en CPU es lento. No probado en esta máquina.
  - Se mantuvo la regla de la consigna en 03 (decisión del autor): crítico determinístico → sin LLM.

  Fase 5 — Skills, memoria y dismiss:
  - Skills = markdown en .guardian/skills/ con criterios de revisión (checklists + severidad
    sugerida). Se cargan SOLO las que matchean los archivos cambiados, según un mapeo
    skill → patrones en config.json (misma sintaxis que .gitignore, librería `ignore`).
    Por qué selectivo: cada skill suma tokens (costo/latencia) y ruido. Sin mapeo → todas.
  - Diferencia CONVENTIONS vs skills: convenciones = reglas de la empresa (qué);
    skills = cómo revisar un área y qué severidad asignar (criterio del revisor).
  - Evidencia: con skills, gemini-3.5-flash-lite (el modelo barato) encontró el await
    faltante del escenario 04 como crítico en 1,5 s; sin skills había subestimado severidades.
  - Memoria en .guardian/memory.json DENTRO del repo revisado y commiteada: el conocimiento es
    del equipo, queda versionado y se revisa en PRs como cualquier código.
  - Doble efecto: (1) filtro exacto por ID (determinístico, auditable) y (2) "excepciones
    conocidas" en el prompt, para que el modelo no repita el criterio redactado distinto.
    Solo se pasan las excepciones de los archivos del cambio (máx. 20): el prompt no crece sin límite.
  - dismiss exige motivo (lo lee el resto del equipo) y NO permite descartar lint/tipos/tests:
    son hechos, no opiniones; se arreglan o se ajusta el comando en config.
  - Los hallazgos descartados no cuentan para el gate, ni para decidir si se llama al LLM.
  - `dismiss` usa .guardian/last-review.json (último reporte, no se commitea) para saber a qué
    hallazgo corresponde el ID.
  - Limitación: los IDs de hallazgos de la IA dependen del texto de la explicación, que puede
    variar entre corridas; por eso el refuerzo vía prompt es importante.

  Correcciones previas a la entrega:
  - Hook pre-push: revisa SOLO los commits que se pushean (`review --pre-push`), no el árbol
    de trabajo. Rutas absolutas a node y al CLI (el PATH de los hooks en Windows es distinto).
    Fail-open: si Guardian no está, avisa y deja pushear. Probado con un push real a un remoto local.
    Limitación: lint/tipos/tests corren sobre el árbol de trabajo, no sobre el commit exacto.
  - GitHub Action: el reporte se lee desde un archivo (antes se pegaba dentro del script →
    se rompía con backticks y permitía inyección). Actualiza su comentario en vez de duplicarlo.
  - ask: texto libre (antes el proveedor forzaba JSON), busca desde la carpeta actual, respeta
    .guardianignore y redacta secretos igual que review. De 18k a 12k tokens y de 48 s a 13 s.
  - Anécdota útil: al regrabar, la IA (con skills) encontró un bug latente en el escenario
    "limpio" 01 (filtro en minúsculas vs. categorías con su casing original). Se corrigió el
    escenario. Muestra que el revisor aporta incluso en cambios que parecían correctos.

  Aprendizaje, monorepo, "todos los errores" y chat (a partir de pruebas del autor):
  - Diagnóstico: el "JSON con información sensible" que marcó el modelo 7B era un FALSO positivo sobre
    .guardian/memory.json (la memoria de Guardian). Arreglo: nunca mandar .guardian/ ni nombres de
    binarios (PDF) a la IA. No se "enseñó" ese hallazgo: hubiera empeorado la revisión.
  - Monorepo: Guardian tomaba config/convenciones/skills de la RAÍZ del repo, así que revisando la tienda
    desde la raíz no cargaba sus reglas (XSS salía ALTO en vez de CRÍTICO). Ahora detecta el proyecto
    (carpeta con .guardian/ o docs/CONVENTIONS.md) por la carpeta actual o por los archivos cambiados.
  - "Quiero todos los errores": se invierte la decisión anterior. La IA revisa SIEMPRE (el secreto va
    redactado) y el prompt pide recorrer cada archivo y reportar todo (máx. 25). El ahorro queda opcional:
    ia.saltearSiHayCriticos. Medido: con 3 bugs en index.html, 7B y 14B encontraron los 3 (antes, 1).
  - Aprendizaje sin fine-tuning, en 3 niveles: reglas en palabras (guardian aprender → prompt),
    descartes (dismiss), reglas FIJAS (--patron → regex determinística en config.json).
    Medido: la misma regla ("sin <script> inline") en palabras NO la aplicó ni 7B ni 14B; como regla
    fija la detectaron ambos. Conclusión: lo innegociable va determinístico; la IA, para criterio.
  - Chat (guardian chat / ask sin pregunta): historial de 4 turnos; las repreguntas suman los nombres
    de funciones de la respuesta anterior; y una BÚSQUEDA EXACTA (sin IA) de dónde aparece cada nombre
    se le pasa al modelo para que cite líneas reales. Medido: sin esto el 14B inventaba ubicaciones.

  Elegir y agregar IAs:
  - `--use replay|gemini|ollama` (alias ia/local) y `--model` por comando; prioridad: --use > .env > replay.
    Si la IA pedida no está lista, se corta ANTES de revisar con instrucciones (key, instalación, modelo).
  - IAs propias sin tocar código: `IA_<NOMBRE>_URL/KEY/MODEL[/FORMATO]` en el .env; `--use <nombre>`
    y `guardian ia` las descubren solas. Formato "openai" (/chat/completions, el estándar de facto:
    OpenAI, DeepSeek, Groq, Mistral, OpenRouter, LM Studio) por fetch; formato "anthropic" con el SDK
    oficial (Claude tiene su propia API). Decisión: un adaptador genérico cubre a casi todos los
    proveedores, en vez de uno por marca. Modo JSON (response_format) con reintento sin él si no se soporta.
  - Aclaración clave para usuarios: ChatGPT Plus / Claude Pro no dan acceso a la API.
  - Hallazgo: el endpoint OpenAI-compatible de Ollama usa contexto de 2k tokens y recorta el prompt;
    por eso para Ollama se recomienda el proveedor nativo (--use local, que fija num_ctx).
  - guardian --help / ayuda / ayuda otra-ia: guía para principiantes en castellano.

  Prueba con Ollama (RTX 5080 16 GB, 100% GPU, num_ctx 16384 confirmado con `ollama ps`):
  - Escenarios: Gemini 3.6 Flash 4/4; qwen2.5-coder:14b 3/4 (encuentra los decimales del 02 pero no
    el cupón doble; falsos positivos en 01); qwen2.5-coder:7b 2/4 (solo el await del 04, con línea mal).
  - Tiempos de IA locales: 2-16 s. Privacidad total, menos precisión: es el trade-off central.
  - Default se mantiene en 7b (corre en casi cualquier PC); se recomienda 14b con ≥12 GB de VRAM.
  - Ajustes que salieron de probar modelos chicos: deduplicar hallazgos repetidos, aceptar `{}` como
    "sin hallazgos" y repetir la pregunta al final del prompt de `ask` (la perdían en textos largos).
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
