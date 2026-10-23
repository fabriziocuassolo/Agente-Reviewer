// Se ejecuta en `npm install` (script "prepare"): compila el CLI de Guardian.
// En Vercel se saltea: ahí solo se despliega la tienda (storefront-demo) y el agente no hace falta.
import { spawnSync } from "node:child_process";

if (process.env.VERCEL) {
  console.log("guardian: en Vercel no se compila el agente (solo se despliega la tienda).");
  process.exit(0);
}

const result = spawnSync("npm", ["run", "build", "--workspace", "agent"], { stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
