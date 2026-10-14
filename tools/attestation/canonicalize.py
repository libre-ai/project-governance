"""Independent derivation of the RFC 8785 manifest of ADR-0038 D2.

Third implementation, after the shell `manifest.sh` and the TypeScript `buildManifest`: it
shares no code with either and uses only the Python standard library. Run it isolated:

    python3 -I tools/attestation/canonicalize.py verify <manifest.jcs.json>
    python3 -I tools/attestation/canonicalize.py derive <git dir> <owner/repo> [<manifest.jcs.json>]

`verify` re-serialises the retained manifest and requires byte equality with the file, which also
rules out a terminal newline, whitespace, unsorted keys and a duplicate key (the re-serialisation
has none). It admits ASCII strings and safe nonnegative integers only. `derive` rebuilds the
manifest from the git object database and, when a file is given, requires byte equality with it.
Both print the SHA-256 of the canonical bytes. Why this subset is enough: in it, Python's sorted
compact JSON is RFC 8785 (ASCII and UTF-16 key order agree, primitives encode identically, array
order is kept, no whitespace). Anything outside it fails closed instead of being approximated.

Every refusal is an explicit exit, never `assert` (python -O strips asserts). Each refusal site
carries a `# neutralise:<id>` marker or an exemption with its reason; neutralise-check.ts counts
the sites with its own pattern and requires a red test per marker.
"""

import hashlib
import json
import os
import subprocess
import sys

SAFE_INTEGER = 9007199254740991
HANDLED_TYPES = {"commit", "tree", "blob", "tag"}


def refuse(message):
    print("refused:", message, file=sys.stderr)
    sys.exit(1)


def admit(value):
    if isinstance(value, str):
        # neutralise:python-ascii
        if not value.isascii():
            raise ValueError("non-ASCII string")
    elif isinstance(value, dict):
        for key, child in value.items():
            admit(key)
            admit(child)
    elif isinstance(value, list):
        for child in value:
            admit(child)
    # neutralise:python-integer
    elif type(value) is not int or not 0 <= value <= SAFE_INTEGER:
        raise ValueError("primitive outside the admitted subset")


def canonical(value):
    try:
        admit(value)
    except ValueError as error:
        # neutralise:none an except clause cannot be neutralised by a condition; python-ascii and python-integer above prove the guards, red:python-verify the exit
        refuse(str(error))
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def git(directory, *args):
    # Same bounded environment as the other implementations: no ambient configuration.
    done = subprocess.run(
        ["git", "-C", directory, *args],
        capture_output=True,
        env={"PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", "HOME": "/", "GIT_CONFIG_GLOBAL": "/dev/null",
             "GIT_CONFIG_SYSTEM": "/dev/null", "GIT_NO_REPLACE_OBJECTS": "1", "LC_ALL": "C"},
    )
    # neutralise:python-git
    if done.returncode != 0:
        refuse("git read failed")
    return done.stdout


def derive(directory, repository):
    # neutralise:python-shallow
    if git(directory, "rev-parse", "--is-shallow-repository").strip() != b"false":
        refuse("shallow repository")
    objects = []
    trees = []
    for line in git(directory, "cat-file", "--batch-all-objects",
                    "--batch-check=%(objectname) %(objecttype) %(objectsize)").decode("ascii").splitlines():
        oid, kind, size = line.split(" ")
        # neutralise:none git refuses to list a type outside commit/tree/blob/tag (invalid object type), so this guards only a future git
        if kind not in HANDLED_TYPES:
            refuse("object type not handled")
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
            # neutralise:python-path
            if not name.isascii():
                refuse("non-ASCII path")
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


def main(argv):
    if len(argv) >= 2 and argv[0] == "verify":
        # neutralise:python-file
        if not os.path.isfile(argv[1]):
            refuse("manifest file cannot be read")
        raw = open(argv[1], "rb").read()
        try:
            manifest = json.loads(raw)
        except ValueError:
            # neutralise:none an except clause cannot be neutralised by a condition; red:python-verify feeds it a file that is not JSON
            refuse("not JSON")
        rebuilt = canonical(manifest)
        # neutralise:python-verify
        if rebuilt != raw:
            refuse("retained bytes are not the canonical serialisation")
        print("verified", len(raw), "bytes, sha256", hashlib.sha256(raw).hexdigest())
        return 0
    if len(argv) >= 3 and argv[0] == "derive":
        rebuilt, _ = derive(argv[1], argv[2])
        if len(argv) >= 4:
            # neutralise:python-file-derive
            if not os.path.isfile(argv[3]):
                refuse("manifest file cannot be read")
            # neutralise:python-derive
            if rebuilt != open(argv[3], "rb").read():
                refuse("derived bytes differ from the retained manifest")
        print("derived", len(rebuilt), "bytes, sha256", hashlib.sha256(rebuilt).hexdigest())
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
