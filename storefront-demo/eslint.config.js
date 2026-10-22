import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "dist/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      // Parámetros que empiezan con "_" son intencionalmente no usados (ej: next en Express)
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // El frontend es JavaScript vanilla que corre en el navegador
    files: ["public/**/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "script" },
  },
);
