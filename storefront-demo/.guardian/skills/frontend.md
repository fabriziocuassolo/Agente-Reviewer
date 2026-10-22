# Skill: frontend vanilla (public/)

## Qué revisar

- **Nada de `innerHTML` con datos** (ver skill de seguridad). El helper `el(tag, clase, texto)`
  existe para esto.
- **Montos**: el frontend NUNCA calcula precios ni totales; solo muestra lo que devuelve la API
  usando `formatCents`. Si aparece una cuenta con precios en `app.js`, es un bug.
- **Errores visibles**: toda llamada a `api()` maneja el error y se lo muestra al usuario
  (`toast` o mensaje en pantalla). Una promesa sin `catch` deja la UI colgada sin aviso.
- **Accesibilidad básica**: botones con texto o `aria-label`, estado con `aria-pressed` /
  `aria-expanded` cuando corresponde, imágenes decorativas con `aria-hidden`.
- **Responsive**: nada de anchos fijos en px que rompan en pantallas de 375 px.

## Severidad sugerida

- Cálculo de precios en el frontend → `alto`
- Error de API no manejado → `medio`
- Accesibilidad o responsive → `bajo`
