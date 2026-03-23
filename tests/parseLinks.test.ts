import { describe, expect, it } from '@effect/vitest';
import { parseLinks, StowLink } from '../src/services/Stow.js';

describe('parseLinks', () => {
  it('empty string -> empty array', () => {
    expect(parseLinks('')).toEqual([]);
  });

  it('single link line -> single StowLink', () => {
    const stderr = 'LINK: .bashrc => home/.bashrc';

    const result = parseLinks(stderr);

    expect(result).toEqual([
      new StowLink({
        target: '.bashrc',
        source: 'home/.bashrc',
      }),
    ]);
  });

  it('multiple link lines -> multiple StowLinks', () => {
    const stderr = `WARNING: some warning
LINK: .bashrc => home/.bashrc
* cannot stow .zshrc over existing target .zshrc since it is a directory
LINK: .config/nvim => home/.config/nvim`;

    const result = parseLinks(stderr);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      new StowLink({
        target: '.bashrc',
        source: 'home/.bashrc',
      }),
    );
    expect(result[1]).toEqual(
      new StowLink({
        target: '.config/nvim',
        source: 'home/.config/nvim',
      }),
    );
  });

  it('mixed valid/invalid lines -> only valid parsed', () => {
    const stderr = `some random output
LINK: foo => bar
invalid link line format
LINK => missing prefix
LINK: a => b`;

    const result = parseLinks(stderr);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(new StowLink({ target: 'foo', source: 'bar' }));
    expect(result[1]).toEqual(new StowLink({ target: 'a', source: 'b' }));
  });

  it('handles paths with special chars', () => {
    const stderr = 'LINK: .config/my-app => home/.config/my-app';

    const result = parseLinks(stderr);

    expect(result).toEqual([
      new StowLink({
        target: '.config/my-app',
        source: 'home/.config/my-app',
      }),
    ]);
  });

  it('handles paths with spaces', () => {
    const stderr = 'LINK: path with spaces => home/path with spaces';

    const result = parseLinks(stderr);

    expect(result).toEqual([
      new StowLink({
        target: 'path with spaces',
        source: 'home/path with spaces',
      }),
    ]);
  });

  it('handles unicode in paths', () => {
    const stderr = 'LINK: .config/日本語 => home/.config/日本語';

    const result = parseLinks(stderr);

    expect(result).toEqual([
      new StowLink({
        target: '.config/日本語',
        source: 'home/.config/日本語',
      }),
    ]);
  });

  it('blank lines ignored', () => {
    const stderr = `
LINK: a => b

`;
    const result = parseLinks(stderr);

    expect(result).toHaveLength(1);
  });
});
