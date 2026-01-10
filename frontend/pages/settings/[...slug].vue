<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { mdiAccount, mdiSync, mdiCodeTags } from '@mdi/js'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()

const store = userStore()
const isAuth = computed(() => store.isLoggedIn)

const tabs_general = [
    { name: t('accountSettings.tabs.account'), icon: mdiAccount, route: '/settings/account' },
    { name: t('accountSettings.tabs.sync'), icon: mdiSync, route: '/settings/sync' },
]
const tabs_advanced = [
    { name: t('accountSettings.tabs.developer'), icon: mdiCodeTags, route: '/settings/developer' },
]

const activeTab = ref('')

watch(() => route.path, (newPath) => {
    if (newPath === '/settings' || newPath.startsWith('/settings/account')) {
        activeTab.value = '#horizontal-scroll-tab-cuenta'
    } else if (newPath.startsWith('/settings/sync')) {
        activeTab.value = '#horizontal-scroll-tab-sincronización-anki'
    } else if (newPath.startsWith('/settings/developer')) {
        activeTab.value = '#horizontal-scroll-tab-desarrollador'
    }
}, { immediate: true })

const navigateToTab = (path) => {
    router.push(path)
}

// Redirigir a /settings/account si estamos en /settings
if (route.path === '/settings' && isAuth.value) {
    router.push('/settings/account')
}else if(route.path === '/settings' && !isAuth.value){
    router.push('/settings/sync')
}

/* Block access page for not authenticated users 
definePageMeta({
    middleware: 'auth'
})*/

</script>

<template>
    <NuxtLayout> 
    <div class="w-11/12 mx-auto my-2 text-white min-h-screen">
        <div class="flex flex-col md:flex-row">
            <!-- Vertical Tabs -->
            <div class="hidden mx-auto md:block md:sticky top-0 md:h-screen md:overflow-y-auto md:w-1/4 xl:w-3/12">
                <nav aria-label="Tabs" class="flex flex-col dark:bg-card-background rounded-lg p-6 my-2 space-y-2">
                    <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.generalTitle") }}</h3>
                    <div class="border-b border-white/10" />
                    <button v-for="tab in tabs_general" :key="tab.name"
                        :class="{ 
                            'active': activeTab === `#horizontal-scroll-tab-${tab.name.toLowerCase().replaceAll(' ', '-')}`,
                            'opacity-50 cursor-not-allowed': !isAuth && tab.name === $t('accountSettings.tabs.account') 
                        }"
                        :disabled="!isAuth && tab.name === $t('accountSettings.tabs.account')"
                        @click="isAuth ? navigateToTab(tab.route) : null"
                        class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left">
                        <UiBaseIcon :path="tab.icon" size="20" />
                        {{ tab.name }}
                    </button>

                    <h3 class="text-lg pt-2 text-white/90 tracking-wide font-semibold">{{ $t("accountSettings.menu.advancedTitle") }}</h3>
                    <div class="border-b border-white/10" />
                    <button v-for="tab in tabs_advanced" :key="tab.name"
                        :class="{ 
                            'active': activeTab === `#horizontal-scroll-tab-${tab.name.toLowerCase().replaceAll(' ', '-')}`,
                            'opacity-50 cursor-not-allowed': !isAuth
                        }"
                        :disabled="!isAuth"
                        @click="isAuth ? navigateToTab(tab.route) : null"
                        class="rounded-lg tab-title-settings flex items-center align-middle gap-2 px-2 py-2 text-left">
                        <UiBaseIcon :path="tab.icon" size="20" />
                        {{ tab.name }}
                    </button>
                </nav>
            </div>

            <!-- Horizontal Tabs for smaller screens -->
            <div class="block md:hidden p-4">
                <nav aria-label="Tabs" class="flex overflow-x-auto">
                    <button v-for="tab in [t('accountSettings.tabs.account'), t('accountSettings.tabs.sync'), t('accountSettings.tabs.developer')]" :key="tab"
                        :class="{ 'active': activeTab === `#horizontal-scroll-tab-${tab.toLowerCase().replace(' ', '-')}` }"
                        @click="activeTab = `#horizontal-scroll-tab-${tab.toLowerCase().replace(' ', '-')}`"
                        class="rounded-lg px-4 py-2 text-left text-nowrap">
                        {{ tab }}
                    </button>
                </nav>
            </div>

            <!-- Tab Content -->
            
            <div class="flex-grow md:pl-6 overflow-y-auto my-2 md:mx-auto">
                <SettingsModuleAccount v-if="activeTab === '#horizontal-scroll-tab-cuenta'" />
                <SettingsModuleAnki v-if="activeTab === '#horizontal-scroll-tab-sincronización-anki'" />
                <SettingsModuleDeveloper v-if="activeTab === '#horizontal-scroll-tab-desarrollador'" />
            </div>
        </div>
    </div>
    </NuxtLayout>
</template>

<style>
.tab-title-settings:hover {
    background: rgba(255, 255, 255, 0.1);
}

.tab-title-settings.active {
    background: rgba(255, 255, 255, 0.1);
    font-weight: bold;
    font-weight: 600;
}

.tab-title-settings.active:after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
    width: 2px;
}
</style>
