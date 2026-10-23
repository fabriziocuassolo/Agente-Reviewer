# Anexos — Decisiones de diseño de Storefront Guardian

Complementan a [DECISIONES.md](DECISIONES.md) (el documento de decisiones, de hasta 5 páginas): la bitácora con cada paso que tomé y qué decidí, y las mediciones que respaldan las decisiones.

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
