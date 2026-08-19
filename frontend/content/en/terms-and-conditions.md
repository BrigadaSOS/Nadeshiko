---
title: "Terms and Conditions"
description: "Read Nadeshiko's terms and conditions of service."
---

# Terms and Conditions

**Last updated: August 14, 2026**

Please read these terms and conditions carefully before using the Nadeshiko website.

## Educational and Personal Use Only
The content provided by Nadeshiko is for educational and personal use only. You agree to use the content solely for your own educational purposes and not for any commercial use. The content available on the service is provided "as is" and "as available," and Nadeshiko does not own or claim to own any of the content unless explicitly stated otherwise.

## Copyright and DMCA Compliance

Nadeshiko respects the intellectual property rights of others and expects users of the service to do the same. We comply with the Digital Millennium Copyright Act (DMCA) and will respond to notices of alleged copyright infringement that comply with the DMCA and other applicable laws.

For detailed information about our DMCA policy, including how to submit a takedown notice, please see our [DMCA Policy](/dmca) page.

## API Access
If you are provided with API access, you agree to use the API in accordance with these terms and any additional terms provided with your API key. Your use of the API is subject to the following conditions:

- **API Key**: You must use a valid API key assigned to you by Nadeshiko. You are responsible for maintaining the security of your API key and for any use of the API key, whether authorized or unauthorized.
- **Rate Limits**: You agree to adhere to any rate limits or usage restrictions imposed by Nadeshiko. Failure to comply with these limits may result in the suspension or termination of your API access.
- **Prohibited Activities**: You must not use the API to engage in any activity that violates these terms or any applicable laws or regulations. Prohibited activities include, but are not limited to, data scraping, unauthorized data access, and any form of abuse or misuse of the API.
- **Data Use**: Any data accessed via the API is for your personal or educational use only. You must not share, sell, or distribute the data to third parties without explicit permission from Nadeshiko.
- **Modifications**: Nadeshiko reserves the right to modify, suspend, or discontinue the API at any time, with or without notice. Nadeshiko will not be liable to you or any third party for any modification, suspension, or discontinuation of the API.

## Third-Party Integrations

A third-party application may read Nadeshiko content on a reader's behalf, provided every reader brings their own API key and the application meets all of the conditions below. Meeting them **is** the explicit permission that the Data Use condition above requires; an integration that satisfies them does not need to ask us separately.

- **The reader's own key**: the application must use a key the reader created themselves and can revoke at any time. It must not ship a shared key, pool readers onto one key, or send reader keys to its own servers.
- **Read-only scope**: ask readers for a key limited to the `READ_MEDIA` scope. An integration must not require scopes that write to a reader's profile, activity or collections in order to function.
- **Direct requests**: requests must go from the reader's own client to Nadeshiko. The application must not proxy them, keep responses beyond the reader's session, mirror or index the corpus, republish it, or use it to train models.
- **Quotas**: the reader's own quota and rate limits apply. Handle `429` responses and do not work around the limits.
- **Content ratings**: every segment carries a `contentRating`. Filtering or presenting ratings appropriately for your audience is the application's responsibility — a request that sends no content-rating filter receives all ratings, including `EXPLICIT`.
- **Attribution**: name Nadeshiko as the source of the content, and link to these terms and to our [DMCA Policy](/dmca).

We may withdraw this permission from any application at any time. The Termination and Disclaimer sections below apply to applications as they do to readers.

## Termination
We may terminate or suspend your account or block your IP address immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the terms.

## Disclaimer
Your use of the service is at your sole risk. The service is provided on an "AS IS" and "AS AVAILABLE" basis. The service is provided without warranties of any kind, whether express or implied, including, but not limited to, implied warranties of merchantability, fitness for a particular purpose, non-infringement, or course of performance.

Nadeshiko does not warrant that
- The service will function uninterrupted, be secure, or be available at any particular time or location
- Any errors or defects will be corrected
- The service is free of viruses or other harmful components
- The results of using the service will meet your requirements

## Changes
We reserve the right, at our sole discretion, to modify or replace these terms at any time. If a revision is material, we will try to provide at least 30 days' notice prior to any new terms taking effect. What constitutes a material change will be determined at our sole discretion.