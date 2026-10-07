use libre_ai_ecosystem_engine::{
    GraphPolicy, KnowledgeGraph, SourceDocument, canonical_json, sha256_hex,
};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn source_documents() -> Vec<SourceDocument> {
    // The canonical objects of this repository, read in place. They used to
    // arrive through a `@libre-ai/governance` git-dep because this crate lived
    // elsewhere; that dependency is now this repository itself.
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../ecosystem/objects");
    let mut paths = Vec::new();
    collect_json_files(&root, &mut paths);
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            SourceDocument::new(
                path.to_string_lossy(),
                fs::read(&path).expect("knowledge object source"),
            )
        })
        .collect()
}

fn collect_json_files(directory: &Path, output: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory).expect("knowledge object directory") {
        let entry = entry.expect("directory entry");
        if entry.file_type().expect("file type").is_dir() {
            collect_json_files(&entry.path(), output);
        } else if entry
            .path()
            .extension()
            .is_some_and(|value| value == "json")
        {
            output.push(entry.path());
        }
    }
}

#[test]
fn projection_is_byte_identical_for_any_input_order_and_matches_checked_output() {
    let sources = source_documents();
    let graph = KnowledgeGraph::ingest(sources.clone(), &GraphPolicy::canonical())
        .expect("canonical knowledge graph");
    let expected = graph
        .public_projection_bytes()
        .expect("public projection bytes");

    let reversed = KnowledgeGraph::ingest(sources.into_iter().rev(), &GraphPolicy::canonical())
        .expect("reversed canonical knowledge graph")
        .public_projection_bytes()
        .expect("reversed public projection bytes");
    assert_eq!(expected, reversed);

    // The committed projection of the repository that owns it — the same
    // reason as the schema above: no vendored copy to drift.
    let checked = include_bytes!("../../../ecosystem/projections/public.v1.json");
    assert_eq!(expected, checked);
}

#[test]
fn selection_digest_binds_canonical_selected_objects() {
    let graph = KnowledgeGraph::ingest(source_documents(), &GraphPolicy::canonical())
        .expect("canonical knowledge graph");
    let projection = graph.public_projection().expect("public projection");
    let objects = serde_json::to_value(&projection.objects).expect("projection objects");
    let digest = sha256_hex(&canonical_json(&objects).expect("canonical selected objects"));
    assert_eq!(projection.selection_digest, digest);
    assert!(projection.objects.iter().all(|object| {
        object.provenance.model.is_none() && object.provenance.harness.is_none()
    }));
}

#[test]
fn legacy_provenance_keeps_only_repository_and_exact_sha_reference() {
    let source = serde_json::json!({
        "schemaVersion": "libre-ai.knowledge-object.v1",
        "kind": "Evidence",
        "id": "urn:libre-ai:evidence:legacy-freeze",
        "name": "Legacy freeze",
        "purpose": "Prove immutable legacy provenance",
        "status": "accepted",
        "trust": "reviewed",
        "authority": {
            "path": "ecosystem/LEGACY-MANIFEST.yaml",
            "owners": ["libre-ai/architecture"]
        },
        "provenance": {
            "authors": ["libre-ai"],
            "createdAt": "2026-07-16T00:00:00Z",
            "reviewedAt": "2026-07-16T00:00:00Z",
            "legacyRepository": "https://github.com/libre-ai/website.git",
            "legacyRevision": "0318c92b5b0f4fed82cc64b75e5132db04ea04e3"
        }
    });
    let graph = KnowledgeGraph::ingest(
        [SourceDocument::new(
            "legacy.json",
            serde_json::to_vec(&source).expect("legacy fixture"),
        )],
        &GraphPolicy::canonical(),
    )
    .expect("legacy SHA provenance");
    let projection: Value = serde_json::from_slice(
        &graph
            .public_projection_bytes()
            .expect("legacy public projection"),
    )
    .expect("projection JSON");
    assert_eq!(
        projection["objects"][0]["provenance"]["legacyRevision"],
        "0318c92b5b0f4fed82cc64b75e5132db04ea04e3"
    );
    assert!(
        projection["objects"][0]["provenance"]
            .get("history")
            .is_none()
    );
}
