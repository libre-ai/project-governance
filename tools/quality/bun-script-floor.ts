/**
 * Whether anything actually makes the Bun floor hook fire.
 *
 * The floor is `pretest`, and bun fires a `pre<script>` hook only for
 * `bun run <script>` — never for the built-in `bun test`. So a manifest can
 * declare `pretest` exactly as the manifest gate demands, and still run its
 * suite below the pinned runtime, because every path that reaches the suite
 * reaches it as `bun test` instead of `bun run test`.
 *
 * That is not hypothetical. This repository's root manifest carried the shape
 * until 2026-10-08 (f032f23): `check`'s test link was a bare `bun test`,
 * `bun run test` appeared nowhere in the tree, and the hook therefore never
 * fired once. `check-bun-manifests` did not catch it then and does not catch
 * it by existence alone — it asserts that `pretest` EXISTS and equals the
 * floor command, which says nothing about whether anything invokes it. The
 * root was corrected by hand, with nothing to stop it regressing, and the
 * same shape was still live in the workspace manifest on 2026-10-09:
 * `check` was `bun test src`.
 *
 * `test` itself is exempt. It IS the script the hook guards, so its body is
 * the one place a bare `bun test` belongs: the hook has already fired by the
 * time the body runs.
 *
 * A second shape enforces the floor without the hook (owner decision
 * 2026-10-09): a script whose FIRST command is the manifest's runtime floor
 * script, chained only by `&&`, cannot reach `bun test` unless the floor has
 * passed. It exists because a repository whose `test` is `cargo test` (the
 * Rust bricks) cannot route its Bun suites through `bun run test`; measured
 * on 2026-10-09, 9 such scripts in execution-continuity-evaluator and
 * execution-sandbox, all starting with `bun run check:bun:runtime && `. The
 * floor script is the one the manifest gate already binds per manifest kind
 * (`check:bun:runtime` at the root, `check:bun` in a nested manifest), never
 * a name this rule invents. Anything that lets the suite run when the floor
 * did not pass — the floor anywhere but first, an `||` branch, a `;`, a
 * background `&`, a newline — keeps the script a bypass. The root `check`,
 * `build` and `check:toolchain` cannot take this shape: the manifest gate
 * requires them to start with `bun run check:bun && `, which is not the root
 * runtime floor, so the f032f23 regression stays refused.
 *
 * Spelling. The command string is normalised before detection — quotes and
 * backslashes removed — and options between `bun` and `test` are tolerated,
 * so `bun "test"`, `bun t''est`, `b''un test`, `bun --smol test` and
 * `bun --bun test` are all `bun test` here (adversarial review of PR #55,
 * 2026-10-09: each of them ran the suite after a failed floor). At the root
 * that detection is no longer what keeps the floor: every non-bound script
 * must pass `enforcesFloorFirst`, so a suite after `||`, `;`, `&` or a newline
 * is refused however `bun test` is spelled.
 *
 * Limit, stated rather than hidden: this reads the command string, so a suite
 * reached through an indirection the string does not show — `$(echo bun)
 * test`, a shell script, `sh -c '…'`, an option given its value as a separate
 * word (`bun --cwd x test`), a runner invoked by another name — is invisible
 * to the `bun test` detection. Where the structural rule applies (every root
 * script that is not bound by exact value, and the nested `pre<script>` hooks)
 * such an indirection still runs only after the floor passed; what the
 * detection alone guards is the f032f23 policy that the root `check`, `build`
 * and `check:toolchain` reach the suite as `bun run test`.
 */

/**
 * `bun test`, possibly with options before `test`, but not `bun run test`,
 * `bunx test` or `bun testify`. Applied to the normalised command.
 */
const BARE_BUN_TEST = /\bbun(?:\s+-\S+)*\s+test\b/;

