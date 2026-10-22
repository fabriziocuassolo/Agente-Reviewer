import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Carpeta raíz de storefront-guardian (agent/dist → ../../). */
export const GUARDIAN_HOME = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Carga el .env de Guardian (no el del proyecto revisado: ese puede tener
 * secretos de la empresa que no nos interesan). Las variables ya definidas
 * en el entorno tienen prioridad, así la GitHub Action puede pasar la key
 * como secret sin archivo .env.
 */
export function loadGuardianEnv(): void {
  const path = join(GUARDIAN_HOME, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}
