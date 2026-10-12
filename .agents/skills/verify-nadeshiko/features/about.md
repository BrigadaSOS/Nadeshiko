# About page

Readers open the About page to see project attribution, contributors, data sources, and contact information.

## Sub-features

- `about-heading` displays the About heading.
- `about-attribution` displays Contribution and Attribution and contributor cards.
- `about-sources` displays Credits and Data Sources.
- `about-contact` displays Contact.

## How to get to it (user POV)

Open `/about` or `/en/about`, or use the header's About link. The unprefixed URL resolves to the English page in a fresh anonymous context. The existing spec covers direct navigation, not a header-link click.

## Driving it with Playwright

Preconditions: an owned local Nuxt instance passes the skill's doctor check. No backend or database is required for this recipe.

Run the complete About command in [the skill](../SKILL.md#drive). It opens `/about` through the normal fixture and verifies the About, Contribution and Attribution, Credits and Data Sources, and Contact headings. It also verifies `contributors-grid` and at least one `contributor-card`.

Require five passing tests, no skips, and retained traces with navigation actions, rendered content, and screenshots. Inspect the trace to confirm the final localized URL and real About content.

For header/navigation changes, also drive the About link. `frontend/e2e/specs/navbar.spec.ts`, test `About link navigates to /about`, uses `page.locator('header').getByRole('link', { name: 'About', exact: true })`. Run that test with the skill's local environment and evidence flags, replacing the spec with `e2e/specs/navbar.spec.ts` and adding `--grep 'About link navigates to /about'`; use separate `navbar-about` log/report/output names. It only asserts the destination URL: additionally verify the About heading and content after the click before claiming the full path. If localized direct routes change, explicitly drive `/en/about` too; the existing About spec opens only `/about`.

## Gotchas

- `/up` does not prove the About page rendered.
- Clear `E2E_SMOKE`, or the config can exclude this spec.
- Clear `E2E_USER_PASSWORD`, or global teardown can mutate account data.
- Default Playwright evidence settings do not preserve a passing trace. Use the skill's explicit trace and output flags.
