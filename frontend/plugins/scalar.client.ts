// plugins/scalar.client.ts
import '@scalar/api-reference/style.css'

export default defineNuxtPlugin(async () => {
  const mod = await import('@scalar/api-reference')

  const ScalarApiReference =
    mod.ScalarApiReference ||
    mod.ApiReference ||
    mod.default

  return {
    provide: {
      ScalarApiReference
    }
  }
})
