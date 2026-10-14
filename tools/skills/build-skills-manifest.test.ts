import { describe, expect, test } from "bun:test";
import {
  buildSkillsManifest,
  evaluateSkillsManifest,
  listedSkills,
  renderSkillsManifest,
} from "./build-skills-manifest";

// ADR-0050 D7-A: the distribution manifest lists exactly the admitted skills,
// and a gate holds the committed manifest equal to the collection.

const COLLECTION = ["pr-body", "biscuit-auth", "wizard"];
const GENERATED = renderSkillsManifest(buildSkillsManifest(COLLECTION));

describe("buildSkillsManifest", () => {
  test("one root-sourced, non-strict entry listing every skill, sorted", () => {
    const manifest = buildSkillsManifest(COLLECTION);
    expect(manifest.plugins).toHaveLength(1);
    expect(manifest.plugins[0]?.source).toBe("./");
    expect(manifest.plugins[0]?.strict).toBe(false);
    expect(manifest.plugins[0]?.skills).toEqual([
      "./skills/biscuit-auth",
      "./skills/pr-body",
      "./skills/wizard",
    ]);
  });

  // Without a version the installed version is the commit sha, so installs
  // follow the served branch (Claude Code plugin loading, "Versions and updates").
  test("carries no version, so an install tracks commits", () => {
    expect(GENERATED).not.toContain('"version"');
  });
});

describe("evaluateSkillsManifest", () => {
  test("the generated manifest passes and prints its volume", () => {
    const report = evaluateSkillsManifest(COLLECTION, GENERATED);
    expect(report.outcome).toBe("pass");
    expect(report.volumeSummary).toBe(
      "3 skill(s) in skills/, 3 listed in .claude-plugin/marketplace.json",
    );
  });

  test("a skill admitted but not listed is named", () => {
    const report = evaluateSkillsManifest([...COLLECTION, "new-skill"], GENERATED);
    expect(report.outcome).toBe("violations");
    expect(report.violations[0]).toContain("missing from the manifest: new-skill");
  });

  test("a listed skill that is no longer admitted is named", () => {
    const report = evaluateSkillsManifest(["pr-body", "wizard"], GENERATED);
    expect(report.violations[0]).toContain("listed but not admitted: biscuit-auth");
  });

  test("same skills in a hand-edited form still fails the generated-form check", () => {
    const report = evaluateSkillsManifest(
      COLLECTION,
      GENERATED.replace('"strict": false', '"strict": true'),
    );
    expect(report.violations).toEqual([
      ".claude-plugin/marketplace.json — generated form: differs from the generated manifest — regenerate it with `bun tools/skills/build-skills-manifest.ts`",
    ]);
  });

  test("an absent manifest is a failure, never an empty pass", () => {
    expect(evaluateSkillsManifest(COLLECTION, null).outcome).toBe("violations");
  });

  test("an unreadable manifest is a failure", () => {
    expect(evaluateSkillsManifest(COLLECTION, "not json").violations[0]).toContain("unreadable");
    expect(evaluateSkillsManifest(COLLECTION, '{"plugins":[]}').violations[0]).toContain(
      'no "libre-ai-skills" entry',
    );
  });
});

describe("listedSkills", () => {
  test("strips the skills/ prefix", () => {
    expect(listedSkills(GENERATED)).toEqual({
      ok: true,
      dirs: ["biscuit-auth", "pr-body", "wizard"],
    });
  });
});
