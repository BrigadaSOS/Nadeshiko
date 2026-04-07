<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Nadeshiko frontend. The `@posthog/nuxt` module was installed and configured with automatic client-side error tracking (`capture_exceptions: true`) and server-side exception autocapture. The PostHog origin was added to the Content Security Policy. Users are identified by username on login via OAuth or magic link callbacks, with `posthog.reset()` called on logout and account deletion to clear identity. Eleven events covering authentication, search, Anki export, and collection management are now tracked.

| Event | Description | File |
|---|---|---|
| `user_logged_in` | User successfully authenticated via OAuth callback or magic link | `app/plugins/auth-callback.client.ts` |
| `login_initiated` | User clicked a login button (Google, Discord, or magic link submit) | `app/components/auth/ModalLoginSignUp.vue` |
| `magic_link_requested` | User submitted their email to request a magic link | `app/components/auth/ModalLoginSignUp.vue` |
| `user_logged_out` | User signed out of their account | `app/stores/auth.ts` |
| `account_deleted` | User permanently deleted their account | `app/stores/auth.ts` |
| `sentence_searched` | User performed a search query (initial, non-paginated) | `app/components/search/SearchContainer.vue` |
| `anki_export_completed` | User successfully exported a sentence card to Anki | `app/stores/anki.ts` |
| `segment_added_to_collection` | User added a sentence segment to a collection | `app/components/search/segment/SegmentActionsContainer.vue` |
| `collection_created` | User created a new sentence collection | `app/components/settings/modules/CollectionsModule.vue` |
| `collection_deleted` | User deleted a sentence collection | `app/components/settings/modules/CollectionsModule.vue` |
| `collection_visibility_changed` | User changed a collection's visibility between public and private | `app/components/settings/modules/CollectionsModule.vue` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard - Analytics basics**: https://us.posthog.com/project/372788/dashboard/1440212
- **Daily active users (logins)**: https://us.posthog.com/project/372788/insights/aK7t23Id
- **Login funnel (initiated → completed)**: https://us.posthog.com/project/372788/insights/JgUyrMJF
- **Daily active searchers**: https://us.posthog.com/project/372788/insights/xmSgsotq
- **Anki exports per day**: https://us.posthog.com/project/372788/insights/5qStp4OL
- **Collection & save activity**: https://us.posthog.com/project/372788/insights/kBEvxbvi
- **Churn signals (logouts & deletions)**: https://us.posthog.com/project/372788/insights/9aThB1KW

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
