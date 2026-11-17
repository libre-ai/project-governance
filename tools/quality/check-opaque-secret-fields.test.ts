import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type OpaqueSecretFinding,
  type OpaqueSecretLabel,
  scanOpaqueSecretFields,
} from "./check-opaque-secret-fields";
import { scanForSecrets } from "./check-secret-scan";

/**
 * Every positive fixture is assembled at run time (repetition, concatenation,
 * base64 computed here): no line of this file has the shape of a credential,
 * which the last test checks against the tree-wide secret gate itself.
 */

const PATH = "config/service.json";

/** 64 hexadecimal characters. */
const hex64 = "0123456789abcdef".repeat(4);
/** 40 characters of the base64 alphabet with a digit, an uppercase and a lowercase. */
const opaque40 = "aB3dE6gH9k".repeat(4);
/** 24 lowercase letters: base64-shaped, not opaque. */
const word24 = "abcdefgh".repeat(3);

/** A forge token of a known issuer shape, never written in one piece. */
const forgeToken = ["gh", "p_", "a1B2".repeat(6)].join("");
/** A plain-text prefix whose base64 carries both `+` and `/`, so the two alphabets differ. */
const alphabetProbe = `${"?".repeat(2)}>${"?".repeat(3)}`;
const encodedToken = btoa(`${alphabetProbe}${forgeToken}`);
const encodedTokenUrlSafe = encodedToken
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replaceAll("=", "");

const uriScheme = ["postgresql", "//"].join(":");
const uriPassword = "p".repeat(12);
function credentialledUri(host: string): string {
  return [uriScheme, "user:", uriPassword, "@", host, "/app"].join("");
}

/** `"name": "value"`, both quoted. */
function pair(name: string, value: string): string {
  return `  "${name}": "${value}",`;
}

/** `name = "value"`, the name unquoted. */
function assign(name: string, value: string): string {
  return `${name} = "${value}"`;
}

function labels(content: string): OpaqueSecretLabel[] {
  return scanOpaqueSecretFields([{ path: PATH, content }]).map((finding) => finding.label);
}

describe("fixtures are what the brief says they are", () => {
  test("lengths and alphabets", () => {
    expect(hex64).toHaveLength(64);
    expect(opaque40).toHaveLength(40);
    expect(word24).toHaveLength(24);
    expect(encodedToken).toContain("+");
    expect(encodedToken).toContain("/");
    expect(encodedToken.endsWith("=")).toBe(true);
    expect(encodedTokenUrlSafe).not.toMatch(/[+/=]/);
  });
});

describe("opaque-hex-field", () => {
  test("a quoted apiKey field holding 64 hexadecimal characters is exactly one finding", () => {
    const expected: OpaqueSecretFinding[] = [{ path: PATH, label: "opaque-hex-field" }];
    expect(scanOpaqueSecretFields([{ path: PATH, content: pair("apiKey", hex64) }])).toEqual(
      expected,
    );
  });

  test("the threshold is 32 hexadecimal characters", () => {
    expect(labels(pair("authValue", "0123456789abcdef".repeat(2)))).toEqual(["opaque-hex-field"]);
    expect(labels(pair("authValue", "0123456789abcdef".repeat(2).slice(1)))).toEqual([]);
  });

  test("a description field holding 64 hexadecimal characters is not evocative", () => {
    expect(labels(pair("description", hex64))).toEqual([]);
  });

  test("an unquoted name is not an opaque field", () => {
    expect(labels(assign("authValue", hex64))).toEqual([]);
  });

  test("each evocative fragment is read, whatever the case", () => {
    const names = [
      "clientSecret",
      "CREDENTIALS",
      "userPassw",
      "dbPwd",
      "accessToken",
      "privateValue",
      "apikey",
      "API_KEY",
      "api-key",
      "authValue",
      "bearerValue",
    ];
    for (const name of names) {
      expect([name, labels(pair(name, hex64))]).toEqual([name, ["opaque-hex-field"]]);
    }
  });
});

describe("opaque-base64-field", () => {
  test("a credentials field holding 40 opaque base64 characters is exactly one finding", () => {
    expect(labels(pair("credentials", opaque40))).toEqual(["opaque-base64-field"]);
  });

  test("the URL-safe alphabet and trailing padding are base64 too", () => {
    expect(labels(pair("credentials", `${opaque40.slice(0, 30)}-_`))).toEqual([
      "opaque-base64-field",
    ]);
    expect(labels(pair("credentials", `${opaque40.slice(0, 30)}+/==`))).toEqual([
      "opaque-base64-field",
    ]);
    expect(labels(pair("credentials", `${opaque40.slice(0, 30)}+_`))).toEqual([]);
  });

  test("the threshold is 20 characters", () => {
    expect(labels(pair("credentials", opaque40.slice(0, 20)))).toEqual(["opaque-base64-field"]);
    expect(labels(pair("credentials", opaque40.slice(0, 19)))).toEqual([]);
  });

  test("opaque means a digit, an uppercase and a lowercase together", () => {
    expect(labels(pair("credentials", "aBcDeFgHiJ".repeat(2)))).toEqual([]);
    expect(labels(pair("credentials", "a1c2e3g4i5".repeat(2)))).toEqual([]);
    expect(labels(pair("credentials", "A1C2E3G4I5".repeat(2)))).toEqual([]);
  });

  test("a 24-letter lowercase word under an evocative name is not opaque", () => {
    expect(labels(pair("credentials", word24))).toEqual([]);
    expect(labels(pair("accessToken", word24))).not.toContain("opaque-base64-field");
  });

  test("a value that is also hexadecimal is reported as hexadecimal only", () => {
    const mixedCaseHex = "0123456789abcDEF".repeat(2);
    expect(labels(pair("credentials", mixedCaseHex))).toEqual(["opaque-hex-field"]);
  });
});

