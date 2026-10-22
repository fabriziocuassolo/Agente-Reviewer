import { randomUUID } from "node:crypto";
import type { Cart } from "../types.js";

/** Carritos en memoria, identificados por un UUID que guarda el navegador. */
export class CartStore {
  private readonly carts = new Map<string, Cart>();

  create(): Cart {
    const cart: Cart = { id: randomUUID(), items: [], couponCode: null };
    this.carts.set(cart.id, cart);
    return cart;
  }

  get(id: string): Cart | undefined {
    return this.carts.get(id);
  }

  /** Suma unidades si el producto ya está en el carrito. */
  addItem(cart: Cart, productId: string, quantity: number): void {
    const existing = cart.items.find((i) => i.productId === productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.items.push({ productId, quantity });
    }
  }

  /** Fija la cantidad exacta; 0 quita el producto. */
  setQuantity(cart: Cart, productId: string, quantity: number): void {
    if (quantity === 0) {
      this.removeItem(cart, productId);
      return;
    }
    const existing = cart.items.find((i) => i.productId === productId);
    if (existing) existing.quantity = quantity;
  }

  removeItem(cart: Cart, productId: string): void {
    cart.items = cart.items.filter((i) => i.productId !== productId);
  }

  clear(cart: Cart): void {
    cart.items = [];
    cart.couponCode = null;
  }
}
