// Frontend de la tienda en JavaScript vanilla.
// Convención: los datos que vienen del servidor o del usuario se insertan
// SIEMPRE con textContent / createElement, nunca con innerHTML.
"use strict";

const state = {
  products: [],
  cart: null,
};

const $ = (id) => document.getElementById(id);

// ---------- Utilidades ----------

/** Los montos viajan en centavos enteros; solo se dividen por 100 para mostrarlos. */
const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD" });
function formatCents(cents) {
  return money.format(cents / 100);
}

/** Crea un elemento con clase y texto de forma segura. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Error inesperado");
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const node = $("toast");
  node.textContent = message;
  node.classList.toggle("error", isError);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 2500);
}

// ---------- Catálogo ----------

function renderCatalog(products) {
  const grid = $("catalog");
  grid.replaceChildren();

  for (const product of products) {
    const card = el("article", "card");

    const image = el("div", "card-image", product.emoji);
    image.style.background = product.color;
    image.setAttribute("aria-hidden", "true");

    const body = el("div", "card-body");
    body.append(
      el("span", "card-category", product.category),
      el("h3", "card-title", product.name),
      el("p", "card-description", product.description),
    );

    const footer = el("div", "card-footer");
    const priceBox = el("div");
    priceBox.append(el("div", "price", formatCents(product.priceCents)));
    if (product.stock > 0 && product.stock <= 5) {
      priceBox.append(el("div", "stock-low", `¡Quedan ${product.stock}!`));
    }

    const button = el("button", "button primary", product.stock > 0 ? "Agregar" : "Sin stock");
    button.type = "button";
    button.disabled = product.stock === 0;
    button.addEventListener("click", () => addToCart(product.id));

    footer.append(priceBox, button);
    body.append(footer);
    card.append(image, body);
    grid.append(card);
  }
}

async function loadProducts() {
  state.products = await api("/api/products");
  renderCatalog(state.products);
}

// ---------- Carrito ----------

async function ensureCart() {
  const savedId = localStorage.getItem("cartId");
  if (savedId) {
    try {
      state.cart = await api(`/api/carts/${encodeURIComponent(savedId)}`);
      return;
    } catch {
      // El servidor se reinició y el carrito ya no existe: creamos uno nuevo.
    }
  }
  state.cart = await api("/api/carts", { method: "POST" });
  localStorage.setItem("cartId", state.cart.id);
}

function cartPath(suffix = "") {
  return `/api/carts/${encodeURIComponent(state.cart.id)}${suffix}`;
}

/** Llama a la API del carrito y re-renderiza. Devuelve false si hubo error. */
async function updateCart(path, options) {
  try {
    state.cart = await api(cartPath(path), options);
    renderCart();
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  }
}

async function addToCart(productId) {
  const ok = await updateCart("/items", { method: "POST", body: { productId, quantity: 1 } });
  if (ok) toast("Producto agregado al carrito");
}

function setQuantity(productId, quantity) {
  return updateCart(`/items/${encodeURIComponent(productId)}`, { method: "PATCH", body: { quantity } });
}

function renderTotals(container, totals) {
  container.replaceChildren();
  const rows = [
    ["Subtotal", formatCents(totals.subtotalCents), ""],
    ["Descuento", `−${formatCents(totals.discountCents)}`, "discount"],
    ["Envío", totals.shippingCents === 0 ? "Gratis" : formatCents(totals.shippingCents), ""],
    ["Total", formatCents(totals.totalCents), "total"],
  ];
  for (const [label, value, className] of rows) {
    if (label === "Descuento" && totals.discountCents === 0) continue;
    container.append(el("dt", className, label), el("dd", className, value));
  }
}

