import type { CartItem, Product } from "../types.js";

export interface StockIssue {
  productId: string;
  requested: number;
  available: number;
}

/**
 * Stock en memoria.
 * Los métodos son async a propósito: simulan el acceso a una base de datos
 * o a un servicio externo, así que quien los use DEBE hacer await.
 */
export class Inventory {
  private readonly stock: Map<string, number>;

  constructor(products: Pick<Product, "id" | "stock">[]) {
    this.stock = new Map(products.map((p) => [p.id, p.stock]));
  }

  async available(productId: string): Promise<number> {
    return this.stock.get(productId) ?? 0;
  }

  /** Devuelve los ítems que no tienen stock suficiente (lista vacía = todo OK). */
  async findIssues(items: CartItem[]): Promise<StockIssue[]> {
    const issues: StockIssue[] = [];
    for (const item of items) {
      const available = await this.available(item.productId);
      if (item.quantity > available) {
        issues.push({ productId: item.productId, requested: item.quantity, available });
      }
    }
    return issues;
  }

  /** Descuenta el stock. Falla si algún ítem no alcanza, sin modificar nada. */
  async reserve(items: CartItem[]): Promise<void> {
    const issues = await this.findIssues(items);
    if (issues.length > 0) {
      throw new Error(`Stock insuficiente para: ${issues.map((i) => i.productId).join(", ")}`);
    }
    for (const item of items) {
      const current = this.stock.get(item.productId) ?? 0;
      this.stock.set(item.productId, current - item.quantity);
    }
  }
}
