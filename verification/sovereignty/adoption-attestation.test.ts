import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ADOPTION_ATTESTATION_RELATIVE_PATH,
  readAdoptionAttestation,
} from "./adoption-attestation";

const created: string[] = [];

async function makeFakeRepoRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sovereignty-sov01-"));
  created.push(root);
  return root;
}

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("readAdoptionAttestation", () => {
  test("reports absent when no attestation has been published", async () => {
    const root = await makeFakeRepoRoot();
    expect(await readAdoptionAttestation(root)).toEqual({ kind: "absent" });
  });

  test("reads the verdict of a published v1 attestation", async () => {
    const root = await makeFakeRepoRoot();
    const path = join(root, ADOPTION_ATTESTATION_RELATIVE_PATH);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      `{ "schemaVersion": "libre-ai.adoption-reproduction.v1", "verdict": "pass" }\n`,
    );
    expect(await readAdoptionAttestation(root)).toEqual({
      kind: "present",
      path: ADOPTION_ATTESTATION_RELATIVE_PATH,
      status: "pass",
    });
  });

  test("falls back to a legacy status field", async () => {
    const root = await makeFakeRepoRoot();
    const path = join(root, ADOPTION_ATTESTATION_RELATIVE_PATH);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `{ "status": "pass", "detail": "reproduced" }\n`);
    expect(await readAdoptionAttestation(root)).toEqual({
      kind: "present",
      path: ADOPTION_ATTESTATION_RELATIVE_PATH,
      status: "pass",
    });
  });

  test("reports unreadable on invalid JSON", async () => {
    const root = await makeFakeRepoRoot();
    const path = join(root, ADOPTION_ATTESTATION_RELATIVE_PATH);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "not json at all");
    const outcome = await readAdoptionAttestation(root);
    expect(outcome.kind).toBe("unreadable");
  });

  test("reports unreadable when the verdict field is missing", async () => {
    const root = await makeFakeRepoRoot();
    const path = join(root, ADOPTION_ATTESTATION_RELATIVE_PATH);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `{ "outcome": "ok" }`);
    const outcome = await readAdoptionAttestation(root);
    expect(outcome.kind).toBe("unreadable");
  });
});