/** Quotes and backslashes split a word for the reader, never for the shell. */
function normaliseForDetection(command: string): string {
  return command.replace(/['"\\]/g, "");
}

/** Whether the command reaches the suite through `bun test`, however quoted. */
function reachesBareBunTest(command: string): boolean {
  return BARE_BUN_TEST.test(normaliseForDetection(command));
}

/**
 * A control operator after which a later command runs whether or not the
 * floor passed: `||`, `;`, a lone `&` (background), or a line break.
 */
const UNCONDITIONAL_SEQUENCE = /\|\||;|(?<!&)&(?!&)|[\n\r]/;

/**
 * True when the floor script is the first command and every later command is
 * reached only through `&&`, so the suite cannot run unless the floor passed.
 */
export function enforcesFloorFirst(command: string, floorScript: string): boolean {
  const prefix = `bun run ${floorScript} && `;
  if (!command.startsWith(prefix)) return false;
  return !UNCONDITIONAL_SEQUENCE.test(command.slice(prefix.length));
}

/**
 * Script names whose command reaches the suite without enforcing the floor,
 * neither through `pretest` nor through `floorScript` run first.
 * Sorted, so the same manifest always reports the same way.
 */
export function findFloorBypasses(
  scripts: Readonly<Record<string, string>>,
  floorScript: string,
): string[] {
  const bypassed: string[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (name === "test") continue;
    if (!reachesBareBunTest(command)) continue;
    if (enforcesFloorFirst(command, floorScript)) continue;
    bypassed.push(name);
  }
  return bypassed.sort();
}

/** The failure wording, shared by the root and the nested manifest checks. */
export function floorBypassNote(script: string, floorScript: string): string {
  return (
    `${script} reaches the suite with a bare \`bun test\`, which does not fire the ` +
    "pretest hook — reach it as `bun run test`, or run " +
    `\`bun run ${floorScript}\` first and chain only with \`&&\`, so the Bun floor is enforced`
  );
}

/** The root manifest's runtime floor and the manifest floor that runs it first. */
const ROOT_RUNTIME_FLOOR = "check:bun:runtime";
const ROOT_MANIFEST_FLOOR = "check:bun";
/** The one value a `pre<script>` hook may take: run the manifest floor. */
export const FLOOR_HOOK = `bun run ${ROOT_MANIFEST_FLOOR}`;

/** Root scripts bound to an exact value by the manifest gate itself. */
const ROOT_EXACT = new Set([ROOT_RUNTIME_FLOOR, ROOT_MANIFEST_FLOOR]);
/** Root scripts that must run the manifest floor first (f032f23 contract). */
const ROOT_MANIFEST_FLOOR_FIRST = new Set(["check:toolchain", "build", "check"]);

export interface ScriptViolation {
  readonly script: string;
  readonly note: string;
}

/**
 * Every root script that can run without the Bun floor having passed.
 *
 * The rule is structural, so it does not depend on how the suite is spelled:
 *
 *   - `check`, `build`, `check:toolchain` start with `bun run check:bun && `
 *     and chain only with `&&`;
 *   - `test` is guarded by `pretest`, which the gate binds by exact value;
 *   - a `pre<script>` hook of a DECLARED script is exactly `bun run check:bun`
 *     — it fires before that script, so any other value is code that runs
 *     ahead of the floor; a hook on the floor scripts themselves is refused,
 *     because at the root `check:bun` runs `check:bun:runtime` and the hook
 *     would recurse;
 *   - every other script — `pre`-prefixed or not, when nothing is declared
 *     under the remaining name it is an ordinary script — starts with
 *     `bun run check:bun:runtime && ` and chains only with `&&`.
 *
 * Before 2026-10-09 the last two were a `startsWith("pre")` exemption and a
 * prefix test: `"presuite": "bun --smol test probe"` passed with no floor, and
 * `bun run check:bun:runtime && false || bun "test"` passed with the floor
 * failing (adversarial review of PR #55).
 */
export function findRootFloorViolations(
  scripts: Readonly<Record<string, string>>,
): ScriptViolation[] {
  const violations: ScriptViolation[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (ROOT_EXACT.has(name) || name === "test") continue;
    if (ROOT_MANIFEST_FLOOR_FIRST.has(name)) {
      if (!enforcesFloorFirst(command, ROOT_MANIFEST_FLOOR)) {
        violations.push({
          script: name,
          note: `${name} must start with \`${FLOOR_HOOK} && \` and chain only with \`&&\``,
        });
      }
      continue;
    }
    const hooked = name.startsWith("pre") ? name.slice(3) : "";
    if (hooked !== "" && scripts[hooked] !== undefined) {
      if (ROOT_EXACT.has(hooked)) {
        violations.push({
          script: name,
          note: `${name} hooks the floor itself, which recurses through ${ROOT_MANIFEST_FLOOR}`,
        });
      } else if (command !== FLOOR_HOOK) {
        violations.push({
          script: name,
          note: `${name} runs before ${hooked}, so it must be exactly \`${FLOOR_HOOK}\``,
        });
      }
      continue;
    }
    if (!enforcesFloorFirst(command, ROOT_RUNTIME_FLOOR)) {
      violations.push({
        script: name,
        note:
          `${name} must enforce the Bun floor first: start with ` +
          `\`bun run ${ROOT_RUNTIME_FLOOR} && \` and chain only with \`&&\``,
      });
    }
  }
  return violations.sort((a, b) => (a.script < b.script ? -1 : a.script > b.script ? 1 : 0));
}

/**
 * Nested hook violations. A nested manifest has no runtime floor of its own
 * to run first, so every script is guarded by a `pre<script>` hook equal to
 * `bun run check:bun`:
 *
 *   - every script but `check:bun` and the hooks of declared scripts needs
 *     that hook — including a `pre`-prefixed name with nothing declared under
 *     the remaining name, which is an ordinary script, not a hook (the nested
 *     side of the `presuite` bypass: a `startsWith("pre")` exemption let it
 *     run with no hook at all);
 *   - every hook of a declared script is exactly that value, so no hook runs
 *     code ahead of the floor;
 *   - a hook on `check:bun` itself is refused: it would recurse.
 */
export function findNestedHookViolations(
  scripts: Readonly<Record<string, string>>,
): ScriptViolation[] {
  const violations: ScriptViolation[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (name === ROOT_MANIFEST_FLOOR) continue;
    const hooked = name.startsWith("pre") ? name.slice(3) : "";
    if (hooked !== "" && scripts[hooked] !== undefined) {
      if (hooked === ROOT_MANIFEST_FLOOR) {
        violations.push({ script: name, note: `${name} hooks the floor itself, which recurses` });
      } else if (command !== FLOOR_HOOK) {
        violations.push({
          script: name,
          note: `${name} runs before ${hooked}, so it must be exactly \`${FLOOR_HOOK}\``,
        });
      }
      continue;
    }
    // A declared hook with the wrong value is reported once, by the branch
    // above, when the loop reaches the hook itself.
    if (scripts[`pre${name}`] === undefined) {
      violations.push({ script: `pre${name}`, note: `pre${name} must enforce the Bun floor` });
    }
  }
  return violations.sort((a, b) => (a.script < b.script ? -1 : a.script > b.script ? 1 : 0));
}
