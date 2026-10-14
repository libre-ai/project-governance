"""Independent derivation of the RFC 8785 manifest of ADR-0038 D2.

Third implementation, after the shell `manifest.sh` and the TypeScript `buildManifest`: it
shares no code with either and uses only the Python standard library. Run it isolated:

    python3 -I tools/attestation/canonicalize.py verify <manifest.jcs.json>
    python3 -I tools/attestation/canonicalize.py derive <git dir> <owner/repo> [<manifest.jcs.json>]

`verify` re-serialises the retained manifest and requires byte equality, no terminal newline,
no duplicate key, ASCII strings and safe nonnegative integers only. `derive` rebuilds the
manifest from the git object database and, when a file is given, requires byte equality with it.
Both print the SHA-256 of the canonical bytes. Why this subset is enough: in it, Python's sorted
compact JSON is RFC 8785 (ASCII and UTF-16 key order agree, primitives encode identically, array
order is kept, no whitespace). Anything outside it fails closed instead of being approximated.
"""

import hashlib
import json
import subprocess
import sys

SAFE_INTEGER = 9007199254740991
HANDLED_TYPES = {"commit", "tree", "blob", "tag"}


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def admit(value):
    if isinstance(value, str):
        if not value.isascii():
            raise ValueError("non-ASCII string")
    elif isinstance(value, dict):
        for key, child in value.items():
            admit(key)
            admit(child)
    elif isinstance(value, list):
        for child in value:
            admit(child)
    elif type(value) is not int or not 0 <= value <= SAFE_INTEGER:
        raise ValueError("primitive outside the admitted subset")


def canonical(value):
    admit(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def git(directory, *args):
    # Same bounded environment as the other implementations: no ambient configuration.
    done = subprocess.run(
        ["git", "-C", directory, *args],
        check=True,
        capture_output=True,
        env={"PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", "HOME": "/", "GIT_CONFIG_GLOBAL": "/dev/null",
             "GIT_CONFIG_SYSTEM": "/dev/null", "GIT_NO_REPLACE_OBJECTS": "1", "LC_ALL": "C"},
    )
    return done.stdout


def derive(directory, repository):
    if git(directory, "rev-parse", "--is-shallow-repository").strip() != b"false":
        raise ValueError("shallow repository")
    objects = []
    trees = []
    for line in git(directory, "cat-file", "--batch-all-objects",
                    "--batch-check=%(objectname) %(objecttype) %(objectsize)").decode("ascii").splitlines():
        oid, kind, size = line.split(" ")
        if kind not in HANDLED_TYPES:
            raise ValueError("object type not handled")
        objects.append({"objectId": oid, "size": int(size), "type": kind})
        if kind == "tree":
            trees.append(oid)
    entries = []
    for tree in trees:
        for raw in git(directory, "ls-tree", "-z", tree).split(b"\0"):
            if not raw:
                continue
            meta, name = raw.split(b"\t", 1)
            mode, kind, oid = meta.decode("ascii").split(" ")
            entries.append({"mode": mode, "name": name.decode("ascii"), "objectId": oid,
                            "treeObjectId": tree, "type": kind})
    refs = []
    for line in git(directory, "for-each-ref", "--format=%(refname) %(objectname)").decode("ascii").splitlines():
        name, oid = line.split(" ")
        refs.append({"name": name, "objectId": oid})
    manifest = {
        "gitObjectFormat": git(directory, "rev-parse", "--show-object-format").decode("ascii").strip(),
        "objects": sorted(objects, key=lambda item: item["objectId"]),
        "refs": sorted(refs, key=lambda item: item["name"]),
        "repository": repository,
        "schemaVersion": "libre-ai.git-object-manifest.v2",
        "treeEntries": sorted(entries, key=lambda item: (item["treeObjectId"], item["name"])),
    }
    return canonical(manifest), manifest


def refuse(message):
    # Explicit exit, never `assert`: python -O strips asserts, and a verifier that passes
    # everything under -O is not a verifier.
    print("refused:", message, file=sys.stderr)
    sys.exit(1)


def main(argv):
    if len(argv) >= 2 and argv[0] == "verify":
        raw = open(argv[1], "rb").read()
        manifest = json.loads(raw, object_pairs_hook=unique)
        rebuilt = canonical(manifest)
        if rebuilt != raw:
            refuse("retained bytes are not the canonical serialisation")
        if raw.endswith(b"\n"):
            refuse("terminal newline")
        if json.loads(rebuilt, object_pairs_hook=unique) != manifest:
            refuse("canonical bytes do not decode to the retained value")
        print("verified", len(raw), "bytes, sha256", hashlib.sha256(raw).hexdigest())
        return 0
    if len(argv) >= 3 and argv[0] == "derive":
        rebuilt, _ = derive(argv[1], argv[2])
        if len(argv) >= 4:
            if rebuilt != open(argv[3], "rb").read():
                refuse("derived bytes differ from the retained manifest")
        print("derived", len(rebuilt), "bytes, sha256", hashlib.sha256(rebuilt).hexdigest())
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
