// Client-side error handler plugin
// Logs Vue errors to console with structured formatting for pino-pretty

export default defineNuxtPlugin((nuxtApp) => {
  // Handle Vue app errors
  nuxtApp.vueApp.config.errorHandler = (err, instance, info) => {
    const errorLog = {
      type: 'vue:error',
      message: err?.message || 'Unknown error',
      stack: err?.stack,
      info,
      componentName: instance?.$options?.name || instance?.$type?.name || 'Unknown',
      timestamp: new Date().toISOString(),
    }

    console.error('[Vue Error]', JSON.stringify(errorLog, null, 2))
  }

  // Handle unhandled promise rejections
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
      const errorLog = {
        type: 'unhandledRejection',
        reason: event.reason?.message || String(event.reason),
        stack: event.reason?.stack,
        timestamp: new Date().toISOString(),
      }
      console.error('[Unhandled Rejection]', JSON.stringify(errorLog, null, 2))
    })

    // Handle global errors
    window.addEventListener('error', (event) => {
      const errorLog = {
        type: 'global:error',
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
        timestamp: new Date().toISOString(),
      }
      console.error('[Global Error]', JSON.stringify(errorLog, null, 2))
    })
  }
})
