# Casos de prueba para Guardian

Guía práctica para probar la IA de Guardian con **Ollama** (local), **Gemini** (nube) o **replay** (grabado),
y comparar resultados. Todos los resultados de este documento son **reales**, medidos el 23/10/2026
en una PC con Ryzen 7 7800X3D, 32 GB de RAM y RTX 5080 (16 GB).

---

## 0. Preparación

### Elegir el proveedor

La forma más simple: agregá `--use` a cualquier comando. No hace falta tocar archivos.

```powershell
guardian ia                                            # qué hay instalado y listo
guardian review --use local --model qwen2.5-coder:14b  # Ollama 14B
guardian review --use local                            # Ollama 7B (el modelo por defecto)
guardian review --use ia                               # Gemini
npm run demo -- all --use local --model qwen2.5-coder:14b
```

Si la IA elegida no está lista (falta la key de Gemini, Ollama cerrado o sin el modelo), Guardian
corta y te explica qué hacer.

Para cambiar la IA **por defecto**, abrí el archivo `.env` (en la raíz del proyecto) y dejá **una** de estas configuraciones:

```
# Opción 1: Ollama, modelo grande (recomendado si tu placa de video tiene 12 GB o más)
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5-coder:14b

# Opción 2: Ollama, modelo chico (funciona en casi cualquier PC, menos preciso)
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5-coder:7b

# Opción 3: Gemini (el más preciso; necesita key y tiene cuota diaria)
LLM_PROVIDER=gemini
GEMINI_API_KEY=tu-key

# Opción 4: replay (sin IA real; solo para los 4 escenarios de demo)
LLM_PROVIDER=replay
```

### Verificar que Ollama está andando

```powershell
ollama list
```

Tiene que aparecer el modelo (`qwen2.5-coder:7b` o `qwen2.5-coder:14b`). Si dice que no puede conectarse,
abrí la app **Ollama** desde el menú Inicio (queda en la bandeja del sistema) o corré `ollama serve`.

Para ver si está usando la placa de video:

```powershell
ollama ps
```

La columna `PROCESSOR` debería decir `100% GPU`.

---

## 1. Los 4 escenarios de demo (5 minutos)

```powershell
npm run demo -- all
```

Corre los 4 cambios con errores sembrados y muestra un resumen "esperado vs. obtenido".

### Resultados reales por proveedor

| Escenario | Qué tiene | Gemini 3.6 Flash | Ollama 14B | Ollama 7B |
|---|---|---|---|---|
| **01-clean** | Nada (cambio correcto) | ✅ APROBADO | ⚠️ ADVERTENCIA (falsos positivos: pide más tests y comentarios) | ⚠️ ADVERTENCIA (falsos positivos repetidos) |
| **02-pricing-float** | Precios con decimales + cupón aplicado dos veces | ✅ BLOQUEADO: encuentra **los dos** bugs | ✅ BLOQUEADO: encuentra los decimales, **no** el cupón doble | ❌ ADVERTENCIA: no encuentra ninguno e inventa otros |
| **03-security** | XSS + API key en el código | ✅ BLOQUEADO (detector de secretos, sin IA) | ✅ Igual | ✅ Igual |
| **04-subtle** | `await` faltante al reservar stock | ✅ BLOQUEADO, línea exacta | ✅ BLOQUEADO, línea exacta (+3 comentarios menores) | ✅ BLOQUEADO, pero cita una línea equivocada |
| **Tiempo de la IA** | | 10 a 50 s (depende de la demanda) | 9 a 16 s | 2 a 50 s |

**Conclusión:** el 03 no depende de la IA, así que da igual en los tres. En los bugs sutiles (02 y 04)
se nota el tamaño del modelo. El 14B local es una opción razonable para código confidencial; Gemini sigue
siendo el más preciso. Los modelos locales tienden a generar **falsos positivos** en cambios limpios.

---

## 2. Casos propios en el sandbox

El sandbox es una copia limpia de la tienda donde podés romper lo que quieras sin tocar el proyecto.

```powershell
npm run demo -- sandbox
cd .demo-work/sandbox
code .            # abre la copia en VS Code (opcional)
```

En cada caso: hacés **una** edición, guardás y corrés `guardian review`.
Para volver a empezar limpio: `npm run demo -- sandbox` otra vez (desde la raíz del proyecto).

> Tip para editar: en VS Code, `Ctrl+P` abre un archivo por nombre y `Ctrl+H` busca y reemplaza.

