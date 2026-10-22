import { describe, expect, it } from "vitest";
import { parseAddedLines } from "../src/diff.js";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
@@ -20,2 +21,3 @@ function x() {
 return 1;
+// nuevo
 }
diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-adiós
`;

describe("parseAddedLines", () => {
  it("devuelve solo las líneas agregadas con su número en el archivo nuevo", () => {
    const added = parseAddedLines(DIFF);
    expect(added.get("src/a.ts")).toEqual([
      { line: 2, text: "const b = 3;" },
      { line: 3, text: "const c = 4;" },
      { line: 22, text: "// nuevo" },
    ]);
  });

  it("ignora archivos borrados", () => {
    expect(parseAddedLines(DIFF).has("old.ts")).toBe(false);
  });
});
