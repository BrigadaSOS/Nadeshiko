---
title: "Un nuevo hogar para Nadeshiko 2.0"
description: "Un nuevo servidor, una plataforma reconstruida, y las funciones que hacen de esta nuestra mayor actualización."
date: 2026-03-16T00:00:00Z
image: /images/blog/orange-pi.jpg
---

# Un nuevo hogar para Nadeshiko 2.0

![La Orange Pi que alojaba Nadeshiko](/images/blog/orange-pi.jpg)

Este es el servidor donde Nadeshiko ha estado funcionando durante el último año: una Orange Pi con un SSD conectado. Al principio funcionaba bien, cuando esta página era solo un prototipo con unos pocos animes y algunos usuarios de nuestra comunidad hispana.

Ahora tenemos:
- Más de **1M de frases únicas**
- Más de **3500 episodios** en **más de 200** animes y j-dramas diferentes.
- Un total de **3M de imágenes y archivos de audio**, sumando más de **200GB** que servimos a través de esta página.


Y con todo eso, el pobre servidor ha llegado a su límite. La tarjeta SD y el SSD ya han muerto varias veces, tirando la página abajo. Además de que estábamos sirviendo esto desde una casa, con todas las fluctuaciones de electricidad e internet que eso conlleva. A veces se nos iba el internet durante días, y ahí es donde empezamos a preocuparnos por cuánto más podríamos aguantar con esta configuración.

Pero ya se acabó. Nos hemos comprometido a darle a Nadeshiko el hogar que se merece. Ahora, Nadeshiko está en un **servidor cloud dedicado (VPS)**, lo que garantiza que la página estará prácticamente disponible siempre sin caídas. Y de paso tenemos una máquina más potente que ejecuta todo el motor de búsqueda con mucha menos latencia. Además, todos los archivos multimedia ahora se sirven a través de Cloudflare CDN, así que sin importar dónde estés audio e imágenes ahora cargarán **mucho más rápido** que antes.

La respuesta de la comunidad de japonés ha sido mucho mayor de lo que esperábamos, siendo mencionados en lugares como la guía de Tatsumoto, el Discord de TheMoeWay y otras comunidades varias. Estamos increíblemente agradecidos con todos los que han dedicado un poco de su tiempo a recomendar la página a otros estudiantes. Ese tipo de apoyo es algo que queremos respaldar con un servicio que esté a la altura de lo se merecen.

Es este nuevo servidor, junto con todas las otras nuevas funcionalidades que hemos construido, lo que nos permite lanzar orgullosos **Nadeshiko 2.0.**

## Qué hay de nuevo en la 2.0

Junto con la migración a un nuevo servidor, teníamos una lista de tareas pendientes que siempre quisimos implementar pero nunca tuvimos tiempo. Pero esta vez nos pusimos las pilas para sacarlas todas.

### Mejora en el parser 

Migramos de Kuromoji a Sudachi para una mejor segmentación de palabras en el engine. Esto mejora directamente la calidad de búsqueda y ofrece resultados más relevantes.

### Colecciones

Ahora puedes crear colecciones de frases y compartirlas con otros usuarios. Además, las palabras que exportes a Anki se guardarán automáticamente en una colección especial para que puedas consultarlas más tarde.

### Sistema de reporte

Si encuentras una frase incorrecta, ahora puedes reportarla directamente desde la web para que podamos revisarla y corregirla rápidamente. También tenemos un sistema de escaneo automático que encuentra segmentos que se han importado incorrectamente a Nadeshiko, para que podamos arreglarlos antes de que te des cuenta.

### Filtro de contenido NSFW

Teníamos muchos animes que queríamos incluir en Nadeshiko pero tenían escenas "cuestionables" (te estamos mirando, [Monogatari](https://nadeshiko.co/search/sentence?media=15689&query=%E8%82%89%E4%BD%93)). Ahora tenemos un filtro adecuado donde puedes decidir si mostrar, ocultar o difuminar estos segmentos.

### Preferencias de usuario persistentes

Tu configuración de Anki y todas las demás opciones ahora se sincronizan con tu cuenta. Además, ahora puedes personalizar mucho más tu experiencia en Nadeshiko, como por ejemplo mostrar u ocultar traducciones en inglés/español.

### Seguimiento de actividad

Ahora puedes activar un historial donde se guardan las búsquedas que haces en Nadeshiko, así como otras acciones como compartir frases específicas o reproducir audio, para que nunca vuelvas a perder una frase interesante.

### Audio normalizado

Hemos reprocesado todo el audio de las frases para que estén nivelados a un volumen consistente, incluyendo filtros que hacen que el diálogo se escuche mejor.

### Ocultar medios

Desde tu configuración de usuario, ahora puedes ocultar cualquier anime en tus resultados de búsqueda, para asegurarte de que no te spoileen un anime específico mientras usas Nadeshiko.

## Que pasa con mi cuenta y claves API?

Todas las cuentas existentes y claves API han sido migradas al nuevo servidor, así que una vez inicies sesión podrás encontrarlas directamente ahí.

Si todavía necesitas acceder a la página anterior, el servidor antiguo seguirá disponible en [old.nadeshiko.co](https://old.nadeshiko.co) hasta finales de abril de 2026. Después de eso, **será apagado permanentemente.**

> **IMPORTANTE:** Para plugins externos que todavía usan la API antigua, aún es necesario crear y gestionar las claves API a través de la web y cuenta antigua. Estamos trabajando con los dueños de plugins externos para ayudarles a migrar a Nadeshiko V2.0 lo antes posible.

## Agradecimientos

Queremos dar las gracias a todos los que a día de hoy siguen usando Nadeshiko. Ver lo mucho que se se le aprecia tanto en la comunidad es lo que realmente nos motiva a seguir mejorándolo.

Y no nos olvidamos de esto. Nadeshiko **siempre será gratuito y de acceso libre, sin excepción**. Esto significa que estamos cubriendo los costes del servidor y mantenimiento de nuestro propio bolsillo. Esta es una herramienta que queremos ver viva durante mucho tiempo, y estamos implicados en mantenerlo para que así sea.

Si tú también sientes lo mismo y quieres ayudar a que Nadeshiko siga funcionando, puedes apoyar el proyecto en [Patreon](https://www.patreon.com/c/BrigadaSOS).

En las próximas semanas, escribiremos más posts explicando las nuevas funciones con más detalle. Si quieres contactarnos para dejar un comentario, sugerencia, reporte de bug, o cualquier otra cosa, puedes hacerlo a través de:
- **Email**: contact@nadeshiko.co
- **Discord**: [Nadeshiko](https://discord.gg/c6yGwbXruq)

Nunca dejéis de estudiar!
