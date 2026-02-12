<p align="center"><img src="https://github.com/stacksjs/dtsx/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

## Features

- Sound type inference with `@defaultValue` preservation — no `isolatedDeclarations` needed
- Fast .d.ts generation
- Highly configurable
- Lightweight library
- Cross-platform binary

## Benchmarks

Benchmarked on Apple M3 Pro, macOS _(bun 1.3.10, arm64-darwin)_. Run `bun benchmark/index.ts` to reproduce.

### In-Process API — Cached

_dtsx uses smart caching (hash check + cache hit) for watch mode, incremental builds, and CI pipelines._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|-------------------|---------------------|--------------------|--------------------|
| **dtsx (cached)** | **0.95 µs** | **2.16 µs** | **19.84 µs** | **105.83 µs** |
| zig-dtsx | 4.60 µs _(4.8x)_ | 11.27 µs _(5.2x)_ | 26.75 µs _(1.3x)_ | 230.91 µs _(2.2x)_ |
| oxc-transform | 6.76 µs _(7.1x)_ | 20.54 µs _(9.5x)_ | 79.54 µs _(4.0x)_ | 519.44 µs _(4.9x)_ |
| tsc | 194.34 µs _(205x)_ | 438.12 µs _(203x)_ | 1.14 ms _(57x)_ | 4.20 ms _(40x)_ |

### In-Process API — No Cache

_Cache cleared every iteration for raw single-transform comparison._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|-------------------|---------------------|--------------------|--------------------|
| **zig-dtsx** | **4.68 µs** | **11.43 µs** | **27.89 µs** | **230.32 µs** |
| oxc-transform | 6.95 µs _(1.5x)_ | 21.05 µs _(1.8x)_ | 81.46 µs _(2.9x)_ | 519.01 µs _(2.3x)_ |
| dtsx (no-cache) | 10.42 µs _(2.2x)_ | 23.06 µs _(2.0x)_ | 67.79 µs _(2.4x)_ | 400.81 µs _(1.7x)_ |
| tsc | 155.16 µs _(33x)_ | 389.90 µs _(34x)_ | 918.21 µs _(33x)_ | 3.82 ms _(17x)_ |

### CLI — Single File

_All tools run as compiled native binaries via subprocess._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|-------------------|---------------------|--------------------|--------------------|
| **zig-dtsx** | **2.32 ms** | **2.31 ms** | **2.42 ms** | **2.46 ms** |
| oxc | 16.51 ms _(7.1x)_ | 15.71 ms _(6.8x)_ | 16.41 ms _(6.8x)_ | 16.14 ms _(6.6x)_ |
| dtsx | 29.42 ms _(12.7x)_ | 29.36 ms _(12.7x)_ | 30.96 ms _(12.8x)_ | 32.30 ms _(13.1x)_ |
| tsgo | 38.70 ms _(16.7x)_ | 41.97 ms _(18.2x)_ | 42.09 ms _(17.4x)_ | 52.83 ms _(21.5x)_ |
| tsc | 347.31 ms _(150x)_ | 374.30 ms _(162x)_ | 376.76 ms _(156x)_ | 403.00 ms _(164x)_ |

### Multi-File Project

| Tool | 50 files | 100 files | 500 files |
|------|----------|-----------|-----------|
| **zig-dtsx** | **12.16 ms** | **23.23 ms** | **109.33 ms** |
| oxc | 35.38 ms _(2.9x)_ | 58.62 ms _(2.5x)_ | 402.32 ms _(3.7x)_ |
| dtsx | 55.21 ms _(4.5x)_ | 79.14 ms _(3.4x)_ | 281.40 ms _(2.6x)_ |
| tsgo | 210.54 ms _(17.3x)_ | 413.69 ms _(17.8x)_ | 2.18 s _(20.0x)_ |
| tsc | 774.44 ms _(63.7x)_ | 1.18 s _(50.6x)_ | 3.99 s _(36.5x)_ |

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

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

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
