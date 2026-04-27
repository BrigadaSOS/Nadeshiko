---
title: "Nadeshiko v2.1.0 - The Dev update (+ new discord bot integration!)"
description: "Official SDKs, a public Discord bot, and an API stability promise."
date: 2026-04-20T00:00:00Z
image: /images/blog/v2-1-0-activity.webp
---

# Nadeshiko v2.1.0 - The Dev update (+ new discord bot integration!)

It's been a little over a month since the v2.0.0 release of Nadeshiko, and we're incredibly grateful for the reception and growth the site has been seeing. In just the last month daily activity has grown 4x, including plenty of new registered users!

Alongside all the small bugs and usability improvements we've shipped during the past month, we've been working hard on **two** features in particular that we want to highlight in this v2.1.0 release:

## 1. Bring Nadeshiko directly to your Discord server!

Starting today, we have an official Nadeshiko Discord bot.

![Nadeshiko Discord bot showing a search result with anime screenshot, audio playback, and Japanese/English/Spanish translations](/images/blog/v2-1-0-discord-search.webp)

Next time you find yourself in the middle of a discussion about pitch accent, grammar, or vocabulary, just type `/search <word>` in the Discord chat and you'll get a rich embed with the same results you'd find on the Nadeshiko website.

We put a lot of effort into making sure the Discord experience doesn't miss any of the features the website offers:
- Search by word or exact match
- See the context of a sentence (previous and next sentences)
- Media and episode filtering
- Access to the same database of 1M example sentences

<div class="image-pair">
  <img src="/images/blog/v2-1-0-discord-results.webp" alt="Search results list showing multiple matching sentences across episodes" loading="lazy" />
  <img src="/images/blog/v2-1-0-discord-filter.webp" alt="Filter by media menu listing every anime in the database" loading="lazy" />
</div>

With this, we hope the Discord integration will give you new ways to bring Nadeshiko into your Japanese studies and share it with more people. You can use the link below to invite the bot to your server, completely free:

<a class="bot-install-card" href="https://discord.com/oauth2/authorize?client_id=1064964424684806184" target="_blank" rel="noopener noreferrer">
  <img class="bot-install-card-avatar" src="/logo-38d6e06a.webp" alt="" loading="lazy" />
  <div class="bot-install-card-info">
    <div class="bot-install-card-header"><span class="bot-install-card-name">Nadeshiko</span><span class="bot-install-card-app-tag">APP</span></div>
    <p class="bot-install-card-description">Search 1M+ Japanese example sentences from anime and J-dramas, right in your Discord server.</p>
  </div>
  <span class="bot-install-card-cta"><svg viewBox="0 0 127.14 96.36" aria-hidden="true"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>Add to Discord</span>
</a>

## 2. (For developers) Official SDK support + revamped API documentation

We've offered first-class API support for Nadeshiko since v1.0, and it's been a core part of our philosophy from the start. Still, there were some minor inconsistencies between the documentation and the real implementation, and we only exposed the basic search endpoints.

**Not anymore!**

We've fully revamped the API spec to the point where we can 100% guarantee that the docs and all request validations match. You can trust the docs when building a service on top of Nadeshiko endpoints.

**[Read the API documentation →](https://nadeshiko.co/docs/api/index.html)**

We've also exposed more endpoints so you can pull activity and collections data. If you need a source of Japanese example sentences for your next project, give Nadeshiko a try.

And if you don't want to call the API directly, we now offer official SDKs for JavaScript and Python:
- https://github.com/BrigadaSOS/nadeshiko-sdk-ts
- https://github.com/BrigadaSOS/nadeshiko-sdk-python

No need to worry about authentication, pagination, retries, or error handling. Everything comes prepared in a clean package.

TypeScript:

```typescript
import { createNadeshikoClient } from '@brigadasos/nadeshiko-sdk';

const client = createNadeshikoClient({ apiKey: 'nade_xxx' });
const { segments } = await client.search({ query: { search: '彼女' } });
```

Python:

```python
from nadeshiko import Nadeshiko
client = Nadeshiko(token="nade_xxx")
result = client.search(query="食べる")
```

If you have questions or want to request a new endpoint, please reach out to us on our [Discord server](https://discord.gg/c6yGwbXruq).

## What's coming next?

The next main thing we're focusing on is **improving tokenization**. We've already reprocessed every sentence with [Sudachi](https://github.com/WorksApplications/Sudachi) to preserve POS (part-of-speech) information. With this, you'll see extra information per sentence (including proper furigana readings) that should make the results even more useful.

We're also targeting a wider set of performance improvements across the site to make it faster and more responsive.

We don't write blog posts for every small change, but we're constantly shipping new things to Nadeshiko! If you want to stay in the loop, drop by our Discord server and reach us directly.

<a class="bot-install-card" href="https://discord.gg/c6yGwbXruq" target="_blank" rel="noopener noreferrer">
  <img class="bot-install-card-avatar" src="/logo-38d6e06a.webp" alt="" loading="lazy" />
  <div class="bot-install-card-info">
    <div class="bot-install-card-header"><span class="bot-install-card-name">Nadeshiko Discord</span></div>
    <p class="bot-install-card-description">Hang out with the community, ask questions, and get release updates.</p>
  </div>
  <span class="bot-install-card-cta"><svg viewBox="0 0 127.14 96.36" aria-hidden="true"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>Join Server</span>
</a>

And if you feel Nadeshiko has helped your Japanese studies and want to give something back, consider supporting our work with a donation on [Patreon](https://www.patreon.com/c/BrigadaSOS).

See you next time with more improvements!
