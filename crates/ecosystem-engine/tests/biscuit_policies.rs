use biscuit_parser::parser::parse_source;
use std::{fs, path::PathBuf};

const POLICIES: [(&str, usize); 4] = [
    ("sessions-v1.datalog", 7),
    ("missions-v1.datalog", 6),
    ("agent-runs-v1.datalog", 15),
    ("agent-runs-v2.datalog", 15),
];

#[test]
fn canonical_biscuit_policies_parse() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendored/authz");

    for (name, expected_policy_count) in POLICIES {
        let path = root.join(name);
        let source =
            fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let parsed = parse_source(&source)
            .unwrap_or_else(|errors| panic!("{}: {errors:#?}", path.display()));

        assert_eq!(
            parsed.policies.len(),
            expected_policy_count,
            "{}",
            path.display()
        );
        assert!(
            parsed.facts.is_empty(),
            "policies must not inject context facts"
        );
        assert!(
            parsed.rules.is_empty(),
            "policies must not derive hidden facts"
        );
        assert!(
            parsed.checks.is_empty(),
            "token checks belong to authority/attenuation blocks"
        );
    }
}

#[test]
fn canonical_authority_template_contains_only_minimal_facts_and_expiry() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendored/authz/authority-v1.datalog");
    let source =
        fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let parsed =
        parse_source(&source).unwrap_or_else(|errors| panic!("{}: {errors:#?}", path.display()));

    assert_eq!(parsed.facts.len(), 3);
    assert_eq!(parsed.checks.len(), 1);
    assert!(parsed.rules.is_empty());
    assert!(parsed.policies.is_empty());
}
