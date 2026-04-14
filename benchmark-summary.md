## Benchmark Results

**Platform:**darwin arm64 |**Runtime:**Bun 1.3.11 |**Date:** 2026-03-20

### In-Process API — Cached

_Smart caching (hash check + cache hit) for watch mode, incremental builds, and CI._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **dtsx (cached)**|**97.81 ns**|**162.55 ns**|**376.39 ns**|**1.43 µs** |
| zig-dtsx | 3.43 µs _(35.0x)_ | 7.16 µs _(44.0x)_ | 22.00 µs _(58.5x)_ | 147.21 µs _(103.0x)_ |
| oxc-transform | 7.35 µs _(75.1x)_ | 22.66 µs _(139.4x)_ | 85.77 µs _(227.9x)_ | 558.72 µs _(390.7x)_ |
| tsc | 236.82 µs _(2421x)_ | 463.06 µs _(2849x)_ | 1.53 ms _(4065x)_ | 4.66 ms _(3259x)_ |

### In-Process API — No Cache

_Raw single-transform comparison (cache cleared every iteration)._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **zig-dtsx**|**3.37 µs**|**7.05 µs**|**21.89 µs**|**144.89 µs** |
| oxc-transform | 7.36 µs _(2.2x)_ | 21.91 µs _(3.1x)_ | 89.66 µs _(4.1x)_ | 560.86 µs _(3.9x)_ |
| dtsx (no-cache) | 15.52 µs _(4.6x)_ | 34.06 µs _(4.8x)_ | 81.96 µs _(3.7x)_ | 573.92 µs _(4.0x)_ |
| tsc | 169.69 µs _(50.4x)_ | 410.31 µs _(58.2x)_ | 1.03 ms _(47.1x)_ | 4.02 ms _(27.7x)_ |

> **Note:** tsgo (`@typescript/native-preview`) is CLI-only — no in-process API is available yet. Each measurement includes ~40ms process spawn overhead, so it is not directly comparable to the in-process tools above. Once tsgo ships an in-process API, it will be added to the tables.

### CLI — Single File

_Compiled native binaries via subprocess._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **zig-dtsx**|**2.69 ms**|**2.35 ms**|**2.28 ms**|**3.14 ms** |
| oxc | 17.08 ms _(6.3x)_ | 17.12 ms _(7.3x)_ | 17.95 ms _(7.9x)_ | 17.69 ms _(5.6x)_ |
| dtsx | 33.42 ms _(12.4x)_ | 34.09 ms _(14.5x)_ | 34.41 ms _(15.1x)_ | 36.34 ms _(11.6x)_ |
| tsgo | 40.53 ms _(15.1x)_ | 44.10 ms _(18.8x)_ | 44.39 ms _(19.5x)_ | 57.77 ms _(18.4x)_ |
| tsc | 384.25 ms _(142.8x)_ | 407.51 ms _(173.4x)_ | 418.81 ms _(183.7x)_ | 454.74 ms _(144.8x)_ |

### Multi-File Project

_All tools processing files in-process sequentially._

| Tool | 50 files | 100 files | 500 files |
|------|------|------|------|
| **zig-dtsx**|**18.10 ms**|**31.46 ms**|**~140 ms** |
| oxc | 48.27 ms _(2.7x)_ | 79.00 ms _(2.5x)_ | ~365 ms _(2.6x)_ |
| dtsx | 70.86 ms _(3.9x)_ | 360.34 ms _(11.5x)_ | ~540 ms _(3.9x)_ |
| tsgo | 244.68 ms _(13.5x)_ | 419.65 ms _(13.3x)_ | - |
| tsc | 871.48 ms _(48.1x)_ | - | - |

### zig-dtsx vs oxc-transform

| Input Size | zig-dtsx | oxc-transform | Speedup |
|-----------|----------|---------------|----------|
| Small (~50 lines) | 3.37 µs | 7.36 µs | :green_circle: 2.18x |
| Medium (~100 lines) | 7.05 µs | 21.91 µs | :green_circle: 3.11x |
| Large (~330 lines) | 21.89 µs | 89.66 µs | :green_circle: 4.10x |
| XLarge (~1050 lines) | 144.89 µs | 560.86 µs | :green_circle: 3.87x |

### dtsx (cached) vs oxc-transform

