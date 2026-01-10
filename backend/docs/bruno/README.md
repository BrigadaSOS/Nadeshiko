# Nadeshiko API - Bruno Collection

This is a Bruno collection for the Nadeshiko backend API.

## Setup

1. Install [Bruno](https://www.usebruno.com/) if you haven't already
2. Open Bruno and import this collection (File > Import Folder > Select
   `docs/bruno`)
3. Configure your environment variables in `docs/bruno/environments/Local.bru`:
   - `baseUrl`: Your API base URL (default: `http://localhost:3000`)
   - `apiKey`: Your API key
   - `sessionToken`: Your better-auth session cookie token

## Authentication

The API uses two authentication methods.

### API Key Authentication

Most endpoints use API key authentication via the `x-api-key` header.

### Session Cookie Authentication

User management endpoints use better-auth session cookie authentication.

## Usage Tips

1. Create a browser session by logging in through the frontend OAuth flow
2. Copy the `nadeshiko.session_token` cookie value into `sessionToken`
3. Create an API key via **Create API Key** if needed
4. Update the `apiKey` environment variable with your API key
5. Use the search endpoints to explore media content
