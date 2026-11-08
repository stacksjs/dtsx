<p align="center"><img src="https://github.com/stacksjs/dtsx/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

## Features

- Sound type inference with `@defaultValue` preservation — no `isolatedDeclarations` needed
- Fast .d.ts generation
- Highly configurable
- Lightweight library
- Cross-platform binary

<!-- benchmarks:start -->

## Benchmarks

Measured on Apple M3 Pro (`Mac15,6`), 11-core CPU (5 performance + 6 efficiency), 18 GB RAM, macOS 27.0.1 (arm64) (2026-11-08, Bun 1.4.4). See [Benchmarks](/benchmarks) for methodology, the Bun CLI, bundled builds and watch mode.

### In-process API (no cache)

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **dtsx (native, zig-dtsx)** | **5.88 µs** | **11.48 µs** | **41.92 µs** | **163.38 µs** |
| oxc-transform | 6.41 µs _(1.09x)_ | 18.29 µs _(1.59x)_ | 43.81 µs _(1.05x)_ | 219.56 µs _(1.34x)_ |
| dtsx (Bun/TypeScript) | 27.46 µs _(4.7x)_ | 49.70 µs _(4.3x)_ | 145.68 µs _(3.5x)_ | 595.29 µs _(3.6x)_ |

### CLI: single file

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **dtsx (native, zig-dtsx)** | **1.91 ms** | **1.89 ms** | **2.04 ms** | **2.30 ms** |
| oxc | 8.31 ms _(4.4x)_ | 8.38 ms _(4.4x)_ | 8.52 ms _(4.2x)_ | 9.13 ms _(4.0x)_ |
| dtsx (Bun binary) | 10.66 ms _(5.6x)_ | 10.93 ms _(5.8x)_ | 12.42 ms _(6.1x)_ | 15.32 ms _(6.7x)_ |
| tsc 7 (native Go) | 27.11 ms _(14x)_ | 27.02 ms _(14x)_ | 28.00 ms _(14x)_ | 29.97 ms _(13x)_ |

### CLI: multi-file project

| Tool | 50 files | 100 files | 500 files |
|------|------|------|------|
| **dtsx (native, zig-dtsx)** | **8.79 ms** | **15.18 ms** | **63.07 ms** |
| oxc | 21.33 ms _(2.4x)_ | 32.69 ms _(2.2x)_ | 137.25 ms _(2.2x)_ |
| tsc 7 (native Go) | 53.29 ms _(6.1x)_ | 78.07 ms _(5.1x)_ | 273.54 ms _(4.3x)_ |
| dtsx (Bun binary) | 47.66 ms _(5.4x)_ | 118.26 ms _(7.8x)_ | 295.98 ms _(4.7x)_ |

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
