import type { ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder } from 'discord.js';

export type CapturedCall = {
  method: string;
  args: any;
};

export type ResponseCapture = {
  calls: CapturedCall[];
  last(method: string): CapturedCall | undefined;
  lastArgs(method: string): any;
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
  };
}

export type StepResult = {
  content: string | undefined;
  buttons: string[];
  selectMenus: { customId: string; options: { label: string; value: string }[] }[];
  modalShown: boolean;
  modalCustomId: string | undefined;
  files: any[];
};

export function extractStepResult(capture: ResponseCapture): StepResult {
  const editReply = capture.lastArgs('editReply');
  const showModal = capture.lastArgs('showModal');

  const content = editReply?.content as string | undefined;
  const components = editReply?.components ?? [];
  const files = editReply?.files ?? [];

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
    buttons,
    selectMenus,
    modalShown: !!showModal,
    modalCustomId,
    files,
  };
}
