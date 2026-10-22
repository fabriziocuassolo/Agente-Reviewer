# Skill: backend Express + TypeScript

## Qué revisar

- **Promesas sin `await`.** Toda llamada a un método async (`inventory.*`, `fetch`, servicios
  externos) debe esperarse o manejarse explícitamente. Una promesa "suelta" significa que:
  - la respuesta HTTP puede salir antes de que la operación termine,
  - si la promesa falla, el error no llega al middleware y puede tirar abajo el proceso
    (unhandled rejection).
  Ojo: TypeScript y ESLint (sin reglas con tipos) NO detectan esto.
- **Validación de entrada.** Body, params y query pasan por un schema zod de
  `src/validation.ts` antes de usarse. Nada de `req.body.x` directo.
- **Errores de negocio** con `HttpError(status, mensaje)` y el código correcto
  (400, 404, 409, 422). Nunca devolver stack traces ni mensajes internos.
- **Rutas finas.** La lógica de negocio va en `src/services/`; si una ruta nueva duplica lógica
  de un servicio existente (ej: arma una orden a mano en vez de usar `checkout()`), señalalo.
- **Rutas nuevas sin tests** de su lógica de negocio → `medio`.

## Severidad sugerida

- Promesa sin await que afecta stock, dinero o datos → `critico`
- Entrada sin validar → `alto`
- Lógica duplicada en una ruta → `medio`
