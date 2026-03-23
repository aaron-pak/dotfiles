import { Command, Flag } from 'effect/unstable/cli';
import { runFullSync } from './syncFlow.js';

const dry = Flag.boolean('dry').pipe(
  Flag.withAlias('n'),
  Flag.withDescription('Show what would be synced without doing it'),
);

export const sync = Command.make('sync', { dry }, ({ dry }) => runFullSync(dry)).pipe(
  Command.withDescription('Sync shared dotfiles, skills, and managed settings onto this machine'),
);
