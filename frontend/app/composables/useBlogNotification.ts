export function useBlogNotification() {
  const store = userStore();
  const hasNewPost = ref(false);

  const markAsRead = async () => {
    if (import.meta.server || !store.isLoggedIn) return;

    const now = new Date().toISOString();
    const sdk = useNadeshikoSdk();
    await sdk.updateUserPreferences({ body: { blogLastVisited: now } });
    store.preferences.blogLastVisited = now;
    hasNewPost.value = false;
  };

  const check = async () => {
    if (import.meta.server || !store.isLoggedIn) return;

    try {
      const allContent = await queryCollection('content').all();
      const blogPosts = allContent.filter((post: any) => post.path?.startsWith('/en/blog/'));

      if (blogPosts.length === 0) return;

      let latestDate = 0;
      for (const post of blogPosts) {
        const d = (post as any).date;
        if (d) {
          const ts = new Date(d).getTime();
          if (ts > latestDate) latestDate = ts;
        }
      }

      if (latestDate === 0) return;

      const lastVisited = store.preferences?.blogLastVisited;
      if (!lastVisited) {
        hasNewPost.value = true;
        return;
      }

      hasNewPost.value = latestDate > new Date(lastVisited).getTime();
    } catch {
      // Silently ignore - notification is non-critical
    }
  };

  onMounted(() => {
    check();
  });

  return { hasNewPost, markAsRead };
}
