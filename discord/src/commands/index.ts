import type { ChatInputCommandInteraction } from 'discord.js';

import * as searchCmd from './search';
import * as sentenceCmd from './sentence';
import * as randomCmd from './random';
import * as statsCmd from './stats';
import * as settingsCmd from './settings';
import * as infoCmd from './info';
import * as healthCmd from './health';

export type Command = {
  data: { name: string; toJSON(): unknown };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

export const allCommands: Command[] = [searchCmd, sentenceCmd, randomCmd, statsCmd, settingsCmd, infoCmd, healthCmd];
