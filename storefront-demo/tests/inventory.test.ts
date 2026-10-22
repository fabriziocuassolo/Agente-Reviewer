import { describe, expect, it } from "vitest";
import { Catalog } from "../src/services/catalog.js";
import { checkout } from "../src/services/checkout.js";
import { Inventory } from "../src/services/inventory.js";
import type { Cart, Product } from "../src/types.js";

const products: Product[] = [
  { id: "a", name: "A", description: "", category: "t", priceCents: 1000, stock: 2, emoji: "", color: "" },
  { id: "b", name: "B", description: "", category: "t", priceCents: 2500, stock: 0, emoji: "", color: "" },
];

const customer = { name: "Ana", email: "ana@example.com", address: "Calle Falsa 123" };

function cart(items: Cart["items"], couponCode: string | null = null): Cart {
  return { id: "cart-1", items, couponCode };
}

describe("Inventory", () => {
  it("reporta los ítems sin stock suficiente", async () => {
    const inventory = new Inventory(products);
    const issues = await inventory.findIssues([
      { productId: "a", quantity: 3 },
      { productId: "b", quantity: 1 },
    ]);
    expect(issues).toEqual([
      { productId: "a", requested: 3, available: 2 },
      { productId: "b", requested: 1, available: 0 },
    ]);
  });

  it("reserve descuenta el stock", async () => {
    const inventory = new Inventory(products);
    await inventory.reserve([{ productId: "a", quantity: 2 }]);
    expect(await inventory.available("a")).toBe(0);
  });

  it("reserve falla sin modificar nada si algo no alcanza", async () => {
    const inventory = new Inventory(products);
    await expect(
      inventory.reserve([
        { productId: "a", quantity: 1 },
        { productId: "b", quantity: 1 },
      ]),
    ).rejects.toThrow("Stock insuficiente");
    expect(await inventory.available("a")).toBe(2);
  });
});

describe("checkout", () => {
  const catalog = new Catalog(products);

  it("crea la orden, calcula totales y descuenta stock", async () => {
    const inventory = new Inventory(products);
    const order = await checkout(cart([{ productId: "a", quantity: 2 }], "BIENVENIDA10"), customer, catalog, inventory);
    expect(order.totals).toEqual({ subtotalCents: 2000, discountCents: 200, shippingCents: 499, totalCents: 2299 });
    expect(await inventory.available("a")).toBe(0);
  });

  it("rechaza con 409 si no hay stock", async () => {
    const inventory = new Inventory(products);
    await expect(checkout(cart([{ productId: "b", quantity: 1 }]), customer, catalog, inventory)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("rechaza un carrito vacío", async () => {
    const inventory = new Inventory(products);
    await expect(checkout(cart([]), customer, catalog, inventory)).rejects.toMatchObject({ status: 400 });
  });

  it("dos compras seguidas no pueden vender más stock del que hay", async () => {
    const inventory = new Inventory(products);
    await checkout(cart([{ productId: "a", quantity: 2 }]), customer, catalog, inventory);
    await expect(checkout(cart([{ productId: "a", quantity: 1 }]), customer, catalog, inventory)).rejects.toMatchObject({
      status: 409,
    });
  });
});
