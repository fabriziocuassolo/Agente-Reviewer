import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { ask } from "./ask.js";
import { startChat } from "./chat.js";
import { applyFixes, commitAndPush, fixableFindings, proposeFixes, renderFixDiff, rollbackFixes } from "./fixer.js";
import { getRepoRoot } from "./git.js";
import { prepareProvider, providersStatus } from "./llm/provider.js";
import type { LLMProvider } from "./llm/types.js";
import { saveLastReview } from "./memory.js";
import { chooseAI, choose, confirm, describeProvider, isInteractive, resolveAIChoice, terminalAsker, type Asker } from "./menu.js";
import { loadPrefs, savePrefs } from "./prefs.js";
import { renderReport } from "./report.js";
import { runReview, type ReviewOptions } from "./review.js";
import { GuardianError, type ReviewReport } from "./types.js";

/**
 * Lo que hace cada comando "de todos los días" (review, ask/chat, ia).
 * cli.ts solo define los comandos y sus opciones; acá está el flujo.
 */

interface AIOptions {
  use?: string;
  model?: string;
}

/** Elige la IA (flag > guardada > menú la primera vez > .env), la prepara y avisa cuál se usa. */
async function pickProvider(options: AIOptions & { record?: boolean }, interactive: boolean, announce: boolean) {
  const ai = await resolveAIChoice(options, interactive);
  const choice = await prepareProvider(process.env, { use: ai.use, model: ai.model, record: options.record });
  if (announce) {
    const origin = options.use ? "elegida con --use" : ai.saved ? "tu elección guardada · para cambiarla: guardian ia" : "por defecto";
    console.log(`\n${describeProvider(choice.provider, choice.reason)} ${pc.dim(`(${origin})`)}`);
  }
  return choice;
}

// ---------------------------------------------------------------------------
// guardian review

export interface ReviewCliOptions extends AIOptions {
  base?: string;
  json?: boolean;
  llm: boolean;
  record?: boolean;
  prePush?: boolean;
  corregir?: boolean;
}

export async function reviewCommand(options: ReviewCliOptions): Promise<void> {
  // En el hook, en la CI o con --json no se pregunta nada: se usa lo configurado.
  const interactive = isInteractive() && !options.json && !options.prePush;
  const { provider, reason } =
    options.llm === false
      ? { provider: null, reason: "pediste --no-llm" }
      : await pickProvider(options, interactive, !options.json);
  if (options.llm === false && !options.json) console.log(`\n${describeProvider(null, reason)}`);

  const reviewOptions: ReviewOptions = {
    cwd: process.cwd(),
    base: options.base,
    llm: options.llm,
    committedOnly: options.prePush,
    provider,
    providerReason: reason,
  };
  const report = await runReview(reviewOptions);
  console.log(options.json ? JSON.stringify(report, null, 2) : renderReport(report));
  // Exit code 1 si está bloqueado: así el hook pre-push y la CI pueden cortar.
  process.exitCode = report.decision === "BLOQUEADO" ? 1 : 0;

  const fixable = fixableFindings(report).length;
  if (fixable === 0 || options.json) return;
  if (!interactive) {
    if (options.prePush) console.log(pc.dim("Tip: corré `guardian review` (sin --pre-push) y Guardian te ofrece corregirlo automáticamente."));
    return;
  }
  if (!provider || provider.name === "replay") {
    console.log(pc.dim("Para que Guardian corrija automáticamente hace falta una IA real (guardian ia para elegirla)."));
    return;
  }
  await fixFlow(provider, report, reviewOptions, Boolean(options.corregir));
}

/**
 * Corrección automática: propone → aplica → valida volviendo a revisar → muestra los cambios →
 * la persona elige: commit + push, rollback (todo como estaba) o dejarlos sin commitear.
 */
