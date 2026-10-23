# Storefront Guardian

**Revisión de código asistida por IA para equipos de e-commerce**

Guardian es un agente autónomo que revisa tus cambios de código antes de que los pushees, detectando bugs de negocio (precios, stock, seguridad) que los linters y tests no ven. Se ejecuta desde la terminal de tu IDE, lee el código directamente del repo y aprende de las decisiones del equipo sin necesidad de fine-tuning.

---

## ¿Qué problema resuelve?

En equipos que mantienen tiendas online, las revisiones de código son lentas e inconsistentes: cada reviewer tiene sus propios criterios, los bugs sutiles (descuentos aplicados dos veces, validaciones faltantes, `await` olvidados) pasan desapercibidos y se detectan tarde, en QA o peor, en producción.

Guardian actúa como **un revisor senior automatizado** que:
- Revisa *cada* cambio con los mismos criterios (las convenciones del proyecto).
- Detecta problemas de lógica de negocio que escapan a herramientas estáticas.
- Decide si el cambio está listo para avanzar: **APROBADO** / **ADVERTENCIA** / **BLOQUEADO**.
- Aprende de los falsos positivos que el equipo descarta (memoria compartida).

**Cuándo corre:**
Antes del push (hook `pre-push` opcional) y en cada pull request (GitHub Action), así los problemas se detectan lo más temprano posible.

---

## Requisitos

- **Node.js 20+**
- **Git**
- Un proveedor de LLM (elegí uno):
  - **Replay** (sin key, respuestas pregrabadas) → para probar sin instalar nada.
  - **Ollama** (local, gratis, privado) → para código confidencial.
  - **Gemini** (Google AI Studio, capa gratuita) → para empezar rápido con una key.

---

## Instalación

```bash
git clone https://github.com/fabriziocuassolo/Agente-Reviewer.git
cd Agente-Reviewer
npm install
npm link
```

El último comando deja disponible el comando `guardian` globalmente.

Ahora copiá `.env.example` a `.env`:
```bash
cp .env.example .env
```

---

## Tres caminos para probar (de menor a mayor esfuerzo)

### A) Replay (sin key ni red)

El modo más rápido. Usa respuestas pregrabadas de Gemini.

**En `.env`:**
```
LLM_PROVIDER=replay
```

**Probalo:**
```bash
npm run demo -- all
```

Ejecuta los 4 escenarios de prueba (cambio limpio, bugs de precios, XSS + secreto, `await` faltante) y muestra si la decisión fue la esperada. Todo en modo local, sin llamadas al modelo.

**Limitación:** solo funciona con los escenarios de demo. Para revisar tu propio código necesitás un proveedor real.

---

### B) Ollama (local, sin key)

Modelo en tu máquina. Privado y gratis, pero más lento en CPU.

1. **Instalá Ollama:** https://ollama.com/download
2. **Descargá el modelo:**
   ```bash
   ollama pull qwen2.5-coder:7b
   ```
   (Unos 4-5 GB. Podés usar otro modelo compatible cambiando `OLLAMA_MODEL` en `.env`.)

**En `.env`:**
```
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5-coder:7b
```

**Probalo:**
```bash
npm run demo -- 02-pricing-float
```

La primera revisión tarda más (el modelo se carga en memoria). Las siguientes son más rápidas.

---

### C) Gemini (Google AI Studio, con key gratuita)

El camino más simple para tener un modelo rápido en la nube.

1. **Obtené tu API key:** https://aistudio.google.com/apikey
   (Google te da 20 requests por día en la capa gratuita.)
2. **Ponela en `.env`:**
   ```
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=tu-key-acá
   ```

**Probalo:**
```bash
npm run demo -- 04-subtle
```

