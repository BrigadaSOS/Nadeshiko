# NadeDB Backend

## Development Setup

### Prerequisites
- node
- npm
- Docker and Docker Compose

### 1. Clone the Repository
```bash
git clone https://github.com/your-repo/nadedb.git
cd nadedb/backend
```

### 2. Setup Environment Variables
Copy the example env file and update the values:
```bash
cp .env.example .env
```

### 3. Start Services with Docker
```bash
docker-compose up -d
```

The following admin panels will also be available:
- Kibana: `http://localhost:5601`
- PGAdmin: `http://localhost:15400` (credentials are in docker-compose.yaml)

### 4. Install Dependencies
```bash
npm install
```

### 5. Run the Application
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

### 6. Initialize Database
Before using the API, initialize the database with default admin user and API key:
```bash
curl --request GET --url http://localhost:5000/api/v1/admin/database/sync/full
```

Default credentials:
- **Admin:** admin@admin.com / admin
- **API Key:** master-api-key (use `X-API-Key` header)

### 7. Bruno Collection
Import and use the [Bruno](https://www.usebruno.com/) collection from `/bruno` for API testing.
```

