---
title: "Términos y Condiciones"
description: "Lee los términos y condiciones del servicio de Nadeshiko."
---

# Términos y Condiciones

**Última actualización: 14 de agosto de 2026**

Por favor, lea estos términos y condiciones detenidamente antes de usar la aplicación Nadeshiko.

## Uso Exclusivamente Educativo y Personal
El contenido proporcionado por Nadeshiko es solo para uso educativo y personal. Usted acepta utilizar el contenido exclusivamente para sus propios fines educativos y no para ningún uso comercial. El contenido disponible en el servicio se proporciona "tal cual" y "según disponibilidad", y Nadeshiko no posee ni reclama la propiedad de ningún contenido a menos que se indique explícitamente lo contrario.

## Derechos de Autor y Cumplimiento de DMCA

Nadeshiko respeta los derechos de propiedad intelectual de otros y espera que los usuarios del servicio hagan lo mismo. Cumplimos con la Digital Millennium Copyright Act (DMCA) y responderemos a los avisos de presunta infracción de derechos de autor que cumplan con la DMCA y otras leyes aplicables.

Para obtener información detallada sobre nuestra política DMCA, incluido cómo enviar un aviso de eliminación o una contra-notificación, consulte nuestra página de [Política DMCA](/dmca).

## Acceso a la API
Si se le proporciona acceso a la API, usted acepta utilizarla de acuerdo con estos términos y cualquier término adicional proporcionado junto con su clave de API. El uso de la API está sujeto a las siguientes condiciones:

- **Clave de API**: Debe usar una clave de API válida asignada por Nadeshiko. Es responsable de mantener la seguridad de su clave de API y de cualquier uso de la misma, ya sea autorizado o no.
- **Límites de Uso**: Usted acepta cumplir con cualquier límite de uso o restricciones de acceso impuestas por Nadeshiko. El incumplimiento de estos límites puede resultar en la suspensión o terminación de su acceso a la API.
- **Actividades Prohibidas**: No debe usar la API para participar en actividades que violen estos términos o cualquier ley o regulación aplicable. Las actividades prohibidas incluyen, entre otras, scraping de datos, acceso no autorizado a datos y cualquier forma de abuso o mal uso de la API.
- **Uso de Datos**: Cualquier dato al que acceda a través de la API es solo para su uso personal o educativo. No debe compartir, vender o distribuir los datos a terceros sin el permiso explícito de Nadeshiko.
- **Modificaciones**: Nadeshiko se reserva el derecho de modificar, suspender o descontinuar la API en cualquier momento, con o sin previo aviso. Nadeshiko no será responsable ante usted ni ante terceros por cualquier modificación, suspensión o interrupción de la API.

## Integraciones de Terceros

Una aplicación de terceros puede leer contenido de Nadeshiko en nombre de un lector, siempre que cada lector aporte su propia clave de API y la aplicación cumpla todas las condiciones siguientes. Cumplirlas **constituye** el permiso explícito que exige la condición de Uso de Datos anterior; una integración que las cumpla no necesita solicitarlo por separado.

- **La clave propia del lector**: la aplicación debe usar una clave que el propio lector haya creado y pueda revocar en cualquier momento. No debe incluir una clave compartida, agrupar a varios lectores en una misma clave, ni enviar las claves de los lectores a sus propios servidores.
- **Alcance de solo lectura**: pida a los lectores una clave limitada al permiso `READ_MEDIA`. Una integración no debe requerir permisos de escritura sobre el perfil, la actividad o las colecciones del lector para funcionar.
- **Peticiones directas**: las peticiones deben ir desde el cliente del propio lector hasta Nadeshiko. La aplicación no debe actuar como proxy, conservar las respuestas más allá de la sesión del lector, replicar o indexar el corpus, redistribuirlo, ni usarlo para entrenar modelos.
- **Cuotas**: se aplican la cuota y los límites de uso del propio lector. Gestione las respuestas `429` y no eluda los límites.
- **Clasificación de contenido**: cada segmento incluye un `contentRating`. Filtrar o presentar las clasificaciones de forma adecuada para su público es responsabilidad de la aplicación: una petición que no envíe filtro de clasificación recibe todas las clasificaciones, incluida `EXPLICIT`.
- **Atribución**: indique a Nadeshiko como fuente del contenido y enlace a estos términos y a nuestra [Política DMCA](/dmca).

Podemos retirar este permiso a cualquier aplicación en cualquier momento. Las secciones de Terminación y Descargo de Responsabilidad siguientes se aplican a las aplicaciones igual que a los lectores.

## Terminación
Podemos terminar o suspender su cuenta o dirección IP de forma inmediata, sin previo aviso o responsabilidad, por cualquier motivo, incluyendo, sin limitación, el incumplimiento de los términos.

## Descargo de Responsabilidad
El uso del servicio es bajo su propio riesgo. El servicio se proporciona "TAL CUAL" y "SEGÚN DISPONIBILIDAD", sin garantías de ningún tipo, ya sean expresas o implícitas, incluidas, pero no limitadas a, garantías implícitas de comerciabilidad, idoneidad para un propósito particular, no infracción o rendimiento.

Nadeshiko no garantiza que:
- El servicio funcionará de manera ininterrumpida, segura o esté disponible en cualquier momento o lugar en particular.
- Cualquier error o defecto será corregido.
- El servicio esté libre de virus u otros componentes dañinos.
- Los resultados de utilizar el servicio cumplirán con sus expectativas.

## Cambios
Nos reservamos el derecho de modificar o reemplazar estos términos a nuestra exclusiva discreción, en cualquier momento. Si una revisión es sustancial, intentaremos proporcionar al menos 30 días de aviso antes de que los nuevos términos entren en vigencia. Lo que constituye un cambio sustancial será determinado a nuestra exclusiva discreción.
