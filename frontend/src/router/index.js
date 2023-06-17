import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import SearchView from '../views/SearchView.vue'
import NotFoundView from '../views/NotFoundView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    {
      path: '/database/sentences',
      name: 'search',
      component: SearchView
    },  
    {
      path: "/:catchAll(.*)",
      name: "not-found",
      component: NotFoundView,
    },
    
  ]
})

export default router
