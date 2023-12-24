<script setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import BaseIcon from '../minimal/BaseIcon.vue'
import {
    mdiFolder,
    mdiFileOutline
} from '@mdi/js'
let directoryTree = ref([])
let currentDirectory = ref('media')
onMounted(async () => {
    await getDirectoryTree('media');
})


const getDirectoryTree = async (directory) => {

    let response = null

    try {
        const params = new URLSearchParams({ directory }).toString();
        response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + `files?${params}`, {
            method: 'GET',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        response = await response.json()

    } catch (error) {
        console.log(error)
        return
    }

    if (currentDirectory.value !== 'media') {
        response.unshift({
            name: '...',
            type: 'directory',
        });
    }
    directoryTree.value = response

}
watch(currentDirectory, (newDir) => {
    getDirectoryTree(newDir);
});
const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const formatSize = (size) => {
    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return (size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
}

const navigate = (item) => {
    if (item.name === '...') {
        const pathSegments = currentDirectory.value.split('/');
        pathSegments.pop();
        currentDirectory.value = pathSegments.join('/') || 'media/anime';
    } else if (item.type === 'directory') {
        currentDirectory.value += '/' + item.name;
    }
}
</script>
<template>
    <table class="min-w-full divide-y bg-gray-100 dark:bg-sgray2 divide-gray-200 dark:divide-white/30">
        <thead>
            <tr class="divide-x bg-gray-200 dark:bg-sgray divide-gray-200 dark:divide-white/30">
                <th class="py-3 px-6 text-left text-xs font-medium text-gray-700 dark:text-white uppercase">Nombre</th>
                <th class="py-3 px-6 text-left text-xs font-medium text-gray-700 dark:text-white uppercase">Fecha de
                    creación</th>
                <th class="py-3 px-6 text-left text-xs font-medium text-gray-700 dark:text-white uppercase">Tamaño</th>

            </tr>
        </thead>
        <tbody class="bg-white dark:bg-sgray2 divide-y divide-gray-200 dark:divide-white/20">
            <tr class="divide-x divide-gray-200 cursor-pointer dark:divide-white/20 hover:bg-sgray dark:hover:bg-sgray3"
                v-for="(item, index) in directoryTree" @click="navigate(item)">
                <td class="py-4 px-6">
                    <i v-if="item.type === 'file'">
                        <BaseIcon display="inline-block" :path="mdiFileOutline" fill="#DDDF" />
                        {{ item.name }}
                    </i>
                    <i v-else-if="item.type === 'directory'">
                        <BaseIcon display="inline-block" :path="mdiFolder" fill="#DDDF" />
                        {{ item.name }}
                    </i>
                </td>
                <td v-if="item.name !== '...'" class="py-4 px-6">{{ formatDate(item.createdDate) }}</td>
                <td v-else class="py-4 px-6"></td> <!-- Oculta la celda si name es "..." -->

                <td v-if="item.name !== '...'" class="py-4 px-6">{{ formatSize(item.size) }}</td>
                <td v-else class="py-4 px-6"></td> <!-- Oculta la celda si name es "..." -->
            </tr>
        </tbody>
    </table>
</template>
    