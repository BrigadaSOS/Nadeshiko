<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <p class="text-white text-2xl text-center m-10">{{t("searchpage.main.labels.errorMessage1")}}<br/>{{t("searchpage.main.labels.errorMessage2")}}</p>
</template>
