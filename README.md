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

## Uso diario (lo más simple)

```bash
guardian                                        # menú: revisar, revisar y corregir, preguntar, elegir IA
guardian "revisá mis cambios con la IA local"   # o decilo en tus palabras
guardian "corregí los errores"
guardian "¿dónde se calcula el envío?"
```

- **La primera vez** aparece un menú para elegir la IA: replay, IA local (modelo chico o grande) o un proveedor (Gemini, Claude, Grok, GPT u otra). Si no está configurada, te explica cómo hacerlo. La elección se guarda; para cambiarla: `guardian ia`.
- **Siempre se avisa** con qué IA se trabaja: `🤖 Usando: IA local · Ollama · qwen2.5-coder:14b`.
- **Corrección automática:** después de revisar, Guardian ofrece corregir. Guarda una copia de cada archivo, corrige, **vuelve a revisar para validar** y te muestra el diff. Elegís: *commit + push*, *deshacer* (todo vuelve exactamente a como estaba) o *dejarlo sin commitear*. Si sigue BLOQUEADO, recomienda deshacer y pide doble confirmación para subir.

---

## Elegir la IA desde la terminal

Por defecto Guardian usa **replay** (respuestas grabadas, sin key ni internet). Para cualquier comando podés elegir otra IA con `--use`:

```bash
guardian review                       # replay (por defecto)
guardian review --use ia              # Gemini, en la nube ("ia" y "gemini" son lo mismo)
guardian review --use local           # Ollama, en tu máquina ("local" y "ollama" son lo mismo)
guardian review --use local --model qwen2.5-coder:14b   # elegir también el modelo
guardian ask "¿cómo se calcula el envío?" --use ia
npm run demo -- all --use local       # también funciona con la demo
guardian ia                           # qué IA está activa y si cada una está lista
```

Si la IA que elegiste no está lista, Guardian **no revisa a medias**: corta y te explica qué hacer.
- **Gemini sin key:** te dice dónde sacarla gratis y dónde pegarla, y te ofrece la IA local.
- **Ollama no instalado, cerrado o sin el modelo:** te da el comando de instalación para tu sistema y el `ollama pull` que falta.

Para cambiar la IA por defecto, editá `LLM_PROVIDER` en el archivo `.env` (`replay`, `gemini`, `ollama` o una IA tuya).

### Agregar cualquier otra IA (ChatGPT, Claude, DeepSeek, Groq, Mistral...)

Sin tocar código: elegí un nombre y agregá estas líneas al `.env`. Apenas las guardás, ya la podés usar con `--use <nombre>` y aparece en `guardian ia`.

```bash
# Cualquier servicio compatible con OpenAI (ChatGPT, DeepSeek, Groq, Mistral, OpenRouter, LM Studio...)
IA_CHATGPT_URL=https://api.openai.com/v1
IA_CHATGPT_KEY=tu-clave
IA_CHATGPT_MODEL=nombre-del-modelo

# Claude (Anthropic): usa su propio formato y no lleva URL (se usa el SDK oficial)
IA_CLAUDE_FORMATO=anthropic
IA_CLAUDE_KEY=tu-clave
IA_CLAUDE_MODEL=claude-opus-5-5
```

```bash
guardian review --use chatgpt
guardian ask "¿qué cupones existen?" --use claude
```

Importante: las suscripciones de chat (ChatGPT Plus, Claude Pro) **no** incluyen acceso por API. Hace falta una API key de la consola para desarrolladores del proveedor, que se paga por uso. La guía completa, con la URL de cada proveedor, está en `guardian ayuda otra-ia`.

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
   (Unos 4-5 GB. Si tu placa de video tiene 12 GB o más, usá `qwen2.5-coder:14b`, unos 9 GB: es bastante más preciso.)

**En `.env`:**
```
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5-coder:7b
```

**Probalo:**
```bash
npm run demo -- 02-pricing-float
```

La primera revisión tarda más (el modelo se carga en memoria). Con una GPU moderna, las siguientes tardan entre 2 y 16 s.

**Calidad medida:** el 14B encontró los bugs del escenario 04 y la mitad del 02; el 7B solo el del 04. Ambos dan falsos positivos en cambios limpios. Gemini fue el más preciso. Detalle y casos para probar en [docs/CASOS-DE-PRUEBA.md](docs/CASOS-DE-PRUEBA.md).

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
| `03-security` | innerHTML con datos de usuario (XSS) + API key hardcodeada | **BLOQUEADO** (secreto y regla fija sin-innerHTML, sin depender de la IA) |
| `04-subtle` | `inventory.reserve()` sin `await` en nueva ruta de compra rápida | **BLOQUEADO** (1 crítico) |

En el modo replay (sin modelo real) tarda ~2 s por escenario. Con Gemini, entre 10 y 60 s según el tamaño del cambio y la demanda del modelo (medido en la capa gratuita).

### 3. Charlá con el código

```bash
cd storefront-demo
guardian chat --use local        # o --use ia (Gemini)
```

```
vos › ¿Cómo se calcula el costo de envío?
guardian › Con calculateShipping en src/services/pricing.ts:31 ...
vos › ¿y dónde se usa esa función?
guardian › En src/services/pricing.ts:45 (calculateTotals) y en los tests de tests/pricing.test.ts ...
```

