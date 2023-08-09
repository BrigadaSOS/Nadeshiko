<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n();
</script>
<template>
    <p class="text-white text-2xl text-center m-10">{{t("searchpage.main.labels.noresults")}}</p>
</template>