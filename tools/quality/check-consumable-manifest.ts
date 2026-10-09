/**
 * This repository is installed by its consumers as a sha-pinned git-dep, so its
 * `dependencies` are THEIR dependencies. A specifier that only resolves inside
 * this workspace therefore breaks every consumer's install, and the breakage
 * surfaces in their CI rather than here.
 *
 * That is not hypothetical. On 2026-10-07 `@libre-ai/classification` was added
 * under `dependencies` with `workspace:*` so that a generator could import it.
 * `bun run check` stayed green — nothing in this repository resolves that entry
 * differently — and `signalement`'s `bun install` failed with
 * `@libre-ai/classification@workspace:* failed to resolve`. Two declared pin
 * generations shipped before the cause was found, each requiring its own
 * declaration cycle to replace.
 *
 * A patch would have fixed that one entry. This gate removes the class: a
 * workspace-local or path specifier is refused in every field a consumer
 * resolves. Internal packages stay usable — the generator imports K2 by path
 * inside its own main block — but they stay out of the surface consumers resolve.
 *
 * `devDependencies` are part of that surface. The entry was first moved there on
 * the premise that a consumer never installs them, and that premise held for the
 * git-dep form only. The composition checks out this repository next to its
 * consumers and links it as `file:../project-governance`, and Bun resolves the
 * development dependencies of a `file:` folder dependency: on 2026-10-09 every
 * re-resolution of `bun.lock` in application-development-toolkit,
 * ai-work-supervision and project-website failed with
 * `Workspace dependency "@libre-ai/classification" not found`. The entry was
 * removed — nothing imported the package by name — and this field is judged.
 */
import { concludeGate, GateReport } from "./gate-report";

/** Specifiers that only resolve inside the workspace that declares them. */
const LOCAL_SPECIFIER = /^(workspace:|file:|link:|\.{1,2}\/)/;

interface Manifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

const manifest = (await Bun.file("package.json").json()) as Manifest;
const report = new GateReport();

// `peerDependencies` reach a consumer the same way, and `devDependencies` reach
// a consumer that links this repository as a `file:` folder (the composition).
const inherited: Array<[string, Record<string, string>]> = [
  ["dependencies", manifest.dependencies ?? {}],
  ["devDependencies", manifest.devDependencies ?? {}],
  ["peerDependencies", manifest.peerDependencies ?? {}],
];

let examined = 0;
for (const [field, entries] of inherited) {
  for (const [name, specifier] of Object.entries(entries)) {
    examined += 1;
    const local = LOCAL_SPECIFIER.test(specifier);
    report.check(
      `${field}: ${name}`,
      !local,
      local
        ? `"${specifier}" resolves only inside this workspace — a consumer installing ` +
            "this repository as a git-dep or composing it as a file: folder resolves it " +
            "and cannot; drop the entry and import the internal package by path where it is used"
        : `"${specifier}" is resolvable by a consumer`,
    );
  }
}

// A gate that asserted nothing fails. A manifest with no inherited dependency
// at all is legitimate, so it is asserted rather than passed over in silence.
if (examined === 0) {
  report.check(
    "inherited dependency surface",
    true,
    "the manifest declares no dependencies, devDependencies or peerDependencies — nothing is inherited",
  );
}

concludeGate("Consumable manifest", report);
