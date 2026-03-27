interface Env {
  SEED_BUCKET: R2Bucket;
  SEED_TOKEN: string;
  SEED_FILE: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') || request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token || token !== env.SEED_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }

    const object = await env.SEED_BUCKET.get(env.SEED_FILE);
    if (!object) {
      return new Response('Seed file not found', { status: 404 });
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${env.SEED_FILE}"`,
        'Content-Length': String(object.size),
      },
    });
  },
};
