import { describe, expect, it } from "vitest";
import { Catalog } from "../src/services/catalog.js";
import { findCoupon } from "../src/services/discounts.js";
import {
  buildLines,
  calculateShipping,
  calculateTotals,
  FREE_SHIPPING_THRESHOLD_CENTS,
  SHIPPING_COST_CENTS,
} from "../src/services/pricing.js";
import type { Product } from "../src/types.js";

function product(id: string, priceCents: number): Product {
  return { id, name: id, description: "", category: "test", priceCents, stock: 10, emoji: "", color: "" };
}

const catalog = new Catalog([product("a", 1850), product("b", 4290), product("c", 333)]);

describe("buildLines", () => {
  it("resuelve precio y total de cada línea en centavos", () => {
    const lines = buildLines([{ productId: "a", quantity: 3 }], catalog);
    expect(lines).toEqual([
      { productId: "a", name: "a", unitPriceCents: 1850, quantity: 3, lineTotalCents: 5550 },
    ]);
  });

  it("ignora productos que no existen en el catálogo", () => {
    expect(buildLines([{ productId: "zzz", quantity: 1 }], catalog)).toEqual([]);
  });
});

describe("calculateShipping", () => {
  it("cobra envío por debajo del umbral", () => {
    expect(calculateShipping(FREE_SHIPPING_THRESHOLD_CENTS - 1, null)).toBe(SHIPPING_COST_CENTS);
  });

  it("es gratis a partir del umbral", () => {
    expect(calculateShipping(FREE_SHIPPING_THRESHOLD_CENTS, null)).toBe(0);
  });

  it("es gratis con el cupón de envío gratis", () => {
    expect(calculateShipping(1000, findCoupon("ENVIOGRATIS"))).toBe(0);
  });

  it("no cobra envío a un carrito vacío", () => {
    expect(calculateShipping(0, null)).toBe(0);
  });
});

describe("calculateTotals", () => {
  it("suma subtotal y envío sin cupón", () => {
    const lines = buildLines([{ productId: "a", quantity: 1 }], catalog);
    expect(calculateTotals(lines, null)).toEqual({
      subtotalCents: 1850,
      discountCents: 0,
      shippingCents: SHIPPING_COST_CENTS,
      totalCents: 1850 + SHIPPING_COST_CENTS,
    });
  });

  it("aplica el descuento una sola vez", () => {
    const lines = buildLines([{ productId: "b", quantity: 2 }], catalog); // 8580
    const totals = calculateTotals(lines, findCoupon("BIENVENIDA10"));
    expect(totals.discountCents).toBe(858);
    expect(totals.totalCents).toBe(8580 - 858);
  });

  it("mantiene todos los montos como enteros (sin errores de punto flotante)", () => {
    // 3 x 333 = 999; 10% = 99,9 → se redondea a 100 centavos
    const lines = buildLines([{ productId: "c", quantity: 3 }], catalog);
    const totals = calculateTotals(lines, findCoupon("BIENVENIDA10"));
    for (const value of Object.values(totals)) {
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(totals.totalCents).toBe(999 - 100 + SHIPPING_COST_CENTS);
  });
});
