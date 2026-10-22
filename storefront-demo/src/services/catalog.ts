import { readFileSync } from "node:fs";
import type { Product } from "../types.js";

const DATA_FILE = new URL("../../data/products.json", import.meta.url);

/** Lee el catálogo desde el JSON. Se usa una sola vez al iniciar la app. */
export function loadProducts(): Product[] {
  return JSON.parse(readFileSync(DATA_FILE, "utf8")) as Product[];
}

/** Catálogo de solo lectura. El stock vivo lo maneja Inventory. */
export class Catalog {
  private readonly byId: Map<string, Product>;

  constructor(private readonly products: Product[]) {
    this.byId = new Map(products.map((p) => [p.id, p]));
  }

  list(): Product[] {
    return this.products;
  }

  get(id: string): Product | undefined {
    return this.byId.get(id);
  }
}
