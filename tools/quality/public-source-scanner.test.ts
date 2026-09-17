import { describe, expect, test } from "bun:test";

import {
  containsCredentialMarker,
  containsEmailIdentifier,
  containsEmailIdentifierExcludingRfc2606Examples,
  containsSensitivePublicMarker,
  decodeSensitiveMarkers,
  publicSourceScannerSelfTestFailures,
  publicSourceScannerSelfTests,
} from "./public-source-scanner";

function emailFixture(local: string, domain: string): string {
  return [local, "@", domain].join("");
}

describe("email identifier line boundaries", () => {
  test.each([
    ["bare LF before at-sign", emailFixture("markdown\n", "AGENTS.md")],
    ["bare CR before at-sign", emailFixture("markdown\r", "AGENTS.md")],
    ["bare CRLF without WSP before at-sign", emailFixture("markdown\r\n", "AGENTS.md")],
    ["bare LF after at-sign", "alice@\ncustomer.company"],
    ["bare CR after at-sign", "alice@\rcustomer.company"],
    ["bare CRLF without WSP after at-sign", "alice@\r\ncustomer.company"],
  ])("does not join independent lines: %s", (_label, value) => {
    expect(containsEmailIdentifier(value)).toBe(false);
    expect(containsEmailIdentifierExcludingRfc2606Examples(value)).toBe(false);
  });

  test.each([
    ["same-line SP/HTAB", "alice \t @ \t customer.company"],
    ["folding before at-sign", emailFixture("alice\r\n \t", "example.company")],
    ["folding after at-sign", "alice@\r\n \texample.company"],
    ["folding on both sides", "alice\r\n \t@\r\n  example.company"],
  ])("recognizes explicit folding whitespace: %s", (_label, value) => {
    expect(containsEmailIdentifier(value)).toBe(true);
    expect(containsEmailIdentifierExcludingRfc2606Examples(value)).toBe(true);
  });

  test.each([
    "markdown%0A%40AGENTS.md",
    "markdown%0D%40AGENTS.md",
    "markdown&#10;&commat;AGENTS&period;md",
  ])("keeps a decoded bare line break as a hard boundary", (value) => {
    expect(containsEmailIdentifierExcludingRfc2606Examples(value)).toBe(false);
  });

  test("detects decoded valid CRLF folding", () => {
    expect(
      containsEmailIdentifierExcludingRfc2606Examples("alice%0D%0A%20%40customer%2Ecompany"),
    ).toBe(true);
  });

  test.each([
    ["comment before at-sign with LF", "alice(\n)@customer.company"],
    ["comment before at-sign with CR", "alice(\r)@customer.company"],
    ["comment before at-sign with non-folded CRLF", "alice(\r\n)@customer.company"],
    ["comment after at-sign with LF", "alice@(\n)customer.company"],
    ["nested comment with LF", "alice(outer(\n)tail)@customer.company"],
  ])("preserves a hard line boundary removed with a comment: %s", (_label, value) => {
    expect(containsEmailIdentifier(value)).toBe(false);
    expect(containsEmailIdentifierExcludingRfc2606Examples(value)).toBe(false);
  });

  test("preserves a decoded hard boundary inside a comment", () => {
    const value = "alice%28%0A%29%40customer%2Ecompany";

    expect(containsEmailIdentifierExcludingRfc2606Examples(value)).toBe(false);
    expect(containsSensitivePublicMarker(value)).toBe(false);
  });

  test("still recognizes a comment carrying valid CRLF plus WSP folding", () => {
    const value = "alice(\r\n )@customer.company";

    expect(containsEmailIdentifier(value)).toBe(true);
    expect(containsEmailIdentifierExcludingRfc2606Examples(value)).toBe(true);
  });

  test("still recognizes decoded valid folding inside a comment", () => {
    expect(
      containsEmailIdentifierExcludingRfc2606Examples("alice%28%0D%0A%20%29%40customer%2Ecompany"),
    ).toBe(true);
  });
});

