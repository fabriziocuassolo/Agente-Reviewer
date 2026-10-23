# Decisiones de diseño — Storefront Guardian

**Autor:** Fabrizio Cuassolo · **Reto:** Full Stack Engineer · IA Agéntica · **Repositorio:** github.com/fabriziocuassolo/Agente-Reviewer

Guardian es un revisor de código para equipos que mantienen tiendas online. Se usa desde la terminal del IDE: revisa los cambios, explica cada problema con cómo arreglarlo, **decide** si el cambio puede avanzar (APROBADO / ADVERTENCIA / BLOQUEADO), puede **corregir** los problemas con mi permiso y **responde preguntas** sobre el código.

> Las secciones 1 a 6 responden lo que pide el reto. La **bitácora** con cada paso que tomé y qué decidí, y las **mediciones** que respaldan las decisiones, están aparte en [DECISIONES-ANEXOS.md](DECISIONES-ANEXOS.md).

---

## 1. Qué parte del ciclo ataqué y por qué

Ataqué la **revisión de código**, porque es donde se concentran tres de las fricciones del escenario: es lenta, es inconsistente entre revisores y deja pasar bugs que se descubren tarde. En e-commerce esos bugs cuestan plata (un descuento aplicado dos veces, vender sin stock, una XSS en el catálogo).

| Capacidad del reto | Estado | Dónde |
|---|---|---|
| Revisar cambios y dar feedback útil y accionable | **Núcleo** | `guardian review`: cada hallazgo trae archivo:línea, explicación y sugerencia |
| Decidir con criterio si un cambio está listo | **Núcleo** | Gate determinístico con reglas configurables que dice qué regla aplicó |
| Detectar un problema, proponer corrección **y validarla** | Agregada después | Corrección automática: corrige, **vuelve a revisar** para validar y deja elegir subir o deshacer |
| Responder preguntas sobre el código | Secundaria | `guardian chat` / `guardian ask`, citando archivo:línea |

**Por qué ahí y no en otra parte del ciclo:** revisar y decidir se refuerzan entre sí (el feedback le sirve al desarrollador; la decisión, al equipo). Elegí intervenir **lo más temprano posible sin cambiar el flujo del equipo**: en la terminal mientras se programa, antes del push (hook) y en el pull request (GitHub Action).

---

## 2. Cómo diseñé el sistema

Una herramienta de terminal (`guardian`) que corre dentro de cualquier repositorio git. El comando principal es un **pipeline de 5 pasos**:

1. **Recolector** — le pregunta a git qué cambió (sin commitear, commits de la rama o lo que se va a pushear).
2. **Chequeos determinísticos** (sin IA, siempre corren, en paralelo) — detector de secretos, **reglas fijas del equipo**, lint, tipos y tests.
3. **Constructor de contexto** — junta el diff, los archivos cambiados, sus imports directos, las convenciones del proyecto, las **skills** que aplican y la **memoria** del equipo. **Tapa los secretos** antes de enviar nada.
4. **Agente revisor (IA)** — devuelve hallazgos en JSON que se **validan con zod**; si la respuesta es inválida reintenta una vez y, si falla, sigue sin IA y avisa.
5. **Gate de decisión** (determinístico) — cuenta hallazgos por severidad y aplica reglas: 1 crítico → BLOQUEADO; 3 altos → BLOQUEADO; 1 alto o medio → ADVERTENCIA.

**La idea central: la IA opina, las reglas deciden.** Así cada decisión es repetible, auditable y configurable por el equipo.

Alrededor del pipeline: **proveedores de IA intercambiables** (replay, Ollama, Gemini, Claude o cualquiera compatible con OpenAI), **aprendizaje sin reentrenar**, **corrección automática** con validación y rollback, un **menú** y comandos en lenguaje natural, el **hook pre-push**, la **GitHub Action** y una **tienda de ejemplo** con 4 escenarios de bugs sembrados.

---

## 3. Decisiones que tomé y alternativas que descarté

