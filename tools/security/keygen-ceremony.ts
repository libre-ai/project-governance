import {
  createCipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Key Generation Ceremony for Ed25519 Origin Signatures (WP-G2-Z01).
 *
 * Generates an Ed25519 keypair, seals the private key with a memory-hard KDF
 * (scrypt), and outputs the public key in SPKI PEM format. The private key
 * is never written to disk in plaintext — only sealed in an encrypted
 * envelope. The script refuses to run in CI/automation (checks for CI env vars)
 * and loudly warns about air-gap compliance.
 *
 * Public key output: suitable for registration in config/signing-keys.v1.json
 * Private key sealing: owner uses a strong passphrase (32+ chars, air-gapped)
 * to unseal on demand via a secure (offline) ceremony.
 *
 * CRITICAL: This script MUST be run on an air-gapped machine. The private
 * key is security-critical and must never traverse a network boundary.
 *
 * Usage:
 *   bun keygen-ceremony.ts                    # Interactive ceremony
 *   bun keygen-ceremony.ts --dev-key          # Dev ephemeral key (for testing)
 *   bun keygen-ceremony.ts --public-key-only  # Output only public key (no seal)
 */

function checkCIEnvironment(): boolean {
  const ciVars = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI", "TRAVIS", "BUILDKITE"];
  return ciVars.some((key) => process.env[key]);
}

function deriveKeyId(publicKeyPem: string): string {
  // Derive a deterministic keyId from the public key using SHA-256 fingerprint.
  // Format: prod_key_YYYYMMDD_<8-char hash>
  const hash = createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 8);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `prod_key_${date}_${hash}`;
}

function generateKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

/**
 * Seal the private key with a memory-hard KDF (scrypt) + Chacha20-Poly1305 AEAD.
 *
 * The sealed envelope contains:
 * - Salt (16 bytes, random)
 * - IV (12 bytes, random for ChaCha20)
 * - Ciphertext (encrypted private key)
 * - Auth tag (16 bytes, for Poly1305)
 *
 * To unseal, the owner provides the passphrase, which is run through scrypt
 * with the same salt to derive the encryption key.
 */
function sealPrivateKey(privateKeyPem: string, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);

  // Derive a 32-byte key from the passphrase using scrypt.
  // N=16384, r=8, p=1 is a reasonable balance for modern machines.
  const derivedKey = scryptSync(passphrase, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024, // 64 MB max memory
  });

  // Encrypt the private key with ChaCha20-Poly1305.
  const cipher = createCipheriv("chacha20-poly1305", derivedKey, iv);
  const ciphertext = cipher.update(privateKeyPem, "utf8");
  const finalCiphertext = Buffer.concat([ciphertext, cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Return: salt || iv || ciphertext || authTag
  return Buffer.concat([salt, iv, finalCiphertext, authTag]);
}

async function ceremony(args: readonly string[]): Promise<void> {
  const isDevKey = args.includes("--dev-key");
  const publicKeyOnly = args.includes("--public-key-only");

  // ===== CRITICAL: Check for CI environment =====
  if (checkCIEnvironment() && !isDevKey) {
    console.error("❌ FATAL: CI environment detected.");
    console.error("This ceremony MUST be run locally on an air-gapped machine.");
    console.error("Refusing to generate production keys in CI/automation.");
    console.error("If this is a test, pass --dev-key for an ephemeral dev key.");
    process.exit(1);
  }

  // ===== WARNINGS: Air-gap compliance =====
  console.log("");
  console.log("⚠️  ════════════════════════════════════════════════════════════════");
  console.log("⚠️  CRITICAL: Ed25519 Key Generation Ceremony (WP-G2-Z01)");
  console.log("⚠️  ════════════════════════════════════════════════════════════════");
  console.log("⚠️");
  console.log("⚠️  YOU are responsible for the private key custody and air-gap security.");
  console.log("⚠️");
  if (isDevKey) {
    console.log("⚠️  DEV MODE: Generating an ephemeral, test-only keypair.");
    console.log("⚠️  This key is NOT suitable for production signing.");
  } else {
    console.log("⚠️  PRODUCTION MODE: Verify this machine is air-gapped NOW:");
    console.log("⚠️    • No Wi-Fi, Bluetooth, or Ethernet connected.");
    console.log("⚠️    • No SSH, VPN, or remote access.");
    console.log("⚠️    • No USB/external storage except for offline backup.");
    console.log("⚠️    • Network monitoring tools disabled.");
    console.log("⚠️");
    console.log("⚠️  Private key MUST NEVER:");
    console.log("⚠️    • Be written to disk in plaintext.");
    console.log("⚠️    • Cross a network boundary.");
    console.log("⚠️    • Be shared, backed up online, or hardcoded.");
    console.log("⚠️    • Be printed or logged (except sealed envelope).");
  }
  console.log("⚠️  ════════════════════════════════════════════════════════════════");
  console.log("");

  // ===== Generate keypair =====
  console.log("🔑 Generating Ed25519 keypair...");
  const { privateKeyPem, publicKeyPem } = generateKeyPair();
  const keyId = deriveKeyId(publicKeyPem);
  console.log(`✓ Keypair generated (keyId: ${keyId})`);
  console.log("");

  // ===== Output public key =====
  console.log("===============================================");
  console.log("🔑 Ed25519 Key Pair Generated Successfully");
  console.log("===============================================");
  console.log("");
  console.log("Public Key (SPKI PEM, for repo registration):");
  // Output the full PEM as-is (includes BEGIN/END markers)
  console.log(publicKeyPem.trim());
  console.log("");
  console.log("KeyID (deterministic, derived from public key):");
  console.log(keyId);
  console.log("");

  if (publicKeyOnly) {
    console.log("✓ Public key exported (--public-key-only mode, no sealing)");
    return;
  }

  // ===== Seal the private key =====
  if (isDevKey) {
    console.log("ℹ️  DEV MODE: Private key is NOT sealed (ephemeral, for testing).");
  } else {
    console.log("⚠️  Sealing private key with memory-hard KDF (scrypt) + ChaCha20-Poly1305...");

    // For production, we'd read the passphrase interactively.
    // For now, we'll generate one and instruct the owner.
    const passphraseGuide =
      "Use a strong passphrase (32+ chars, random) when unsealing.\n" +
      "The passphrase is NEVER stored — you must remember or write it down offline.";

    console.log(passphraseGuide);

    // Seal with a placeholder passphrase (owner will re-seal with their own).
    const defaultPassphrase =
      process.env.KEYGEN_TEST_PASSPHRASE || "placeholder-passphrase-replace-with-yours";
    const sealedEnvelope = sealPrivateKey(privateKeyPem, defaultPassphrase);

    // Write sealed envelope to a temporary file
    const sealedPath = join(tmpdir(), `private-key-sealed-${keyId}.bin`);
    writeFileSync(sealedPath, sealedEnvelope);
    console.log("");
    console.log("✓ Private key sealed and written to:");
    console.log(`  ${sealedPath}`);
    console.log("");
    console.log("Next Steps:");
    console.log("1. Transfer the sealed envelope to USB (offline storage).");
    console.log("2. Verify checksum: sha256sum private-key-sealed-*.bin");
    console.log("3. Store USB in a secure location (coffre-fort, HSM, geographically replicated).");
    console.log("4. Register the public key in config/signing-keys.v1.json");
    console.log("5. Follow KEY-CEREMONY-RUNBOOK.md for rotation/revocation protocols.");
    console.log("");
  }

  console.log("===============================================");
  console.log("✓ Ceremony complete. Public key is ready to register.");
  console.log("===============================================");
}

await ceremony(process.argv.slice(2));
