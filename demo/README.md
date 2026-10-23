# Escenarios de demo

Cada escenario es un patch que simula el cambio de un desarrollador sobre `storefront-demo/`.

| Escenario | Qué cambia | Quién lo detecta | Decisión esperada |
| --- | --- | --- | --- |
| `01-clean` | Filtro por categoría con validación zod, sin `innerHTML` y con tests | — | APROBADO |
| `02-pricing-float` | Descuento mayorista calculado en pesos con flotantes; el cupón se aplica dos veces | Agente IA (los tests no cubren compras de 10+ unidades) | BLOQUEADO |
| `03-security` | Tarjetas armadas con `innerHTML` (XSS) y API key hardcodeada | Chequeo de secretos y regla fija `sin-innerHTML` (determinísticos), más la IA | BLOQUEADO |
| `04-subtle` | Nueva ruta "comprar ahora" que reserva stock sin `await` | Agente IA (compila, pasa lint y tests) | ADVERTENCIA o BLOQUEADO |

```bash
npm run demo -- all                 # todos, con resumen
npm run demo -- 02-pricing-float    # uno solo
npm run demo -- all --record        # regrabar con el proveedor real del .env
```

La copia de trabajo queda en `.demo-work/<escenario>`, ignorada por git: podés entrar ahí
y seguir probando (`cd .demo-work/04-subtle && guardian review`).

`recordings/` tiene respuestas reales de Gemini que usa `LLM_PROVIDER=replay`.
`03-security` todavía no tiene grabación de la IA (hasta la versión anterior, el secreto bloqueaba antes de llamarla): regrabá con `npm run demo -- all --record --use gemini`.
