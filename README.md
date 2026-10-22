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
guardian review   # o: guardian review --json / --base main
```
