import { describe, expect, it } from "vitest";
import { calculateDiscount, findCoupon, isCouponApplicable } from "../src/services/discounts.js";

describe("findCoupon", () => {
  it("encuentra cupones sin importar mayúsculas ni espacios", () => {
    expect(findCoupon("  bienvenida10 ")?.code).toBe("BIENVENIDA10");
  });

  it("devuelve null si el cupón no existe", () => {
    expect(findCoupon("NOEXISTE")).toBeNull();
  });
});

describe("calculateDiscount", () => {
  it("calcula porcentajes redondeando al centavo", () => {
    expect(calculateDiscount(1005, findCoupon("BIENVENIDA10"))).toBe(101); // 100,5 → 101
  });

  it("aplica montos fijos si se alcanza el mínimo", () => {
    expect(calculateDiscount(3000, findCoupon("AHORRA5"))).toBe(500);
  });

  it("no descuenta si no se alcanza el mínimo", () => {
    const coupon = findCoupon("AHORRA5")!;
    expect(isCouponApplicable(coupon, 2999)).toBe(false);
    expect(calculateDiscount(2999, coupon)).toBe(0);
  });

  it("nunca descuenta más que el subtotal", () => {
    expect(calculateDiscount(300, { code: "X", type: "fixed", amountCents: 500 })).toBe(300);
  });

  it("el cupón de envío gratis no descuenta del subtotal", () => {
    expect(calculateDiscount(5000, findCoupon("ENVIOGRATIS"))).toBe(0);
  });

  it("sin cupón no hay descuento", () => {
    expect(calculateDiscount(5000, null)).toBe(0);
  });
});
