---
title: "A new home for Nadeshiko 2.0"
description: "A new server, a rebuilt platform, and the features that make this our biggest release yet."
date: 2026-03-16T00:00:00Z
image: /images/blog/orange-pi.jpg
---

# A new home for Nadeshiko 2.0

![The Orange Pi that hosted Nadeshiko](/images/blog/orange-pi.jpg)

This image above is the server where Nadeshiko has been running for the past year: an Orange Pi with an SSD attached to it. Initially, it worked just fine, back when this whole page was just a prototype with only a few animes and some users from our Spanish community.

Now we have:
- More than **1M unique sentences**
- Over **3500 episodes** across **>200** different animes and j-dramas.
- A total of **3M individual images and audio files**, adding up to more than **200GB** that we serve through this page.


And with all that, the poor server has reached its limit. The SD card and SSD have already died a few times, causing the page to go down. And serving this from home, with all the electricity and internet fluctuations, doesn't help with stability. Sometimes these outages would last days, and that's where we started to worry about how much longer we could keep this setup going.

But not anymore. We have committed to give Nadeshiko the home it deserves. Nadeshiko now runs on a **dedicated cloud server (VPS)**, which guarantees that the page will be virtually always up. And as an extra benefit, we get a beefier machine that runs the whole search engine at lower latency. Also, all media assets are now hosted and served through Cloudflare CDN, so no matter where you are, audio and images will load **fast**.

The response from the Japanese learning community has been way beyond what we expected, being mentioned in places like Tatsumoto's guide, the TheMoeWay Discord, and other communities. We are incredibly grateful to everybody who spends their time recommending the page to other fellow Japanese learners. That kind of support is something we want to back up with a service that meets the standards you deserve.


This infrastructure overhaul, together with everything we've built on top of it, is what makes this **Nadeshiko 2.0.**

## What's new in 2.0

Along with migrating to a proper server, we had a backlog of things we always wanted to implement but never had the time to do. This time, we put our ass to work and shipped all of them.

### Better Japanese Parser

We moved from Kuromoji to Sudachi for better word segmentation and accuracy. This directly improves search quality and parsing of your search, so you will get more relevant results.

### Sentence Collections

Now you can create as many collections of sentences as you like and share them with other users. Also, words that you export to Anki will be saved automatically so you can refer to them later.

### Sentence Reporting

If you find an incorrect sentence, you can now report it directly from the website so we can quickly review and fix it. We also have an automatic scan system that finds segments or media that have been imported incorrectly to Nadeshiko, so we can fix them before you even notice.

### NSFW Content Filter

We had a lot of anime we wanted to include in Nadeshiko but had "questionable" scenes (looking at you, [Monogatari](https://nadeshiko.co/search/sentence?media=15689&query=%E8%82%89%E4%BD%93)). Now we have a proper filter to blur and hide these segments, so you can decide whether to show, hide, or blur them.

### Persistent User Preferences

Your Anki configuration and all other settings are now saved with your account. No more losing them when you switch devices. Also, you can now customize your experience in Nadeshiko a lot more, like showing or hiding English/Spanish translations.

### Activity tracking

You can now opt in to save a history of the searches you do in Nadeshiko, as well as other actions like sharing specific sentences or playing audio, so you never lose a sentence again.

### Audio Normalization

All sentence audio is now leveled to a consistent volume. No more jumping between whisper-quiet dialogue and ear-shattering action scenes.

### Media Preferences

From your user settings, you can now hide any anime in your search results, to make sure you won't get spoiled on a specific show while using Nadeshiko.

## About your account and API Keys

All existing accounts and API Keys have been migrated to the new platform. You can log in and find them in your account settings right away.

If you still need access to the previous version, the old server remains available at [old.nadeshiko.co](https://old.nadeshiko.co) until the end of April 2026. After that, **it will be permanently shut down.**

> **IMPORTANT:** For plugins that still use the old API, you still need to create and manage the API key through the old website. We are working with the owners of external plugins to help them migrate to the Nadeshiko V2.0 as soon as possible, after which you can just use the API Keys from the new page.

## Thank You

We really want to thank everybody who uses Nadeshiko. Seeing it being loved so much across the community is what keeps us motivated to make it even better.

Nadeshiko will **always remain free and open-access, no exception**. We are covering server and maintenance costs from our own pockets because this is a tool we want to see live for a long time.

If you feel the same way and want to help keep Nadeshiko running, consider supporting the project on [Patreon](https://www.patreon.com/c/BrigadaSOS).

In the following weeks, we will write more posts explaining the new features in more detail. If you wish to contact us to leave a comment, suggestion, bug report, or anything else, you can do so via:
- **Email**: contact@nadeshiko.co
- **Discord**: [Nadeshiko](https://discord.gg/c6yGwbXruq)

Never stop studying!
