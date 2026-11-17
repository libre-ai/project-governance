import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TagReleaseResult, tagRelease } from "./tag-release";

// Every expectation below comes from the lot brief, not from the tool's output:
// codes 0 done or already done, 1 refusal, 2 usage, 3 forge or git unreachable
// or unexpected; existence asked to the git protocol; a 201 is only a success
// once the tag is read back at the expected commit; the token never printed.
//
// The "forge" is a local bare repository served over file:// (the git
// protocol side) and a loopback HTTP server (the release API side). The API
// side creates the tag in the bare repository, as a real forge would, unless a
// test asks it to lie.

const TOKEN = "fixture-credential-5b1e9c";
const OWNER_REPOSITORY = "fixture-owner/fixture-product";
const SERVED = "trunk";
const IDENTITY = {
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

interface PostedRelease {
  readonly path: string;
  readonly authorization: string | null;
  readonly body: unknown;
}

type ForgeReply = (posted: PostedRelease) => Promise<Response>;

let workspace = "";
let forgeRoot = "";
let bareRepository = "";
let checkout = "";
let current = "";
let other = "";
let posted: PostedRelease[] = [];
let reply: ForgeReply = async () => new Response(null, { status: 500 });
let server: ReturnType<typeof Bun.serve> | undefined;

function git(args: readonly string[]): string {
  const ran = Bun.spawnSync(["git", "--git-dir", bareRepository, ...args], {
    env: { PATH: process.env.PATH ?? "", HOME: workspace, ...IDENTITY },
  });
  if (ran.exitCode !== 0) throw new Error(`fixture git ${args.join(" ")}: ${ran.stderr}`);
  return ran.stdout.toString().trim();
}

/** The release API creates the tag at the requested commit, then answers 201. */
const honestForge: ForgeReply = async (release) => {
  const body = release.body as { tag_name: string; target_commitish: string };
  git(["tag", body.tag_name, body.target_commitish]);
  return Response.json({ id: 1 }, { status: 201 });
};

function environment(overrides: Record<string, string | undefined> = {}) {
  const port = server?.port;
  return {
    GITHUB_SERVER_URL: `file://${forgeRoot}`,
    GITHUB_API_URL: `http://127.0.0.1:${port}`,
    GITHUB_REPOSITORY: OWNER_REPOSITORY,
    GITHUB_SHA: current,
    GITHUB_REF: `refs/heads/${SERVED}`,
    GITHUB_TOKEN: TOKEN,
    ...overrides,
  };
}

async function run(
  args: readonly string[] = [],
  overrides: Record<string, string | undefined> = {},
): Promise<TagReleaseResult> {
  const result = await tagRelease({
    args,
    environment: environment(overrides),
    repositoryRoot: checkout,
  });
  // Invariant over every run: the token never reaches the output.
  expect(result.lines.join("\n")).not.toContain(TOKEN);
  return result;
}

function tagsAt(name: string): string {
  return git(["for-each-ref", "--format=%(objectname) %(*objectname)", `refs/tags/${name}`]);
}

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const release: PostedRelease = {
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      };
      posted.push(release);
      return await reply(release);
    },
  });
});

