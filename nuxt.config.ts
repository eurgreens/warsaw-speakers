// Everything runs in the browser: no SSR, no server routes.
// `npm run build` (nuxt generate) outputs a static SPA in .output/public.
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  ssr: false,
  devtools: { enabled: false },
  css: [
    '@fontsource/inter/500.css',
    '@fontsource/inter/600.css',
    '@fontsource/space-mono/400.css',
    '~/assets/css/main.css',
  ],
  app: {
    head: {
      title: 'Warsaw Congress · Speaker card generator',
      htmlAttrs: { lang: 'en' },
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        // Adobe Fonts kit with Hagrid (families "hagrid" and "hagrid-text").
        { rel: 'preconnect', href: 'https://use.typekit.net', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://use.typekit.net/bsv0ktr.css' },
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Create a Warsaw Congress speaker image for social media.' },
        { name: 'theme-color', content: '#009565' },
      ],
    },
  },
})
