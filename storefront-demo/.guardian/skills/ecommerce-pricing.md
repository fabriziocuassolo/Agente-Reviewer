# Skill: precios, descuentos y checkout

Aplica a cambios en el cálculo de dinero. Un error acá es plata real que se pierde o se cobra de más:
casi siempre es **critico**.

## Qué revisar

- **Centavos enteros de punta a punta.** Buscá divisiones por 100, `parseFloat`, `toFixed` o
  multiplicadores decimales (`* 0.9`, `* 1.21`) dentro de la lógica. Lo correcto es operar en
  centavos y redondear UNA vez con `Math.round` al aplicar un porcentaje.
- **Cada descuento se aplica una sola vez.** Seguí el flujo completo: si una función auxiliar
  ya resta el cupón y después `calculateTotals` lo vuelve a restar, está duplicado.
- **El total nunca es negativo** y el descuento nunca supera el subtotal.
- **El envío se calcula sobre el subtotal original**, no sobre el subtotal con descuento
  (salvo que la regla de negocio diga otra cosa explícitamente).
- **El checkout valida stock antes de confirmar** y la reserva se espera (`await`) antes de
  responder. Si no, se vende stock que no existe.
- **Los precios salen del catálogo del servidor**, nunca del body del request.
- **Toda regla nueva de precios trae tests** con casos borde: cantidades grandes,
  redondeos (ej: 10% de 999 centavos), cupones con mínimo justo en el límite.

## Severidad sugerida

- Monto mal calculado, descuento duplicado, vender sin stock → `critico`
- Lógica de precios nueva sin tests → `medio`