describe("secret-named-literal", () => {
  test("pwd assigned an 8-character literal is a finding, 7 characters is not", () => {
    expect(labels(assign("pwd", "x".repeat(8)))).toEqual(["secret-named-literal"]);
    expect(labels(assign("pwd", "x".repeat(7)))).toEqual([]);
  });

  test("both separators, both quotes, quoted and unquoted names", () => {
    const literal = "x".repeat(8);
    expect(labels(`password: '${literal}'`)).toEqual(["secret-named-literal"]);
    expect(labels(pair("passwd", literal))).toEqual(["secret-named-literal"]);
    expect(labels(`const sessionToken="${literal}";`)).toEqual(["secret-named-literal"]);
    expect(labels(`api-key = "${literal}"`)).toEqual(["secret-named-literal"]);
  });

  test("a name outside the list, a comparison and a bare string are not findings", () => {
    const literal = "x".repeat(8);
    expect(labels(assign("label", literal))).toEqual([]);
    expect(labels(`if (pwd == "${literal}") {}`)).toEqual([]);
    expect(labels(`log("${literal}")`)).toEqual([]);
    expect(labels(`pwd("${literal}")`)).toEqual([]);
    expect(labels(`pwd "${literal}"`)).toEqual([]);
  });

  test("each fragment of the list is read, whatever the case", () => {
    const names = [
      "clientSecret",
      "PASSWORD",
      "passwd",
      "dbPwd",
      "accessToken",
      "apikey",
      "API_KEY",
      "api-key",
    ];
    for (const name of names) {
      expect([name, labels(assign(name, "x".repeat(8)))]).toEqual([name, ["secret-named-literal"]]);
    }
  });

  test("an escaped quote does not end the literal", () => {
    expect(labels(assign("pwd", `ab\\"${"x".repeat(5)}`))).toEqual(["secret-named-literal"]);
  });
});

describe("exemptions", () => {
  test("a: a secretRef field whose value starts with ref:// is not a finding", () => {
    expect(labels(pair("secretRef", `ref://vault/${"x".repeat(8)}`))).toEqual([]);
    expect(labels(pair("secretRef", `ref://${hex64}`))).toEqual([]);
  });

  test("b: a tokenHash field holding sha256: and 64 hexadecimal characters is not a finding", () => {
    expect(labels(pair("tokenHash", `sha256:${hex64}`))).toEqual([]);
  });

  test("b: the fingerprint prefixes exempt the value under a name that is not a fingerprint name", () => {
    expect(labels(pair("accessToken", `sha256:${hex64}`))).toEqual([]);
    expect(labels(pair("accessToken", `fp:${hex64}`))).toEqual([]);
  });

  test("c: a tokenDigest field holding 64 bare hexadecimal characters is not a finding", () => {
    expect(labels(pair("tokenDigest", hex64))).toEqual([]);
    for (const name of ["tokenHash", "secretFingerprint", "PASSWORD_CHECKSUM"]) {
      expect([name, labels(pair(name, hex64))]).toEqual([name, []]);
    }
  });

  test("no exemption applies to an encoded credential", () => {
    expect(labels(pair("tokenDigest", encodedToken))).toEqual(["encoded-credential"]);
    expect(labels(pair("secretChecksum", encodedTokenUrlSafe))).toEqual(["encoded-credential"]);
  });
});

describe("encoded-credential", () => {
  test("the base64 of a forge token is a finding under any name, in both alphabets", () => {
    expect(labels(pair("note", encodedToken))).toEqual(["encoded-credential"]);
    expect(labels(pair("note", encodedTokenUrlSafe))).toEqual(["encoded-credential"]);
    expect(labels(`run("${encodedToken}")`)).toEqual(["encoded-credential"]);
  });

  test("a decoding that carries no known marker is not a finding", () => {
    const sentence = btoa("an ordinary sentence, long enough to be read");
    expect(labels(pair("note", sentence))).toEqual([]);
  });

  test("a binary decoding is not a finding, even around a known marker", () => {
    const binary = btoa(`${String.fromCharCode(0, 1, 2)}${forgeToken}`);
    expect(labels(pair("note", binary))).toEqual([]);
    const highBytes = btoa(String.fromCharCode(...Array.from({ length: 48 }, (_, at) => 200 + at)));
    expect(labels(pair("note", highBytes))).toEqual([]);
  });

  test("the RFC 2606 rule of the scanner is inherited, not redefined", () => {
    const reserved = btoa(credentialledUri("db.example.org"));
    const provisioned = btoa(credentialledUri("db.internal-host.net"));
    expect(labels(pair("note", reserved))).toEqual([]);
    expect(labels(pair("note", provisioned))).toEqual(["encoded-credential"]);
  });

  test("the threshold is 24 characters", () => {
    // The shortest issuer shape of the scanner: 15 characters, 20 once encoded.
    const shortToken = ["xo", "xb-", "a".repeat(10)].join("");
    expect(btoa(shortToken)).toHaveLength(20);
    expect(labels(pair("note", btoa(shortToken)))).toEqual([]);
    expect(btoa(`${shortToken}aaa`)).toHaveLength(24);
    expect(labels(pair("note", btoa(`${shortToken}aaa`)))).toEqual(["encoded-credential"]);
  });

  test("a string outside the base64 alphabet is not decoded", () => {
    const spaced = `${encodedToken.slice(0, 8)} ${encodedToken.slice(8)}`;
    expect(labels(pair("note", spaced))).toEqual([]);
  });
});

