# Nadeshiko API - Bruno Collection

This is a Bruno collection for the Nadeshiko backend API.

## Setup

1. Install [Bruno](https://www.usebruno.com/) if you haven't already
2. Open Bruno and import this collection (File > Import Folder > Select `bruno/Nadeshiko-API`)
3. Configure your environment variables in `environments/Local.json`:
   - `baseUrl`: Your API base URL (default: `http://localhost:3000/api`)
   - `apiKey`: Your API key
   - `jwtToken`: Your JWT authentication token

## Authentication

The API uses two authentication methods:

### API Key Authentication
Most endpoints use API key authentication via the `x-api-key` header.

### JWT Authentication
User management endpoints use JWT authentication via the `Authorization: Bearer {token}` header.

## Usage Tips

1. Start by logging in via **Login** to get your JWT token
2. Update the `jwtToken` environment variable with the received token
3. Create an API key via **Create API Key** if needed
4. Update the `apiKey` environment variable with your API key
5. Use the search endpoints to explore media content
