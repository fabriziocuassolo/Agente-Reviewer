import type { Product } from "../types.js";
// Se importa (en vez de leerlo con fs) para que el JSON viaje dentro del paquete al desplegar
// en plataformas serverless como Vercel, que descartan los archivos que no se importan.
import products from "../../data/products.json" with { type: "json" };

/** Devuelve una copia del catálogo (cada instancia de la app arranca con su propio estado). */
export function loadProducts(): Product[] {
  return structuredClone(products) as Product[];
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