---

### Caso A — XSS sin secreto (¿la IA ve el riesgo de seguridad?)

**Objetivo:** en el escenario 03 la XSS no se reporta porque el secreto bloquea antes. Acá va sola.

**Edición** en `public/app.js` (línea 66):

| Buscar | Reemplazar por |
|---|---|
| `el("h3", "card-title", product.name),` | `Object.assign(el("h3", "card-title"), { innerHTML: product.name }),` |

**Esperado:** BLOQUEADO por un hallazgo CRÍTICO de seguridad en `public/app.js:66`, sugiriendo `textContent`.

**Resultado real:** ✅ 7B y 14B lo encuentran (CRÍTICO, línea 66) en 3 a 5 segundos.

---

### Caso B — Datos sin validar en la API

**Objetivo:** ver si la IA aplica la convención "toda entrada de la API se valida".

**Edición** en `src/routes/carts.ts` (línea 41):

| Buscar | Reemplazar por |
|---|---|
| `const { productId, quantity } = parse(addItemSchema, req.body);` | `const { productId, quantity } = req.body;` |

**Esperado:** ADVERTENCIA. Dos hallazgos ALTO:
1. de **ESLint** (determinístico): quedó un import sin usar;
2. de la **IA**: falta validar con zod.

**Resultado real:** ✅ 7B y 14B, ADVERTENCIA con los dos hallazgos, en 4 a 6 segundos.

---

### Caso C — Lo atrapan los tests (sin IA)

**Objetivo:** mostrar que lo determinístico corre primero y, si ya bloquea, no se gasta IA.

**Edición** en `src/services/discounts.ts`:

| Buscar | Reemplazar por |
|---|---|
| `return Math.min(discount, subtotalCents);` | `return discount;` |

**Esperado:** BLOQUEADO porque fallan los tests ("el descuento nunca supera el subtotal").
Aviso: "Se omitió la revisión con IA".

**Resultado real:** ✅ BLOQUEADO en 1,9 s, sin llamar al modelo.

---

### Caso D — Cambio solo visual (¿la IA molesta de más?)

**Objetivo:** un cambio inofensivo debería pasar.

**Edición** en `public/styles.css`:

| Buscar | Reemplazar por |
|---|---|
| `.price { font-weight: 700; font-size: 1.1rem; }` | `.price { font-weight: 700; font-size: 1.2rem; color: var(--accent-dark); }` |

**Esperado:** APROBADO. Solo se cargan las skills `security` y `frontend` (no la de precios).

**Resultado real:** ✅ APROBADO con 14B (sin hallazgos) y con 7B (un comentario BAJO, que no frena).

---

### Caso E — Secreto en el código

**Edición** en cualquier archivo, por ejemplo al final de `src/server.ts`, agregá:

```ts
const PAYMENTS_API_KEY = "clave-de-prueba-123456";
```

**Esperado:** BLOQUEADO al instante (detector de secretos). El reporte muestra solo `clav…` para no
volver a filtrar la key. No se llama a la IA.

---

### Caso F — Falso positivo y memoria (`dismiss`)

**Objetivo:** ver cómo Guardian "aprende" del equipo.

1. Corré el escenario 02 y entrá a su carpeta:
   ```powershell
   npm run demo -- 02-pricing-float
   cd .demo-work/02-pricing-float
   ```
2. Elegí el ID de un hallazgo que consideres aceptable (ej. el de tests, `G-xxxxxx`):
   ```powershell
   guardian dismiss G-xxxxxx "Los tests de mayorista llegan en el PR siguiente"
   ```
3. Volvé a revisar:
   ```powershell
   guardian review
   ```

**Esperado:** ese hallazgo ya no aparece ("1 hallazgo oculto porque el equipo ya lo descartó") y
el reporte indica "Memoria: 1 excepción incluida en el prompt". El archivo `.guardian/memory.json`
tiene el motivo.

**Probá también:** intentar descartar un test roto (Caso C) → Guardian no lo permite.

---

### Caso G — El hook antes de pushear

```powershell
npm run demo -- sandbox
cd .demo-work/sandbox
guardian install-hook
```

Hacé el Caso E (secreto) y commitealo:

```powershell
git commit -am "agrego key"
git push
```

**Esperado:** como el sandbox no tiene remoto, `git push` falla igual. Para verlo completo usá un repo
propio con GitHub. El comportamiento es: con BLOQUEADO el push se cancela y no sube nada. Este
caso se probó de punta a punta con un remoto local: el commit con secreto fue rechazado.

