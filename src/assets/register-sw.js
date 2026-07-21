if ('serviceWorker' in navigator) {
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
