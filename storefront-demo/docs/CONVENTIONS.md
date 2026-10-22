# Convenciones de código — Casa Almendra

Estas reglas son obligatorias para todo cambio en la tienda. Las revisiones de
código (humanas o automáticas) las usan como criterio.

## 1. Dinero

- **Todos los montos se representan en centavos enteros** (`priceCents`, `totalCents`).
  Nunca se usan decimales (`19.99`) ni `parseFloat` para calcular precios.
- Solo se divide por 100 **al mostrar** el monto en pantalla (`formatCents`).
- Los porcentajes se redondean con `Math.round` al centavo más cercano.
- Un descuento se aplica **una sola vez**, sobre el subtotal, y nunca puede dejar
  el total en negativo.
- La lógica de precios vive en `src/services/pricing.ts` y `src/services/discounts.ts`.
  Las rutas y el frontend no calculan precios por su cuenta.

## 2. Seguridad

- **Nunca usar `innerHTML`, `outerHTML` ni `insertAdjacentHTML` con datos** que vengan
  del servidor o del usuario (nombres de productos, cupones, direcciones). Usar
  `textContent` o `createElement`.
- **Sin secretos en el código**: API keys, tokens y contraseñas van en variables de
  entorno (`process.env`) y nunca se commitean. El archivo `.env` está en `.gitignore`.
- Los IDs que se interpolan en URLs del frontend se escapan con `encodeURIComponent`.

## 3. API

- **Toda entrada de la API se valida** con zod (`src/validation.ts`) antes de usarla:
  body, parámetros y query.
- Los errores de negocio se lanzan como `HttpError(status, mensaje)`; el middleware
  de errores los convierte en JSON. No se devuelven stack traces al cliente.
- Códigos: 400 datos inválidos, 404 no existe, 409 conflicto de stock,
  422 regla de negocio no cumplida.

## 4. Asincronía

- **Toda función async se llama con `await`** (o se maneja explícitamente su promesa).
  Una promesa "suelta" puede ocultar errores y romper el orden de operaciones,
  por ejemplo vender stock que no existe.
- Los errores de operaciones async se manejan: o se propagan al middleware de
  errores, o se capturan con `try/catch` y se informan al usuario.

## 5. Tests

- Toda lógica de precios, descuentos y stock tiene tests en `tests/`.
- Un cambio que modifica esa lógica agrega o actualiza los tests correspondientes.

## 6. Estilo

- TypeScript en modo `strict`. Sin `any` salvo justificación en un comentario.
- Nombres en inglés en el código; textos para el usuario en español.
- Funciones chicas y puras en `services/`; las rutas solo orquestan.
