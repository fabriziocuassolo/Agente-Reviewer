# Decisiones de diseño — Storefront Guardian

**Autor:** Fabrizio Cuassolo · **Reto:** Full Stack Engineer · IA Agéntica · **Repositorio:** github.com/fabriziocuassolo/Agente-Reviewer

Guardian es un revisor de código para equipos que mantienen tiendas online. Se usa desde la terminal del IDE: revisa los cambios, explica cada problema con cómo arreglarlo, **decide** si el cambio puede avanzar (APROBADO / ADVERTENCIA / BLOQUEADO), puede **corregir** los problemas con mi permiso y **responde preguntas** sobre el código.

> Las secciones 1 a 6 responden lo que pide el reto. Al final hay dos anexos: la **bitácora** con cada paso que tomé y qué decidí, y las **mediciones** que respaldan las decisiones.

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

Alrededor del pipeline:
- **Proveedores de IA intercambiables** detrás de una interfaz común: replay (respuestas grabadas), Ollama (local), Gemini, Claude y cualquier servicio compatible con OpenAI que se agregue en el `.env`.
- **Aprendizaje sin reentrenar**: reglas en palabras (`guardian aprender`), reglas fijas (`--patron`), descartes de falsos positivos (`dismiss`), convenciones y skills. Todo vive en el repo y se le pasa a cualquier modelo.
- **Corrección automática** con foto previa de cada archivo, validación y rollback exacto.
- **Uso simple**: `guardian` abre un menú; también entiende frases (`guardian "revisá mis cambios con la IA local"`).
- **Integraciones**: hook `pre-push` y GitHub Action que comenta en cada PR.
- **Tienda de ejemplo** (`storefront-demo`) con 4 escenarios de bugs sembrados para demostrarlo.

---

## 3. Decisiones que tomé y alternativas que descarté

### Arquitectura y stack
| Decisión | Por qué | Alternativa descartada |
|---|---|---|
| Herramienta de terminal (CLI) en Node + TypeScript | Revisar exige leer el repo local, correr sus tests y poder frenar un push: eso pasa en la máquina del desarrollador. El mismo programa sirve para la terminal, el hook y la CI. Mismo lenguaje que la tienda. | **n8n**: necesita servidor, no puede frenar un push local y el código viajaría a otro lado; lo usaría después de la decisión (avisar por Slack). **Google ADK / LangGraph**: el pipeline tiene pasos fijos; un framework sumaba complejidad sin aportar. **Power Apps**: no accede al repo ni a git. |
| El gate es determinístico | Repetible, auditable, configurable | Que la IA decida: la misma pregunta puede dar otra respuesta |
| Pocas dependencias (commander, zod, picocolors, ignore, vitest) y Gemini por REST sin SDK | Fácil de instalar y de explicar; se ve exactamente qué se envía | SDKs por proveedor (para Claude sí uso el SDK oficial: tiene su propia API) |
| Monorepo con npm workspaces | Cero herramientas extra para quien lo prueba | pnpm / turbo |
| Precios en centavos enteros, servicios separados de Express, validación con zod | Evita errores de punto flotante; lógica testeable sin servidor | Montos con decimales |

### Revisión
| Decisión | Por qué |
|---|---|
| Secretos detectados solo en líneas **agregadas**, con el valor enmascarado en el reporte | No castiga código viejo y no vuelve a filtrar la clave en logs |
| Lint, tipos y tests se autodetectan y corren **en paralelo** | El tiempo total es el del más lento |
| ID del hallazgo = hash del contenido **sin** número de línea | `dismiss` sigue funcionando aunque el código se mueva |
| Contexto con presupuesto (~80.000 caracteres) y archivos con número de línea | Controla costo y latencia; el modelo cita líneas exactas |
| Hallazgos que citan archivos fuera del cambio se descartan; los repetidos se muestran una vez | Control de alucinaciones (necesario con modelos chicos) |
| Si la IA falla, un APROBADO baja a ADVERTENCIA (`ia-no-disponible`) | No frena al equipo por una caída del proveedor, pero no aprueba a ciegas |
| **La IA revisa siempre**, aunque ya haya un crítico (antes no lo hacía) | Ver **todos** los errores juntos. El ahorro quedó opcional: `ia.saltearSiHayCriticos` |
| En un repo con varios proyectos, se usa la configuración del proyecto revisado | Desde la raíz no se cargaban las convenciones de la tienda (la XSS salía ALTO en vez de CRÍTICO) |
| Nunca se envían a la IA los archivos internos de Guardian ni nombres de binarios | El modelo chico marcaba un "falso secreto" en su propia memoria |

