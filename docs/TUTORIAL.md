# Tutorial: probá Guardian en tu proyecto en 10 minutos

Este tutorial te lleva paso a paso desde cero hasta tener Guardian revisando tus propios cambios de código. Asume que **nunca viste este proyecto antes**.

---

## Prerrequisitos

Antes de empezar, verificá que tenés instalado:

```bash
node --version   # Debería mostrar v20.x o superior
git --version    # Cualquier versión reciente
```

Si no tenés Node.js 20+, instalalo desde https://nodejs.org (elegí la versión LTS).

---

## Parte 1: Instalación (3 minutos)

### 1.1. Cloná el repositorio

```bash
git clone https://github.com/fabriziocuassolo/Agente-Reviewer.git
cd Agente-Reviewer
```

### 1.2. Instalá las dependencias

```bash
npm install
```

Esto instala todas las librerías necesarias y compila el agente automáticamente.

### 1.3. Hacé que el comando `guardian` esté disponible globalmente

```bash
npm link
```

Ahora podés ejecutar `guardian` desde cualquier directorio.

### 1.4. Configurá el proveedor de LLM

Copiá el archivo de configuración de ejemplo:

```bash
cp .env.example .env
```

Abrí `.env` con tu editor. Por defecto dice:

```
LLM_PROVIDER=replay
```

Esto significa que va a usar respuestas pregrabadas (modo **replay**), que funciona sin API key y sin conexión a internet.

**Para usar otra IA no hace falta tocar el archivo:** agregá `--use` al comando.

```bash
guardian review --use ia      # Gemini, en la nube
guardian review --use local   # Ollama, en tu máquina
guardian ia                   # muestra qué IA está activa y cuáles están listas
```

Si elegís una IA que todavía no configuraste, Guardian te explica paso a paso qué hacer: dónde sacar la key de Gemini o cómo instalar Ollama.

Para este tutorial dejalo en `replay`.

---

## Parte 2: Primera prueba con los escenarios de demo (2 minutos)

Antes de usar Guardian en tu código, probalo con los escenarios incluidos.

```bash
npm run demo -- all
```

Esto ejecuta 4 escenarios sobre una tienda de ejemplo:
1. **01-clean:** un cambio correcto → APROBADO
2. **02-pricing-float:** bugs de precios con flotantes → BLOQUEADO
3. **03-security:** XSS + API key hardcodeada → BLOQUEADO
4. **04-subtle:** falta un `await` → BLOQUEADO

Al final verás un resumen:

```
━━━ Resumen ━━━
✔ 01-clean           APROBADO                 APROBADO             0   1.8 s
✔ 02-pricing-float   BLOQUEADO                BLOQUEADO            3   1.7 s
✔ 03-security        BLOQUEADO                BLOQUEADO            1   1.8 s
✔ 04-subtle          ADVERTENCIA o BLOQUEADO  BLOQUEADO            1   1.8 s

4/4 escenarios con la decisión esperada.
```

En modo **replay** tarda unos 2 segundos por escenario porque usa respuestas pregrabadas.

---

## Parte 3: Usá Guardian en tu propio proyecto (5 minutos)

Ahora vamos a revisar cambios reales en un proyecto tuyo.

### 3.1. Andá a tu proyecto

Abrí otra terminal y navegá a cualquier repositorio git que tengas:

```bash
cd ~/mis-proyectos/mi-app
```

**Importante:** tiene que ser un repositorio git. Si no tenés uno a mano, podés crear uno de prueba:

```bash
mkdir ~/prueba-guardian
cd ~/prueba-guardian
git init
echo "console.log('hola')" > index.js
git add .
git commit -m "initial"
```

### 3.2. Hacé un cambio

Editá cualquier archivo o creá uno nuevo. Por ejemplo:

```bash
echo 'const API_KEY = "clave-de-prueba-123456";' >> index.js
```

(Es un valor inventado: a Guardian le alcanza con ver una variable llamada `API_KEY` con un texto fijo de 8 caracteres o más.)

### 3.3. Ejecutá `guardian review`

```bash
guardian review
```

Vas a ver esto (salida real):

```
🛡  Guardian · revisión de cambios
Comparando: cambios sin commitear contra HEAD (1 archivo/s)

Chequeos determinísticos
  ✖ Secretos                1 ms
  – ESLint               omitido: no se encontró configuración en el proyecto
  – Tipos (TypeScript)   omitido: no se encontró configuración en el proyecto
  – Tests                omitido: no se encontró configuración en el proyecto

Hallazgos (1)
   CRÍTICO  index.js:2 [secretos] G-1a3efa
    Credencial hardcodeada escrita en el código: clav… (22 caracteres). Cualquiera con acceso al repo (o a su historial) puede usarla.
    → Mové el valor a una variable de entorno (process.env) y agregala a .env.example sin el valor real. Si ya se pusheó, considerá la clave comprometida y rotala.

⚠ Se omitió la revisión con IA: los chequeos determinísticos ya encontraron fallos críticos.

Decisión:  BLOQUEADO
  Regla "critico-bloquea": 1 hallazgo crítico (la regla exige 1 o más)

Tiempos: Recolección 138 ms · Chequeos 1 ms · Total 140 ms
```

