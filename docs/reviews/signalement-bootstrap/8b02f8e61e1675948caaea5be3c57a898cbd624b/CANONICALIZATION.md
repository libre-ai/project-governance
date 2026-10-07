# Independent canonical manifest verification

ADR-0038 requires a retained RFC 8785 artifact. The product's native serializer uses
a different deterministic top-level order; its existing mirror verifier still compares
that native digest. Both representations are retained and their decoded values must agree.

This recipe is deliberately restricted to the actual manifest's ASCII strings and
nonnegative safe integers, arrays and objects. In this admitted subset Python's sorted
compact JSON matches RFC 8785: ASCII and UTF-16 key orders agree, primitive encodings
agree, array order is preserved, and no whitespace or terminal newline is emitted.
Unsupported values or duplicate keys fail. This is not a general-purpose JCS implementation.
See [RFC 8785 sections 3.1–3.2.4](https://www.rfc-editor.org/rfc/rfc8785).

Run this independent verification from this document's directory with Python 3:

```python
import hashlib
import json
from pathlib import Path

def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate key")
        result[key] = value
    return result

def admit(value):
    if isinstance(value, str):
        if not value.isascii():
            raise ValueError("Unsupported string")
    elif isinstance(value, dict):
        for key, child in value.items():
            admit(key)
            admit(child)
    elif isinstance(value, list):
        for child in value:
            admit(child)
    elif type(value) is not int or not 0 <= value <= 9007199254740991:
        raise ValueError("Unsupported primitive")

native = Path("evidence/manifest.json").read_bytes()
manifest = json.loads(native, object_pairs_hook=unique)
admit(manifest)
canonical = json.dumps(
    manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False
).encode("utf-8")
assert canonical == Path("evidence/manifest.jcs.json").read_bytes()
assert hashlib.sha256(canonical).hexdigest() == (
    "492f8d648354c7af217a2eb8d673b952e4e5b9c321462085db3a22dd306f0d79"
)
assert native.endswith(b"\n") and not native.endswith(b"\n\n")
assert hashlib.sha256(native[:-1]).hexdigest() == (
    "b63c266142ffba8955ee4206a14d0212273f74827c2e6bde5ff95c7667e27c7e"
)
assert json.loads(canonical, object_pairs_hook=unique) == manifest
print("Both manifest representations verified")
```

For the frozen-private and anonymous checks, first require the remote verifier's
native digest and exact ref/object set to match. The retained native bytes, their digest,
decoded-value equality, canonical bytes and independent JCS digest then bind the same
complete remote manifest. Any native or canonical mismatch refuses publication.
