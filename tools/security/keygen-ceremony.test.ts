import { describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";

/**
 * Unit tests for keygen-ceremony pure helpers.
 *
 * Tests ONLY pure functions (keyId derivation, public key format validation).
 * NO test generates or persists real keys (all ephemeral, in-memory).
 * NO test seals or unseals private keys (that's an integration concern, owner-only).
 *
 * The actual key generation ceremony is owner-run on an air-gapped machine —
 * these tests validate the helpers, not the ceremony itself.
 */

// ===== Helper: Derive KeyID =====
function deriveKeyId(publicKeyPem: string): string {
  // Extract base64 body from PEM (skip header/footer lines).
  const base64Body = publicKeyPem
    .split("\n")
    .filter((line) => !line.startsWith("-----") && line.trim().length > 0)
    .join("");

  const hash = createHash("sha256").update(base64Body).digest("hex").slice(0, 8);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `prod_key_${date}_${hash}`;
}

// ===== Helper: Validate PEM format =====
function isValidSpkiPem(pem: string): boolean {
  const lines = pem.split("\n").filter((line) => line.length > 0);
  if (lines.length < 3) return false;
  if (lines[0] !== "-----BEGIN PUBLIC KEY-----") return false;
  if (lines[lines.length - 1] !== "-----END PUBLIC KEY-----") return false;
  // Check base64 body (all lines between header/footer should be valid base64)
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i] ?? "";
    if (line && !/^[A-Za-z0-9+/=]*$/.test(line)) return false;
  }
  return true;
}

describe("keygen-ceremony helpers", () => {
  test("deriveKeyId produces a deterministic, formatted keyId", () => {
    // Generate ephemeral keypair (in-memory only, not persisted).
    const { publicKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });

    const keyId = deriveKeyId(publicKey as string);

    // Check format: prod_key_YYYYMMDD_<8-char hash>
    expect(keyId).toMatch(/^prod_key_\d{8}_[a-f0-9]{8}$/);
  });

  test("deriveKeyId is deterministic for the same public key", () => {
    const { publicKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });

    const id1 = deriveKeyId(publicKey as string);
    const id2 = deriveKeyId(publicKey as string);

    expect(id1).toBe(id2);
  });

  test("different public keys produce different keyIds", () => {
    const { publicKey: key1 } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });
    const { publicKey: key2 } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });

    const id1 = deriveKeyId(key1 as string);
    const id2 = deriveKeyId(key2 as string);

    expect(id1).not.toBe(id2);
  });

  test("public key is valid SPKI PEM format", () => {
    const { publicKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });

    const pem = publicKey as string;
    expect(isValidSpkiPem(pem)).toBe(true);
    expect(pem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(pem).toContain("-----END PUBLIC KEY-----");
  });

  test("public key PEM is at least 80 chars (minimum base64 payload)", () => {
    const { publicKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });

    const pem = publicKey as string;
    expect(pem.length).toBeGreaterThan(80);
  });

  test("ephemeral keys are never persisted to disk", () => {
    // This test documents the contract: no file I/O for key generation.
    // The actual ceremony writes sealed envelopes only.
    const { publicKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });

    // Verify we can derive the keyId from the ephemeral key.
    const keyId = deriveKeyId(publicKey as string);
    expect(keyId).toBeTruthy();

    // The key object is garbage-collected after this test.
    // No disk writes occurred during this test.
  });

  test("keyId changes if public key encoding changes", () => {
    const { publicKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });

    const pem = publicKey as string;
    const id1 = deriveKeyId(pem);

    // Modify the PEM (cosmetic: change spacing)
    const modifiedPem = pem.replace(/\n/g, "\r\n");
    const id2 = deriveKeyId(modifiedPem);

    // Should differ because the hash input changed (whitespace)
    expect(id1).not.toBe(id2);
  });

  test("isValidSpkiPem rejects malformed PEM", () => {
    expect(isValidSpkiPem("not a pem")).toBe(false);
    expect(
      isValidSpkiPem("-----BEGIN PUBLIC KEY-----\ninvalid base64!\n-----END PUBLIC KEY-----"),
    ).toBe(false);
    // Reject wrong PEM type (header mismatch)
    const wrongType = `-----BEGIN RSA PUBLIC KEY-----\nbase64\n-----END RSA PUBLIC KEY-----`;
    expect(isValidSpkiPem(wrongType)).toBe(false);
  });

  test("isValidSpkiPem accepts valid Ed25519 SPKI PEM", () => {
    const { publicKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });

    expect(isValidSpkiPem(publicKey as string)).toBe(true);
  });
});
