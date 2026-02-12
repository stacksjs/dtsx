## Benchmark Results

**Platform:** darwin arm64 | **Runtime:** Bun 1.3.10 | **Date:** 2026-02-13

### In-Process API — Cached

_Smart caching (hash check + cache hit) for watch mode, incremental builds, and CI._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) | XXLarge (~2000 lines) | Huge (~5000 lines) |
|------|------|------|------|------|------|------|
| **dtsx (cached)** | 17.5 µs _(2.4x)_ | **6.2 µs** | 67.8 µs _(2.2x)_ | **131.2 µs** | 603.8 µs _(1.7x)_ | 4.13 ms _(4.4x)_ |
| zig-dtsx | **7.4 µs** | 14.9 µs _(2.4x)_ | **30.8 µs** | 291.5 µs _(2.2x)_ | **364.3 µs** | **937.5 µs** |
| oxc-transform | 7.9 µs _(1.1x)_ | 28.5 µs _(4.6x)_ | 91.5 µs _(3.0x)_ | 550.8 µs _(4.2x)_ | 384.6 µs _(1.1x)_ | 941.1 µs _(1.0x)_ |
| tsc | 752.7 µs _(101.6x)_ | 1.28 ms _(206.9x)_ | 2.82 ms _(91.5x)_ | 6.23 ms _(47.5x)_ | 9.67 ms _(26.5x)_ | 18.41 ms _(19.6x)_ |

### In-Process API — No Cache

_Raw single-transform comparison (cache cleared every iteration)._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) | XXLarge (~2000 lines) | Huge (~5000 lines) |
|------|------|------|------|------|------|------|
| **zig-dtsx** | **7.4 µs** | **14.9 µs** | **30.8 µs** | **291.5 µs** | **364.3 µs** | **937.5 µs** |
| oxc-transform | 7.9 µs _(1.1x)_ | 28.5 µs _(1.9x)_ | 91.5 µs _(3.0x)_ | 550.8 µs _(1.9x)_ | 384.6 µs _(1.1x)_ | 941.1 µs _(1.0x)_ |
| dtsx (no-cache) | 45.8 µs _(6.2x)_ | 115.4 µs _(7.7x)_ | 146.8 µs _(4.8x)_ | 478.2 µs _(1.6x)_ | 1.35 ms _(3.7x)_ | 6.04 ms _(6.4x)_ |
| tsc | 752.7 µs _(101.6x)_ | 1.28 ms _(85.5x)_ | 2.82 ms _(91.5x)_ | 6.23 ms _(21.4x)_ | 9.67 ms _(26.5x)_ | 18.41 ms _(19.6x)_ |

### Multi-File Project

_All tools processing files in-process sequentially._

| Tool | 50 files | 100 files |
|------|------|------|
| **zig-dtsx** | **4.35 ms** | **8.36 ms** |
| dtsx | 6.57 ms _(1.5x)_ | 14.31 ms _(1.7x)_ |
| oxc-transform | 8.12 ms _(1.9x)_ | 16.69 ms _(2.0x)_ |
| tsc | 90.45 ms _(20.8x)_ | 176.96 ms _(21.2x)_ |

> _No previous benchmark found for regression comparison_

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
