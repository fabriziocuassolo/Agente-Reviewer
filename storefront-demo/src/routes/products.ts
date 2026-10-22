import { Router } from "express";
import { HttpError } from "../errors.js";
import type { Catalog } from "../services/catalog.js";
import type { Inventory } from "../services/inventory.js";

export function productsRouter(catalog: Catalog, inventory: Inventory): Router {
  const router = Router();

  // GET /api/products → catálogo completo con el stock actual
  router.get("/", async (_req, res) => {
    const products = await Promise.all(
      catalog.list().map(async (p) => ({ ...p, stock: await inventory.available(p.id) })),
    );
    res.json(products);
  });

  // GET /api/products/:id → detalle de un producto
  router.get("/:id", async (req, res) => {
    const product = catalog.get(req.params.id);
    if (!product) throw new HttpError(404, "Producto no encontrado");
    res.json({ ...product, stock: await inventory.available(product.id) });
  });

  return router;
}
