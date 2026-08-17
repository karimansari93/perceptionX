# Activate — Acceptable Use

**Version `2026-08-v1`.** This version string is recorded against each client's
acceptance in `activate_org_settings.terms_version`. Changing the terms below
means minting a new version and re-collecting acceptance — the link-minting RPC
refuses any org whose recorded version is not the current one. Do not edit an
already-issued version in place; that would silently claim a client agreed to
words they never saw.

> This is a product-level acceptable-use statement, written to be shown to a
> client and ticked by a named person. It is not legal advice and it is not a
> contract. It exists so that a lawyer reviewing our position later has a real
> artefact to work from, and so that a client's obligations are stated somewhere
> other than in a sales call. Have it reviewed before it becomes contractual.

## What Activate does

Activate gives your people a link. The recipient says which country they're in
and which part of the business they work for, and the page shows them the
platforms where AI systems actually learn about your organisation in their
market — with a link to each one.

That's the whole mechanism. It routes people to places. It does not tell anyone
what to write, does not ask them to write anything, and does not check whether
they did.

## What you agree to as a client

**1. No rewards conditional on posting.** You may not offer money, vouchers,
prizes, time off, recognition, or any other benefit in exchange for someone
leaving a review, and you may not make any benefit contingent on proof that
they did.

The test is whether the benefit is *conditional*. Buying lunch for a team that
took part in an engagement programme is fine. "Post a review, send us a
screenshot, collect a voucher" is not. If a person could reasonably believe they
get something for posting that they would not get otherwise, it's conditional.

**2. No scripting.** You may not tell people what to say, supply suggested
wording, provide talking points, or ask to see or approve anything before it's
posted. You may tell people the link exists and why it matters. You may not
shape the content.

**3. No selecting people by how they're likely to feel.** You may target a link
by location, business unit, function, or employment stage — an office, a plant,
a graduate cohort, leavers. You may not select recipients by engagement score,
performance rating, survey sentiment, promotion status, or any other measure of
how positively a person is expected to write.

This is the one that carries the most risk. Sending only to people you expect to
be positive is review gating. It is prohibited by the review platforms, and in
the US it falls under the FTC's rule on consumer reviews. It also invalidates
the measurement, since a filtered cohort tells you nothing true about your
employer brand.

**4. No pressure about existing reviews.** You may not ask anyone to change,
soften, or remove a review they have already written.

**5. You are the sender.** The link is distributed by you, through your channels,
in your words. You remain responsible for your own communications and for
compliance with each platform's own rules, which vary — Glassdoor explicitly
encourages review requests at moments like onboarding, work anniversaries and
exit interviews, while kununu takes a narrower view of targeted solicitation.
Where a platform offers its own sanctioned request mechanism, we route through
it wherever you've given us the details.

## What we do, and don't

- **We route, we never script.** Page copy stays non-directive throughout. This
  is a design constraint, not a preference, and it is not negotiable per client.
- **We don't identify individuals.** Each pageview mints a random identifier
  that is never persisted, never a cookie, and never a fingerprint. It tells us
  a click followed a declaration in the same visit. It does not tell us who.
- **We don't follow anyone into a platform.** Measurement stops at the click.
  We cannot see whether anyone wrote anything, and we don't try to.
- **We suppress small numbers.** Cohort breakdowns are withheld below five
  distinct respondents, so a link sent to a small team can't be read back as
  individual behaviour.

## If these terms are breached

We can revoke any link immediately, and will do so if we have reason to believe
it's being used against these terms. Revocation takes effect on the next page
load; already-issued links stop resolving.

We may also decline to issue further links for an organisation. Neither of these
is a penalty — the mechanism only works while the reviews it produces are real,
and a platform sanction lands on the client's own public profile.

## Acceptance

Recorded per organisation against a named person at the client, with the version
of these terms they were shown and the date. Held in `activate_consent_events`,
which is append-only: re-acceptance adds a row rather than overwriting the last
one, so the history of what was agreed and when survives.
