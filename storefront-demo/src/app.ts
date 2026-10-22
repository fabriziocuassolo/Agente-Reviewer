import express, { type NextFunction, type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { HttpError } from "./errors.js";
import { cartsRouter } from "./routes/carts.js";
import { productsRouter } from "./routes/products.js";
import { CartStore } from "./services/carts.js";
import { Catalog, loadProducts } from "./services/catalog.js";
import { Inventory } from "./services/inventory.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

/** Arma la app de Express. Separado de server.ts para poder testearla sin abrir un puerto. */
export function createApp() {
  const products = loadProducts();
  const catalog = new Catalog(products);
  const inventory = new Inventory(products);
  const carts = new CartStore();

  const app = express();
  app.use(express.json({ limit: "10kb" }));
  app.use(express.static(PUBLIC_DIR));

  app.use("/api/products", productsRouter(catalog, inventory));
  app.use("/api/carts", cartsRouter(carts, catalog, inventory));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
  });

  // Middleware de errores: Express 5 captura también los errores de handlers async.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  });

  return app;
}
