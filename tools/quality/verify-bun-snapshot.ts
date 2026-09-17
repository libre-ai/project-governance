export {};

interface Asset {
  name: string;
  sha256: string;
}

interface BunToolchainSnapshot {
  localSnapshot: string;
  sourceCommit: string;
  sourceArchive: Asset;
  assets: Record<string, Asset>;
}

const manifest = (await Bun.file("toolchains/bun.json").json()) as BunToolchainSnapshot;
const failures: string[] = [];

for (const [platform, asset] of Object.entries(manifest.assets)) {
  const path = `${manifest.localSnapshot}/${asset.name}`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    failures.push(`${platform}: missing ${path}`);
    continue;
  }

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await file.arrayBuffer());
  const actual = hasher.digest("hex");
  if (actual !== asset.sha256) {
    failures.push(`${platform}: checksum ${actual} does not match ${asset.sha256}`);
  }
}

const sourceArchivePath = `${manifest.localSnapshot}/${manifest.sourceArchive.name}`;
const sourceArchiveFile = Bun.file(sourceArchivePath);
if (!(await sourceArchiveFile.exists())) {
  failures.push(`Missing ${sourceArchivePath}`);
} else {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await sourceArchiveFile.arrayBuffer());
  const actual = hasher.digest("hex");
  if (actual !== manifest.sourceArchive.sha256) {
    failures.push(
      `Source archive checksum ${actual} does not match ${manifest.sourceArchive.sha256}`,
    );
  }
}

const sourceCommitPath = `${manifest.localSnapshot}/SOURCE_COMMIT`;
if (!(await Bun.file(sourceCommitPath).exists())) {
  failures.push(`Missing ${sourceCommitPath}`);
} else if ((await Bun.file(sourceCommitPath).text()).trim() !== manifest.sourceCommit) {
  failures.push("Snapshotted Bun source commit does not match the manifest");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(`Bun snapshot verified: ${Object.keys(manifest.assets).length} assets`);
