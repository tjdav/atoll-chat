const isNative = typeof window !== 'undefined' && (
  (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
  window.location.protocol === 'file:' ||
  /Capacitor/i.test(navigator.userAgent) ||
  window.location.origin === 'capacitor://localhost' ||
  window.location.origin === 'ionic://localhost'
)

if (!isNative && 'serviceWorker' in navigator) {
  const isControlled = !!navigator.serviceWorker.controller

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isControlled) {
      window.location.reload()
    }
  })

  navigator.serviceWorker.register('/sw.js')
    .then(reg => console.log('Service Worker registered', reg))
    .catch(err => console.error('Service Worker registration failed', err))
} else if (isNative) {
  console.log('Service Worker registration bypassed on native mobile platforms')
}