function renderCart() {
  const { lines, totals, couponCode } = state.cart;
  const list = $("cart-items");
  list.replaceChildren();

  for (const line of lines) {
    const product = state.products.find((p) => p.id === line.productId);
    const item = el("li", "cart-item");

    const thumb = el("div", "cart-item-thumb", product ? product.emoji : "");
    if (product) thumb.style.background = product.color;

    const info = el("div");
    info.append(
      el("p", "cart-item-name", line.name),
      el("p", "cart-item-price", formatCents(line.lineTotalCents)),
    );

    const qty = el("div", "qty");
    const minus = el("button", "", "−");
    minus.setAttribute("aria-label", `Quitar una unidad de ${line.name}`);
    minus.addEventListener("click", () => setQuantity(line.productId, line.quantity - 1));
    const plus = el("button", "", "+");
    plus.setAttribute("aria-label", `Agregar una unidad de ${line.name}`);
    plus.addEventListener("click", () => setQuantity(line.productId, line.quantity + 1));
    qty.append(minus, el("span", "", String(line.quantity)), plus);

    item.append(thumb, info, qty);
    list.append(item);
  }

  const isEmpty = lines.length === 0;
  $("cart-empty").hidden = !isEmpty;
  $("go-checkout").disabled = isEmpty;
  $("cart-count").textContent = String(lines.reduce((sum, l) => sum + l.quantity, 0));

  $("coupon-form").hidden = Boolean(couponCode);
  $("coupon-applied").hidden = !couponCode;
  $("coupon-code").textContent = couponCode || "";

  renderTotals($("cart-totals"), totals);
}

function toggleCart(open) {
  $("cart-panel").classList.toggle("open", open);
  $("cart-panel").setAttribute("aria-hidden", String(!open));
  $("cart-toggle").setAttribute("aria-expanded", String(open));
  $("overlay").hidden = !open;
}

// ---------- Checkout ----------

function openCheckout() {
  const summary = $("summary-lines");
  summary.replaceChildren();
  for (const line of state.cart.lines) {
    const li = el("li");
    li.append(el("span", "", `${line.quantity} × ${line.name}`), el("span", "", formatCents(line.lineTotalCents)));
    summary.append(li);
  }
  renderTotals($("summary-totals"), state.cart.totals);

  $("checkout-form").hidden = false;
  $("order-confirmation").hidden = true;
  $("checkout-error").hidden = true;
  toggleCart(false);
  $("checkout-dialog").showModal();
}

async function submitCheckout(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const order = await api(cartPath("/checkout"), {
      method: "POST",
      body: { name: form.get("name"), email: form.get("email"), address: form.get("address") },
    });
    $("order-id").textContent = order.id.slice(0, 8).toUpperCase();
    $("order-total").textContent = formatCents(order.totals.totalCents);
    $("checkout-form").hidden = true;
    $("order-confirmation").hidden = false;
    event.target.reset();

    state.cart = await api(cartPath());
    renderCart();
    await loadProducts(); // refresca el stock
  } catch (error) {
    $("checkout-error").textContent = error.message;
    $("checkout-error").hidden = false;
  }
}

// ---------- Eventos ----------

function bindEvents() {
  $("cart-toggle").addEventListener("click", () => toggleCart(true));
  $("cart-close").addEventListener("click", () => toggleCart(false));
  $("overlay").addEventListener("click", () => toggleCart(false));
  $("go-checkout").addEventListener("click", openCheckout);

  $("coupon-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = $("coupon-input").value;
    await updateCart("/coupon", { method: "POST", body: { code } });
    $("coupon-input").value = "";
  });
  $("coupon-remove").addEventListener("click", () => updateCart("/coupon", { method: "DELETE" }));

  $("checkout-form").addEventListener("submit", submitCheckout);
  $("checkout-close").addEventListener("click", () => $("checkout-dialog").close());
  $("confirmation-close").addEventListener("click", () => $("checkout-dialog").close());
}

async function init() {
  bindEvents();
  try {
    await Promise.all([loadProducts(), ensureCart()]);
    renderCart();
  } catch (error) {
    toast(`No se pudo cargar la tienda: ${error.message}`, true);
  }
}

init();
