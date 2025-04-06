# NadeDB Frontend (Nuxt 3)

## Development Setup

### Prerequisites
- Node.js 18+
- Backend API running (see backend README)
- npm 9+ (comes with Node 18+)

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

Key environment variables:
```bash
# Backend API URL
NUXT_PUBLIC_API_BASE_URL=http://localhost:5000

# Google OAuth (optional)
NUXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com

# Other feature flags
NUXT_PUBLIC_ENABLE_ANALYTICS=false
```

### 4. Start Development Server
```bash
npm run dev
```
App will be available at: `http://localhost:3000`

## Key Features
- **State Management**: Pinia stores
- **Styling**: TailwindCSS with custom animations
- **UI Components**: Radix Vue + Lucide icons
- **Internationalization**: Nuxt i18n
- **Image Optimization**: Nuxt Image
- **API Documentation**: Scalar integration

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

## Recommended VS Code Extensions
- [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) - Vue 3 support
- [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)
- [i18n Ally](https://marketplace.visualstudio.com/items?itemName=lokalise.i18n-ally)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)

## Project Structure
```
frontend_v2/
├── assets/       # Global assets
├── components/   # Vue components
├── composables/  # Composable functions
├── layouts/      # Layout components  
├── pages/        # Route pages
├── public/       # Static files
├── server/       # API routes
├── stores/       # Pinia stores
└── utils/        # Utility functions
```

## Deployment
See [Nuxt Deployment Docs](https://nuxt.com/docs/getting-started/deployment) for:
- Node.js hosting
- Static site hosting
- Serverless deployment
- Docker containers
