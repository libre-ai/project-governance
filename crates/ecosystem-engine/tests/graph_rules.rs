use libre_ai_ecosystem_engine::{GraphPolicy, KnowledgeGraph, SourceDocument};
use serde_json::{Value, json};

fn object(id: &str) -> Value {
    json!({
        "schemaVersion": "libre-ai.knowledge-object.v1",
        "kind": "Decision",
        "id": id,
        "name": id,
        "purpose": "Graph rule fixture",
        "status": "accepted",
        "trust": "normative",
        "authority": {
            "path": "docs/adr/fixture.md",
            "owners": ["libre-ai/architecture"]
        },
        "relationships": [],
        "provenance": {
            "authors": ["libre-ai"],
            "createdAt": "2026-07-16T00:00:00Z",
            "reviewedAt": "2026-07-16T00:00:00Z"
        }
    })
}

fn source(name: &str, value: &Value) -> SourceDocument {
    SourceDocument::new(name, serde_json::to_vec(value).expect("fixture JSON"))
}

fn ingest(values: &[Value]) -> Result<KnowledgeGraph, libre_ai_ecosystem_engine::GraphError> {
    KnowledgeGraph::ingest(
        values
            .iter()
            .enumerate()
            .map(|(index, value)| source(&format!("fixture-{index}.json"), value)),
        &GraphPolicy::canonical(),
    )
}

#[test]
fn rejects_unknown_fields_and_incomplete_legacy_provenance() {
    let mut unknown = object("urn:libre-ai:decision:unknown-field");
    unknown["unexpected"] = Value::Bool(true);
    assert_eq!(
        ingest(&[unknown])
            .expect_err("unknown field must fail")
            .code,
        "knowledge.schema_invalid"
    );

    let mut incomplete = object("urn:libre-ai:decision:legacy-incomplete");
    incomplete["provenance"]["legacyRepository"] =
        Value::String("https://github.com/libre-ai/website.git".to_owned());
    assert_eq!(
        ingest(&[incomplete])
            .expect_err("legacy repository without SHA must fail")
            .code,
        "knowledge.schema_invalid"
    );

    let mut traversal = object("urn:libre-ai:decision:path-traversal");
    traversal["authority"]["path"] = Value::String("../private/authority.json".to_owned());
    assert_eq!(
        ingest(&[traversal])
            .expect_err("authority path traversal must fail")
            .code,
        "knowledge.schema_invalid"
    );
}

#[test]
fn rejects_duplicate_ids_and_unresolved_targets() {
    assert_eq!(
        ingest(&[]).expect_err("empty graph must fail").code,
        "knowledge.graph_empty"
    );

    let first = object("urn:libre-ai:decision:duplicate");
    assert_eq!(
        ingest(&[first.clone(), first])
            .expect_err("duplicate id must fail")
            .code,
        "knowledge.id_duplicate"
    );

    let mut unresolved = object("urn:libre-ai:decision:unresolved");
    unresolved["relationships"] = json!([{
        "type": "depends-on",
        "target": "urn:libre-ai:decision:missing",
        "status": "accepted"
    }]);
    assert_eq!(
        ingest(&[unresolved])
            .expect_err("unresolved relationship must fail")
            .code,
        "knowledge.relationship_unresolved"
    );
}

#[test]
fn rejects_untrusted_authority_transitions() {
    let mut untrusted_owner = object("urn:libre-ai:decision:untrusted-owner");
    untrusted_owner["authority"]["owners"] = json!(["external/claimant"]);
    assert_eq!(
        ingest(&[untrusted_owner])
            .expect_err("self-asserted normative owner must fail")
            .code,
        "knowledge.authority_untrusted"
    );

    let target = object("urn:libre-ai:decision:trusted-target");
    let mut external = object("urn:libre-ai:decision:external-source");
    external["status"] = Value::String("draft".to_owned());
    external["trust"] = Value::String("external".to_owned());
    external["relationships"] = json!([{
        "type": "implements",
        "target": "urn:libre-ai:decision:trusted-target",
        "status": "accepted"
    }]);
    assert_eq!(
        ingest(&[target, external])
            .expect_err("external accepted transition must fail")
            .code,
        "knowledge.authority_transition_untrusted"
    );
}

#[test]
fn rejects_forbidden_cycles_but_allows_inverse_semantic_links() {
    let mut left = object("urn:libre-ai:decision:left");
    let mut right = object("urn:libre-ai:decision:right");
    left["relationships"] = json!([{
        "type": "depends-on",
        "target": "urn:libre-ai:decision:right",
        "status": "accepted"
    }]);
    right["relationships"] = json!([{
        "type": "depends-on",
        "target": "urn:libre-ai:decision:left",
        "status": "accepted"
    }]);
    assert_eq!(
        ingest(&[left, right])
            .expect_err("dependency cycle must fail")
            .code,
        "knowledge.cycle_forbidden"
    );

    let mut implementation = object("urn:libre-ai:decision:implementation");
    let mut decision = object("urn:libre-ai:decision:decision");
    implementation["relationships"] = json!([{
        "type": "implements",
        "target": "urn:libre-ai:decision:decision",
        "status": "accepted"
    }]);
    decision["relationships"] = json!([{
        "type": "implemented-by",
        "target": "urn:libre-ai:decision:implementation",
        "status": "accepted"
    }]);
    ingest(&[implementation, decision]).expect("inverse semantic links are not dependency cycles");
}

#[test]
fn rejects_cross_kind_or_lower_trust_supersession() {
    let target = object("urn:libre-ai:decision:superseded");
    let mut replacement = object("urn:libre-ai:decision:replacement");
    replacement["kind"] = Value::String("Evidence".to_owned());
    replacement["supersedes"] = Value::String("urn:libre-ai:decision:superseded".to_owned());
    assert_eq!(
        ingest(&[target, replacement])
            .expect_err("cross-kind supersession must fail")
            .code,
        "knowledge.supersedes_transition_invalid"
    );
}
