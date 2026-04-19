<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  banned: boolean;
  providers: string[];
};

const { t, locale } = useI18n();
const store = userStore();

const users = ref<AdminUser[]>([]);
const total = ref(0);
const isLoading = ref(false);
const searchQuery = ref('');
const currentOffset = ref(0);
const limit = 20;

const openMenuId = ref<string | null>(null);

function formatDate(dateStr: string) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString(locale.value);
}

function formatRelative(dateStr: string) {
  if (!dateStr) return '—';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' });
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return formatter.format(0, 'minute');
  if (diffMins < 60) return formatter.format(-diffMins, 'minute');
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return formatter.format(-diffHours, 'hour');
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return formatter.format(-diffDays, 'day');
  return formatDate(dateStr);
}

const formatNumber = (value: number) => new Intl.NumberFormat(locale.value).format(value);

const providerLabel = (provider: string) => {
  switch (provider) {
    case 'google':
      return t('accountSettings.dashboard.providers.google');
    case 'discord':
      return t('accountSettings.dashboard.providers.discord');
    case 'magic-link':
    case 'credential':
      return t('accountSettings.dashboard.providers.email');
    default:
      return provider;
  }
};

const statusLabel = (banned: boolean) =>
  banned
    ? t('accountSettings.dashboard.status.banned')
    : t('accountSettings.dashboard.status.active');

async function fetchUsers() {
  isLoading.value = true;
  try {
    const query: Record<string, string | number> = {
      limit,
      offset: currentOffset.value,
    };
    if (searchQuery.value.trim()) {
      query.search = searchQuery.value.trim();
    }
    const result = await $fetch<{ users: AdminUser[]; total: number }>('/v1/admin/users-with-providers', {
      credentials: 'include',
      query,
    });
    users.value = result.users ?? [];
    total.value = result.total ?? 0;
  } finally {
    isLoading.value = false;
  }
}

const debouncedSearch = useDebounceFn(() => {
  currentOffset.value = 0;
  fetchUsers();
}, 300);

watch(searchQuery, debouncedSearch);

function goToPrev() {
  if (currentOffset.value <= 0) return;
  currentOffset.value = Math.max(0, currentOffset.value - limit);
  fetchUsers();
}

function goToNext() {
  if (currentOffset.value + limit >= total.value) return;
  currentOffset.value += limit;
  fetchUsers();
}

function toggleMenu(userId: string) {
  openMenuId.value = openMenuId.value === userId ? null : userId;
}

function closeMenu() {
  openMenuId.value = null;
}

async function handleImpersonate(user: AdminUser) {
  closeMenu();
  await store.impersonateUser(Number(user.id));
}

async function handleBan(user: AdminUser) {
  closeMenu();
  await $fetch('/v1/auth/admin/ban-user', {
    method: 'POST',
    credentials: 'include',
    body: { userId: user.id, banReason: '' },
  });
  await fetchUsers();
}

async function handleUnban(user: AdminUser) {
  closeMenu();
  await $fetch('/v1/auth/admin/unban-user', {
    method: 'POST',
    credentials: 'include',
    body: { userId: user.id },
  });
  await fetchUsers();
}

function onDocumentClick() {
  closeMenu();
}

