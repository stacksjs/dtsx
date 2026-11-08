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
| **dtsx (native, zig-dtsx)** | **5.64 µs** | **11.74 µs** | **43.43 µs** | **153.10 µs** |
| oxc-transform | 6.60 µs _(1.17x)_ | 18.83 µs _(1.60x)_ | 45.25 µs _(1.04x)_ | 225.76 µs _(1.47x)_ |
| dtsx (Bun/TypeScript) | 34.29 µs _(6.1x)_ | 50.06 µs _(4.3x)_ | 152.29 µs _(3.5x)_ | 637.78 µs _(4.2x)_ |

### CLI: single file

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **dtsx (native, zig-dtsx)** | **2.13 ms** | **2.11 ms** | **2.13 ms** | **2.34 ms** |
| oxc | 8.55 ms _(4.0x)_ | 8.65 ms _(4.1x)_ | 8.42 ms _(4.0x)_ | 8.61 ms _(3.7x)_ |
| dtsx (Bun binary) | 8.44 ms _(4.0x)_ | 8.82 ms _(4.2x)_ | 10.00 ms _(4.7x)_ | 12.84 ms _(5.5x)_ |
| tsc 7 (native Go) | 28.10 ms _(13x)_ | 27.90 ms _(13x)_ | 27.78 ms _(13x)_ | 28.98 ms _(12x)_ |

### CLI: multi-file project

| Tool | 50 files | 100 files | 500 files |
|------|------|------|------|
| **dtsx (native, zig-dtsx)** | **8.90 ms** | **14.59 ms** | **61.90 ms** |
| oxc | 20.75 ms _(2.3x)_ | 32.20 ms _(2.2x)_ | 125.04 ms _(2.0x)_ |
| dtsx (Bun binary) | 47.84 ms _(5.4x)_ | 72.26 ms _(5.0x)_ | 241.43 ms _(3.9x)_ |
| tsc 7 (native Go) | 53.92 ms _(6.1x)_ | 78.31 ms _(5.4x)_ | 291.59 ms _(4.7x)_ |

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
