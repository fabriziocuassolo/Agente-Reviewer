// Tipos compartidos de la tienda.
// Convención: todos los montos son centavos enteros (number entero), nunca decimales.

export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  stock: number;
  emoji: string;
  color: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface Cart {
  id: string;
  items: CartItem[];
  couponCode: string | null;
}

/** Línea de carrito ya resuelta contra el catálogo (con precio y nombre). */
export interface CartLine {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
}

export interface Customer {
  name: string;
  email: string;
  address: string;
}

export interface Order {
  id: string;
  customer: Customer;
  lines: CartLine[];
  couponCode: string | null;
  totals: Totals;
  createdAt: string;
}