---

---

### Caso H — Varios errores juntos (¿los reporta TODOS?)

**Edición** en `public/index.html`: debajo del párrafo del cupón (`<p>Envío gratis...</p>`), pegá:

```html
<p id="saludo"></p>
<script>
  const nombre = new URLSearchParams(location.search).get("nombre");
  document.getElementById("saludo").innerHTML = "Hola " + nombre + "!";
  const ADMIN_PASSWORD = "admin1234";
  const descuento = parseFloat(nombre) * 0.1;
</script>
```

**Esperado:** BLOQUEADO con **todos** los problemas: XSS (`innerHTML` con un dato de la URL), contraseña
en el código, decimales para calcular un descuento y, si cargaste la regla del Caso I, `<script>` inline.

**Resultado real** (desde la raíz del repo, 7B y 14B): ✅ los dos encontraron la XSS (CRÍTICO), la
contraseña (CRÍTICO) y el `parseFloat` (ALTO). La línea `Proyecto: storefront-demo` confirma que usó
las convenciones y skills de la tienda.

---

### Caso I — Enseñarle una regla: en palabras vs. fija

```powershell
# En palabras (la IA la recibe como criterio):
guardian aprender "No se permiten scripts inline en el HTML: el JavaScript va en public/app.js" --archivos "public/**"

# Fija (se detecta siempre, con cualquier IA o sin IA):
guardian aprender "No se permiten scripts inline en el HTML" --patron "<script>" --archivos "public/**/*.html"

guardian aprender --lista
```

Después repetí el Caso H.

**Resultado real:** la regla **en palabras** llegó al prompt ("Aprendizaje: 1 regla"), pero **ni el 7B
ni el 14B la aplicaron**. La regla **fija** la detectaron los dos (ALTO, `<script>` en la línea 22).
Conclusión: lo innegociable conviene declararlo fijo; las reglas en palabras sirven como criterio extra
y funcionan mejor con modelos grandes.

---

### Caso J — Chat con repreguntas

```powershell
cd storefront-demo
guardian chat --use local --model qwen2.5-coder:14b
```

```
vos › ¿Cómo se calcula el costo de envío?
vos › ¿y dónde se usa esa función?
vos › /fuentes
vos › /salir
```

**Esperado:** la segunda respuesta entiende que "esa función" es `calculateShipping` y cita
`src/services/pricing.ts:45` (dentro de `calculateTotals`) y los tests de `tests/pricing.test.ts`.

**Resultado real:** ✅ 7B: correcto y completo (~6 s). ✅ 14B: correcto en lo principal (~11 s), y agrega
`carts.ts`/`checkout.ts`, que usan la función de forma indirecta (vía `calculateTotals`).
Sin la búsqueda exacta que Guardian le pasa al modelo, el 14B inventaba ubicaciones.

---

### Caso K — Elegir la IA con el menú (la primera vez)

```powershell
guardian ia
```

Respondé `s` y elegí con números: `2` (IA local) → `2` (modelo más grande). Después corré `guardian review`
sin opciones.

**Esperado:** la primera línea dice `🤖 Usando: IA local · Ollama · qwen2.5-coder:14b ... (tu elección
guardada · para cambiarla: guardian ia)`. Probá también `3` → `2` (Claude sin configurar): te explica de
dónde sacar la clave y qué líneas agregar al `.env`, y ofrece hacerlo ahí mismo (Enter para salir).

**Resultado real:** ✅ los 8 caminos del menú (local chico/grande, Gemini configurada, Claude y GPT sin
configurar, Otra, replay y un número inválido) se probaron con respuestas automáticas.

---

### Caso L — Lenguaje natural

```powershell
guardian "revisá mis cambios con la IA local"
guardian "¿qué cupones existen?"
guardian "aprendé que los precios van en centavos"
guardian
```

**Esperado:** cada frase muestra el comando equivalente (`→ guardian review --use ollama`, `→ guardian ask
"..."`, `→ guardian aprender "..."`) y lo ejecuta. `guardian` solo abre el menú principal.

**Resultado real:** ✅ las 9 frases de los tests se traducen al comando correcto.

---

### Caso M — Corrección automática, rollback y push

Usá el sandbox con el Caso H aplicado (o el escenario 04) y corré `guardian review` con una IA real.

