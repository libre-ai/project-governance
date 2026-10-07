import { describe, expect, test } from "bun:test";

describe("canonical bootstrap", () => {
  test("uses the qualified Bun package manager with a 1.4 floor", async () => {
    const manifest = (await Bun.file("package.json").json()) as {
      packageManager?: string;
      engines?: { bun?: string };
    };
    const toolchain = (await Bun.file("toolchains/bun.json").json()) as {
      minimumVersion?: string;
    };
    expect(manifest.packageManager).toBe("bun@1.4.0-canary.1");
    expect(manifest.engines?.bun).toBe(">=1.4.0");
    expect(toolchain.minimumVersion).toBe("1.4.0");
  });

  test("declares one canonical Knowledge Object schema", async () => {
    const schema = (await Bun.file("ecosystem/schemas/knowledge-object.schema.json").json()) as {
      $id?: string;
    };
    expect(schema.$id).toBe("https://libre-ai.fr/schemas/knowledge-object.v1.json");
  });
});
