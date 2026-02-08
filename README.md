# Nadeshiko
Nadeshiko is an online sentence search engine designed to display content from a wide variety of media including anime, J-dramas, films and more.

![2024-09-15-22-54-38](https://github.com/user-attachments/assets/6e2dd891-5d39-46a3-adcb-85c590c17cce)

## Features
- **Multilingual Search:** Search for Japanese sentences using Japanese characters, English, or Spanish terms.
- **Simultaneous Search:** Search for multiple terms with a single click.
- **Sentence Context:** View any sentence within their original context.
- **Anki Support:** Export to Anki with complete sentence, image and audio.
- **Downloadable Content**: Download any content for offline study and reference.
- **Public API:** Integrate our database and search features into your own applications.

## Development
### Prerequisites
- `bun` (see `.tool-versions`)
- Docker and Docker Compose

### Quick start
```bash
# Start local services (Postgres/Elasticsearch/Kibana)
cd backend && docker compose up -d

# Install dependencies
cd ..
bun install --cwd backend
bun install --cwd frontend

# Create env files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Prepare backend data
bun run --cwd backend setup

# Run apps
bun run dev:backend
bun run dev:frontend
```

### Common root commands
```bash
bun run lint
bun run typecheck
bun run build
bun run check
bun run docs:verify
```

## Release Versioning
From the repository root:

```bash
bun run release:set-version 1.2.3
bun run release:check-version
```

Tag and push the release:

```bash
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3
```

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
            <img src="https://avatars.githubusercontent.com/u/29177698?v=4" width="100;" alt="m-edlund"/>
            <br />
            <sub><b>Davafons</b></sub>
        </a>
    </td>
    <td align="center">
        <a href="https://github.com/xyaman">
            <img src="https://avatars.githubusercontent.com/u/32078353?v=4" width="100;" alt="m-edlund"/>
            <br />
            <sub><b>Xyaman</b></sub>
        </a>
    </td>
</tr>
</table>


This search engine makes use of materials and references that are the intellectual property of their respective authors and rights holders. Please consult [here](https://nadeshiko.co/search/media) for the list of content used and its respective authors.

The use of these materials is carried out under the belief that it complies with the guidelines of "fair use" for educational purposes and without profit motive. If you are the holder of the rights to any of these materials and believe that the fair use standards are not being met, please [contact us](https://nadeshiko.co/dmca).
