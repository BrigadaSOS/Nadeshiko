# Nadeshiko Frontend

## Development Setup

### Prerequisites

- bun
- Backend API running (see backend README)

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment

Create `.env` file from example:

```bash
cp .env.example .env
```

### 4. Start Development Server

```bash
bun run dev
```

App will be available at: `http://localhost:3000`

## Deployment (Kamal)

Run Kamal from the `frontend` directory.

Secret files:

- `dev`: `.kamal/dev.key`
- `prod`: `.kamal/prod.key`

Development:

```bash
kamal deploy -d dev
```

Production:

```bash
kamal deploy -d prod
```
