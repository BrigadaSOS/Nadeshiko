---
title: "A New Home for Nadeshiko"
description: "Nadeshiko has moved from a Raspberry Pi to a proper server. Here's what changed."
date: 2026-03-01T00:00:00Z
author: "Natsume"
excerpt: "Nadeshiko used to run on a Raspberry Pi in Colombia. Not anymore."
tags:
  - announcement
  - news
---

# A New Home for Nadeshiko

*[Photo of the Raspberry Pi]*

This little Raspberry Pi, sitting in a home in Colombia, is where Nadeshiko has been running for the past years. Every power outage, every internet hiccup meant the service would go down. Sometimes for hours, sometimes for days. If you ever visited Nadeshiko and found it unavailable, now you know why.

Not anymore.

The response from the Japanese learning community has been way beyond what we expected. Nadeshiko has been mentioned in places like Tatsumoto's guide, the TheMoeWay Discord, and other learner communities. That kind of support deserves a proper foundation, so we decided to give Nadeshiko the infrastructure it actually needs.

## What's New

### Reliable infrastructure

- Nadeshiko now runs on a dedicated cloud server (Hetzner). No more outages from power cuts or home internet issues.
- All media assets are served through Cloudflare CDN, so audio and images load faster no matter where you are.

### New features

We shipped a lot of improvements in this update:

- **Audio normalization**: all sentence audio is now leveled to a consistent volume. No more blasting your ears or straining to hear.
- **Upgraded Japanese parser**: moved from Kuromoji to Sudachi for better word segmentation and accuracy.
- **Sentence reporting**: found an incorrect sentence? You can now flag it directly.
- **Segment editing**: edit details about specific segments right from the interface.
- **NSFW content support**: with proper filtering so you stay in control.
- **Persistent user preferences**: your settings now save to your account across sessions.
- **Hide media by preference**: choose to hide specific shows or content you don't want to see.
- **Toggle translations**: hide English or Spanish translations if you prefer immersion.
- **Sentence collections**: create and organize your own collections of sentences for study.
- **SEO improvements**: Nadeshiko pages are now properly indexed and shareable.

### Revamped API and SDKs

We also completely rebuilt the Nadeshiko API. It's already available to use ([link to API docs]). Official SDKs are coming later this week, and we'll do a separate post diving into the API.

## Thank You

We really appreciate everyone who uses Nadeshiko. Seeing it recommended across the community is what keeps us motivated to make it better.

Nadeshiko will always remain free and open-access. We want it to be a lasting resource for Japanese learners. We are covering server and maintenance costs from our own pockets because this is a tool we want to see live for a long time.

If you feel the same way and want to help keep Nadeshiko running, consider supporting the project on [Patreon](link).
