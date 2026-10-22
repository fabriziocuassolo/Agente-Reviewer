import type { CartItem, CartLine, Totals } from "../types.js";
import type { Catalog } from "./catalog.js";
import type { Coupon } from "./discounts.js";
import { calculateDiscount } from "./discounts.js";

// Envío: gratis a partir de $50, si no cuesta $4,99. Todo en centavos.
export const FREE_SHIPPING_THRESHOLD_CENTS = 5000;
export const SHIPPING_COST_CENTS = 499;

/** Resuelve los ítems del carrito contra el catálogo. Ignora productos inexistentes. */
export function buildLines(items: CartItem[], catalog: Catalog): CartLine[] {
  const lines: CartLine[] = [];
  for (const item of items) {
    const product = catalog.get(item.productId);
    if (!product) continue;
    lines.push({
      productId: product.id,
      name: product.name,
      unitPriceCents: product.priceCents,
      quantity: item.quantity,
      lineTotalCents: product.priceCents * item.quantity,
    });
  }
  return lines;
}

export function calculateSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
}

export function calculateShipping(subtotalCents: number, coupon: Coupon | null): number {
  if (subtotalCents === 0) return 0;
  if (coupon?.type === "free_shipping") return 0;
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_COST_CENTS;
}

/**
 * Calcula los totales del carrito.
 * El descuento se aplica UNA sola vez sobre el subtotal; el envío se calcula
 * sobre el subtotal original (un cupón no te hace perder el envío gratis).
 */
export function calculateTotals(lines: CartLine[], coupon: Coupon | null): Totals {
  const subtotalCents = calculateSubtotal(lines);
  const discountCents = calculateDiscount(subtotalCents, coupon);
  const shippingCents = calculateShipping(subtotalCents, coupon);
  return {
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents: subtotalCents - discountCents + shippingCents,
  };
}
