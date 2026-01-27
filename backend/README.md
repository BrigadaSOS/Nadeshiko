# NadeDB Backend

## Development Setup

### Prerequisites

- node
- npm
- Docker and Docker Compose

### Quick Start

First run the dependencies from docker-compose:

```bash
docker-compose up -d
```

Then, run the setup script to configure everything else:

```bash
cd backend
npm run setup
```

This will:

- Copy `.env.example` to `.env` if needed
- Install npm dependencies
- Initialize the database with default admin user

## Running the Application

For development (hot reloading):

```bash
npm run dev
```

For production:

```bash
npm run build
npm run start
```

The API will be available at `http://localhost:5000`

## Bruno Collection

Import and use the [Bruno](https://www.usebruno.com/) collection from
`/docs/bruno` for easy testing of the API endpoints.