afterAll(() => {
  server?.stop(true);
});

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "tag-release-"));
  forgeRoot = join(workspace, "forge");
  bareRepository = join(forgeRoot, `${OWNER_REPOSITORY}.git`);
  checkout = join(workspace, "checkout");
  await mkdir(checkout, { recursive: true });
  await mkdir(bareRepository, { recursive: true });
  git(["init", "--quiet", "--bare"]);
  other = git(["commit-tree", EMPTY_TREE, "-m", "first"]);
  current = git(["commit-tree", EMPTY_TREE, "-p", other, "-m", "second"]);
  git(["update-ref", `refs/heads/${SERVED}`, current]);
  git(["update-ref", "refs/heads/feature", current]);
  git(["symbolic-ref", "HEAD", `refs/heads/${SERVED}`]);
  await writeFile(join(checkout, "VERSION"), "1.2.3\n");
  posted = [];
  reply = honestForge;
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("tag-release on the served branch", () => {
  test("a free tag is created with the token at the pipeline commit, then read back", async () => {
    const result = await run();
    expect(result.code).toBe(0);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.path).toBe(`/repos/${OWNER_REPOSITORY}/releases`);
    expect(posted[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(posted[0]?.body).toEqual({
      tag_name: "v1.2.3",
      target_commitish: current,
      name: "v1.2.3",
    });
    expect(tagsAt("v1.2.3")).toStartWith(current);
    expect(result.lines).toContain("version: 1.2.3");
    expect(result.lines).toContain("tag: v1.2.3");
    expect(result.lines).toContain(`commit: ${current}`);
    expect(result.lines).toContain(`branch: ${SERVED}`);
  });

  test("the second run on the same commit changes nothing", async () => {
    expect((await run()).code).toBe(0);
    expect(posted).toHaveLength(1);
    const second = await run();
    expect(second.code).toBe(0);
    expect(posted).toHaveLength(1);
  });

  test("a lightweight tag at another commit is refused and nothing is posted", async () => {
    git(["tag", "v1.2.3", other]);
    const result = await run();
    expect(result.code).toBe(1);
    expect(posted).toHaveLength(0);
  });

  test("an annotated tag is peeled: at another commit it is refused", async () => {
    git(["tag", "-a", "v1.2.3", "-m", "release", other]);
    const result = await run();
    expect(result.code).toBe(1);
    expect(posted).toHaveLength(0);
  });

  test("an annotated tag is peeled: at the pipeline commit it is already done", async () => {
    git(["tag", "-a", "v1.2.3", "-m", "release", current]);
    const result = await run();
    expect(result.code).toBe(0);
    expect(posted).toHaveLength(0);
  });

  test("a neighbouring tag sharing the prefix is not the tag", async () => {
    git(["tag", "v1.2.30", other]);
    const result = await run();
    expect(result.code).toBe(0);
    expect(posted).toHaveLength(1);
  });

  test("a forge refusal is code 3, prints the HTTP status, a bounded message, no token", async () => {
    const long = `bad credential ${TOKEN} ${"x".repeat(400)}`;
    reply = async () => Response.json({ message: long }, { status: 422 });
    const result = await run();
    expect(result.code).toBe(3);
    const output = result.lines.join("\n");
    expect(output).toContain("HTTP 422");
    expect(output).toContain("bad credential");
    // The brief bounds the forge's message to 200 characters: measured on the
    // line itself, with a message whose useful part is longer than that.
    const prefix = "forge message: ";
    const messageLine = result.lines.find((line) => line.startsWith(prefix));
    expect(messageLine).toBeDefined();
    expect((messageLine ?? "").length - prefix.length).toBe(200);
  });

  test("a connection cut while the forge's body is read is code 3, never a crash", async () => {
    // Headers of a 422 are sent, then the connection closes before the body
    // the Content-Length announces.
    const cutting = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          socket.write(
            "HTTP/1.1 422 Unprocessable Entity\r\nContent-Type: application/json\r\n" +
              'Content-Length: 1000\r\n\r\n{"mess',
          );
          socket.end();
        },
      },
    });
    try {
      const result = await run([], { GITHUB_API_URL: `http://127.0.0.1:${cutting.port}` });
      expect(result.code).toBe(3);
      expect(result.lines).toContain("unreachable: the release API did not answer");
      expect(result.lines.some((line) => line.startsWith("version: "))).toBe(true);
    } finally {
      cutting.stop(true);
    }
  });

  test("a redirect from the release API is not followed: the token stays home", async () => {
    const reached: string[] = [];
    const target = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        reached.push(request.headers.get("authorization") ?? "");
        return Response.json({ id: 1 }, { status: 201 });
      },
    });
    try {
      reply = async () =>
        new Response(null, {
          status: 307,
          headers: { Location: `http://127.0.0.1:${target.port}/elsewhere` },
        });
      const result = await run();
      expect(result.code).toBe(3);
      expect(result.lines).toContain("forge: HTTP 307");
      expect(reached).toHaveLength(0);
    } finally {
      target.stop(true);
    }
  });

  test("a forge message cannot inject lines into the log", async () => {
    reply = async () =>
      Response.json({ message: "denied\n::error::injected\r\nnext" }, { status: 403 });
    const result = await run();
    expect(result.code).toBe(3);
    expect(result.lines.some((line) => line.startsWith("::error::"))).toBe(false);
    for (const line of result.lines) expect(line).not.toMatch(/[\r\n]/);
  });

  test("the forge body is never printed beyond its message", async () => {
    reply = async () =>
      Response.json({ message: "nope", documentation_url: "body-only-marker" }, { status: 401 });
    const result = await run();
    expect(result.code).toBe(3);
    expect(result.lines.join("\n")).not.toContain("body-only-marker");
  });

  test("a 201 without the tag is a failure", async () => {
    reply = async () => Response.json({ id: 1 }, { status: 201 });
    const result = await run();
    expect(result.code).toBe(3);
  });

  test("a 201 with the tag at another commit is a failure", async () => {
    reply = async (release) => {
      const body = release.body as { tag_name: string };
      git(["tag", body.tag_name, other]);
      return Response.json({ id: 1 }, { status: 201 });
    };
    const result = await run();
    expect(result.code).toBe(3);
  });

  test("an unreachable release API is code 3", async () => {
    const result = await run([], { GITHUB_API_URL: "http://127.0.0.1:1" });
    expect(result.code).toBe(3);
  });

  test("a missing token is a usage error once a tag must be created", async () => {
    const result = await run([], { GITHUB_TOKEN: undefined });
    expect(result.code).toBe(2);
    expect(posted).toHaveLength(0);
  });

  test("a pushed tag named like the served branch is not the served branch", async () => {
    const result = await run([], { GITHUB_REF: `refs/tags/${SERVED}` });
    expect(result.code).toBe(0);
    expect(result.lines).toContain("mode: check");
    expect(posted).toHaveLength(0);
    expect(tagsAt("v1.2.3")).toBe("");
  });

  test("a branch ending in HEAD or in the tag path does not block the run", async () => {
    git(["update-ref", "refs/heads/x/HEAD", other]);
    git(["update-ref", "refs/heads/refs/tags/v1.2.3", other]);
    // A symbolic ref ending in HEAD is listed twice: its `ref:` line and its value.
    git(["symbolic-ref", "refs/heads/y/HEAD", "refs/heads/feature"]);
    const result = await run();
    expect(result.code).toBe(0);
    expect(posted).toHaveLength(1);
    expect(tagsAt("v1.2.3")).toStartWith(current);
    expect(result.lines.some((line) => /, 4 ignored,/.test(line))).toBe(true);
  });

  test("--check on the served branch creates nothing", async () => {
    const result = await run(["--check"]);
    expect(result.code).toBe(0);
    expect(posted).toHaveLength(0);
    expect(tagsAt("v1.2.3")).toBe("");
  });
});

