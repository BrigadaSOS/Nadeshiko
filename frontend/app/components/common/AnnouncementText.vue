<script lang="ts">
import { defineComponent, h, resolveComponent, type VNodeChild } from 'vue';
import { parseAnnouncement, type AnnouncementNode } from '~/utils/announcementMarkdown';

/**
 * An announcement's message, with its markdown subset drawn as elements.
 *
 * A render function rather than a template because the node tree is recursive,
 * and -- the part that matters -- because `v-html` is the one tool that must not
 * appear on this path. See `~/utils/announcementMarkdown` for what is supported
 * and why the blog's `marked` pipeline is not reused here.
 */
export default defineComponent({
  name: 'AnnouncementText',
  props: {
    message: { type: String, default: '' },
  },
  setup(props) {
    const localePath = useLocalePath();
    const NuxtLink = resolveComponent('NuxtLink');

    const linkClass = 'underline underline-offset-2 font-medium hover:no-underline';

    /**
     * `strategy: 'prefix'` puts a locale on every route, so a path written as
     * `/media` has to pick one up or land on nothing. One an admin already
     * prefixed is left alone rather than prefixed twice.
     */
    const routeFor = (path: string) => (splitLocalePrefix(path).localePrefix ? path : localePath(path));

    const toVNodes = (nodes: AnnouncementNode[]): VNodeChild[] =>
      nodes.map((node) => {
        switch (node.type) {
          case 'text':
            return node.value;
          case 'break':
            return h('br');
          case 'code':
            return h('code', { class: 'rounded bg-black/30 px-1 py-0.5 text-[0.9em]' }, node.value);
          case 'strong':
            return h('strong', { class: 'font-semibold' }, toVNodes(node.children));
          case 'em':
            return h('em', toVNodes(node.children));
          // `default` rather than `case 'link'` so the switch is visibly
          // exhaustive; the type still narrows to the link node here.
          default:
            return node.external
              ? h(
                  'a',
                  { href: node.href, target: '_blank', rel: 'noopener noreferrer', class: linkClass },
                  toVNodes(node.children),
                )
              : h(NuxtLink, { to: routeFor(node.href), class: linkClass }, () => toVNodes(node.children));
        }
      });

    return () => h('span', toVNodes(parseAnnouncement(props.message)));
  },
});
</script>
