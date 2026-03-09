---
title: "A New Home for Nadeshiko"
description: "We have moved Nadeshiko to a proper server. Here's what changed."
date: 2026-03-01T00:00:00Z
author: "Natsume"
tags:
  - announcement
  - news
---

# A New Home for Nadeshiko

![The Orange Pi that hosted Nadeshiko](/images/blog/orange-pi.jpg)
*"Rest in peace, little Orange Pi"*

This little Orange Pi is where Nadeshiko has been running for the past year. Initially, it worked just fine. When this whole page was just a prototype and we had a few animes included. Now we have more than 1M segments, including audio and images. This is roughly >3M individual files, over ~200GB of media that we serve throughout this page.

And with that, the poor Orange Pi has reached it's limit. The SD card would die, small electricity fluctiations

And the environment conditions weren't that much better. Running this in a home server meant that we were at mercy of the local ISP internet. And having hours (or even days) internet blackouts were sadly becomming a common thing out of our control.

Not anymore. We have committed to give Nadeshiko the home it deserves.

The response from the Japanese learning community has been way beyond what we expected, being mentioned in places like Tatsumoto's guide, the TheMoeWay Discord, and other learner communities. We are incredibly grateful of everybody that spends their time recommending the page to other fellow Japanese learners that are finding whatever tools they can find to improve their learning. And that kind of support is something that we want to backup with a service that has proper foundations.

Nadeshiko now runs on a dedicated cloud server (Hetzner) in Europe. No more outages or internet blackouts. And as a benefit, we get a more hefty machine that should run the whole search backend at a better and lower latency.
In addition, all media assets are now hosted and served through Cloudflare CDN. So now no matter where you are, audios and images should load blazingly fast.

### New features

But that is not all. Along migrating to a proper new server, we had a backlog of things we wanted to implement but never had the time to do.

We shipped a lot of improvements with the recent 1.5.0 update:
- **Upgraded Japanese parser**: Moved from Kuromoji to Sudachi for better word segmentation and accuracy.
- **Sentence reporting**: Now logged users can report an incorrect sentence directly from the website so we can quickly review and fix it.
- **NSFW content filter**: We had a lot of animes that wanted to include in Nadeshiko, but had "questionable" scenes (looking at you, [Monogatari](https://nadeshiko.co/search/sentence?media=15689&query=%E8%82%89%E4%BD%93)). So now we have added proper filter to blur/hide these segments so you stay in control.
- **Hide media by preference**: We care about spoilers. If you have a specific anime that you don't want to see in Nadeshiko, now you can hide it from all search results from your user settings.
- **Persistent user preferences**: Never lose again your Anki configuration. No we save save it along your account data.
- **Toggle translations**: Hide English or Spanish translations, in case you prefer immersion or are not interested in a specific language.
- **Sentence collections**: Create and organize your own collections of sentences for study.

- **Audio normalization**: all sentence audio is now leveled to a consistent volume.
- **SEO improvements**: Nadeshiko pages are now properly indexed and shareable.

### Revamped API and SDKs

We also completely rebuilt the Nadeshiko API. It's already available to use ([link to API docs]). Official SDKs are coming later this week, and we'll do a separate post diving into the API.

## Thank You

We really appreciate everyone who uses Nadeshiko. Seeing it recommended across the community is what keeps us motivated to make it better.

Nadeshiko will always remain free and open-access. We want it to be a lasting resource for Japanese learners. We are covering server and maintenance costs from our own pockets because this is a tool we want to see live for a long time.

If you feel the same way and want to help keep Nadeshiko running, consider supporting the project on [Patreon](link).
