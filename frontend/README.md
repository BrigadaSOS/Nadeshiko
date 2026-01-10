# NadeDB Frontend (Nuxt 3)

## Development Setup

### Prerequisites
- node
- npm
- Backend API running (see backend README)

### 1. Clone the Repository
```bash
git clone https://github.com/your-repo/nadedb.git
cd nadedb/frontend_v2
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Create `.env` file from example:
```bash
cp .env.example .env
```

### 4. Start Development Server
```bash
npm run dev
```
App will be available at: `http://localhost:3000`

## Development Scripts
```bash
# Lint code
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview

# Generate static site
npm run generate
```