### Arquitectura y stack
| Decisión | Por qué | Alternativa descartada |
|---|---|---|
| Herramienta de terminal (CLI) en Node + TypeScript | Revisar exige leer el repo local, correr sus tests y poder frenar un push: eso pasa en la máquina del desarrollador. El mismo programa sirve para la terminal, el hook y la CI. Mismo lenguaje que la tienda. | **n8n**: necesita servidor, no puede frenar un push local y el código viajaría a otro lado; lo usaría después de la decisión (avisar por Slack). **Google ADK / LangGraph**: el pipeline tiene pasos fijos; un framework sumaba complejidad sin aportar. **Power Apps**: no accede al repo ni a git. |
| El gate es determinístico | Repetible, auditable, configurable | Que la IA decida: la misma pregunta puede dar otra respuesta |
| Pocas dependencias, npm workspaces, Gemini por REST sin SDK | Fácil de instalar y de explicar; se ve qué se envía | pnpm/turbo; un SDK por proveedor (Claude sí usa el oficial) |

### Revisión
| Decisión | Por qué |
|---|---|
| Secretos detectados solo en líneas **agregadas**, con el valor enmascarado en el reporte | No castiga código viejo y no vuelve a filtrar la clave en logs |
| ID del hallazgo = hash del contenido **sin** número de línea | `dismiss` sigue funcionando aunque el código se mueva |
| Hallazgos que citan archivos fuera del cambio se descartan; los repetidos se muestran una vez | Control de alucinaciones (necesario con modelos chicos) |
| Si la IA falla, un APROBADO baja a ADVERTENCIA (`ia-no-disponible`) | No frena al equipo por una caída del proveedor, pero no aprueba a ciegas |
| **La IA revisa siempre**, aunque ya haya un crítico (antes no lo hacía) | Ver **todos** los errores juntos. El ahorro quedó opcional: `ia.saltearSiHayCriticos` |
| En un monorepo, se usa la configuración del proyecto revisado; nunca se envían archivos internos ni binarios | Desde la raíz no se cargaban las reglas de la tienda; el modelo chico marcaba un "falso secreto" en la memoria de Guardian |

### IA y proveedores
| Decisión | Por qué |
|---|---|
| Modelo de Gemini elegido **midiendo**: `gemini-3.6-flash` | 3.8-flash era el mejor pero estaba saturado (60–80 s); 3.5-flash-lite (~2 s) explicó mal un bug |
| Modo replay con grabaciones reales | Cualquiera prueba la demo en minutos, sin clave ni internet |
| IA local con Ollama; contexto de 16k tokens explícito | Privacidad total; Ollama recorta el prompt en silencio si no se configura |
| Cualquier IA se agrega con 3 líneas en el `.env` (`IA_<NOMBRE>_URL/KEY/MODEL`) | Un adaptador "compatible con OpenAI" cubre a casi todos (ChatGPT, DeepSeek, Groq, Mistral…); Claude va con su SDK |
| Menú para elegir la IA, elección guardada por usuario y aviso "🤖 Usando: …" | No repetir la elección y saber siempre a quién se envía el código |

### Aprendizaje (sin reentrenar la IA)
| Nivel | Qué es | Medido |
|---|---|---|
| Reglas en palabras (`guardian aprender "…"`) | Criterio que se le pasa a la IA | Los modelos locales **no siempre** las aplican |
| Reglas fijas (`--patron`) | Un patrón que se detecta siempre, sin IA | La misma regla la detectaron **todos** los modelos |
| Descartes (`dismiss`) | Falsos positivos que no se repiten | Filtro exacto + aviso a la IA |
| Convenciones y skills | Reglas de la empresa y criterios por área | Con skills, el modelo barato encontró un bug que antes subestimaba |

**Conclusión:** lo innegociable va como regla fija; la IA queda para el criterio.

### Corrección automática
| Decisión | Por qué |
|---|---|
| Solo con permiso; foto de cada archivo antes de tocarlo | Rollback exacto (verificado con el hash del archivo) sin tocar los cambios del desarrollador |
| Validación: se **vuelve a revisar** después de corregir | Muestra problemas antes → después y si pasan los tests |
| Opciones: commit + push / deshacer / dejar sin commitear; **por defecto, deshacer** | Nunca se sube nada sin elección explícita |
| Si sigue BLOQUEADO: push "NO recomendado" + segunda confirmación | En una prueba, la IA "arregló" una contraseña del navegador con `process.env` y la validación lo detectó |

