import memoryDriver from 'unstorage/drivers/memory';

export default defineNitroPlugin(async () => {
  // The isolated publisher gets fresh generation storage, independent of old
  // worker caches and their nested stale-while-revalidate values.
  if (process.env.NADESHIKO_SITEMAP_GENERATOR === '1') {
    await useStorage().unmount('sitemap');
    useStorage().mount('sitemap', memoryDriver());
  }
});
