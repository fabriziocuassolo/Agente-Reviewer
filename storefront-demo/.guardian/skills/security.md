# Skill: seguridad

## Qué revisar

- **XSS en el frontend.** `innerHTML`, `outerHTML`, `insertAdjacentHTML` o `document.write`
  con cualquier dato que venga de la API o del usuario (nombres de producto, descripciones,
  cupones, direcciones) es **critico**, aunque hoy los datos "sean nuestros": el catálogo
  puede editarse desde un panel o venir de un proveedor. Usar `textContent` / `createElement`.
- **Atributos armados con datos**: `style="...${dato}"`, `href="${url}"` también son inyección.
- **Secretos**: API keys, tokens, contraseñas o URLs con credenciales en el código. Van en
  `process.env` y en `.env.example` sin valor.
- **Datos sensibles en logs** (emails, direcciones, tokens) o en URLs (query strings).
- **Llamadas a servicios externos**: deben tener timeout y no confiar en la respuesta sin validarla.
- **IDs en URLs del frontend** van con `encodeURIComponent`.

## Severidad sugerida

- XSS, secreto expuesto → `critico`
- Dato sensible en logs, llamada externa sin validar respuesta → `alto`