Modelo por defecto: `gemini-3.6-flash`. Podés cambiarlo con `GEMINI_MODEL` (ver modelos disponibles en https://ai.google.dev/gemini-api/docs/models).

---

## Recorrido guiado

### 1. Corré la tienda de ejemplo

```bash
npm run store
```

Abrí http://localhost:3000. Es una tienda sencilla con productos, carrito, cupones y checkout. Probá el cupón `BIENVENIDA10`.

### 2. Revisá los escenarios de demo

```bash
npm run demo -- all
```

Cada escenario aplica un cambio sobre la tienda y ejecuta `guardian review`:

| Escenario | Cambio | Decisión esperada |
|-----------|--------|-------------------|
| `01-clean` | Filtro por categoría con validación y tests | **APROBADO** |
| `02-pricing-float` | Descuento mayorista con flotantes + cupón aplicado dos veces | **BLOQUEADO** (2 críticos) |
| `03-security` | innerHTML con datos de usuario (XSS) + API key hardcodeada | **BLOQUEADO** (secreto, sin IA) |
| `04-subtle` | `inventory.reserve()` sin `await` en nueva ruta de compra rápida | **BLOQUEADO** (1 crítico) |

En el modo replay (sin modelo real) tarda ~2 s por escenario. Con Gemini, entre 10 y 60 s según el tamaño del cambio y la demanda del modelo (medido en la capa gratuita).

### 3. Preguntale sobre el código

```bash
guardian ask "¿Cómo se calculan los descuentos con cupones?"
```

Te responde citando `archivo:línea`. Útil para onboarding o cuando no sabés por dónde empezar.

*Requiere un proveedor LLM (no funciona con replay).*

### 4. Instalá el hook pre-push

Desde el repo de la tienda (o cualquier repo tuyo):
```bash
guardian install-hook
```

Ahora, antes de cada `git push`, Guardian revisa **los commits que se van a pushear** (`guardian review --pre-push`, que ignora los cambios sin commitear). Si está BLOQUEADO, el push se cancela. Si Guardian no está disponible, el hook avisa y deja pushear. Para saltearlo una vez:
```bash
git push --no-verify
```

Para desinstalarlo:
```bash
guardian uninstall-hook
```

---

## Cómo usarlo en tu proyecto

1. **Desde la raíz de tu repo:**
   ```bash
   guardian review
   ```

   Esto revisa tus cambios sin commitear (contra HEAD) o, si estás en una rama, los commits de la rama contra `main`.

2. **Opcional: creá `.guardian/config.json`**
   Configurá las reglas del gate, los comandos a ejecutar (lint, tests, tipos) y el mapeo de skills:
   ```json
   {
     "baseBranch": "main",
     "gate": {
       "rules": [
         { "name": "critico-bloquea", "severity": "critico", "min": 1, "decision": "BLOQUEADO" },
         { "name": "muchos-altos-bloquean", "severity": "alto", "min": 3, "decision": "BLOQUEADO" },
         { "name": "alto-advierte", "severity": "alto", "min": 1, "decision": "ADVERTENCIA" }
       ]
     },
     "skills": {
       "security": ["**/*.ts", "**/*.js"],
       "pricing": ["**/pricing.ts", "**/discounts.ts"]
     }
   }
   ```

3. **Opcional: escribí skills en `.guardian/skills/*.md`**
   Por ejemplo, `.guardian/skills/pricing.md`:
   ```markdown
   # Precios y descuentos

   - (CRÍTICO) Todos los montos se representan en centavos enteros.
   - (CRÍTICO) Nunca usar decimales ni `parseFloat` para cálculos de precio.
   - (CRÍTICO) Los descuentos se aplican UNA SOLA VEZ.
   - (ALTO) Todo precio o descuento nuevo debe tener tests.
   ```

   Solo se cargan las skills que corresponden a los archivos cambiados (según el mapeo en `config.json`).

4. **Opcional: agregá `.guardianignore`**
   Archivos que nunca se envían al modelo (sintaxis de `.gitignore`):
   ```
   data/
   coverage/
   *.log
   ```

   Por defecto ya se excluyen: `.env*`, `node_modules`, `dist`, binarios y lockfiles.

---

## Configuración

Todo es opcional: sin configuración, Guardian usa valores por defecto razonables.

| Archivo (en el repo revisado) | Para qué | ¿Se commitea? |
|---|---|---|
| `.guardian/config.json` | Rama base, comandos de lint/tipos/tests, reglas del gate, tamaño del contexto, mapeo de skills | Sí |
| `.guardian/skills/*.md` | Criterios de revisión por área (precios, seguridad, frontend...) | Sí |
| `.guardian/memory.json` | Falsos positivos descartados con `guardian dismiss` | Sí (es conocimiento del equipo) |
| `.guardian/last-review.json` | Último reporte, lo usa `dismiss` | No |
| `.guardianignore` | Archivos que nunca se envían al modelo | Sí |
| `docs/CONVENTIONS.md` | Convenciones del proyecto que el revisor usa como criterio | Sí |

Ejemplo completo de `config.json` (es el que usa la tienda de ejemplo, en [storefront-demo/.guardian/config.json](storefront-demo/.guardian/config.json)):

```json
{
  "baseBranch": "main",
  "checks": {
    "lint": "npm run lint --silent",
    "typecheck": "npm run typecheck --silent",
    "test": "npm test --silent",
    "timeoutMs": 120000
  },
  "gate": {
    "rules": [
      { "name": "critico-bloquea", "severity": "critico", "min": 1, "decision": "BLOQUEADO" },
      { "name": "muchos-altos-bloquean", "severity": "alto", "min": 3, "decision": "BLOQUEADO" },
      { "name": "alto-advierte", "severity": "alto", "min": 1, "decision": "ADVERTENCIA" },
      { "name": "medio-advierte", "severity": "medio", "min": 1, "decision": "ADVERTENCIA" }
    ]
  },
  "context": { "maxChars": 80000 },
  "skills": {
    "ecommerce-pricing": ["src/services/pricing.ts", "src/services/discounts.ts"],
    "security": ["src/**", "public/**"]
  }
}
```

- `checks.lint` / `typecheck` / `test`: un comando, `null` para desactivarlo, o se omite para autodetectarlo desde `package.json`.
- `gate.rules`: las reglas de BLOQUEADO se evalúan antes que las de ADVERTENCIA; la primera que se cumple decide.
- `skills`: nombre de la skill → patrones de archivos (sintaxis de `.gitignore`). Solo se carga si el cambio toca alguno.

### Memoria (`.guardian/memory.json`)

`guardian dismiss <id> "<motivo>"` guarda el hallazgo descartado. En las próximas revisiones:
1. ese hallazgo no se muestra ni cuenta para la decisión;
2. se le pasa al modelo como "excepción conocida", para que no repita el mismo criterio.

No se pueden descartar fallos de lint, tipos o tests: se corrigen o se ajusta el comando.

---

## GitHub Action

[.github/workflows/guardian.yml](.github/workflows/guardian.yml) corre `guardian review --json` en cada pull request de este repo, publica (o actualiza) un comentario con la decisión y los hallazgos, y marca el check en rojo si el resultado es BLOQUEADO.

Para activarla: **Settings → Secrets and variables → Actions → New repository secret** con `GEMINI_API_KEY`. Sin la key la Action igual corre, con los chequeos determinísticos.

---

## Privacidad

- **Ollama:** el código nunca sale de tu máquina.
- **Gemini, capa gratuita:** según los términos de Google, lo que se envía puede usarse para mejorar sus productos. **Con código real de una empresa usá Ollama o un plan pago sin retención de datos.**
- **Replay:** no envía nada a la red.
- En todos los casos, antes de enviar código Guardian: redacta lo que parezca un secreto (`[SECRETO REDACTADO]`), nunca envía `.env*`, `node_modules`, `dist`, binarios ni lockfiles, y respeta `.guardianignore`.

---

## Limitaciones conocidas

1. **Cuota gratuita de Gemini:** unas 20 revisiones por día y por modelo. Si se agota, Guardian sigue con los chequeos determinísticos y la decisión queda como mucho en ADVERTENCIA (regla `ia-no-disponible`).
2. **Replay solo sirve para los escenarios de demo.** Para revisar código propio hace falta Gemini u Ollama.
3. **Ollama no fue probado en la máquina de desarrollo** (está implementado con la API documentada).
4. **Contexto acotado:** se envían el diff, los archivos modificados y sus imports directos, hasta ~80.000 caracteres.
5. **El revisor sugiere correcciones pero no las valida** (no ejecuta el arreglo propuesto).
6. **`ask` busca por palabras clave**, sin búsqueda semántica ni memoria entre preguntas.
7. Si en el chequeo determinístico aparece un fallo crítico (por ejemplo, un secreto), no se llama al LLM: otros problemas del mismo cambio aparecen recién en la siguiente revisión.

---

## Comandos disponibles

```bash
guardian review [--base <ref>] [--json] [--no-llm] [--record] [--pre-push]
```
Revisa los cambios y decide: APROBADO / ADVERTENCIA / BLOQUEADO.
Exit code 1 si está bloqueado. `--pre-push` revisa solo los commits (lo usa el hook).

```bash
guardian ask "<pregunta>"
```
Responde citando archivo:línea. Requiere un LLM configurado.

```bash
guardian dismiss <id> "<motivo>"
```
Marca un hallazgo como falso positivo y lo guarda en la memoria.

```bash
guardian install-hook
```
Instala el hook pre-push que ejecuta `guardian review` antes de cada push.

```bash
guardian uninstall-hook
```
Desinstala el hook pre-push.

---

## Licencia

MIT

---

Diseñado para el reto técnico de Full Stack Engineer en IA Agéntica.