### IA y proveedores
| Decisión | Por qué |
|---|---|
| Modelo de Gemini elegido **midiendo**: `gemini-3.6-flash` | 3.8-flash era el mejor pero estaba saturado (60–80 s); 3.5-flash-lite (~2 s) explicó mal un bug |
| Modo replay con grabaciones reales | Cualquiera prueba la demo en minutos, sin clave ni internet |
| IA local con Ollama; contexto de 16k tokens explícito | Privacidad total; Ollama recorta el prompt en silencio si no se configura |
| Cualquier IA se agrega con 3 líneas en el `.env` (`IA_<NOMBRE>_URL/KEY/MODEL`) | Un adaptador "compatible con OpenAI" cubre a casi todos (ChatGPT, DeepSeek, Groq, Mistral…); Claude va con su SDK |
| La elección de IA se guarda por usuario; siempre se muestra "🤖 Usando: …" | No repetir la elección y saber siempre a quién se envía el código |
| No se reintenta ante cuota agotada (429) | Cada reintento gasta cuota sin chance de éxito |

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
| Commit solo de los archivos revisados y corregidos | Nunca `git add -A` a ciegas |

### Uso
| Decisión | Por qué |
|---|---|
| `guardian` solo abre un menú; también entiende frases | Pedido: "tiene muchos comandos" |
| Las frases se interpretan **sin IA** (palabras clave) y se muestra el comando equivalente | Instantáneo, gratis, predecible y testeable; enseña los comandos sin memorizarlos |
| Ayuda `guardian --help` para alguien que no programa | Operabilidad |

### Demo, integraciones y despliegue
| Decisión | Por qué |
|---|---|
| Bugs de los escenarios 02 y 04 en código **sin tests** | Los tests atrapaban los bugs "obvios" y la IA nunca se llamaba: el valor real está en lo que se escapa de los tests |
| La demo trabaja en copias dentro de `.demo-work/` (ignorada por git) | No ensucia el repo y reutiliza las dependencias |
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
- Probar la GitHub Action en un PR real y exponer Guardian como **servidor MCP** para los agentes del editor.
- Búsqueda semántica para el chat.

---

## 6. Qué hice con apoyo de IA y qué es mío

**Mío (idea, diseño y decisiones):**
- La especificación con la que arrancó todo: qué capacidades atacar, el pipeline de 5 pasos, el gate determinístico, las skills, la memoria con `dismiss`, los proveedores (con replay y `--record`), los escenarios de demo, la GitHub Action y el contenido del README.
- La forma de trabajar: plan por fases, aprobar cada fase, un commit por fase, código simple y comentado.
- Las decisiones que tomé probando el sistema, detalladas en la bitácora (Anexo A).

**Con apoyo de IA (Claude, como asistente de programación):**
- La implementación del código y de los tests, siguiendo mi especificación y mis pedidos, fase por fase.
- Decisiones técnicas de implementación dentro de mi diseño (por ejemplo, cómo detectar secretos, cómo armar el contexto o el formato de las grabaciones).
- Las mediciones de modelos y varias propuestas que acepté después de verlas funcionar.
- La documentación y la guía de estudio.

**Errores de la IA que detectamos y corregimos:** ejemplos de configuración inválidos en el README, una GitHub Action insegura, `ask` que devolvía JSON crudo, un hook sin probar, regex rotas por caracteres invisibles y textos con escapes mal hechos.

