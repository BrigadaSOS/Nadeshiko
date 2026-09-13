# Nadeshiko Frontend

## Development Setup

### Prerequisites

- Node.js 24 (npm ships with it)
- Backend API running (see backend README)

### 1. Install Dependencies

This is an npm workspaces monorepo — install once from the repository root:

```bash
npm install          # from the repository root
```

### 2. Configure Environment

Create `.env` file from example:

```bash
cp .env.example .env
```

### 4. Start Development Server

```bash
npm run dev
```

App will be available at: `http://localhost:3000`

## Sentence audio pitch contours

Sentence cards can estimate and display a pitch contour from the clip's audio
using the browser's Web Audio API. Analysis is local: the clip is fetched and
decoded in the browser, reduced to a mono 8 kHz signal, and discarded after
the estimate is produced. The contour is an educational visual aid rather
than a phonetic accent annotation; unvoiced, noisy, or unsupported clips show
a recoverable message and retain normal audio playback.

## Deployment (Kamal)

Run Kamal from the `frontend` directory.

Secret files:

- `dev`: `.kamal/dev.key`
- `prod`: `.kamal/prod.key`

Development:

```bash
kamal deploy -d staging
```

Production:

```bash
kamal deploy -d prod
```