export async function fixFlow(
  provider: LLMProvider,
  report: ReviewReport,
  reviewOptions: ReviewOptions,
  alreadyAsked: boolean,
  asker: Asker = terminalAsker(),
) {
  const root = getRepoRoot(reviewOptions.cwd);
  if (!root) return;
  try {
    const count = fixableFindings(report).length;
    if (!alreadyAsked && !(await confirm(asker, pc.bold(`\n¿Querés que Guardian intente corregir automáticamente ${count} problema/s?`)))) {
      console.log(pc.dim("Ok, no toqué nada. Podés corregirlo a mano o pedírmelo después con: guardian review --corregir\n"));
      return;
    }

    const conventionsPath = join(root, report.project ?? "", "docs", "CONVENTIONS.md");
    const conventions = existsSync(conventionsPath) ? readFileSync(conventionsPath, "utf8") : null;
    const { fixes, skipped } = await proposeFixes(provider, root, report, conventions, (msg) => console.log(pc.dim(msg)));
    for (const s of skipped) console.log(pc.yellow(`  · No se corrigió ${s}`));
    if (fixes.length === 0) {
      console.log(pc.yellow("La IA no pudo proponer correcciones. No toqué nada.\n"));
      return;
    }

    // Se aplica y se VALIDA: se vuelve a revisar con las correcciones puestas.
    applyFixes(root, fixes);
    console.log(pc.dim("\nValidando: vuelvo a revisar el código con las correcciones…"));
    const after = await runReview(reviewOptions);
    const tests = after.checks.find((c) => c.name === "Tests");
    console.log(renderFixDiff(fixes));
    console.log(
      `\n${pc.bold("Resultado de la validación:")} ${report.findings.length} problema/s (${report.decision}) → ` +
        `${after.findings.length} problema/s (${after.decision})` +
        (tests ? ` · tests: ${tests.status === "ok" ? pc.green("pasan") : tests.status === "fallo" ? pc.red("fallan") : "omitidos"}` : ""),
    );
    for (const f of after.findings.slice(0, 8)) {
      console.log(pc.dim(`  · queda: [${f.severity}] ${f.file ?? ""}${f.line ? `:${f.line}` : ""} ${f.explanation.split("\n")[0].slice(0, 100)}`));
    }

    const stillBlocked = after.decision === "BLOQUEADO";
    if (stillBlocked) {
      console.log(pc.red(pc.bold("\n⚠ Aun con las correcciones, el cambio sigue BLOQUEADO. Lo recomendable es deshacerlas y corregir a mano.")));
    }
    const action = await choose(
      asker,
      "¿Qué hacemos con estas correcciones?",
      [
        stillBlocked
          ? { label: "Commit + push (NO recomendado)", hint: "sigue BLOQUEADO: subirías código con problemas críticos" }
          : { label: "Commit + push", hint: "se suben tus cambios junto con las correcciones" },
        { label: "Deshacer las correcciones (rollback)", hint: "todo vuelve a como estaba y lo corregís vos a mano" },
        { label: "Dejarlas sin commitear", hint: "para mirarlas o retocarlas en tu editor" },
      ],
      1, // por defecto, lo más seguro: deshacer
    );

    if (action === 1) {
      rollbackFixes(root, fixes);
      saveLastReview(root, report); // los IDs de dismiss vuelven a ser los de la revisión original
      console.log(pc.green(`✔ Rollback: ${fixes.length} archivo/s quedaron exactamente como estaban. Tus cambios no se tocaron.\n`));
      return;
    }
    if (action === 2) {
      console.log(pc.green("✔ Correcciones aplicadas y sin commitear. Revisalas con git diff.\n"));
      return;
    }
    // Subir algo que sigue BLOQUEADO exige una segunda confirmación explícita (por defecto: no).
    if (stillBlocked && !(await confirm(asker, pc.red("¿Seguro? Vas a subir código que Guardian marca como BLOQUEADO")))) {
      rollbackFixes(root, fixes);
      saveLastReview(root, report);
      console.log(pc.green(`✔ No subí nada. Rollback: ${fixes.length} archivo/s quedaron exactamente como estaban.\n`));
      return;
    }
    const result = commitAndPush(root, report, fixes);
    console.log(result.pushed ? pc.green(`✔ Commit + push listos.\n${pc.dim(result.detail)}\n`) : pc.yellow(`${result.detail}\n`));
  } finally {
    asker.close();
  }
}

// ---------------------------------------------------------------------------
// guardian ask / guardian chat

export async function askCommand(question: string | undefined, options: AIOptions): Promise<void> {
  const interactive = isInteractive();
  const ai = await resolveAIChoice(options, interactive);
  if (!question) {
    await startChat({ cwd: process.cwd(), use: ai.use, model: ai.model });
    return;
  }
  const { provider, reason } = await prepareProvider(process.env, { use: ai.use, model: ai.model });
  console.log(`\n${describeProvider(provider, reason)}`);
  if (!provider) throw new GuardianError(`Para responder preguntas hace falta una IA.\n${reason}`);

  const started = Date.now();
  const result = await ask(question, { cwd: process.cwd(), provider });
  console.log(`\n${result.answer}\n`);
  if (result.sources.length > 0) console.log(pc.dim(`Archivos consultados: ${result.sources.join(", ")}`));
  const tokens = result.inputTokens ? ` · ${result.inputTokens} tokens de entrada / ${result.outputTokens ?? 0} de salida` : "";
  console.log(pc.dim(`Tiempo: ${((Date.now() - started) / 1000).toFixed(1)} s${tokens}\n`));
}

// ---------------------------------------------------------------------------
// guardian ia

export async function iaCommand(options: { estado?: boolean }): Promise<void> {
  const prefs = loadPrefs();
  const statuses = await providersStatus();
  console.log(pc.bold("\nIA para las revisiones\n"));
  if (prefs) console.log(`  ${pc.cyan("★")} Tu elección guardada: ${pc.bold(prefs.label ?? prefs.use)} ${pc.dim(`(desde ${prefs.fecha})`)}\n`);
  for (const s of statuses) {
    const icon = s.ready ? pc.green("✔") : pc.yellow("–");
    console.log(`  ${icon} ${pc.bold(s.name.padEnd(8))}\n      ${pc.dim(s.detail)}`);
  }

  if (options.estado || !isInteractive()) {
    console.log(pc.dim("\nPara elegir otra: guardian ia   (o para un solo comando: --use ia | --use local | --use replay)\n"));
    return;
  }
  const asker = terminalAsker();
  try {
    if (!(await confirm(asker, "\n¿Querés elegir otra IA?"))) return;
    const choice = await chooseAI(asker);
    if (!choice) return;
    savePrefs({ use: choice.use, model: choice.model, label: choice.label });
    console.log(pc.green(`✔ Listo: desde ahora uso ${choice.label}.\n`));
  } finally {
    asker.close();
  }
}