describe("RFC 2606 example-aware email identifiers", () => {
  test.each([
    "alice@example.com",
    "alice@example.net",
    "alice@example.org",
    "alice@docs.libre-ai.example",
    "alice@docs.libre-ai.invalid",
    "alice@docs.libre-ai.test",
  ])("ignores only a canonical ASCII dot-atom example: %s", (value) => {
    expect(containsEmailIdentifier(value)).toBe(true);
    expect(containsEmailIdentifierExcludingRfc2606Examples(value)).toBe(false);
  });

  test.each([
    ["quoted", '"alice"@example.org'],
    ["commented local", "alice(comment)@example.org"],
    ["commented domain", "alice@(comment)example.org"],
    ["SMTPUTF8", "😀@example.org"],
    ["domain literal", "alice@[192.0.2.1]"],
    ["malformed label", "alice@bad_name.example"],
    ["leading-hyphen exact example", emailFixture("alice", "-example.org")],
    ["trailing-hyphen exact example", emailFixture("alice", "example-.org")],
    ["empty-label exact example", emailFixture("alice", "example..org")],
    ["percent-encoded", "alice%40example.org"],
    ["eight-digit Unicode escape", "alice%U00000040example.org"],
    ["HTML-encoded", "alice&commat;example&period;org"],
    ["NFKC at-sign", "alice＠example.org"],
    ["default-ignorable", "ali\u200bce@example.org"],
    ["comma inside apparent local", "ali,ce@example.org"],
    ["colon before trailing address", "unknown:alice@example.org"],
    ["semicolon inside apparent local", "ali;ce@example.org"],
    ["closing parenthesis before trailing address", "ali)ce@example.org"],
  ])("does not exempt a non-canonical reserved-domain form: %s", (_label, value) => {
    expect(containsEmailIdentifierExcludingRfc2606Examples(value)).toBe(true);
  });

  test.each([
    " ",
    ",",
    ";",
    ":",
    ")",
  ])("continues after an ignored example separated by %s", (separator) => {
    expect(
      containsEmailIdentifierExcludingRfc2606Examples(
        [
          emailFixture("first", "example.org"),
          separator,
          emailFixture("admin", "customer.company"),
        ].join(""),
      ),
    ).toBe(true);
  });

  test("detects a personal identifier before and between ignored examples", () => {
    expect(
      containsEmailIdentifierExcludingRfc2606Examples(
        [
          emailFixture("admin", "customer.company"),
          ",",
          emailFixture("first", "example.org"),
          ";",
          emailFixture("second", "example.net"),
        ].join(""),
      ),
    ).toBe(true);
    expect(
      containsEmailIdentifierExcludingRfc2606Examples(
        [
          emailFixture("first", "example.org"),
          ";",
          emailFixture("admin", "customer.company"),
          ":",
          emailFixture("second", "example.net"),
        ].join(""),
      ),
    ).toBe(true);
  });

  test("preserves raw provenance across mixed encoded and canonical candidates", () => {
    expect(
      containsEmailIdentifierExcludingRfc2606Examples(
        [
          emailFixture("first", "example.org"),
          ",second%40example.net;",
          emailFixture("admin", "customer.company"),
        ].join(""),
      ),
    ).toBe(true);
    expect(
      containsEmailIdentifierExcludingRfc2606Examples("first@example.org,second%40example.net"),
    ).toBe(true);
    expect(
      containsEmailIdentifierExcludingRfc2606Examples("alice@example.org,alice%40example.org"),
    ).toBe(true);
  });

  test.each([
    "alice@example.org%5F alice%40example.org",
    "alice@example.org%5F alice&commat;example&period;org",
    "alice@example.org(note)_ alice(comment)@example.org",
    "alice@example.org(note)_ alice@(comment)example.org",
    "alice%40example.org alice@example.org%5F",
    "alice(comment)@example.org alice@example.org(note)_",
    "alice@example.org%5F alice@example.org%5F alice%40example.org alice%40example.org",
  ])("does not transfer an exemption between source occurrences: %s", (value) => {
    expect(containsEmailIdentifierExcludingRfc2606Examples(value)).toBe(true);
  });

  test.each([
    "alice@example.org documentation%2Fguide",
    "alice@example.org documentation (note)",
  ])("does not taint a raw canonical example when unrelated text is projected: %s", (value) => {
    expect(containsEmailIdentifierExcludingRfc2606Examples(value)).toBe(false);
  });

  test("keeps adjacent canonical examples and email-labelled examples exempt", () => {
    expect(
      containsEmailIdentifierExcludingRfc2606Examples(
        "first@example.org,second@example.net;contact:third@example.com",
      ),
    ).toBe(false);
  });

  test("stays bounded while structurally rejecting many canonical candidates", () => {
    const value = "contact:a@example.org,".repeat(2_900);
    const started = Bun.nanoseconds();

    expect(containsEmailIdentifierExcludingRfc2606Examples(value)).toBe(false);
    expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(2_000);
  });

  test("scales near-linearly across repeated unmatched domain literals", () => {
    const small = "a@[".repeat(2_730);
    const large = "a@[".repeat(21_845);
    const medianElapsedPerRun = (value: string, runs: number): number => {
      const samples: number[] = [];
      containsEmailIdentifierExcludingRfc2606Examples(value);
      for (let sample = 0; sample < 5; sample += 1) {
        const started = Bun.nanoseconds();
        for (let run = 0; run < runs; run += 1)
          containsEmailIdentifierExcludingRfc2606Examples(value);
        samples.push((Bun.nanoseconds() - started) / runs);
      }
      samples.sort((left, right) => left - right);
      return samples[2] ?? Number.POSITIVE_INFINITY;
    };

    const smallElapsed = medianElapsedPerRun(small, 16);
    const largeElapsed = medianElapsedPerRun(large, 2);

    expect(largeElapsed / smallElapsed).toBeLessThan(14);
  });
});

