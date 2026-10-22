export type Coupon =
  | { code: string; type: "percent"; percent: number; minSubtotalCents?: number }
  | { code: string; type: "fixed"; amountCents: number; minSubtotalCents?: number }
  | { code: string; type: "free_shipping"; minSubtotalCents?: number };

// Cupones vigentes. En una tienda real vendrían de una base de datos.
export const COUPONS: Coupon[] = [
  { code: "BIENVENIDA10", type: "percent", percent: 10 },
  { code: "AHORRA5", type: "fixed", amountCents: 500, minSubtotalCents: 3000 },
  { code: "ENVIOGRATIS", type: "free_shipping" },
];

/** Busca un cupón por código, sin distinguir mayúsculas. */
export function findCoupon(code: string): Coupon | null {
  const normalized = code.trim().toUpperCase();
  return COUPONS.find((c) => c.code === normalized) ?? null;
}

/** Indica si el cupón puede usarse con este subtotal. */
export function isCouponApplicable(coupon: Coupon, subtotalCents: number): boolean {
  return subtotalCents >= (coupon.minSubtotalCents ?? 0);
}

/**
 * Monto a descontar, en centavos enteros.
 * - Los porcentajes se redondean al centavo más cercano.
 * - El descuento nunca supera el subtotal (el total no puede ser negativo).
 */
export function calculateDiscount(subtotalCents: number, coupon: Coupon | null): number {
  if (!coupon || !isCouponApplicable(coupon, subtotalCents)) return 0;

  let discount = 0;
  if (coupon.type === "percent") {
    discount = Math.round((subtotalCents * coupon.percent) / 100);
  } else if (coupon.type === "fixed") {
    discount = coupon.amountCents;
  }
  return Math.min(discount, subtotalCents);
}
