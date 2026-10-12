# Cleanup skills

These three standalone principles come from [pstack](https://github.com/cursor/plugins/tree/d73344bee8cf22e53b9d5f4cf5749d38ba38c174/pstack), revision `d73344bee8cf22e53b9d5f4cf5749d38ba38c174`. Their `SKILL.md` files are unmodified. The upstream MIT license is in [PSTACK-LICENSE](PSTACK-LICENSE).

| Skill | Use |
| --- | --- |
| `principle-subtract-before-you-add` | Remove proven redundancy before adding abstractions. |
| `principle-test-behavior-not-implementation` | Assert outputs and effects consumers observe, rather than internal call structure. |
| `principle-prove-it-works` | Run checks against the changed artifact and keep reproducible evidence. |

Yuke discovers workspace skills in `.agents/skills`. Restart the session to refresh its catalog. These files do not install the Cursor plugin, configure models, or provide its orchestration tools. The existing yuke `how` and `why` workflows handle investigation. Pstack's `unslop` skill edits prose, not application code.

For cleanup work, select one bounded module, name its current behavior and consumers, preserve compatibility, and run characterization tests before and after the change. Fix a discovered behavior bug separately from the refactor.

The project-authored [verify-nadeshiko](verify-nadeshiko/SKILL.md) skill adapts pstack's verification workflow to the existing local harnesses. It is not an unmodified upstream skill. Read its execution status before treating a recipe as verified.
