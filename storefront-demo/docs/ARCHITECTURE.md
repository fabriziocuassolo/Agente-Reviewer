# Arquitectura — Casa Almendra

Tienda online mínima: un servidor Express en TypeScript que expone una API JSON
y sirve un frontend en HTML, CSS y JavaScript vanilla.

```
storefront-demo/
├── data/products.json     Catálogo inicial (precios en centavos, stock)
├── public/                Frontend estático (index.html, styles.css, app.js)
├── src/
│   ├── server.ts          Punto de entrada: levanta el puerto
│   ├── app.ts             Arma la app de Express (rutas + middleware de errores)
│   ├── validation.ts      Schemas zod de todas las entradas de la API
│   ├── errors.ts          HttpError
│   ├── routes/            Capa HTTP: valida, llama a servicios y responde
│   │   ├── products.ts
│   │   └── carts.ts       Carrito, cupón y checkout
│   └── services/          Lógica de negocio, sin dependencias de Express
│       ├── catalog.ts     Catálogo de solo lectura
│       ├── inventory.ts   Stock en memoria (métodos async)
│       ├── carts.ts       Carritos en memoria
│       ├── pricing.ts     Subtotal, envío y totales
│       ├── discounts.ts   Cupones y cálculo de descuentos
│       └── checkout.ts    Valida stock, reserva y crea la orden
└── tests/                 Vitest: precios, descuentos, stock y checkout
```

## API

| Método | Ruta                                   | Descripción                        |
| ------ | -------------------------------------- | ---------------------------------- |
| GET    | `/api/products`                        | Lista de productos con stock       |
| GET    | `/api/products/:id`                    | Detalle de un producto             |
| POST   | `/api/carts`                           | Crea un carrito                    |
| GET    | `/api/carts/:cartId`                   | Carrito con líneas y totales       |
| POST   | `/api/carts/:cartId/items`             | Agrega `{ productId, quantity }`   |
| PATCH  | `/api/carts/:cartId/items/:productId`  | Cambia la cantidad (0 = quitar)    |
| DELETE | `/api/carts/:cartId/items/:productId`  | Quita el producto                  |
| POST   | `/api/carts/:cartId/coupon`            | Aplica `{ code }`                  |
| DELETE | `/api/carts/:cartId/coupon`            | Quita el cupón                     |
| POST   | `/api/carts/:cartId/checkout`          | Confirma `{ name, email, address }` |

## Flujo de checkout

1. La ruta valida los datos del cliente con zod.
2. `checkout()` verifica que el carrito no esté vacío.
3. Pide a `Inventory` los ítems sin stock suficiente; si hay alguno, responde 409.
4. Reserva el stock (`await inventory.reserve`).
5. Calcula los totales con `pricing.calculateTotals` y devuelve la orden.

## Decisiones

- **Sin base de datos**: catálogo en JSON y estado en memoria. Al reiniciar el
  servidor se pierden carritos y se repone el stock.
- **Servicios sin Express**: la lógica de negocio se testea sin levantar un servidor.
- **`Inventory` es async** aunque hoy trabaje en memoria, para que el código ya esté
  preparado para una base de datos real.
