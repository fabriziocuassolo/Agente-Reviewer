import { z } from "zod";
import { HttpError } from "./errors.js";

// Convención: toda entrada de la API se valida con zod antes de usarla.

const quantity = z.number().int().min(0).max(99);

export const addItemSchema = z.object({
  productId: z.string().min(1),
  quantity: quantity.min(1).default(1),
});

export const updateItemSchema = z.object({ quantity });

export const couponSchema = z.object({
  code: z.string().trim().min(1).max(40),
});

export const customerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email(),
  address: z.string().trim().min(5).max(200),
});

/** Valida `input` con el schema; si falla lanza un 400 con los problemas. */
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    throw new HttpError(400, "Datos inválidos", issues);
  }
  return result.data;
}
