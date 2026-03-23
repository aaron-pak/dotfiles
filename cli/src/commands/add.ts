import { Console, Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { Stow } from '../services/Stow.js';

const paths = Argument.string('paths').pipe(
  Argument.withDescription('Paths to add (relative to home)'),
  Argument.variadic({ min: 1 }),
);

const dry = Flag.boolean('dry').pipe(
  Flag.withAlias('n'),
  Flag.withDescription('Show what would be added without doing it'),
);

export const add = Command.make('add', { paths, dry }, ({ paths, dry }) =>
  Effect.gen(function* () {
    const stow = yield* Stow;

    for (const p of paths) {
      if (dry) {
        yield* stow.checkAddable(p);
        yield* Console.log(`Would add: ~/${p}`);
      } else {
        yield* stow.addDotfile(p);
        yield* Console.log(`Added: ~/${p}`);
      }
    }

    if (!dry) {
      const links = yield* stow.sync();
      if (links.length > 0) {
        yield* Console.log('\nSymlinks created:');
        for (const { target } of links) {
          yield* Console.log(`  ${target}`);
        }
      }
    }
  }),
).pipe(Command.withDescription('Add dotfiles to be managed'));
