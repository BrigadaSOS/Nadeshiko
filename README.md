# Nadeshiko

[![Release](https://github.com/BrigadaSOS/Nadeshiko/actions/workflows/release.yml/badge.svg)](https://github.com/BrigadaSOS/Nadeshiko/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@brigadasos/nadeshiko-sdk)](https://www.npmjs.com/package/@brigadasos/nadeshiko-sdk)
[![PyPI](https://img.shields.io/pypi/v/nadeshiko-sdk)](https://pypi.org/project/nadeshiko-sdk/)

Nadeshiko is an online sentence search engine designed to display content from a wide variety of media including anime, J-dramas, films and more.

![2024-09-15-22-54-38](https://github.com/user-attachments/assets/6e2dd891-5d39-46a3-adcb-85c590c17cce)

## Features
- **Multilingual Search:** Search for Japanese sentences using Japanese characters, English, or Spanish terms.
- **Simultaneous Search:** Search for multiple terms with a single click.
- **Sentence Context:** View any sentence within their original context.
- **Anki Support:** Export to Anki with complete sentence, image and audio.
- **Downloadable Content**: Download any content for offline study and reference.
- **Public API:** Integrate our database and search features into your own applications.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, available commands, and how to submit changes.

## Deployment

Every push to `main` deploys that commit to staging (https://stg.nadeshiko.co)
and runs E2E against it. Once staging is green, pushing the same commit to
`production` releases it to https://nadeshiko.co. Releases are identified by
commit SHA; there are no version bumps or tags. See
[DEPLOYMENT.md](DEPLOYMENT.md) for the full workflow.

```bash
# after the staging release of this main commit is green:
git push origin main:production
```

## Projects Using Nadeshiko

### Anki Note Types
- **[Senren](https://github.com/BrenoAqua/Senren)** — A highly customizable Anki note type for studying Japanese.
- **[Kiku](https://github.com/youyoumu/kiku)** — A modern, fully interactive Anki note type designed for Japanese learners.

### Anki Add-ons
- **[AnkiAutoImage](https://github.com/swagercode/AnkiAutoImage)** — On-demand images for Anki flashcards.
- **[Anki InContext](https://github.com/abdnh/anki-incontext)** — An Anki add-on to fetch example sentences for various languages.

### External Tools
- **[NihongoClick](https://github.com/FragozoLeonardo/NihongoClick)** — Context menu Japanese study assistant.
- **[JPDB-Nadeshiko-Examples](https://github.com/Sacus1/JPDB-Nadeshiko-Examples)** — Userscript for jpdb.io that embeds anime examples from Nadeshiko.


## Contribution and Attribution
<table>
<tr>
    <td align="center">
        <a href="https://github.com/Natsume-197">
            <img src="https://avatars.githubusercontent.com/u/36428207?v=4" width="100;" alt="Natsume-197"/>
            <br />
            <sub><b>Natsume-197</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/davafons">
            <img src="https://avatars.githubusercontent.com/u/29177698?v=4" width="100;" alt="davafons"/>
            <br />
            <sub><b>Davafons</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/xyaman">
            <img src="https://avatars.githubusercontent.com/u/32078353?v=4" width="100;" alt="xyaman"/>
            <br />
            <sub><b>Xyaman</b></sub>
        </a>
    </td>
</tr>
</table>


This search engine makes use of materials and references that are the intellectual property of their respective authors and rights holders. Please consult [here](https://nadeshiko.co/media) for the list of content used and its respective authors.

The use of these materials is carried out under the belief that it complies with the guidelines of "fair use" for educational purposes and without profit motive. If you are the holder of the rights to any of these materials and believe that the fair use standards are not being met, please [contact us](https://nadeshiko.co/dmca).
