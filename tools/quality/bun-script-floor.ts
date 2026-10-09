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
 * Limit, stated rather than hidden: this reads the command string, so a suite
 * reached through an indirection the string does not show — a shell script, a
 * `bun --bun test` spelling, a runner invoked by another name — is outside
 * what it can see. It catches the spelling that was actually measured twice.
 */

/** `bun test`, but not `bun run test` and not `bunx test`. */
const BARE_BUN_TEST = /\bbun\s+test\b/;

/**
 * A control operator after which a later command runs whether or not the
 * floor passed: `||`, `;`, a lone `&` (background), or a newline.
 */
const UNCONDITIONAL_SEQUENCE = /\|\||;|(?<!&)&(?!&)|\n/;

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
    if (!BARE_BUN_TEST.test(command)) continue;
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