| Input Size | dtsx (cached) | oxc-transform | Speedup |
|-----------|----------|---------------|----------|
| Small (~50 lines) | 97.81 ns | 7.35 µs | :green_circle: 75x |
| Medium (~100 lines) | 162.55 ns | 22.66 µs | :green_circle: 139x |
| Large (~330 lines) | 376.39 ns | 85.77 µs | :green_circle: 228x |
| XLarge (~1050 lines) | 1.43 µs | 558.72 µs | :green_circle: 391x |

<details>
<summary><strong>Internal Benchmark Details</strong></summary>

#### Extraction

| Benchmark | Avg | Min | Max | Throughput | Memory |
|-----------|-----|-----|-----|------------|--------|
| Simple (0001.ts) | 835 ns | 458 ns | 3.5 µs | 847.5 M chars/s | 0.0 MB |
| Medium (0002.ts) | 996 ns | 500 ns | 2.1 µs | 988.1 M chars/s | 0.0 MB |
| Complex (0003.ts) :trophy: | 523 ns | 291 ns | 3.7 µs | 2.5 G chars/s | 0.0 MB |
| Very Complex (0005.ts) | 3.8 µs | 3.7 µs | 4.4 µs | 21.9 G chars/s | 0.0 MB |
| Lodash-like (real-world) | 1.4 µs | 1.3 µs | 2.1 µs | 18.5 G chars/s | 0.0 MB |
| React-like (real-world) | 1.7 µs | 1.6 µs | 2.4 µs | 19.7 G chars/s | 0.0 MB |

#### Synthetic

| Benchmark | Avg | Min | Max | Throughput | Memory |
|-----------|-----|-----|-----|------------|--------|
| 100 lines :trophy: | 628 ns | 459 ns | 4.3 µs | 11.2 G chars/s | 0.0 MB |
| 500 lines | 1.8 µs | 1.7 µs | 3.7 µs | 19.9 G chars/s | 0.0 MB |
| 1000 lines | 3.3 µs | 3.2 µs | 4.0 µs | 21.8 G chars/s | 0.0 MB |
| 5000 lines | 16.8 µs | 16.7 µs | 17.0 µs | 22.2 G chars/s | 0.0 MB |
| 10000 lines | 33.4 µs | 33.1 µs | 34.0 µs | 22.5 G chars/s | 0.0 MB |

#### Memory

| Benchmark | Avg | Min | Max | Throughput | Memory |
|-----------|-----|-----|-----|------------|--------|
| Large File Memory :trophy: | 10.33 ms | 10.33 ms | 10.33 ms | 72.6 M chars/s | 7.0 MB |

#### Real-World

| Benchmark | Avg | Min | Max | Throughput | Memory |
|-----------|-----|-----|-----|------------|--------|
| Lodash-like :trophy: | 1.6 µs | 1.3 µs | 2.9 µs | 16.6 G chars/s | 0.0 MB |
| React-like | 4.8 µs | 3.1 µs | 15.2 µs | 6.9 G chars/s | 0.0 MB |

#### Generation

| Benchmark | Avg | Min | Max | Throughput | Memory |
|-----------|-----|-----|-----|------------|--------|
| Single File (100 lines) :trophy: | 301.8 µs | 241.1 µs | 375.7 µs | 23.4 M chars/s | 0.0 MB |
| Medium File (1000 lines) | 598.6 µs | 526.0 µs | 810.8 µs | 120.8 M chars/s | 0.0 MB |
| Large File (5000 lines) | 5.06 ms | 4.44 ms | 6.11 ms | 73.7 M chars/s | 0.0 MB |

#### Phase Timing

| File | Phase | Avg Time | % of Total |
|------|-------|----------|------------|
| 500 lines | Processing | 183.3 µs | ████████████████████ 98.6% |
| 500 lines | Extraction | 2.2 µs | █ 1.2% |
| 500 lines | Formatting | 65 ns | █ 0.0% |
| 500 lines | File Read | 35 ns | █ 0.0% |
| 2000 lines | Processing | 741.4 µs | ████████████████████ 98.9% |
| 2000 lines | Extraction | 7.4 µs | █ 1.0% |
| 2000 lines | Formatting | 54 ns | █ 0.0% |
| 2000 lines | File Read | 29 ns | █ 0.0% |
| 5000 lines | Processing | 4.16 ms | ████████████████████ 99.6% |
| 5000 lines | Extraction | 17.6 µs | █ 0.4% |
| 5000 lines | Formatting | 94 ns | █ 0.0% |
| 5000 lines | File Read | 42 ns | █ 0.0% |

</details>

| Metric | Value |
|--------|-------|
| Total benchmarks | 17 |
| Avg time | 962.8 µs |
| Total time | 0.1 s |
