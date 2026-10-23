import app from "./app.js";

// Arranque local (npm run store). En Vercel no se usa: Vercel toma el export de app.ts.
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`🛒 Storefront demo en http://localhost:${port}`);
});
