<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core';
import { mdiDotsVertical } from '@mdi/js';
import type { AdminUserWithProviders as AdminUser } from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';

const { t } = useI18n();
const { formatNumber, formatDate, formatRelativeTime } = useFormat();
const store = userStore();

const users = ref<AdminUser[]>([]);
const total = ref(0);
const isLoading = ref(false);
const searchQuery = ref('');
const currentOffset = ref(0);
const limit = 20;

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
  banned ? t('accountSettings.dashboard.status.banned') : t('accountSettings.dashboard.status.active');

/**
 * Which request the table is currently showing.
 *
 * Every fetch here is racing the reader: the search box debounces but does not
 * wait, and Next can be pressed again before the last page is back. Two replies
 * were assigned in the order they ARRIVED rather than the order they were asked
 * for, so whichever server round-trip happened to be quicker won -- a slow reply
 * for a search the box no longer shows would overwrite the one it does.
 */
let latestRequest = 0;

/**
 * `offset` is the page being ASKED for, and it is only committed once the rows
 * that go under it are in hand. It used to be written to `currentOffset` before
 * the request, with nothing to put it back: a failed page left the reader
 * reading "showing 21-40" over page one's rows, and pressing Next again skipped
 * a page that had never been shown.
 */
async function fetchUsers(offset = currentOffset.value) {
  const request = ++latestRequest;
  isLoading.value = true;
  try {
    const query: Record<string, string | number> = {
      limit,
      offset,
    };
    if (searchQuery.value.trim()) {
      query.search = searchQuery.value.trim();
    }
    const result = await useNadeshikoSdk().getAdminUsersWithProviders(query);
    if (request !== latestRequest) return;
    users.value = result.users ?? [];
    total.value = result.total ?? 0;
    currentOffset.value = offset;
  } catch (error) {
    if (request !== latestRequest) return;
    handleApiError('admin:users-fetch-failed', error, { toastKey: 'accountSettings.dashboard.loadError' });
  } finally {
    // Only the newest request owns the spinner; an overtaken one turning it off
    // would clear it while the request the reader is waiting for is still out.
    if (request === latestRequest) isLoading.value = false;
  }
}

// `useTimeoutFn` rather than `useDebounceFn`: the latter holds a bare
// `setTimeout` with no scope teardown, so a pending fetch would still run (and
// try to toast) after the admin left this tab.
const { start: scheduleSearch } = useTimeoutFn(
  () => {
    fetchUsers(0);
  },
  300,
  { immediate: false },
);

watch(searchQuery, () => scheduleSearch());

function goToPrev() {
  if (currentOffset.value <= 0) return;
  fetchUsers(Math.max(0, currentOffset.value - limit));
}

function goToNext() {
  if (currentOffset.value + limit >= total.value) return;
  fetchUsers(currentOffset.value + limit);
}

async function handleImpersonate(user: AdminUser) {
  await store.impersonateUser(user.id);
}

async function handleBan(user: AdminUser) {
  try {
    await useNadeshikoSdk().banUser({ userId: user.id, banReason: '' });
  } catch (error) {
    // Toasted here rather than via `toastKey`: the copy interpolates the user's name.
    handleApiError('admin:ban-user-failed', error, { toastKey: false, context: { 'user.id': String(user.id) } });
    useToastError(t('accountSettings.dashboard.banError', { name: user.name || user.email }));
    return;
  }

  useToastSuccess(t('accountSettings.dashboard.banSuccess', { name: user.name || user.email }));
  await fetchUsers();
}

async function handleUnban(user: AdminUser) {
  try {
    await useNadeshikoSdk().unbanUser({ userId: user.id });
  } catch (error) {
    // Toasted here rather than via `toastKey`: the copy interpolates the user's name.
    handleApiError('admin:unban-user-failed', error, { toastKey: false, context: { 'user.id': String(user.id) } });
    useToastError(t('accountSettings.dashboard.unbanError', { name: user.name || user.email }));
    return;
  }

  useToastSuccess(t('accountSettings.dashboard.unbanSuccess', { name: user.name || user.email }));
  await fetchUsers();
}

onMounted(() => {
  fetchUsers();
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
        class="nd-input max-w-sm"
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

      <div v-else class="rounded-lg border border-hairline bg-control overflow-x-auto">
        <table class="w-full text-sm min-w-[800px]">
          <thead>
            <tr class="border-b border-hairline text-left text-ink-muted">
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
              class="border-b border-hairline last:border-0"
            >
              <td class="px-4 py-3 text-gray-200">{{ user.name || '—' }}</td>
              <td class="px-4 py-3 text-gray-300">{{ user.email }}</td>
              <td class="px-4 py-3 text-gray-400 capitalize">{{ user.role }}</td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-1">
                  <template v-if="!user.providers || user.providers.length === 0">
                    <span class="px-1.5 py-0.5 text-xs font-medium rounded bg-lift-strong text-ink-muted border border-hairline">{{ t('accountSettings.dashboard.providers.email') }}</span>
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
                      class="px-1.5 py-0.5 text-xs font-medium rounded bg-lift-strong text-ink-muted border border-hairline"
                    >{{ providerLabel(provider) }}</span>
                    <span
                      v-else
                      class="px-1.5 py-0.5 text-xs font-medium rounded bg-lift-strong text-ink-muted border border-hairline"
                    >{{ provider }}</span>
                  </template>
                </div>
              </td>
              <td class="px-4 py-3 text-gray-400">{{ formatDate(user.createdAt) }}</td>
              <td class="px-4 py-3 text-gray-400">{{ formatRelativeTime(user.updatedAt) }}</td>
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
                <SearchDropdownContainer
                  dropdown-id="nd-user-actions"
                  teleport
                  teleport-align="end"
                  dropdown-container-class="z-[60] min-w-[10rem]"
                >
                  <SearchDropdownMainButton
                    :show-chevron="false"
                    test-id="user-menu-toggle"
                    dropdown-button-class="p-1 rounded text-gray-400 hover:text-white hover:bg-neutral-700 transition-colors"
                  >
                    <UiBaseIcon :path="mdiDotsVertical" w="w-4" h="h-4" size="16" />
                  </SearchDropdownMainButton>
                  <template #content>
                    <SearchDropdownItem
                      :text="t('accountSettings.dashboard.actions.impersonate')"
                      @click="handleImpersonate(user)"
                    />
                    <SearchDropdownItem
                      v-if="!user.banned"
                      danger
                      :text="t('accountSettings.dashboard.actions.ban')"
                      @click="handleBan(user)"
                    />
                    <SearchDropdownItem
                      v-else
                      :text="t('accountSettings.dashboard.actions.unban')"
                      @click="handleUnban(user)"
                    />
                  </template>
                </SearchDropdownContainer>
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
