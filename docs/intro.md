<p align="center"><img src="https://github.com/stacksjs/dtsx/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

## Features

- Sound type inference with `@defaultValue` preservation — no `isolatedDeclarations` needed
- Fast .d.ts generation
- Highly configurable
- Lightweight library
- Cross-platform binary

<!-- benchmarks:start -->

## Benchmarks

Measured on Apple M3 Pro (`Mac15,6`), 11-core CPU (5 performance + 6 efficiency), 18 GB RAM, macOS 27.0.1 (arm64) (2026-11-08, Bun 1.4.4). See [Benchmarks](/benchmarks) for methodology and the JavaScript SDK comparison, including bundled builds and watch mode.

### In-process API (no cache)

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **dtsx** | **6.26 µs** | **14.05 µs** | **44.21 µs** | **164.40 µs** |
| oxc-transform | 7.24 µs _(1.16x)_ | 20.24 µs _(1.44x)_ | 49.90 µs _(1.13x)_ | 250.75 µs _(1.53x)_ |

### CLI: single file

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **dtsx** | **2.95 ms** | **2.88 ms** | **3.11 ms** | **3.31 ms** |
| oxc | 10.64 ms _(3.6x)_ | 10.34 ms _(3.6x)_ | 11.09 ms _(3.6x)_ | 10.51 ms _(3.2x)_ |
| tsc 7 | 34.52 ms _(12x)_ | 33.44 ms _(12x)_ | 34.86 ms _(11x)_ | 36.07 ms _(11x)_ |

### CLI: multi-file project

| Tool | 50 files | 100 files | 500 files |
|------|------|------|------|
| **dtsx** | **10.53 ms** | **17.82 ms** | **74.57 ms** |
| oxc | 26.38 ms _(2.5x)_ | 39.55 ms _(2.2x)_ | 186.20 ms _(2.5x)_ |
| tsc 7 | 71.98 ms _(6.8x)_ | 123.11 ms _(6.9x)_ | 412.65 ms _(5.5x)_ |

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
