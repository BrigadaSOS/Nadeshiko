export type CapturedCall = {
  method: string;
  args: any;
};

export type ResponseCapture = {
  calls: CapturedCall[];
  last(method: string): CapturedCall | undefined;
  lastArgs(method: string): any;
  /** The most recent of several methods, whichever ran last. */
  lastOfArgs(methods: string[]): any;
};

export function createCapture(): ResponseCapture {
  const calls: CapturedCall[] = [];
  return {
    calls,
    last(method: string) {
      for (let i = calls.length - 1; i >= 0; i--) {
        if (calls[i].method === method) return calls[i];
      }
      return undefined;
    },
    lastArgs(method: string) {
      return this.last(method)?.args;
    },
    lastOfArgs(methods: string[]) {
      for (let i = calls.length - 1; i >= 0; i--) {
        if (methods.includes(calls[i].method)) return calls[i].args;
      }
      return undefined;
    },
  };
}

export type StepResult = {
  content: string | undefined;
  embeds: any[];
  buttons: string[];
  selectMenus: { customId: string; options: { label: string; value: string }[] }[];
  modalShown: boolean;
  modalCustomId: string | undefined;
  files: any[];
};

export function extractStepResult(capture: ResponseCapture): StepResult {
  // A command's visible state is whatever it wrote LAST, and which method that
  // was depends on the command: deferred ones `editReply`, `/settings` and
  // `/info` `reply`, and a component handler rewriting its own message
  // `update`. Reading only `editReply` made every non-deferred surface look
  // like it had produced no output at all.
  const reply = capture.lastOfArgs(['editReply', 'reply', 'update']);
  const showModal = capture.lastArgs('showModal');

  const content = reply?.content as string | undefined;
  const components = reply?.components ?? [];
  const files = reply?.files ?? [];
  const embeds = (reply?.embeds ?? []).map((e: any) => (typeof e?.toJSON === 'function' ? e.toJSON() : e));

  const buttons: string[] = [];
  const selectMenus: StepResult['selectMenus'] = [];

  for (const row of components) {
    const rowJson = typeof row.toJSON === 'function' ? row.toJSON() : row;
    for (const comp of rowJson.components ?? []) {
      if (comp.type === 2 && comp.custom_id) {
        buttons.push(comp.custom_id);
      }
      if (comp.type === 3 && comp.custom_id) {
        selectMenus.push({
          customId: comp.custom_id,
          options: (comp.options ?? []).map((o: any) => ({ label: o.label, value: o.value })),
        });
      }
    }
  }

  let modalCustomId: string | undefined;
  if (showModal) {
    const modalJson = typeof showModal.toJSON === 'function' ? showModal.toJSON() : showModal;
    modalCustomId = modalJson.custom_id ?? modalJson.customId;
  }

  return {
    content,
    embeds,
    buttons,
    selectMenus,
    modalShown: !!showModal,
    modalCustomId,
    files,
  };
}