**¿Qué pasó?**
- El detector de secretos (sin IA) encontró la key escrita en el código. El reporte no la repite entera.
- Es **CRÍTICO**, así que el cambio queda **BLOQUEADO** (exit code 1).
- Como ya está bloqueado, Guardian ni siquiera llama al modelo: ahorra tiempo y cuota.
- Lint, tipos y tests aparecen como "omitidos" porque este proyecto de prueba no los tiene. En un proyecto con `package.json` se detectan solos.

### 3.4. Corregí el problema

Volvé `index.js` a como estaba y hacé otro cambio cualquiera:

```bash
git checkout -- index.js
echo "console.log('chau')" >> index.js
```

Como en modo replay no hay un modelo para revisar tu código, corré solo los chequeos determinísticos:

```bash
guardian review --no-llm
```

Ahora dice **APROBADO**. Si corrés `guardian review` sin `--no-llm` en modo replay, vas a ver **ADVERTENCIA** con la regla `ia-no-disponible`: Guardian no aprueba un cambio que la IA no pudo revisar. Para la revisión completa seguí con la Parte 4.

---

## Parte 4: Activá un proveedor LLM real (solo si querés ver la IA en acción)

El modo **replay** solo sirve para los escenarios de demo. Para revisar tu código real con IA, necesitás un modelo.

### Opción A: Gemini (más rápido, requiere una key gratuita)

1. **Obtené tu API key:** andá a https://aistudio.google.com/apikey
   (Google te da 20 requests gratis por día)

2. **Agregala a `.env`:**
   ```bash
   cd ~/ruta/a/Agente-Reviewer
   ```

   Editá `.env` y cambiá:
   ```
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=tu-key-acá
   ```

3. **Probalo:**
   ```bash
   cd ~/mis-proyectos/mi-app
   guardian review
   ```

Ahora la revisión tarda entre 10 y 60 segundos (según el tamaño del cambio y la demanda del modelo) y el modelo revisa tu código de verdad.

### Opción B: Ollama (modelo local, privado)

1. **Instalá Ollama:** https://ollama.com/download

2. **Descargá el modelo:**
   ```bash
   ollama pull qwen2.5-coder:7b
   ```
   (Son unos 4-5 GB. La primera descarga tarda varios minutos.)

3. **Configurá `.env`:**
   ```bash
   cd ~/ruta/a/Agente-Reviewer
   ```

   Editá `.env`:
   ```
   LLM_PROVIDER=ollama
   OLLAMA_MODEL=qwen2.5-coder:7b
   ```

4. **Probalo:**
   ```bash
   cd ~/mis-proyectos/mi-app
   guardian review
   ```

La primera revisión es más lenta (carga el modelo en memoria). Las siguientes son más rápidas.

---

## Parte 5: Instalá el hook pre-push (opcional, 1 minuto)

Si querés que Guardian revise automáticamente antes de cada push:

```bash
cd ~/mis-proyectos/mi-app
guardian install-hook
```

Ahora cada vez que hagas:

```bash
git push
```

...Guardian revisa **los commits que estás por pushear** (no los cambios sin commitear). Si el resultado es **BLOQUEADO**, el push se cancela y el remoto no se toca.

Si Guardian no está disponible (por ejemplo, moviste la carpeta), el hook avisa y deja pushear: una herramienta de apoyo no debería trabar al equipo. En ese caso reinstalalo con `guardian uninstall-hook` y `guardian install-hook`.

Para saltear el hook una sola vez:

```bash
git push --no-verify
```

Para desinstalar el hook:

```bash
guardian uninstall-hook
```

---

## Parte 6: Configurá tu proyecto (opcional, 5 minutos)

Guardian funciona sin configuración, pero podés personalizarlo.

### 6.1. Creá `.guardian/config.json` en la raíz de tu proyecto

```bash
mkdir -p .guardian
cat > .guardian/config.json <<'EOF'
{
  "baseBranch": "main",
  "gate": {
    "rules": [
      { "name": "critico-bloquea", "severity": "critico", "min": 1, "decision": "BLOQUEADO" },
      { "name": "muchos-altos-bloquean", "severity": "alto", "min": 3, "decision": "BLOQUEADO" },
      { "name": "alto-advierte", "severity": "alto", "min": 1, "decision": "ADVERTENCIA" }
    ]
  }
}
EOF
```

