// Client-side error handler plugin
// Logs Vue errors to console with structured formatting for pino-pretty

export default defineNuxtPlugin((nuxtApp) => {
  const getErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
      return value.message;
    }
    return 'Unknown error';
  };

  const getErrorStack = (value: unknown): string | undefined => {
    if (value instanceof Error) {
      return value.stack;
    }
    return undefined;
  };

  const getComponentName = (value: unknown): string => {
    if (value && typeof value === 'object') {
      const component = value as {
        $options?: { name?: string };
        $type?: { name?: string };
      };

      return component.$options?.name || component.$type?.name || 'Unknown';
    }

    return 'Unknown';
  };

  // Handle Vue app errors
  nuxtApp.vueApp.config.errorHandler = (err, instance, info) => {
    const errorLog = {
      type: 'vue:error',
      message: getErrorMessage(err),
      stack: getErrorStack(err),
      info,
      componentName: getComponentName(instance),
      timestamp: new Date().toISOString(),
    };

    console.error('[Vue Error]', JSON.stringify(errorLog, null, 2));
  };

  // Handle unhandled promise rejections
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
      const errorLog = {
        type: 'unhandledRejection',
        reason: event.reason?.message || String(event.reason),
        stack: event.reason?.stack,
        timestamp: new Date().toISOString(),
      };
      console.error('[Unhandled Rejection]', JSON.stringify(errorLog, null, 2));
    });

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
      };
      console.error('[Global Error]', JSON.stringify(errorLog, null, 2));
    });
  }
});
