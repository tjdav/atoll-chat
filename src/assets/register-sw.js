if ('serviceWorker' in navigator) {
  const isCapacitorNative = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()

  if (isCapacitorNative) {
    console.log('[Native App] Disabling PWA Service Worker caching on native platform.')
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (const registration of registrations) {
        registration.unregister()
      }
    }).catch(() => {
    })
  } else {
    const isControlled = !!navigator.serviceWorker.controller

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (isControlled) {
        window.location.reload()
      }
    })

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('Service Worker registered', reg))
        .catch(err => console.error('Service Worker registration failed', err))
    })
  }
}