### Uso, demo, integraciones y despliegue
| Decisión | Por qué |
|---|---|
| `guardian` abre un menú y entiende frases, interpretadas **sin IA** (palabras clave) | "Tenía muchos comandos". Sin IA: instantáneo, gratis, predecible y testeable |
| Bugs de los escenarios 02 y 04 en código **sin tests** | Los tests atrapaban los bugs "obvios" y la IA nunca se llamaba: el valor real está en lo que se escapa de los tests |
| Hook: revisa solo los commits que se suben; si Guardian falta, avisa y deja pasar | Revisar lo que realmente se pushea; una herramienta de apoyo no debe trabar al equipo |
| GitHub Action lee el reporte desde un archivo y actualiza un único comentario | La primera versión pegaba el reporte en el script (se rompía y permitía inyección) |
| Vercel: no compila el agente; `src/app.ts` exporta la app; el catálogo se importa en el código | El build fallaba compilando el agente; Vercel exige ese formato |

---

## 4. Cómo balanceé costo, tiempo, privacidad y operabilidad

| Condición | Qué hice | Dato concreto |
|---|---|---|
| **Costo** | Capa gratuita de Gemini, Ollama gratis y replay. Skills solo si aplican. Contexto con tope. Opción de no llamar a la IA si ya está bloqueado. | $0. Una revisión usa entre 5.000 y 12.000 tokens de entrada |
| **Tiempo** | Chequeos en paralelo; modelo elegido midiendo; IA local en GPU | Chequeos ~1,5 s · IA en la nube 10–60 s · IA local 2–16 s · replay ~2 s |
| **Privacidad** | Secretos tapados antes de enviar; nunca `.env`, dependencias ni binarios; `.guardianignore`; IA local para código sensible; siempre se avisa a quién se envía | La capa gratuita de Gemini puede usar los datos; para código real: Ollama o un plan pago |
| **Operabilidad** | `npm install` + `npm link`; replay sin clave; menú y lenguaje natural; ayuda para principiantes; README, tutorial y casos de prueba | Demo completa en ~3 minutos |

**Cuando chocaron:**
- **Costo vs. feedback completo:** primero no llamaba a la IA si ya había un crítico. Probándolo con cambios reales vi que el desarrollador recibía un error por vez, así que **prioricé ver todo junto** y dejé el ahorro configurable.
- **Velocidad vs. calidad:** elegí el modelo intermedio, no el más rápido ni el mejor.
- **Privacidad vs. precisión:** la IA local de 14B encontró 3 de 4 escenarios y Gemini 4 de 4. El sistema permite ambos, y lo innegociable se cubre con reglas fijas que no dependen del modelo.
- **Automatizar vs. control:** la corrección automática existe, pero siempre con validación, diff visible y decisión explícita.

---

## 5. Qué haría con más tiempo

- **Un revisor más "agente":** darle herramientas (leer otro archivo, buscar usos, correr un test, escribir un test que demuestre el bug) en un loop acotado, y activarlo solo en cambios riesgosos.
- **Medir con un set de evaluación** (`npm run eval`): bugs encontrados, falsos positivos, tokens y tiempo por modelo.
- **Validar las correcciones con tests generados**, no solo volviendo a revisar.
- **Persistir el estado de la tienda** (carrito y stock) para que funcione en serverless.
- Probar la GitHub Action en un PR real, exponer Guardian como **servidor MCP** y sumar búsqueda semántica al chat.

---

## 6. Qué hice con apoyo de IA y qué es mío

**Mío (idea, diseño y decisiones):**
- La especificación con la que arrancó todo: qué capacidades atacar, el pipeline de 5 pasos, el gate determinístico, las skills, la memoria con `dismiss`, los proveedores (con replay y `--record`), los escenarios de demo, la GitHub Action y el contenido del README.
- La forma de trabajar: plan por fases, aprobar cada fase, un commit por fase, código simple y comentado.
- Las decisiones que tomé probando el sistema, detalladas en la bitácora ([anexo A](DECISIONES-ANEXOS.md)).

**Con apoyo de IA (Claude, como asistente de programación):**
- La implementación del código y de los tests, siguiendo mi especificación y mis pedidos, fase por fase.
- Decisiones técnicas de implementación dentro de mi diseño (por ejemplo, cómo detectar secretos, cómo armar el contexto o el formato de las grabaciones).
- Las mediciones de modelos y varias propuestas que acepté después de verlas funcionar.
- La documentación y la guía de estudio.

**Errores de la IA que detectamos y corregimos:** ejemplos inválidos en el README, una GitHub Action insegura, `ask` devolviendo JSON crudo y un hook sin probar.