### 6.2. (Opcional) Escribí convenciones en `docs/CONVENTIONS.md`

Guardian usa este archivo para criterios de revisión:

```bash
mkdir -p docs
cat > docs/CONVENTIONS.md <<'EOF'
# Convenciones del proyecto

## 1. Seguridad
- Nunca usar `innerHTML` con datos de usuario (riesgo de XSS).
- Todas las entradas de API se validan con un esquema.
- Sin secretos hardcodeados (API keys, tokens, contraseñas).

## 2. Async/await
- Toda función `async` debe llamarse con `await`.
- No dejar promesas sin capturar.

## 3. Tests
- Toda lógica de negocio nueva debe tener tests.
EOF
```

### 6.3. (Opcional) Creá skills en `.guardian/skills/`

Las skills son checklists de revisión que solo se cargan si los archivos cambiados las activan.

Ejemplo: `.guardian/skills/security.md`

```bash
mkdir -p .guardian/skills
cat > .guardian/skills/security.md <<'EOF'
# Seguridad

- (CRÍTICO) Sin `eval()`, `Function()` o `innerHTML` con datos no confiables.
- (CRÍTICO) Validar toda entrada de API con un esquema (zod, joi, etc).
- (ALTO) Headers de seguridad: `Content-Security-Policy`, `X-Frame-Options`.
- (MEDIO) No logear información sensible (tokens, contraseñas, datos de tarjetas).
EOF
```

Después en `config.json` agregá el mapeo:

```json
{
  "skills": {
    "security": ["**/*.ts", "**/*.js"]
  }
}
```

---

## Resumen: flujo de trabajo diario

Una vez instalado, tu flujo es:

1. **Hacés cambios en tu código.**
2. **Antes de commitear:**
   ```bash
   guardian review
   ```
3. **Si está APROBADO o ADVERTENCIA:** commiteás y pusheás.
4. **Si está BLOQUEADO:** corregís los problemas críticos y repetís.
5. **(Opcional) Si un hallazgo es un falso positivo:**
   ```bash
   guardian dismiss G-abc123 "Este patrón está bien porque..."
   ```

---

## Comandos útiles

```bash
# Revisar cambios
guardian review

# Revisar contra una rama específica
guardian review --base develop

# Salida en JSON (para scripts)
guardian review --json

# Solo chequeos determinísticos (sin IA)
guardian review --no-llm

# Preguntarle sobre el código
guardian ask "¿Dónde se valida la entrada del usuario?"

# Marcar un hallazgo como falso positivo
guardian dismiss G-abc123 "motivo"

# Instalar/desinstalar hook
guardian install-hook
guardian uninstall-hook
```

---

## Preguntas frecuentes

### ¿Funciona en Windows?
Sí. El único requisito es Node.js 20+ y Git.

### ¿Funciona sin conexión a internet?
En modo **replay** sí (solo para los escenarios de demo). Con **Ollama** también (modelo local). Con **Gemini** no (necesita internet).

### ¿Cuánto cuesta?
- **Replay:** gratis, sin límites.
- **Ollama:** gratis, sin límites (pero necesitás ~5 GB de disco y RAM para el modelo).
- **Gemini (capa gratuita):** 20 requests por día gratis. Si agotás la cuota, Guardian sigue funcionando pero sin revisión de IA (solo chequeos determinísticos).

### ¿Es seguro? ¿Envía mi código a algún lado?
- **Replay y Ollama:** el código nunca sale de tu máquina.
- **Gemini:** el código se envía a Google. **Los secretos se redactan antes de enviar** (API keys, tokens, etc). Para código confidencial, usá Ollama o un plan pago de Gemini que no retenga datos.

### ¿Qué pasa si ya tengo un hook pre-push?
`guardian install-hook` solo funciona si no existe un hook. Si ya tenés uno, agregá manualmente `guardian review` a tu script.

### ¿Puedo usarlo en GitLab / Bitbucket?
El CLI funciona igual. La GitHub Action es específica para GitHub, pero el flujo es el mismo: correr `guardian review --json` en el CI y comentar el resultado.

---

## Siguientes pasos

- Leé el [README.md](../README.md) completo para ver todas las opciones de configuración.
- Explorá los [escenarios de demo](../demo/) para entender qué tipo de bugs detecta Guardian.
- Revisá [docs/DECISIONES.md](DECISIONES.md) para entender las decisiones de diseño.

---

**¿Problemas?** Abrí un issue en el repo o escribime.
