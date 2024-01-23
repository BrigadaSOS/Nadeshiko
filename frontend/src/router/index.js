import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import SearchView from '../views/SearchView.vue'
import NotFoundView from '../views/NotFoundView.vue'
import AllAnimeView from '../views/AllAnimeView.vue'
import AccountSummaryView from '../views/AccountSummaryView.vue'
import AboutView from '../views/AboutView.vue'
import { userStore } from '../stores/user'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior() {
    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: {
        title: 'NadeDB',
        metaTags: [
          {
            name: 'description',
            content: 'A powerful tool for searching japanese sentences or words from multiple contexts'
          },
          {
            property: 'og:description',
            content: 'A powerful tool for searching japanese sentences or words from multiple contexts'
          }
        ]
      }
    },
    {
      path: '/search/sentences',
      name: 'search-sentences',
      component: SearchView
    },
    {
      path: '/anime/all',
      name: 'anime-all',
      component: AllAnimeView
    },
    {
      path: '/about',
      name: 'about',
      component: AboutView
    },
    {
      path: '/:catchAll(.*)',
      name: 'not-found',
      component: NotFoundView
    },
    {
      path: '/account',
      name: 'account',
      component: AccountSummaryView,
      meta: { requireAuth: true }
    }
  ]
})

router.beforeEach(async (to, from, next) => {
  const store = userStore()
  if (to.matched.some((record) => record.meta.requireAuth)) {
    if (store.isLoggedIn) {
      next()
    } else {
      next({
        path: '/'
      })
    }
  } else {
    next()
  }

  // This goes through the matched routes from last to first, finding the closest route with a title.
  // e.g., if we have `/some/deep/nested/route` and `/some`, `/deep`, and `/nested` have titles,
  // `/nested`'s will be chosen.
  const nearestWithTitle = to.matched
    .slice()
    .reverse()
    .find((r) => r.meta && r.meta.title)

  // Find the nearest route element with meta tags.
  const nearestWithMeta = to.matched
    .slice()
    .reverse()
    .find((r) => r.meta && r.meta.metaTags)

  const previousNearestWithMeta = from.matched
    .slice()
    .reverse()
    .find((r) => r.meta && r.meta.metaTags)

  // If a route with a title was found, set the document (page) title to that value.
  if (nearestWithTitle) {
    document.title = nearestWithTitle.meta.title
  } else if (previousNearestWithMeta) {
    document.title = previousNearestWithMeta.meta.title
  }

  // Remove any stale meta tags from the document using the key attribute we set below.
  Array.from(document.querySelectorAll('[data-vue-router-controlled]')).map((el) => el.parentNode.removeChild(el))

  // Skip rendering meta tags if there are none.
  if (!nearestWithMeta) return next()

  // Turn the meta tag definitions into actual elements in the head.
  nearestWithMeta.meta.metaTags
    .map((tagDef) => {
      const tag = document.createElement('meta')

      Object.keys(tagDef).forEach((key) => {
        tag.setAttribute(key, tagDef[key])
      })

      // We use this to track which meta tags we create so we don't interfere with other ones.
      tag.setAttribute('data-vue-router-controlled', '')

      return tag
    })
    // Add the meta tags to the document head.
    .forEach((tag) => document.head.appendChild(tag))

  next()
})

// ...

export default router
