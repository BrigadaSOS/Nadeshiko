function supportedLocalesInclude(locale) {
  return ['en', 'es'].includes(locale)
}

function getBrowserLocale(options = {}) {
  const defaultOptions = { countryCodeOnly: false }

  const opt = { ...defaultOptions, ...options }

  const navigatorLocale = navigator.languages !== undefined ? navigator.languages[0] : navigator.language

  if (!navigatorLocale) {
    return undefined
  }

  const trimmedLocale = opt.countryCodeOnly ? navigatorLocale.trim().split(/-|_/)[0] : navigatorLocale.trim()

  return trimmedLocale
}

export function getStartingLocale() {
  const browserLocale = getBrowserLocale({ countryCodeOnly: true })

  if (supportedLocalesInclude(browserLocale)) {
    return browserLocale
  } else {
    return 'en'
  }
}
