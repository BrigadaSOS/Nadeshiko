---
title: "Nadeshiko v2.1.0 - La actualización para devs (+ ¡nueva integración del bot de Discord!)"
description: "SDKs oficiales, bot de Discord público, y promesa de estabilidad en la API."
date: 2026-04-20T00:00:00Z
image: /images/blog/v2-1-0-activity.webp
---

# Nadeshiko v2.1.0 - La actualización para devs (+ ¡nueva integración del bot de Discord!)

Ha pasado poco más de un mes desde el lanzamiento de v2.0.0 de Nadeshiko, y estamos increíblemente agradecidos por la recepción y el crecimiento que está teniendo el proyecto. Solo en el último mes la actividad diaria ha crecido 4x, incluyendo un montón de nuevos usuarios registrados.

Junto con todos los pequeños bugs y mejoras de usabilidad que hemos lanzado durante el último mes, hemos estado trabajando duro en **dos** funcionalidades en concreto que queremos destacar en esta versión v2.1.0:

## 1. ¡Trae Nadeshiko directamente a tu servidor de Discord!

A partir de hoy, hay un bot oficial de Nadeshiko en Discord.

![Bot de Nadeshiko en Discord mostrando un resultado de búsqueda con captura de anime, reproducción de audio y traducciones a japonés/inglés/español](/images/blog/v2-1-0-discord-search.webp)

La próxima vez que estés en mitad de una discusión sobre pitch accent, gramática o vocabulario, simplemente escribe `/search <palabra>` en el chat y obtendrás un embed completo con los mismos resultados que encontrarías en la web de Nadeshiko.

Hemos puesto mucho esfuerzo en asegurarnos de que la experiencia en Discord no se pierda ninguna de las funcionalidades que ofrece la web:
- Búsqueda por palabra o coincidencia exacta
- Ver el contexto de una frase (frases anterior y siguiente)
- Filtrado por anime y episodio
- Acceso a la misma base de datos de 1M de frases de ejemplo

<div class="image-pair">
  <img src="/images/blog/v2-1-0-discord-results.webp" alt="Lista de resultados de búsqueda mostrando varias frases coincidentes en distintos episodios" loading="lazy" />
  <img src="/images/blog/v2-1-0-discord-filter.webp" alt="Menú de filtrado por anime listando todos los animes en la base de datos" loading="lazy" />
</div>

Esperamos que esto te dé nuevas formas de incorporar Nadeshiko en tus estudios de japonés y compartirlo con más gente. Usa el enlace de abajo para invitar al bot a tu servidor, totalmente gratis:

<a class="bot-install-card" href="https://discord.com/oauth2/authorize?client_id=1064964424684806184" target="_blank" rel="noopener noreferrer">
  <img class="bot-install-card-avatar" src="/logo-38d6e06a.webp" alt="" loading="lazy" />
  <div class="bot-install-card-info">
    <div class="bot-install-card-header"><span class="bot-install-card-name">Nadeshiko</span><span class="bot-install-card-app-tag">APP</span></div>
    <p class="bot-install-card-description">Busca más de 1M de frases de ejemplo en japonés de animes y J-dramas, directamente en tu servidor de Discord.</p>
  </div>
  <span class="bot-install-card-cta"><svg viewBox="0 0 127.14 96.36" aria-hidden="true"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>Añadir a Discord</span>
</a>

## 2. (Para devs) SDKs oficiales + documentación de API renovada

Hemos ofrecido soporte de primera para Nadeshiko como API desde la v1.0, y ha sido una parte central de nuestra filosofía desde el principio. Aún así, había algunas pequeñas inconsistencias entre la documentación y la implementación real, y solo exponíamos los endpoints básicos de búsqueda.

**Ya no.**

Hemos revisado por completo la spec de la API hasta el punto en el que podemos garantizar al 100% que los docs y todas las validaciones de requests coinciden. Puedes confiar en la documentación cuando montes un servicio sobre los datos de Nadeshiko.

**[Lee la documentación de la API →](https://nadeshiko.co/docs/api/index.html)**

También hemos expuesto más endpoints para que puedas extraer datos de actividad y colecciones. Si necesitas una fuente de frases de ejemplo en japonés para tu próximo proyecto, prueba Nadeshiko.

Y si no quieres llamar a la API directamente, ahora ofrecemos SDKs oficiales para JavaScript y Python:
- https://github.com/BrigadaSOS/nadeshiko-sdk-ts
- https://github.com/BrigadaSOS/nadeshiko-sdk-python

Sin tener que preocuparte por autenticación, paginación, reintentos ni manejo de errores. Todo viene preparado en un paquete limpio.

TypeScript:

```typescript
import { createNadeshikoClient } from '@brigadasos/nadeshiko-sdk';

const client = createNadeshikoClient({ apiKey: 'nade_xxx' });
const { segments } = await client.search({ query: { search: '彼女' } });
```

Python:

```python
from nadeshiko import Nadeshiko
client = Nadeshiko(token="nade_xxx")
result = client.search(query="食べる")
```

Si tienes preguntas o quieres pedir un nuevo endpoint, no dudes en escribirnos en nuestro [servidor de Discord](https://discord.gg/c6yGwbXruq).

## ¿Qué viene a continuación?

En lo siguiente que nos vamos a centrar es en mejorar la tokenización. Ya hemos reprocesado todas las frases con [Sudachi](https://github.com/WorksApplications/Sudachi) para preservar la información POS (part-of-speech). Con esto, verás información extra por frase (incluyendo lecturas de furigana correctas) que debería hacer los resultados aún más útiles.

También estamos apuntando a un conjunto más amplio de mejoras de rendimiento por toda la web para hacerla más rápida y responsive.

No escribimos posts en el blog por cada pequeño cambio, pero estamos constantemente lanzando cosas nuevas a Nadeshiko. Si quieres estar al tanto, pásate por nuestro servidor de Discord y escríbenos directamente.

<a class="bot-install-card" href="https://discord.gg/c6yGwbXruq" target="_blank" rel="noopener noreferrer">
  <img class="bot-install-card-avatar" src="/logo-38d6e06a.webp" alt="" loading="lazy" />
  <div class="bot-install-card-info">
    <div class="bot-install-card-header"><span class="bot-install-card-name">Nadeshiko Discord</span></div>
    <p class="bot-install-card-description">Pásate por la comunidad, haz preguntas y entérate de los lanzamientos.</p>
  </div>
  <span class="bot-install-card-cta"><svg viewBox="0 0 127.14 96.36" aria-hidden="true"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>Unirse al servidor</span>
</a>

Como siempre, si sientes que Nadeshiko te ha ayudado en tus estudios de japonés y quieres devolver algo, considera apoyar nuestro trabajo con una donación en [Patreon](https://www.patreon.com/c/BrigadaSOS).

¡Nos vemos la próxima vez con más mejoras!
