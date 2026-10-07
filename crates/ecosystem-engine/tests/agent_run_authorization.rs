use biscuit_auth::{AuthorizerBuilder, Biscuit, KeyPair, PublicKey, datalog::RunLimits, error};
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    time::Duration,
};

const ROOT_KEY_ID: u32 = 41;
const EVALUATION_TIME: &str = "2030-01-01T00:00:00Z";
const EXPIRATION_TIME: &str = "2030-01-01T00:05:00Z";
const RESOURCE: &str = "urn:libre-ai:agent-run:fixture";

#[derive(Debug, Deserialize)]
struct AuthzVectors {
    cases: Vec<AuthzVector>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthzVector {
    id: String,
    role: String,
    operation: String,
    tenant: String,
    resource_tenant: String,
    token_mission: Option<String>,
    resource_mission: Option<String>,
    token_run: Option<String>,
    resource_run: Option<String>,
    token_plan_digest: Option<String>,
    resource_plan_digest: Option<String>,
    token_authorization_digest: Option<String>,
    resource_authorization_digest: Option<String>,
    token_subject_digest: Option<String>,
    resource_subject_digest: Option<String>,
    subject_type: Option<String>,
    quorum_valid: Option<bool>,
    #[serde(default)]
    agent_fleet: Option<String>,
    #[serde(default)]
    resource_fleet: Option<String>,
    #[serde(default)]
    mission_agent: Option<String>,
    expected: String,
}

#[derive(Clone, Copy)]
enum RevocationStore<'a> {
    Available(&'a HashSet<Vec<u8>>),
    Unavailable,
}

fn quoted(value: &str) -> String {
    serde_json::to_string(value).expect("fixture strings must serialize")
}

fn push_fact(source: &mut String, name: &str, values: &[&str]) {
    source.push_str(name);
    source.push('(');
    source.push_str(
        &values
            .iter()
            .map(|value| quoted(value))
            .collect::<Vec<_>>()
            .join(", "),
    );
    source.push_str(");\n");
}

fn token_source(vector: &AuthzVector) -> String {
    let mut source = String::new();
    push_fact(&mut source, "user", &["fixture-agent"]);
    push_fact(&mut source, "tenant", &[&vector.tenant]);
    push_fact(&mut source, "role", &["fixture-agent", &vector.role]);
    if let Some(fleet) = vector.agent_fleet.as_deref() {
        push_fact(&mut source, "agent_fleet", &["fixture-agent", fleet]);
    }
    if let Some(mission) = vector.mission_agent.as_deref() {
        push_fact(&mut source, "mission_agent", &["fixture-agent", mission]);
    }
    for (name, value) in [
        ("token_mission", vector.token_mission.as_deref()),
        ("token_run", vector.token_run.as_deref()),
        ("token_plan_digest", vector.token_plan_digest.as_deref()),
        (
            "token_authorization_digest",
            vector.token_authorization_digest.as_deref(),
        ),
        (
            "token_subject_digest",
            vector.token_subject_digest.as_deref(),
        ),
    ] {
        if let Some(value) = value {
            push_fact(&mut source, name, &[value]);
        }
    }
    source.push_str(&format!(
        "check if time($time), $time < {EXPIRATION_TIME};\n"
    ));
    source
}

fn authorizer_source(vector: &AuthzVector, policy: &str) -> String {
    let mut source = String::new();
    source.push_str(&format!("time({EVALUATION_TIME});\n"));
    push_fact(&mut source, "resource", &[RESOURCE]);
    push_fact(&mut source, "operation", &[&vector.operation]);
    push_fact(&mut source, "resource_tenant", &[&vector.resource_tenant]);
    if let Some(fleet) = vector.resource_fleet.as_deref() {
        push_fact(&mut source, "resource_fleet", &[fleet]);
    }
    for (name, value) in [
        ("resource_mission", vector.resource_mission.as_deref()),
        ("resource_run", vector.resource_run.as_deref()),
        (
            "resource_plan_digest",
            vector.resource_plan_digest.as_deref(),
        ),
        (
            "resource_authorization_digest",
            vector.resource_authorization_digest.as_deref(),
        ),
        (
            "resource_subject_digest",
            vector.resource_subject_digest.as_deref(),
        ),
        ("subject_type", vector.subject_type.as_deref()),
    ] {
        if let Some(value) = value {
            push_fact(&mut source, name, &[value]);
        }
    }
    if vector.quorum_valid == Some(true) {
        push_fact(&mut source, "quorum_valid", &[RESOURCE]);
    }
    source.push_str(policy);
    source
}

fn verify_with_active_keys(
    serialized: &[u8],
    active_keys: &HashMap<u32, PublicKey>,
) -> Result<Biscuit, error::Token> {
    Biscuit::from(serialized, |key_id: Option<u32>| {
        key_id
            .and_then(|id| active_keys.get(&id).copied())
            .ok_or(error::Format::UnknownPublicKey)
    })
}

fn revocation_allows(token: &Biscuit, store: RevocationStore<'_>) -> bool {
    let RevocationStore::Available(revoked) = store else {
        return false;
    };
    token
        .revocation_identifiers()
        .first()
        .is_some_and(|root_id| !revoked.contains(root_id))
}

fn contract_root() -> PathBuf {
    // The crate moved under `crates/` of the repository that installs the
    // contracts authority pin, so `node_modules` is two levels up — not beside
    // the manifest as it was when this crate had its own repository.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../node_modules/@libre-ai/contracts-authority/contracts")
}

#[test]
fn selected_biscuit_engine_matches_all_agent_run_vectors() {
    let root = contract_root();
    let policy = fs::read_to_string(root.join("authz/agent-runs-v1.datalog"))
        .expect("agent-run policy must be readable");
    let vectors: AuthzVectors = serde_json::from_str(
        &fs::read_to_string(root.join("fixtures/agent-orchestration-v1/authz-vectors.v1.json"))
            .expect("authz vectors must be readable"),
    )
    .expect("authz vectors must deserialize");
    let signing_key = KeyPair::new();
    let active_keys = HashMap::from([(ROOT_KEY_ID, signing_key.public())]);
    let limits = RunLimits {
        max_facts: 256,
        max_iterations: 32,
        max_time: Duration::from_millis(50),
    };

    for vector in vectors.cases {
        // biscuit-auth 6.0: consuming builders, and the authorizer is declared
        // on an AuthorizerBuilder then built against the verified token.
        let token = Biscuit::builder()
            .root_key_id(ROOT_KEY_ID)
            .code(token_source(&vector))
            .unwrap_or_else(|error| panic!("{}: token source rejected: {error}", vector.id))
            .build(&signing_key)
            .unwrap_or_else(|error| panic!("{}: token build failed: {error}", vector.id));
        let serialized = token
            .to_vec()
            .unwrap_or_else(|error| panic!("{}: token serialization failed: {error}", vector.id));
        let verified = verify_with_active_keys(&serialized, &active_keys)
            .unwrap_or_else(|error| panic!("{}: token verification failed: {error}", vector.id));
        let mut authorizer = AuthorizerBuilder::new()
            .code(authorizer_source(&vector, &policy))
            .unwrap_or_else(|error| panic!("{}: authorizer source rejected: {error}", vector.id))
            .build(&verified)
            .unwrap_or_else(|error| panic!("{}: authorizer build failed: {error}", vector.id));
        let actual = if authorizer.authorize_with_limits(limits.clone()).is_ok() {
            "allow"
        } else {
            "deny"
        };
        assert_eq!(actual, vector.expected, "{}", vector.id);
    }
}

// Runtime proof (real biscuit, not the TS mirror) that agent-runs-v2 enforces
// the loop-security kernel K1 identity boundary: an agent token carrying
// agent_fleet/mission_agent facts is denied cross-fleet and out-of-mission by
// the real authorizer. token_source emits the K1 facts (present only in v2
// vectors); authorizer_source injects resource_fleet at the simulated handler.
#[test]
fn selected_biscuit_engine_matches_all_agent_run_v2_vectors() {
    let root = contract_root();
    let policy = fs::read_to_string(root.join("authz/agent-runs-v2.datalog"))
        .expect("agent-run v2 policy must be readable");
    let vectors: AuthzVectors = serde_json::from_str(
        &fs::read_to_string(root.join("fixtures/agent-orchestration-v1/authz-vectors.v2.json"))
            .expect("authz v2 vectors must be readable"),
    )
    .expect("authz v2 vectors must deserialize");
    let signing_key = KeyPair::new();
    let active_keys = HashMap::from([(ROOT_KEY_ID, signing_key.public())]);
    let limits = RunLimits {
        max_facts: 256,
        max_iterations: 32,
        max_time: Duration::from_millis(50),
    };

    for vector in vectors.cases {
        // biscuit-auth 6.0: consuming builders, and the authorizer is declared
        // on an AuthorizerBuilder then built against the verified token.
        let token = Biscuit::builder()
            .root_key_id(ROOT_KEY_ID)
            .code(token_source(&vector))
            .unwrap_or_else(|error| panic!("{}: token source rejected: {error}", vector.id))
            .build(&signing_key)
            .unwrap_or_else(|error| panic!("{}: token build failed: {error}", vector.id));
        let serialized = token
            .to_vec()
            .unwrap_or_else(|error| panic!("{}: token serialization failed: {error}", vector.id));
        let verified = verify_with_active_keys(&serialized, &active_keys)
            .unwrap_or_else(|error| panic!("{}: token verification failed: {error}", vector.id));
        let mut authorizer = AuthorizerBuilder::new()
            .code(authorizer_source(&vector, &policy))
            .unwrap_or_else(|error| panic!("{}: authorizer source rejected: {error}", vector.id))
            .build(&verified)
            .unwrap_or_else(|error| panic!("{}: authorizer build failed: {error}", vector.id));
        let actual = if authorizer.authorize_with_limits(limits.clone()).is_ok() {
            "allow"
        } else {
            "deny"
        };
        assert_eq!(actual, vector.expected, "{}", vector.id);
    }
}

#[test]
fn root_key_rotation_and_registry_outage_fail_closed() {
    let old_key = KeyPair::new();
    let current_key = KeyPair::new();
    let old_token = Biscuit::builder()
        .root_key_id(1)
        .code("user(\"old-fixture\");")
        .expect("old token source must parse")
        .build(&old_key)
        .expect("old token must build")
        .to_vec()
        .expect("old token must serialize");
    let current_token = Biscuit::builder()
        .root_key_id(2)
        .code("user(\"current-fixture\");")
        .expect("current token source must parse")
        .build(&current_key)
        .expect("current token must build")
        .to_vec()
        .expect("current token must serialize");

    let overlap = HashMap::from([(1, old_key.public()), (2, current_key.public())]);
    assert!(verify_with_active_keys(&old_token, &overlap).is_ok());
    assert!(verify_with_active_keys(&current_token, &overlap).is_ok());

    let after_retirement = HashMap::from([(2, current_key.public())]);
    assert!(verify_with_active_keys(&old_token, &after_retirement).is_err());
    assert!(verify_with_active_keys(&current_token, &after_retirement).is_ok());
    assert!(verify_with_active_keys(&current_token, &HashMap::new()).is_err());
}

#[test]
fn root_block_revocation_and_store_outage_fail_closed() {
    let signing_key = KeyPair::new();
    let token = Biscuit::builder()
        .root_key_id(ROOT_KEY_ID)
        .code("user(\"revocation-fixture\");")
        .expect("token source must parse")
        .build(&signing_key)
        .expect("token must build");
    let root_id = token
        .revocation_identifiers()
        .into_iter()
        .next()
        .expect("root block must expose a revocation identifier");

    let empty = HashSet::new();
    assert!(revocation_allows(
        &token,
        RevocationStore::Available(&empty)
    ));

    let revoked = HashSet::from([root_id]);
    assert!(!revocation_allows(
        &token,
        RevocationStore::Available(&revoked)
    ));
    assert!(!revocation_allows(&token, RevocationStore::Unavailable));
}
