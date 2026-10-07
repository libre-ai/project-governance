use serde::{Deserialize, Serialize};

pub const KNOWLEDGE_OBJECT_SCHEMA_VERSION: &str = "libre-ai.knowledge-object.v1";
pub const KNOWLEDGE_PROJECTION_SCHEMA_VERSION: &str = "libre-ai.knowledge-projection.v1";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeObject {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    pub kind: KnowledgeKind,
    pub id: String,
    pub name: String,
    pub purpose: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub status: KnowledgeStatus,
    pub trust: TrustLevel,
    pub authority: Authority,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<Relationship>,
    pub provenance: Provenance,
    #[serde(rename = "validFrom", skip_serializing_if = "Option::is_none")]
    pub valid_from: Option<String>,
    #[serde(rename = "validUntil", skip_serializing_if = "Option::is_none")]
    pub valid_until: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum KnowledgeKind {
    Thesis,
    Bet,
    Hypothesis,
    Capability,
    Experience,
    Decision,
    Contract,
    Implementation,
    Evidence,
    Learning,
    Release,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum KnowledgeStatus {
    Draft,
    Reviewed,
    Accepted,
    Deprecated,
    Archived,
    Untrusted,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrustLevel {
    External,
    Observed,
    Reviewed,
    Normative,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Authority {
    pub path: String,
    pub owners: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Relationship {
    #[serde(rename = "type")]
    pub relationship_type: String,
    pub target: String,
    pub status: RelationshipStatus,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RelationshipStatus {
    Proposed,
    Accepted,
    Rejected,
    Superseded,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Provenance {
    pub authors: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "reviewedAt", skip_serializing_if = "Option::is_none")]
    pub reviewed_at: Option<String>,
    #[serde(rename = "legacyRepository", skip_serializing_if = "Option::is_none")]
    pub legacy_repository: Option<String>,
    #[serde(rename = "legacyRevision", skip_serializing_if = "Option::is_none")]
    pub legacy_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PublicKnowledgeProjection {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "sourceSchemaVersion")]
    pub source_schema_version: String,
    #[serde(rename = "selectionDigest")]
    pub selection_digest: String,
    pub objects: Vec<KnowledgeObject>,
}