onMounted(() => {
  fetchUsers();
  document.addEventListener('click', onDocumentClick);
});

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-white mb-6">{{ t('accountSettings.dashboard.title') }}</h1>

    <div class="flex items-center justify-between mb-4 gap-3">
      <input
        v-model="searchQuery"
        type="text"
        :placeholder="t('accountSettings.dashboard.searchPlaceholder')"
        class="w-full max-w-sm px-3 py-2 text-sm rounded-lg bg-neutral-800 border border-neutral-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-input-focus-ring"
      />
      <span class="text-sm text-gray-400 whitespace-nowrap">{{ t('accountSettings.dashboard.count', { count: formatNumber(total) }) }}</span>
    </div>

    <div v-if="isLoading" class="text-center py-12">
      <div class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full" role="status" />
    </div>

    <template v-else>
      <div v-if="users.length === 0" class="text-center py-12 text-gray-500 text-sm">
        {{ t('accountSettings.dashboard.empty') }}
      </div>

      <div v-else class="rounded-lg border border-neutral-700 bg-neutral-800/50 overflow-x-auto">
        <table class="w-full text-sm min-w-[800px]">
          <thead>
            <tr class="border-b border-neutral-700 text-left text-gray-400">
              <th class="px-4 py-3 font-medium">{{ t('accountSettings.dashboard.table.name') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('accountSettings.dashboard.table.email') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('accountSettings.dashboard.table.role') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('accountSettings.dashboard.table.providers') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('accountSettings.dashboard.table.registered') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('accountSettings.dashboard.table.lastUpdate') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('accountSettings.dashboard.table.status') }}</th>
              <th class="px-4 py-3 font-medium w-10" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="user in users"
              :key="user.id"
              class="border-b border-neutral-700/50 last:border-0"
            >
              <td class="px-4 py-3 text-gray-200">{{ user.name || '—' }}</td>
              <td class="px-4 py-3 text-gray-300">{{ user.email }}</td>
              <td class="px-4 py-3 text-gray-400 capitalize">{{ user.role }}</td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-1">
                  <template v-if="!user.providers || user.providers.length === 0">
                    <span class="px-1.5 py-0.5 text-xs font-medium rounded bg-neutral-500/20 text-gray-400 border border-neutral-600">{{ t('accountSettings.dashboard.providers.email') }}</span>
                  </template>
                  <template v-for="provider in user.providers" :key="provider">
                    <span
                      v-if="provider === 'google'"
                      class="px-1.5 py-0.5 text-xs font-medium rounded bg-blue-500/20 text-blue-400 border border-blue-600"
                    >{{ providerLabel(provider) }}</span>
                    <span
                      v-else-if="provider === 'discord'"
                      class="px-1.5 py-0.5 text-xs font-medium rounded bg-indigo-500/20 text-indigo-400 border border-indigo-600"
                    >{{ providerLabel(provider) }}</span>
                    <span
                      v-else-if="provider === 'magic-link' || provider === 'credential'"
                      class="px-1.5 py-0.5 text-xs font-medium rounded bg-neutral-500/20 text-gray-400 border border-neutral-600"
                    >{{ providerLabel(provider) }}</span>
                    <span
                      v-else
                      class="px-1.5 py-0.5 text-xs font-medium rounded bg-neutral-500/20 text-gray-400 border border-neutral-600"
                    >{{ provider }}</span>
                  </template>
                </div>
              </td>
              <td class="px-4 py-3 text-gray-400">{{ formatDate(user.createdAt) }}</td>
              <td class="px-4 py-3 text-gray-400">{{ formatRelative(user.updatedAt) }}</td>
              <td class="px-4 py-3">
                <span
                  v-if="user.banned"
                  class="px-2 py-1 text-xs font-medium rounded border bg-red-500/20 text-red-400 border-red-600"
                >
                  {{ statusLabel(true) }}
                </span>
                <span
                  v-else
                  class="px-2 py-1 text-xs font-medium rounded border bg-green-500/20 text-green-400 border-green-600"
                >
                  {{ statusLabel(false) }}
                </span>
              </td>
              <td class="px-4 py-3 relative">
                <button
                  class="p-1 rounded text-gray-400 hover:text-white hover:bg-neutral-700 transition-colors"
                  @click.stop="toggleMenu(user.id)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="12" cy="19" r="1.5" />
                  </svg>
                </button>

                <div
                  v-if="openMenuId === user.id"
                  class="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-lg border border-neutral-700 bg-neutral-800 shadow-lg py-1"
                  @click.stop
                >
                  <button
                    class="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-neutral-700 transition-colors"
                    @click="handleImpersonate(user)"
                  >
                    {{ t('accountSettings.dashboard.actions.impersonate') }}
                  </button>
                  <button
                    v-if="!user.banned"
                    class="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-neutral-700 transition-colors"
                    @click="handleBan(user)"
                  >
                    {{ t('accountSettings.dashboard.actions.ban') }}
                  </button>
                  <button
                    v-else
                    class="w-full text-left px-4 py-2 text-sm text-green-400 hover:bg-neutral-700 transition-colors"
                    @click="handleUnban(user)"
                  >
                    {{ t('accountSettings.dashboard.actions.unban') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="flex items-center justify-between mt-4 text-sm text-gray-400">
        <span>{{ t('accountSettings.dashboard.pagination.showing', {
          start: formatNumber(currentOffset + 1),
          end: formatNumber(Math.min(currentOffset + limit, total)),
          total: formatNumber(total),
        }) }}</span>
        <div class="flex gap-2">
          <button
            :disabled="currentOffset <= 0"
            class="px-3 py-1.5 rounded-lg bg-neutral-700 text-white hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            @click="goToPrev"
          >
            {{ t('accountSettings.dashboard.pagination.previous') }}
          </button>
          <button
            :disabled="currentOffset + limit >= total"
            class="px-3 py-1.5 rounded-lg bg-neutral-700 text-white hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            @click="goToNext"
          >
            {{ t('accountSettings.dashboard.pagination.next') }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
