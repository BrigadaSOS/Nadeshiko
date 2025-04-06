# NadeDB Backend

## Development Setup

### Prerequisites
- Node.js 18+
- Docker and Docker Compose
- PostgreSQL client (optional)
- Redis client (optional)

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

#### Essential Variables to Configure:
```bash
# Database
PG_HOST=localhost
PG_PORT=5432
PG_USER=admin
PG_PASSWORD=admin
PG_DATABASE=nadedb

# Media Storage
MEDIA_DIRECTORY=./media/anime
TMP_DIRECTORY=./media/tmp
BASE_URL_MEDIA=localhost:5000/api/media/anime
BASE_URL_TMP=localhost:5000/api/media/tmp

# Security
SECRET_KEY_JWT=jwtkey  # Change to a strong random string
API_KEY_MASTER=master-api-key  # Change for production

# Elasticsearch
ELASTICSEARCH_HOST=http://localhost:9200
ELASTICSEARCH_PASSWORD=admin  # Match docker-compose

# Default Admin Account (change these!)
USERNAME_API_NADEDB=admin
PASSWORD_API_NADEDB=admin
EMAIL_API_NADEDB=admin@admin.com
```

### 3. Start Services with Docker
```bash
docker-compose up -d
```
This will start:
- PostgreSQL with PGroonga (port 5432)
- Redis (port 6379) 
- Elasticsearch (port 9200)
- Kibana (port 5601)
- PgSync service

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

1. Create database tables:
```bash
npx sequelize-cli db:migrate
```

2. (Optional) Seed test data:
```bash
npx sequelize-cli db:seed:all
```

3. Verify Elasticsearch indices are created by:
- Checking Kibana at http://localhost:5601
- Or querying directly:
```bash
curl -X GET "localhost:9200/_cat/indices?v"
```

### 7. Testing
To run tests:
```bash
npm test
```

## Production Deployment Notes

1. For production, ensure:
```bash
ENVIRONMENT=production
SECRET_KEY_JWT=strong-random-string-here
API_KEY_MASTER=change-this-value
```

2. Recommended production security:
- Enable Elasticsearch security in docker-compose
- Change Redis password
- Use HTTPS for all endpoints
- Set proper file permissions for media directories

3. Backup strategy:
- Schedule PostgreSQL dumps
- Backup media directory
- Consider Elasticsearch snapshots

## Monitoring Tools
- Kibana: `http://localhost:5601`
- PGAdmin: `http://localhost:15400` (credentials in docker-compose.yaml)
