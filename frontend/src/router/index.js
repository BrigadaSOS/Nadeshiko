import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import SearchView from '../views/SearchView.vue'
import NotFoundView from '../views/NotFoundView.vue'
import AllAnimeView from '../views/AllAnimeView.vue'
import AccountSummaryView from '../views/AccountSummaryView.vue'
import AboutView from '../views/AboutView.vue'
import { userStore } from '../stores/user'
import ApiView from '../views/ApiView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(to) {
    if (to.path === '/search/sentences') {
      return false;
    }
    return { top: 0 };
  },
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    {
      path: '/search/sentences',
      name: 'search-sentences',
      component: SearchView
    },
    {
      path: '/content',
      name: 'content',
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
      path: '/settings',
      name: 'settings',
      component: AccountSummaryView,
      meta: { requireAuth: true }
    },
    {
      path: '/settings/account',
      name: 'settings-account',
      component: AccountSummaryView,
      meta: { requireAuth: true }
    },
    {
      path: '/settings/sync',
      name: 'settings-sync',
      component: AccountSummaryView,
      meta: { requireAuth: true }
    },
    {
      path: '/settings/developer',
      name: 'settings-developer',
      component: AccountSummaryView,
      meta: { requireAuth: true }
    },
    {
      path: '/api/docs',
      name: 'api-docs',
      component: ApiView
    },
  ]
})

// Global Route Guard
router.beforeEach(async (to, _from, next) => {
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
})

export default router