describe("specialized-vector public-source scanner", () => {
  for (const [label, value, expectedSensitive] of publicSourceScannerSelfTests) {
    test(label, () => {
      expect(containsSensitivePublicMarker(value)).toBe(expectedSensitive);
    });
  }

  test("keeps the executable gate self-tests coherent", () => {
    expect(publicSourceScannerSelfTestFailures()).toEqual([]);
  });

  describe("credential marker — provisioned connection URIs", () => {
    // A provisioned connection string matches no vendor token shape, so the
    // credential path used to let `postgresql://user:pw@host/db` through every
    // per-PR gate while catching a GitHub token on the same line.
    const cases: ReadonlyArray<readonly [label: string, value: string, expected: boolean]> = [
      ["postgres URI with password", "postgresql://u:pw@db.internal.acme.fr:5432/mydb", true],
      ["redis URI with password", "redis://default:pw@cache-prod.acme.fr:6379", true],
      [
        "addon-host URI with password",
        "postgresql://u:pw@bXXX-postgresql.example-cloud.fr/db",
        true,
      ],
      ["vendor token still caught", "ghp_0000000000000000000000000000000000", true],
      // Empty-username userinfo is the canonical Redis form; percent-encoded
      // userinfo is the canonical Azure form. Both are credentials by position
      // (K4 review of f49fc18, findings 1-2: the positional regex missed both).
      ["empty-username redis URI", "redis://:tYm9x2QpLw7fVb@cache-prod.acme.fr:6379", true],
      [
        "empty-username postgres URI",
        "postgresql://:tYm9x2QpLw7fVb@db-prod.acme.fr:5432/appdb",
        true,
      ],
      ["percent-encoded @ in username", "postgresql://admin%40pgsrv:pw@db-prod.acme.fr/db", true],
      [
        "percent-encoded / in password",
        "postgresql://admin:tYm9%2Fx2QpLw7fVb@db-prod.acme.fr/db",
        true,
      ],
      // An empty password is not a credential: the userinfo is an identifier.
      ["empty-password userinfo", "postgresql://user:@db-prod.acme.fr/db", false],
      // RFC 2606 and localhost cannot name a provisioned service: an example.
      ["reserved-host example", "https://user:secret@example.org/feed.xml", false],
      ["reserved-host empty username", "redis://:pw@localhost:6379", false],
      ["localhost example", "amqp://u:pw@localhost:5672", false],
      // Userinfo without a password is an identifier, handled by the PII path.
      ["userinfo without password", "git://git@acme.fr/repo.git", false],
      ["plain URL", "https://github.com/libre-ai/libre-ai.git", false],
    ];
    for (const [label, value, expected] of cases) {
      test(label, () => {
        expect(containsCredentialMarker(value)).toBe(expected);
      });
    }
  });

  test("uses exact case-sensitive HTML5 names", () => {
    expect(decodeSensitiveMarkers("&commat;|&CommaT;|&alpha;|&QUOT;")).toBe('@|&CommaT;|α|"');
  });

  test("stays bounded on maximum adversarial strings", () => {
    const maximum = 65_536;
    const cases = [
      "a".repeat(maximum),
      "@".repeat(maximum),
      '""'.repeat(maximum / 2),
      `a@${"a.".repeat(32_760)}1`,
      `${"a".repeat(65_520)}"@example.org`,
      `${"&amp;".repeat(13_000)}text`,
      `${"(".repeat(32_760)}release@2${")".repeat(32_760)}`,
    ];
    const started = Bun.nanoseconds();
    for (const value of cases) expect(containsSensitivePublicMarker(value)).toBe(false);
    expect(
      containsSensitivePublicMarker(`${"(".repeat(32_750)}alice@example.org${")".repeat(32_750)}`),
    ).toBe(true);
    expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(2_000);
  });
});