---

## Anexo A — Bitácora: los pasos que tomé y qué decidí

| # | Paso | Qué decidí |
|---|---|---|
| 1 | Escribí la especificación del proyecto | Atacar revisión de código + decisión (núcleo) y preguntas (secundaria). Preferí algo enfocado y bien hecho |
| 2 | Revisé el plan por fases | Lo aprobé; instalar Node 22, rama `main`, Gemini como primer proveedor |
| 3 | Fases 1 a 5 (tienda, CLI, IA, demo, skills y memoria) | Aprobé cada fase después de ver cómo probarla |
| 4 | Me encontré con que en el escenario 03 la XSS no aparecía | En ese momento, **mantuve** la regla de la consigna (sin IA si ya hay un crítico) |
| 5 | Antes de entregar, pedí revisar errores | Corregir README, Action, `ask`, hook y grabaciones antes de seguir |
| 6 | Saqué la clave real de ejemplo del tutorial | No mostrar claves con forma real en la documentación |
| 7 | Pedí una guía de estudio en PDF | Entender cada parte para defenderla en la entrevista |
| 8 | Instalé Ollama y probé la IA local | Comparar privacidad vs. precisión con datos propios |
| 9 | Pedí elegir la IA desde la terminal | `--use`, replay por defecto, instrucciones si falta configuración |
| 10 | Pedí poder agregar cualquier IA (ChatGPT, Claude…) | Que se agregue desde el `.env` y aparezca sola en `--use` |
| 11 | Probé con mis propios cambios y vi un falso positivo del modelo chico y un error no detectado en `index.html` | No "enseñarle" el falso positivo; arreglar la causa. **Cambiar la decisión del paso 4:** quiero ver **todos** los errores |
| 12 | Pedí que aprenda y que `ask` funcione como chat | Aprendizaje sin reentrenar (reglas, descartes, reglas fijas) y chat con repreguntas |
| 13 | Pedí corrección automática con confirmación y rollback | Nunca subir sin preguntar; si digo que no, todo vuelve a como estaba |
| 14 | Sentí que había muchos comandos | Menú interactivo, elección de IA guardada, aviso "Usando: …" y lenguaje natural |
| 15 | Probé la corrección automática en el repo real | Se subió un commit de correcciones que no cambió código (solo memoria y PDF) |
| 16 | Quise publicar la tienda en Vercel; el build falló | Desplegar solo la tienda (Root Directory `storefront-demo`) y adaptarla al formato de Vercel |
| 17 | Vi que este documento no mostraba las decisiones | Reescribirlo visible y completo |

---

## Anexo B — Mediciones que respaldan las decisiones

**Escenarios de demo por modelo**

| Escenario | Gemini 3.6 Flash | Ollama 14B | Ollama 7B |
|---|---|---|---|
| 01 cambio correcto | APROBADO ✔ | falsos positivos | falsos positivos |
| 02 decimales + cupón doble | encuentra los dos ✔ | encuentra los decimales | no encuentra ninguno |
| 03 XSS + clave | BLOQUEADO ✔ (sin depender de la IA) | ✔ | ✔ |
| 04 `await` faltante | línea exacta ✔ | línea exacta ✔ | línea equivocada |

**Otras mediciones**
- Con 3 errores en `index.html`, el 7B y el 14B encontraron los 3 después de los cambios del paso 11 (antes, 1).
- Una regla en palabras no la aplicó ningún modelo local; la misma como regla fija la detectaron todos.
- Chat: sin la búsqueda exacta de nombres, el 14B inventaba ubicaciones; con ella cita líneas reales.
- `ask` desde la carpeta de la tienda: de 48 s y 18.000 tokens a 13 s y 12.000 tokens.
- Corrección automática: rollback con hash idéntico; push a un remoto de prueba ✔.
- Cuota gratuita de Gemini: ~20 revisiones por día por modelo.
