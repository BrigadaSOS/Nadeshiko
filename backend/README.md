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

### 6. Initial Data Setup
After starting services, run these commands:

1. Verify Elasticsearch indices are created by:
- Checking Kibana at http://localhost:5601

### 7. Testing
To run tests:
```bash
npm test
```

## Monitoring Tools
- Kibana: `http://localhost:5601`
- PGAdmin: `http://localhost:15400` (credentials in docker-compose.yaml)
