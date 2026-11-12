<p align="center"><img src="https://github.com/stacksjs/dtsx/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

## Features

- Sound type inference with `@defaultValue` preservation — no `isolatedDeclarations` needed
- Fast .d.ts generation
- Highly configurable
- Lightweight library
- Cross-platform binary

<!-- benchmarks:start -->

## Benchmarks

Measured on Apple M3 Pro (`Mac15,6`), 11-core CPU (5 performance + 6 efficiency), 18 GB RAM, macOS 27.0.1 (arm64) (2026-11-12, Bun 1.4.4). See [Benchmarks](/benchmarks) for methodology and the JavaScript SDK comparison, including bundled builds and watch mode.

### In-process API (no cache)

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| dtsx | **6.22 µs** | **13.58 µs** | 47.00 µs _(1.10x)_ | **189.18 µs** |
| oxc-transform | 6.24 µs _(1.00x)_ | 18.55 µs _(1.37x)_ | **42.81 µs** | 213.06 µs _(1.13x)_ |

### CLI: single file

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **dtsx** | **1.65 ms** | **1.78 ms** | **2.00 ms** | **2.21 ms** |
| oxc | 9.13 ms _(5.5x)_ | 8.82 ms _(5.0x)_ | 9.33 ms _(4.7x)_ | 9.02 ms _(4.1x)_ |
| tsc 7 | 29.25 ms _(18x)_ | 28.00 ms _(16x)_ | 29.41 ms _(15x)_ | 31.03 ms _(14x)_ |

### CLI: multi-file project

| Tool | 50 files | 100 files | 500 files |
|------|------|------|------|
| **dtsx** | **8.94 ms** | **17.76 ms** | **64.10 ms** |
| oxc | 23.89 ms _(2.7x)_ | 35.76 ms _(2.0x)_ | 132.45 ms _(2.1x)_ |
| tsc 7 | 56.57 ms _(6.3x)_ | 86.49 ms _(4.9x)_ | 299.49 ms _(4.7x)_ |

<!-- benchmarks:end -->

### Binary Size

| Platform | Zig Binary | Bun Binary | Reduction |
|----------|-----------|------------|-----------|
| macOS arm64 | 659 KB | 61 MB | **95x smaller** |
| macOS x64 | 716 KB | 67 MB | **96x smaller** |
| Linux x64 | 6.2 MB | 108 MB | **17x smaller** |
| Linux arm64 | 6.3 MB | 103 MB | **16x smaller** |
| Windows x64 | 1.0 MB | 101 MB | **101x smaller** |
| FreeBSD x64 | 5.5 MB | — | — |

## Changelog

Please see our [releases](https://github.com/stacksjs/stacks/releases) page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Stargazers

[![Stargazers over time](https://starchart.cc/stacksjs/dtsx.svg?variant=adaptive)](https://starchart.cc/stacksjs/dtsx)

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://stacksjs.com/discord)

## Postcardware

Two things are true: Stacks OSS will always stay open-source, and we do love to receive postcards from wherever Stacks is used! 🌍 _We also publish them on our website. And thank you, Spatie_

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](https://github.com/stacksjs/dtsx/graphs/contributors)

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/stacks/tree/main/LICENSE.md) for more information.

Made with 💙