describe("findings", () => {
  test("one finding per path and label, sorted by path then label", () => {
    const three = [pair("apiKey", hex64), pair("authValue", hex64), pair("dbPwd", hex64)].join(
      "\n",
    );
    expect(labels(three)).toEqual(["opaque-hex-field"]);

    const two = [pair("apiKey", hex64), assign("pwd", "x".repeat(8))].join("\n");
    expect(labels(two)).toEqual(["opaque-hex-field", "secret-named-literal"]);

    const expected: OpaqueSecretFinding[] = [
      { path: "a.json", label: "encoded-credential" },
      { path: "a.json", label: "opaque-base64-field" },
      { path: "b.json", label: "opaque-hex-field" },
      { path: "b.json", label: "secret-named-literal" },
    ];
    expect(
      scanOpaqueSecretFields([
        { path: "b.json", content: two },
        {
          path: "a.json",
          content: [pair("credentials", opaque40), pair("note", encodedToken)].join("\n"),
        },
        { path: "b.json", content: assign("pwd", "x".repeat(8)) },
      ]),
    ).toEqual(expected);
  });

  test("a finding carries neither the value nor the field name", () => {
    const content = [
      pair("apiKey", hex64),
      pair("credentials", opaque40),
      assign("pwd", "x".repeat(8)),
      pair("note", encodedToken),
    ].join("\n");
    const findings = scanOpaqueSecretFields([{ path: PATH, content }]);
    expect(findings).toHaveLength(4);
    const rendered = JSON.stringify(findings);
    for (const hidden of [hex64, opaque40, "x".repeat(8), encodedToken, forgeToken, "apiKey"]) {
      expect(rendered).not.toContain(hidden);
    }
    for (const finding of findings) expect(Object.keys(finding).sort()).toEqual(["label", "path"]);
  });

  test("no content raises, and nothing is found in none", () => {
    const contents = [
      "",
      "\n\n",
      '"',
      "'\"'",
      '="',
      `:"${"\\".repeat(9)}"`,
      String.fromCharCode(0, 0xd800, 0xffff),
      // 25 base64 characters: a length no base64 decoder accepts.
      `"${"A".repeat(25)}"`,
    ];
    for (const content of contents) {
      expect(scanOpaqueSecretFields([{ path: PATH, content }])).toEqual([]);
    }
    expect(scanOpaqueSecretFields([])).toEqual([]);
  });

  test("stays bounded on one 65 536-character line", () => {
    const maximum = 65_536;
    const cases = [
      "Ab1+".repeat(maximum / 4),
      `"${"Ab1+".repeat(maximum / 4)}"`,
      `"credentials": "${"Ab1_".repeat(maximum / 4)}`,
      '"'.repeat(maximum),
      `'${'"'.repeat(maximum)}`,
      'a="'.repeat(maximum / 3),
      "\\'".repeat(maximum / 2),
      `${"a".repeat(maximum)}="${"b".repeat(4)}"`,
    ];
    const started = Bun.nanoseconds();
    for (const content of cases) expect(labels(content)).toEqual([]);
    expect(labels(`"credentials": "${"Ab1_".repeat(maximum / 4)}"`)).toEqual([
      "opaque-base64-field",
    ]);
    expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(2_000);
  });
});

describe("the fixtures of this lot carry no credential shape", () => {
  const sources = [
    "tools/quality/check-opaque-secret-fields.test.ts",
    "tools/quality/check-opaque-secret-fields.process.test.ts",
  ];

  test("the tree-wide secret gate finds nothing in either test source", async () => {
    const targets = await Promise.all(
      sources.map(async (path) => ({
        path,
        content: await Bun.file(join(import.meta.dir, "..", "..", path)).text(),
      })),
    );
    for (const target of targets) expect(target.content.length).toBeGreaterThan(0);
    expect(scanForSecrets(targets)).toEqual([]);
    // Control: the same gate, at the same path, does see the assembled token.
    expect(scanForSecrets([{ path: sources[0] ?? "", content: forgeToken }])).toEqual([
      { path: sources[0] ?? "", line: 1 },
    ]);
  });
});