1. Respondé `s` a "¿Querés que Guardian intente corregir…?".
2. Mirá el diff y el **resultado de la validación** (problemas antes → después, tests).
3. Elegí `2` (deshacer) → el archivo queda **idéntico** a como estaba.
4. Repetí y elegí `1` (commit + push) en un repo con remoto.

**Resultado real (Ollama 14B):**
- Escenario 04: agregó correctamente `await inventory.reserve(items)`; tests pasan.
- Caso H: corrigió la XSS (`innerHTML` → `textContent`), pero la contraseña la "arregló" con `process.env`
  en el navegador → la validación siguió en **BLOQUEADO** y Guardian recomendó deshacer. Al elegir
  push, pidió una segunda confirmación; con "no", hizo rollback.
- Rollback: mismo hash del archivo antes y después ✅. Push a un remoto local: commit
  "Correcciones automáticas de Guardian" ✅.
- Limitación: con modelos locales la validación es ruidosa (el 14B volvió a reportar "falta await"
  sobre la línea ya corregida). La señal dura son los tests.

---

## 3. Preguntas para `guardian ask`

Corré desde `storefront-demo/` (así busca solo en la tienda):

```powershell
cd storefront-demo
guardian ask "¿Cómo se calcula el costo de envío?"
```

| Pregunta | Qué debería mencionar |
|---|---|
| ¿Cómo se calcula el costo de envío? | `calculateShipping` en `src/services/pricing.ts`: gratis desde $50 o con cupón ENVIOGRATIS; si no, $4,99 |
| ¿Dónde se validan los datos que llegan a la API? | `src/validation.ts` (zod + `parse`) y su uso en `src/routes/carts.ts` |
| ¿Qué cupones existen y qué hace cada uno? | `COUPONS` en `src/services/discounts.ts`: BIENVENIDA10, AHORRA5, ENVIOGRATIS |
| ¿Qué pasa si dos clientes compran el último producto al mismo tiempo? | `findIssues` y `reserve` en `src/services/inventory.ts`; el checkout devuelve 409 si no hay stock |
| ¿Por qué los precios están en centavos? | `docs/CONVENTIONS.md`, sección Dinero |
| ¿Qué tengo que tocar para agregar un cupón nuevo? | El array `COUPONS` y sus tests |

**Resultados reales con Ollama:**
- *Costo de envío* (7B): ✅ correcta, 5,8 s.
- *Dos clientes al mismo tiempo* (14B): ✅ correcta y cita `inventory.ts` y `checkout.ts` con líneas, ~10 s.
  Con 7B: correcta en lo general, más vaga, 7,4 s.

> Nota: con modelos locales conviene preguntar desde la carpeta del paquete (`storefront-demo/`) y no
> desde la raíz: menos archivos = respuestas más precisas y rápidas.

---

## 4. Comparar proveedores con el mismo caso

Corré el mismo cambio con cada IA, sin editar el `.env`:

```powershell
guardian review --use local --model qwen2.5-coder:7b
guardian review --use local --model qwen2.5-coder:14b
guardian review --use ia
```

Fijate en la línea `IA: ...` del reporte: muestra proveedor, modelo y tokens usados.

### Qué mirar al comparar

| Pregunta | Dónde verlo |
|---|---|
| ¿Encontró el bug real? | Sección "Hallazgos" |
| ¿Inventó problemas? (falsos positivos) | Hallazgos que no tienen sentido para el cambio |
| ¿Citó la línea correcta? | `archivo:línea` de cada hallazgo |
| ¿Cuánto tardó? | Línea "Tiempos", etapa "Revisión IA" |
| ¿Cuánto "costó"? | Línea "IA: ... tokens de entrada / de salida" |

---

## 5. Para la entrevista: qué conclusión sacar

- **Lo determinístico es igual en todos los proveedores** (secretos, lint, tipos, tests): es la base confiable.
- **La calidad de la IA depende del modelo.** Gemini encontró los 2 bugs del 02; el 14B local, 1; el 7B, ninguno.
- **El modelo local es rápido con buena GPU** (2 a 16 s) y el código **no sale de la máquina**.
- **Trade-off:** privacidad total con algo menos de precisión (Ollama 14B) o máxima precisión con el código
  enviado a un tercero (Gemini). Guardian permite elegir con una línea del `.env`.
- **Mejoras que salieron de probar:** los modelos chicos repetían hallazgos (ahora se deduplican), a veces
  responden `{}` para decir "nada" (ahora se acepta) y en `ask` perdían la pregunta en textos largos
  (ahora se repite al final).
