# Storefront Guardian

Agente de revisión de código para equipos que mantienen tiendas online.

> 🚧 En construcción. El README completo llega en la fase final.

## Probar la tienda de ejemplo

```bash
npm install
npm run store   # http://localhost:3000
npm test
```

## Probar el CLI

```bash
npm install
npm link          # deja disponible el comando `guardian`
cd <cualquier repo git>
guardian review   # o: guardian review --json / --base main / --no-llm
```

## Escenarios de demo

```bash
cp .env.example .env    # LLM_PROVIDER=replay: no necesita key
npm run demo -- all
```

Ver [demo/README.md](demo/README.md).

## Falsos positivos

```bash
guardian dismiss G-3f2a1c "motivo"   # se guarda en .guardian/memory.json
```
