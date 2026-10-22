import { randomUUID } from "node:crypto";
import { HttpError } from "../errors.js";
import type { Cart, Customer, Order } from "../types.js";
import type { Catalog } from "./catalog.js";
import { findCoupon } from "./discounts.js";
import type { Inventory } from "./inventory.js";
import { buildLines, calculateTotals } from "./pricing.js";

/**
 * Confirma la compra:
 * 1. valida que el carrito no esté vacío,
 * 2. valida stock (si falta, 409 con el detalle),
 * 3. reserva el stock y calcula los totales finales.
 */
export async function checkout(
  cart: Cart,
  customer: Customer,
  catalog: Catalog,
  inventory: Inventory,
): Promise<Order> {
  if (cart.items.length === 0) {
    throw new HttpError(400, "El carrito está vacío");
  }

  const issues = await inventory.findIssues(cart.items);
  if (issues.length > 0) {
    throw new HttpError(409, "No hay stock suficiente para algunos productos", issues);
  }

  await inventory.reserve(cart.items);

  const lines = buildLines(cart.items, catalog);
  const coupon = cart.couponCode ? findCoupon(cart.couponCode) : null;

  return {
    id: randomUUID(),
    customer,
    lines,
    couponCode: cart.couponCode,
    totals: calculateTotals(lines, coupon),
    createdAt: new Date().toISOString(),
  };
}
