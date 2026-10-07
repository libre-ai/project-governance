# Security Policy

This is the canonical security policy for the Libre AI fleet — every
repository under the `libre-ai` GitHub organization, unless that repository
ships its own `SECURITY.md`, in which case its own file governs it instead.
This repository (`governance`) is the fleet's doctrine authority (I-03), so
it is the right home for the fleet's single reporting channel: one channel
is easier to find, and it survives an individual repository being archived,
renamed or restructured.

## Supported versions

Security fixes target the default branch (`main`) of the repository
concerned. No product is released yet, so there are no supported release
branches and no backport channel. Treat reports as valid even though the
projects are pre-release.

## Reporting a vulnerability

**Do not open a public issue for a suspected vulnerability, an exposed
secret, or any finding that includes exploit detail.**

Report privately through GitHub private vulnerability reporting on this
repository:

<https://github.com/libre-ai/governance/security/advisories/new>

This is the intake point for the whole organization: use it even when the
finding concerns another repository, and name the repository and commit in
the report. If the repository you are reporting about has its own "Report a
vulnerability" button enabled, you may use that one instead — both reach the
same maintainer.

There is no security mailing address. Any email address you find in a
specification or draft in this organization is a placeholder, not a
channel.

Please include:

- the repository, branch and commit concerned;
- an impact summary — what an attacker gains;
- the smallest reproduction you have;
- whether any secret, token, credential or personal data may be exposed;
- any deadline you are bound by, if you have one.

Never include secrets, tokens, production credentials, personal data or
working exploit payloads in a public issue, pull request, log, screenshot
or attachment. If a secret is already public, say so in the private report
— do not paste it again.

## How a report is handled

- The report is acknowledged privately before the issue is discussed in
  public. No fixed response-time commitment is made here — pre-release,
  solo-maintained, this is a statement of intent, not a service-level
  agreement a report can hold anyone to.
- Reproduction uses the smallest safe fixture, kept free of personal data.
- Fixes are fail-closed and land with a regression test whenever the
  behaviour can be tested.
- A fix that cannot land immediately is recorded as an explicit waiver with
  its scope, owner and removal condition — see
  `docs/security/ADVISORY-WAIVER-POLICY.md` for dependency advisories
  specifically.
- Triage never publishes a release on its own.
- Disclosure is coordinated with the reporter; credit is given unless the
  reporter asks otherwise.

## Out of scope

- Findings against third-party services the organization merely links to.
- Reports produced only by an automated scanner, with no demonstrated
  impact on code in this organization.
