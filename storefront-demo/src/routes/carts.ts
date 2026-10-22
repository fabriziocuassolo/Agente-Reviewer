import { Router, type Request } from "express";
import { HttpError } from "../errors.js";
import type { CartStore } from "../services/carts.js";
import type { Catalog } from "../services/catalog.js";
import { checkout } from "../services/checkout.js";
import { findCoupon, isCouponApplicable } from "../services/discounts.js";
import type { Inventory } from "../services/inventory.js";
import { buildLines, calculateSubtotal, calculateTotals } from "../services/pricing.js";
import type { Cart } from "../types.js";
import { addItemSchema, couponSchema, customerSchema, parse, updateItemSchema } from "../validation.js";

export function cartsRouter(carts: CartStore, catalog: Catalog, inventory: Inventory): Router {
  const router = Router();

  function getCart(req: Request<{ cartId: string }>): Cart {
    const cart = carts.get(req.params.cartId);
    if (!cart) throw new HttpError(404, "Carrito no encontrado");
    return cart;
  }

  /** Vista del carrito que consume el frontend: líneas + totales calculados. */
  function view(cart: Cart) {
    const lines = buildLines(cart.items, catalog);
    const coupon = cart.couponCode ? findCoupon(cart.couponCode) : null;
    return { id: cart.id, couponCode: cart.couponCode, lines, totals: calculateTotals(lines, coupon) };
  }

  // POST /api/carts → crea un carrito vacío
  router.post("/", (_req, res) => {
    res.status(201).json(view(carts.create()));
  });

  // GET /api/carts/:cartId
  router.get("/:cartId", (req, res) => {
    res.json(view(getCart(req)));
  });

  // POST /api/carts/:cartId/items  { productId, quantity }
  router.post("/:cartId/items", async (req, res) => {
    const cart = getCart(req);
    const { productId, quantity } = parse(addItemSchema, req.body);
    if (!catalog.get(productId)) throw new HttpError(404, "Producto no encontrado");

    const inCart = cart.items.find((i) => i.productId === productId)?.quantity ?? 0;
    if (inCart + quantity > (await inventory.available(productId))) {
      throw new HttpError(409, "No hay stock suficiente");
    }
    carts.addItem(cart, productId, quantity);
    res.json(view(cart));
  });

  // PATCH /api/carts/:cartId/items/:productId  { quantity }
  router.patch("/:cartId/items/:productId", async (req, res) => {
    const cart = getCart(req);
    const { quantity } = parse(updateItemSchema, req.body);
    if (quantity > (await inventory.available(req.params.productId))) {
      throw new HttpError(409, "No hay stock suficiente");
    }
    carts.setQuantity(cart, req.params.productId, quantity);
    res.json(view(cart));
  });

  // DELETE /api/carts/:cartId/items/:productId
  router.delete("/:cartId/items/:productId", (req, res) => {
    const cart = getCart(req);
    carts.removeItem(cart, req.params.productId);
    res.json(view(cart));
  });

  // POST /api/carts/:cartId/coupon  { code }
  router.post("/:cartId/coupon", (req, res) => {
    const cart = getCart(req);
    const { code } = parse(couponSchema, req.body);
    const coupon = findCoupon(code);
    if (!coupon) throw new HttpError(404, "El cupón no existe");

    const subtotal = calculateSubtotal(buildLines(cart.items, catalog));
    if (!isCouponApplicable(coupon, subtotal)) {
      throw new HttpError(422, "El carrito no alcanza el mínimo para este cupón");
    }
    cart.couponCode = coupon.code;
    res.json(view(cart));
  });

  // DELETE /api/carts/:cartId/coupon
  router.delete("/:cartId/coupon", (req, res) => {
    const cart = getCart(req);
    cart.couponCode = null;
    res.json(view(cart));
  });

  // POST /api/carts/:cartId/checkout  { name, email, address }
  router.post("/:cartId/checkout", async (req, res) => {
    const cart = getCart(req);
    const customer = parse(customerSchema, req.body);
    const order = await checkout(cart, customer, catalog, inventory);
    carts.clear(cart);
    res.status(201).json(order);
  });

  return router;
}