Recuerda lo hablado, así que podés repreguntar ("¿y eso dónde se usa?"). Para ubicar código, Guardian hace una **búsqueda exacta sin IA** y se la pasa al modelo, para que cite líneas reales en vez de inventarlas. Comandos dentro del chat: `/fuentes`, `/nuevo`, `/salir`. Para una pregunta suelta: `guardian ask "..."`.

*Requiere una IA real (no funciona con replay).*

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

### Enseñarle a Guardian

Guardian no se reentrena: aprende guardando el conocimiento del equipo **en el repo**, y se lo pasa a la IA en cada revisión. Si cambian de modelo (Gemini → Ollama → ChatGPT), lo aprendido sigue.

| Cómo | Para qué | ¿Depende de la IA? |
|---|---|---|
| `guardian aprender "Los precios nunca se calculan en el frontend" --archivos "public/**"` | Criterios en tus palabras | Sí: los modelos grandes los siguen mejor que los chicos |
| `guardian aprender "Sin scripts inline en el HTML" --patron "<script>" --archivos "public/**/*.html"` | **Regla fija**: un patrón que se detecta siempre | **No**: lo detecta cualquier modelo, o sin IA |
| `guardian dismiss <id> "motivo"` | Falsos positivos que no se repiten | Filtro exacto + aviso a la IA |
| `docs/CONVENTIONS.md`, `.guardian/skills/*.md` | Reglas de la empresa y criterios por área | Sí |

`guardian aprender --lista` muestra lo aprendido y `guardian aprender --borrar <n>` borra una regla. Las reglas fijas quedan en `.guardian/config.json` → `"reglas"`, y se pueden editar a mano:

```json
"reglas": [
  { "nombre": "sin-innerHTML", "buscar": "\\.(innerHTML|outerHTML)\\s*=", "archivos": ["public/**"],
    "severidad": "alto", "mensaje": "innerHTML con datos es XSS", "sugerencia": "Usá textContent" }
]
```

**Lo medido:** con modelos locales (Ollama 7B y 14B), una regla escrita en palabras no siempre se aplica. La misma regla como regla fija la detectaron los dos modelos. Por eso conviene que lo que no se puede escapar nunca vaya como regla fija.

### Repositorios con varios proyectos

Si el repo tiene varios proyectos (como este: `agent/` y `storefront-demo/`), Guardian usa la configuración, convenciones, skills y memoria **del proyecto revisado**: el que contiene la carpeta donde estás parado o, si corrés desde la raíz, el que contiene los archivos cambiados. El reporte lo indica en la línea `Proyecto: ...`.

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
3. **Los modelos locales son menos precisos que Gemini:** `qwen2.5-coder:7b` no detecta los bugs más sutiles y ambos (7B y 14B) generan falsos positivos en cambios correctos. Ver [docs/CASOS-DE-PRUEBA.md](docs/CASOS-DE-PRUEBA.md).
4. **Contexto acotado:** se envían el diff, los archivos modificados y sus imports directos, hasta ~80.000 caracteres.
5. **El revisor sugiere correcciones pero no las valida** (no ejecuta el arreglo propuesto).
6. **El chat y `ask` buscan por palabras clave** (más una búsqueda exacta de nombres de código), sin búsqueda semántica. Los modelos locales chicos a veces mezclan usos directos con indirectos.
7. **La IA revisa siempre**, aunque los chequeos fijos ya hayan encontrado algo crítico, para mostrar todos los problemas juntos. Para ahorrar costo con IAs pagas: `"ia": { "saltearSiHayCriticos": true }` en `.guardian/config.json`.
8. **Las reglas aprendidas en palabras dependen del modelo:** los modelos locales no siempre las aplican. Lo crítico conviene declararlo como regla fija (`--patron`).

---

## Comandos disponibles

```bash
guardian --help        # (o "guardian" a secas, o "guardian ayuda")
```
Guía completa en castellano para quien lo usa por primera vez: primeros pasos, cada comando con ejemplos, cómo configurar cada IA, cómo leer el resultado y qué hacer si algo falla. `guardian <comando> --help` muestra el detalle de un comando.

```bash
guardian review [--use replay|gemini|ollama] [--model <nombre>] [--base <ref>] [--json] [--no-llm] [--record] [--pre-push]
```
Revisa los cambios y decide: APROBADO / ADVERTENCIA / BLOQUEADO.
Exit code 1 si está bloqueado. `--pre-push` revisa solo los commits (lo usa el hook).

```bash
guardian ia
```
Muestra qué IA está activa por defecto y si replay, Gemini y Ollama están listas.

```bash
guardian chat [--use ia|local|<tu-ia>] [--model <nombre>]
guardian ask "<pregunta>" [--use ...]   # una pregunta suelta; sin pregunta abre el chat
```

```bash
guardian aprender "<regla>" [--archivos "<patrones>"] [--patron "<regex>"] [--severidad alto]
guardian aprender --lista | --borrar <n>
```
Le enseña reglas a Guardian: en palabras (para la IA) o fijas con `--patron` (se detectan siempre).
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