describe("tag-release off the served branch", () => {
  test("tag mode posts nothing when the tag is free", async () => {
    const result = await run([], { GITHUB_REF: "refs/heads/feature" });
    expect(result.code).toBe(0);
    expect(posted).toHaveLength(0);
    expect(tagsAt("v1.2.3")).toBe("");
  });

  test("a version that was not bumped is the same refusal", async () => {
    git(["tag", "v1.2.3", other]);
    const tagMode = await run([], { GITHUB_REF: "refs/heads/feature" });
    const checkMode = await run(["--check"], { GITHUB_REF: "refs/heads/feature" });
    expect(tagMode.code).toBe(1);
    expect(checkMode.code).toBe(1);
    expect(posted).toHaveLength(0);
  });

  test("the default branch is asked to the protocol, not assumed", async () => {
    git(["symbolic-ref", "HEAD", "refs/heads/feature"]);
    const result = await run();
    expect(result.code).toBe(0);
    expect(posted).toHaveLength(0);
  });
});

describe("tag-release refusals and usage", () => {
  test("a malformed version is refused", async () => {
    for (const content of ["1.2\n", "v1.2.3\n", "1.2.3-rc.1\n", "01.2.3\n", "1.2.3\n4.5.6\n"]) {
      await writeFile(join(checkout, "VERSION"), content);
      const result = await run();
      expect(result.code).toBe(1);
    }
    expect(posted).toHaveLength(0);
  });

  test("an unreadable version file is a usage error", async () => {
    await rm(join(checkout, "VERSION"));
    expect((await run()).code).toBe(2);
  });

  test("an unknown argument is a usage error", async () => {
    expect((await run(["--force"])).code).toBe(2);
    expect((await run(["--check", "--check"])).code).toBe(2);
  });

  test("a missing or malformed variable is a usage error", async () => {
    expect((await run([], { GITHUB_SHA: undefined })).code).toBe(2);
    expect((await run([], { GITHUB_SHA: "HEAD" })).code).toBe(2);
    expect((await run([], { GITHUB_REPOSITORY: "../escape" })).code).toBe(2);
    expect((await run([], { GITHUB_REPOSITORY: "a/../b" })).code).toBe(2);
    expect((await run([], { GITHUB_REF: undefined })).code).toBe(2);
    expect((await run([], { GITHUB_REF: "trunk" })).code).toBe(2);
    expect((await run([], { GITHUB_REF: "refs/heads/x\n::error::y" })).code).toBe(2);
    expect((await run([], { GITHUB_SERVER_URL: "ssh://host/x" })).code).toBe(2);
    expect((await run([], { GITHUB_API_URL: "http://forge.example/api" })).code).toBe(2);
    expect((await run([], { GITHUB_API_URL: "https://user:pw@example.org/api" })).code).toBe(2);
    expect(posted).toHaveLength(0);
  });

  test("an unreadable remote is code 3, never a free tag", async () => {
    const result = await run([], { GITHUB_REPOSITORY: "fixture-owner/absent" });
    expect(result.code).toBe(3);
    expect(posted).toHaveLength(0);
  });

  test("a remote with no symbolic HEAD is code 3, never a free tag", async () => {
    git(["update-ref", "--no-deref", "HEAD", current]);
    const result = await run();
    expect(result.code).toBe(3);
    expect(result.lines).toContain("unreachable: the remote reports no served branch");
    expect(posted).toHaveLength(0);
  });

  test("a git that does not answer is stopped and is code 3", async () => {
    const bin = join(workspace, "bin");
    await mkdir(bin, { recursive: true });
    const fake = join(bin, "git");
    await writeFile(fake, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
    const started = performance.now();
    let result: TagReleaseResult;
    try {
      result = await tagRelease({
        args: [],
        environment: environment(),
        repositoryRoot: checkout,
        timeoutMs: 500,
      });
    } finally {
      process.env.PATH = path;
    }
    expect(result.code).toBe(3);
    expect(result.lines).toContain("unreachable: git ls-remote did not answer");
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(posted).toHaveLength(0);
  });

  test("an unexpected error is code 3 with the lines gathered, its message unprinted", async () => {
    const values = environment();
    const throwing = new Proxy(values, {
      get(target, property) {
        if (property === "GITHUB_SHA") throw new TypeError(`leak ${TOKEN}`);
        return Reflect.get(target, property);
      },
    });
    const result = await tagRelease({ args: [], environment: throwing, repositoryRoot: checkout });
    expect(result.code).toBe(3);
    expect(result.lines).toContain("unexpected: TypeError");
    expect(result.lines.join("\n")).not.toContain(TOKEN);
  });

  test("the volume read on the remote is printed", async () => {
    const result = await run(["--check"]);
    expect(result.lines.some((line) => /^remote: \d+ ref line\(s\) read/.test(line))).toBe(true);
  });
});
