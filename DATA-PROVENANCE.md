# Data provenance and publication policy

No real dataset, imported model output or third-party corpus inherits the
repository's software or documentation licence. Publication is denied until the
following record is complete for that dataset.

## Required provenance record

- stable dataset identifier and version hash;
- producer, source URL or acquisition channel;
- collection date and collection method;
- original licence and contractual terms;
- transformations, filtering, enrichment and deduplication performed;
- copyright and EU sui generis database rights analysis;
- redistribution, attribution and withdrawal conditions;
- personal, confidential, sensitive or regulated data classification;
- lawful basis, purpose, minimisation and retention period where GDPR applies;
- deletion, correction and source-withdrawal procedure;
- model-provider terms and output restrictions where applicable;
- accountable human approval and publication date.

## Licence decision

After provenance and rights review:

- own data intended for broad reuse may use `CC-BY-4.0`;
- a share-alike data licence requires a separate compatibility review;
- third-party data keeps its original terms and is never covered by a blanket
  repository licence;
- data with unresolved provenance, privacy or redistribution rights is not
  published.

An open-data licence grants only rights held by the licensor. It does not cure a
GDPR issue, waive confidentiality, grant image/personality rights or override a
source contract.

## Benchmarks

Benchmark code and technical harnesses use `Apache-2.0`. Editorial methodology
uses the documentation licence. Executable prompts follow their component's
software licence. Model outputs and source datasets keep their applicable terms;
aggregated results receive an explicit licence only after confirming that they
do not reproduce restricted inputs or outputs.

Synthetic fixtures under `contracts/fixtures/**` are software test vectors, not
published real-world datasets, and use `Apache-2.0`.
