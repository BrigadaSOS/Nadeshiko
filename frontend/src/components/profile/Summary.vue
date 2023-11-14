<script setup>
import Tabs from '../minimal/Tabs.vue';
import Tab from '../minimal/Tab.vue';
import { ankiStore } from '../../stores/anki'

const store = ankiStore()
store.loadAnkiData()

</script>
<template>
    <div class="container sm:max-w-screen-lg md:max-w-full mx-auto w-100 flex flex-col">
        <Tabs class="mt-2">
            <Tab active="true" title="Anki">
                <div class="border rounded-lg shadow overflow-hidden dark:border-sgray2 dark:shadow-gray-900">
                    
                  <table class="min-w-full divide-y bg-sgray2 divide-gray-200 dark:divide-white/30">
                    <thead>
                      <tr class="divide-x divide-gray-200 dark:divide-white/30">
                        <th scope="col" class="py-3 text-center text-xs font-medium text-white/60 uppercase">
                          Campo
                        </th>
                        <th scope="col" class="py-3 text-center text-xs font-medium text-white/60 uppercase">
                          Contenido
                        </th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200 dark:divide-white/30">
                      <tr v-for="(item, index) in sortedWordsMatch">
                        <td
                          class="y-4 whitespace-nowrap text-base text-center font-medium text-gray-800 dark:text-gray-200"
                        >
                            {{ item.field }}
                        </td>

                        <td
                          class="py-4 whitespace-nowrap text-center text-base font-medium text-gray-800 dark:text-gray-200"
                        >
                          {{ item.content }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
            </Tab>
        </Tabs>
    </div>
</template>