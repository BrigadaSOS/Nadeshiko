---
title: "Nadeshiko v2.1.0 — Actualización DEV + Discord: SDKs, Bot y Estabilidad de API"
description: "SDKs oficiales para Python y TypeScript, un bot de Discord que convierte enlaces en rich embeds, y una promesa de cero cambios breaking de aquí en adelante."
date: 2026-04-20T00:00:00Z
image: /images/blog/nadeshiko-dev-2-1-0.jpg
draft: true
---

# Nadeshiko v2.1.0 — Actualización DEV

Esta versión es para desarrolladores, integradores y usuarios avanzados que quieran construir sobre Nadeshiko. Lanzamos oficialmente nuestros SDKs, abrimos más endpoints de API y nos comprometemos con la estabilidad a largo plazo.

## SDKs Oficiales: Python y TypeScript

Después de semanas refinando la especificación OpenAPI y la experiencia de desarrollo, ambos SDKs están disponibles y listos para producción.

### TypeScript — `npm add @brigadasos/nadeshiko-sdk`

```typescript
import { createNadeshikoClient } from '@brigadasos/nadeshiko-sdk';

const client = createNadeshikoClient({ apiKey: 'nade_xxx' });
const { segments } = await client.search({ query: { search: '彼女' } });

// Auto-paginación
for await (const seg of client.search.paginate({ query: { search: '猫' } })) {
  console.log(seg.textJa.content);
}
```

### Python — `pip install nadeshiko-sdk`

```python
from nadeshiko import Nadeshiko
from nadeshiko.api.search import search

client = Nadeshiko(token="nade_xxx")
result = search.sync(client, body=SearchRequest(query="食べる"))
```

**Características de los SDK:**
- Tipado completo generado desde OpenAPI
- Reintentos automáticos con backoff exponencial y soporte para header `Retry-After`
- Manejo de errores RFC 7807 con códigos legibles por máquina e IDs de traza
- Paginación cursor-based con iteradores async `.paginate()`
- Opción de desactivar excepciones por llamada vía `throwOnError: false`

## Bot de Discord: Auto-Embed

Pega un enlace de Nadeshiko en Discord y el bot responde automáticamente con un rich embed que incluye:

- Texto japonés con furigana
- Traducciones al inglés y español
- Clips de audio y video inline
- Botones de navegación de contexto (segmentos anterior y siguiente)
- Enlaces a resultados de búsqueda filtrados por media y episodio

Sin comandos necesarios. Solo pega un enlace como `nadeshiko.co/sentence/xK9mP2nQwR4t` y el bot hace el resto. Los admins pueden activar/desactivar los auto-embeds por servidor.

## Promesa de Estabilidad de API

Aquí viene lo importante: **revisé personalmente cada endpoint, nombre de parámetro y schema de respuesta para asegurar una experiencia consistente e intuitiva. Después de este release, me comprometo a cero cambios breaking en la API pública.**

Nuevas funciones y endpoints serán puramente aditivos. La API tiene versionado y es backwards-compatible. Si construyes sobre Nadeshiko hoy, tu código funcionará mañana.

## Nuevos Endpoints de API

Más funcionalidad core de Nadeshiko ahora accesible vía API:

- **`searchWords`** — Busca múltiples palabras simultáneamente, obtén conteos por media
- **`searchMedia`** — Autocompletado de títulos de media
- **`getSearchStats`** — Conteos por categoría y lista de media para UIs de filtro
- **`getStatsOverview`** — Estadísticas del corpus: total de segmentos, tiers de cobertura
- **Collections API** — CRUD completo para colecciones de frases guardadas
- **User Activity** — Tracking de actividad personal y visualización de heatmaps
- **`getSegmentContext`** — Obtén segmentos circundantes para expansión de contexto

Más endpoints están en desarrollo para exponer la profundidad completa del dataset de Nadeshiko.

## Qué Cambió Desde v2.0.0

**Mejoras para usuarios:**

- **Stats dashboard** — Explora analíticas del corpus incluyendo total de segmentos, tiers de cobertura y estadísticas de búsqueda
- **Sesiones persistentes** — Las sesiones ahora duran 30 días en vez de expirar al cerrar el navegador
- **Aumento de rate limit** — Subido a 20.000 requests por mes para todos los tiers
- **Mejoras de búsqueda** — Mejores títulos y descripciones en todas las páginas, sitemap mejorado, filtros de longitud min/max
- **Descargas de audio** — Descarga audio expandido de frases directamente desde el reproductor
- **Refresh visual** — Rebrand completo con nueva imagen en toda la página
- **Páginas más rápidas** — Fetching paralelo de datos para llamadas de sentence y stats
- **Persistencia de preferencias** — La configuración de idioma ahora sobrevive recargas de página
- **Autenticación mejorada** — Magic link login arreglado en subpáginas, mejor flujo OAuth

**Mejoras internas:**

- **Overhaul de paginación** — Migración de offset a keyset pagination para mejor rendimiento a escala
- **Observabilidad** — Instrumentación OpenTelemetry, logging de errores de browser, analytics PostHog, endpoints de health
- **Infraestructura** — Límites de memoria Docker, optimizaciones de connection pooling, cluster mode Nuxt
- **Elasticsearch** — Reindexado sin downtime con soporte de rollback vía aliases
- **Bot de Discord** — Integración completa de monitoreo, persistencia de settings por guild
- **Sistema de reportes** — Overhaul para mejor workflow de moderación de contenido

## Qué Viene Después

Más endpoints de API están en camino para exponer operadores de búsqueda avanzada, exports bulk e integraciones terceras. El objetivo es hacer de Nadeshiko el mejor backend posible para quien construya herramientas de aprendizaje de japonés.

¿Preguntas? Únete a nosotros en [#dev-chat](https://discord.gg/c6yGwbXruq) o lee la [documentación de la API](https://nadeshiko.co/docs/api).

¡Nunca dejes de estudiar!
