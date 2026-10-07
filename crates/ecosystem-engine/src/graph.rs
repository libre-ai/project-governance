use crate::canonical::{canonical_json, sha256_hex, stable_pretty_json};
use crate::model::{
    KNOWLEDGE_OBJECT_SCHEMA_VERSION, KNOWLEDGE_PROJECTION_SCHEMA_VERSION, KnowledgeObject,
    KnowledgeStatus, PublicKnowledgeProjection, RelationshipStatus, TrustLevel,
};
use jsonschema::{Draft, Validator};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::sync::OnceLock;

static KNOWLEDGE_VALIDATOR: OnceLock<Result<Validator, String>> = OnceLock::new();

#[derive(Clone, Debug)]
pub struct SourceDocument {
    pub path: String,
    pub bytes: Vec<u8>,
}

impl SourceDocument {
    pub fn new(path: impl Into<String>, bytes: impl Into<Vec<u8>>) -> Self {
        Self {
            path: path.into(),
            bytes: bytes.into(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct GraphPolicy {
    trusted_authority_owners: BTreeSet<String>,
    acyclic_relationships: BTreeSet<String>,
}

impl GraphPolicy {
    pub fn new(owners: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            trusted_authority_owners: owners.into_iter().map(Into::into).collect(),
            acyclic_relationships: ["depends-on", "derived-from", "supersedes"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
        }
    }

    #[must_use]
    pub fn canonical() -> Self {
        Self::new(["libre-ai/architecture", "libre-ai/canonical-core"])
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GraphError {
    pub code: &'static str,
    pub source: Option<String>,
    pub object_id: Option<String>,
    pub path: Option<String>,
}

impl GraphError {
    fn source(code: &'static str, source: &str, path: Option<String>) -> Self {
        Self {
            code,
            source: Some(source.to_owned()),
            object_id: None,
            path,
        }
    }

    fn object(code: &'static str, object_id: &str, path: Option<String>) -> Self {
        Self {
            code,
            source: None,
            object_id: Some(object_id.to_owned()),
            path,
        }
    }
}

impl Display for GraphError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.code)?;
        if let Some(source) = &self.source {
            write!(formatter, " in {source}")?;
        }
        if let Some(object_id) = &self.object_id {
            write!(formatter, " for {object_id}")?;
        }
        if let Some(path) = &self.path {
            write!(formatter, " at {path}")?;
        }
        Ok(())
    }
}

impl Error for GraphError {}

#[derive(Clone, Debug)]
pub struct KnowledgeGraph {
    objects: BTreeMap<String, KnowledgeObject>,
}

impl KnowledgeGraph {
    pub fn ingest(
        sources: impl IntoIterator<Item = SourceDocument>,
        policy: &GraphPolicy,
    ) -> Result<Self, GraphError> {
        let validator = knowledge_validator()?;
        let mut objects = BTreeMap::new();

        for source in sources {
            let value: Value = serde_json::from_slice(&source.bytes)
                .map_err(|_| GraphError::source("knowledge.json_invalid", &source.path, None))?;
            if let Some(error) = validator.iter_errors(&value).next() {
                return Err(GraphError::source(
                    "knowledge.schema_invalid",
                    &source.path,
                    Some(error.instance_path().as_str().to_owned()),
                ));
            }
            let object: KnowledgeObject = serde_json::from_value(value)
                .map_err(|_| GraphError::source("knowledge.decode_invalid", &source.path, None))?;
            let object_id = object.id.clone();
            if objects.insert(object_id.clone(), object).is_some() {
                return Err(GraphError::object(
                    "knowledge.id_duplicate",
                    &object_id,
                    None,
                ));
            }
        }

        if objects.is_empty() {
            return Err(GraphError::source(
                "knowledge.graph_empty",
                "ingestion",
                None,
            ));
        }
        let graph = Self { objects };
        graph.validate(policy)?;
        Ok(graph)
    }

    pub fn objects(&self) -> impl Iterator<Item = &KnowledgeObject> {
        self.objects.values()
    }

    pub fn get(&self, id: &str) -> Option<&KnowledgeObject> {
        self.objects.get(id)
    }

    pub fn public_projection(&self) -> Result<PublicKnowledgeProjection, GraphError> {
        let selected_ids = self
            .objects
            .values()
            .filter(|object| {
                object.status == KnowledgeStatus::Accepted
                    && matches!(object.trust, TrustLevel::Reviewed | TrustLevel::Normative)
            })
            .map(|object| object.id.clone())
            .collect::<BTreeSet<_>>();

        let mut objects = self
            .objects
            .values()
            .filter(|object| selected_ids.contains(&object.id))
            .cloned()
            .map(|mut object| {
                object.authority.owners.sort();
                object.provenance.authors.sort();
                object.provenance.model = None;
                object.provenance.harness = None;
                object.relationships.retain(|relationship| {
                    relationship.status == RelationshipStatus::Accepted
                        && selected_ids.contains(&relationship.target)
                });
                object.relationships.sort();
                if !object
                    .supersedes
                    .as_ref()
                    .is_some_and(|target| selected_ids.contains(target))
                {
                    object.supersedes = None;
                }
                object
            })
            .collect::<Vec<_>>();
        objects.sort_by(|left, right| left.id.cmp(&right.id));

        let object_value = serde_json::to_value(&objects).map_err(|_| {
            GraphError::object("knowledge.projection_encode_failed", "projection", None)
        })?;
        let canonical = canonical_json(&object_value).map_err(|_| {
            GraphError::object("knowledge.projection_encode_failed", "projection", None)
        })?;
        Ok(PublicKnowledgeProjection {
            schema_version: KNOWLEDGE_PROJECTION_SCHEMA_VERSION.to_owned(),
            source_schema_version: KNOWLEDGE_OBJECT_SCHEMA_VERSION.to_owned(),
            selection_digest: sha256_hex(&canonical),
            objects,
        })
    }

    pub fn public_projection_bytes(&self) -> Result<Vec<u8>, GraphError> {
        let projection = self.public_projection()?;
        let value = serde_json::to_value(projection).map_err(|_| {
            GraphError::object("knowledge.projection_encode_failed", "projection", None)
        })?;
        stable_pretty_json(&value).map_err(|_| {
            GraphError::object("knowledge.projection_encode_failed", "projection", None)
        })
    }

    fn validate(&self, policy: &GraphPolicy) -> Result<(), GraphError> {
        for object in self.objects.values() {
            if (object.trust == TrustLevel::Normative || object.status == KnowledgeStatus::Accepted)
                && !object
                    .authority
                    .owners
                    .iter()
                    .any(|owner| policy.trusted_authority_owners.contains(owner))
            {
                return Err(GraphError::object(
                    "knowledge.authority_untrusted",
                    &object.id,
                    Some("/authority/owners".to_owned()),
                ));
            }

            if matches!(object.trust, TrustLevel::External | TrustLevel::Observed)
                && object
                    .relationships
                    .iter()
                    .any(|relationship| relationship.status == RelationshipStatus::Accepted)
            {
                return Err(GraphError::object(
                    "knowledge.authority_transition_untrusted",
                    &object.id,
                    Some("/relationships".to_owned()),
                ));
            }

            for relationship in &object.relationships {
                let target = self.objects.get(&relationship.target).ok_or_else(|| {
                    GraphError::object(
                        "knowledge.relationship_unresolved",
                        &object.id,
                        Some(relationship.target.clone()),
                    )
                })?;
                if relationship.status == RelationshipStatus::Accepted
                    && (object.status != KnowledgeStatus::Accepted
                        || target.status != KnowledgeStatus::Accepted
                        || target.trust < TrustLevel::Reviewed)
                {
                    return Err(GraphError::object(
                        "knowledge.authority_transition_untrusted",
                        &object.id,
                        Some(relationship.target.clone()),
                    ));
                }
            }

            if let Some(superseded_id) = &object.supersedes {
                let superseded = self.objects.get(superseded_id).ok_or_else(|| {
                    GraphError::object(
                        "knowledge.supersedes_unresolved",
                        &object.id,
                        Some(superseded_id.clone()),
                    )
                })?;
                if object.kind != superseded.kind || object.trust < superseded.trust {
                    return Err(GraphError::object(
                        "knowledge.supersedes_transition_invalid",
                        &object.id,
                        Some(superseded_id.clone()),
                    ));
                }
            }
        }

        self.reject_forbidden_cycles(policy)
    }

    fn reject_forbidden_cycles(&self, policy: &GraphPolicy) -> Result<(), GraphError> {
        let mut edges = BTreeMap::<&str, Vec<&str>>::new();
        for object in self.objects.values() {
            let targets = edges.entry(&object.id).or_default();
            if let Some(supersedes) = &object.supersedes {
                targets.push(supersedes);
            }
            targets.extend(
                object
                    .relationships
                    .iter()
                    .filter(|relationship| {
                        policy
                            .acyclic_relationships
                            .contains(&relationship.relationship_type)
                    })
                    .map(|relationship| relationship.target.as_str()),
            );
            targets.sort_unstable();
            targets.dedup();
        }

        let mut visiting = BTreeSet::new();
        let mut visited = BTreeSet::new();
        for id in self.objects.keys() {
            if has_cycle(id, &edges, &mut visiting, &mut visited) {
                return Err(GraphError::object("knowledge.cycle_forbidden", id, None));
            }
        }
        Ok(())
    }
}

fn knowledge_validator() -> Result<&'static Validator, GraphError> {
    KNOWLEDGE_VALIDATOR
        .get_or_init(|| {
            // The authority's own schema, read from the repository that owns
            // it. Before the 2026-10-07 consolidation this crate lived in its
            // own repository and had to vendor the file under a byte-exact
            // drift gate; now that the schema and this engine share a tree,
            // a vendored copy could only add a way for them to disagree.
            let schema: Value = serde_json::from_str(include_str!(
                "../../../ecosystem/schemas/knowledge-object.schema.json"
            ))
            .map_err(|error| error.to_string())?;
            jsonschema::options()
                .with_draft(Draft::Draft202012)
                .should_validate_formats(true)
                .build(&schema)
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|_| GraphError::source("knowledge.schema_unavailable", "embedded", None))
}

fn has_cycle<'a>(
    current: &'a str,
    edges: &BTreeMap<&'a str, Vec<&'a str>>,
    visiting: &mut BTreeSet<&'a str>,
    visited: &mut BTreeSet<&'a str>,
) -> bool {
    if visited.contains(current) {
        return false;
    }
    if !visiting.insert(current) {
        return true;
    }
    if edges.get(current).is_some_and(|targets| {
        targets
            .iter()
            .any(|target| has_cycle(target, edges, visiting, visited))
    }) {
        return true;
    }
    visiting.remove(current);
    visited.insert(current);
    false
}
