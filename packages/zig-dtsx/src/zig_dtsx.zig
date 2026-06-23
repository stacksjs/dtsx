//! Native-Zig API root for the zig-dtsx fast `.d.ts` emitter.
//!
//! `lib.zig` is the C-ABI / Bun-FFI entry point (`process_source` &
//! friends). This module is the entry point for downstream **Zig**
//! consumers that import zig-dtsx as a Zig module and drive the
//! scanner + emitter directly instead of going through the FFI
//! boundary — e.g. Home's `packages/ts_emit/src/d_ts_fast.zig`, which
//! wires this file in as the `zig_dtsx` module via `build.zig`.
//!
//! Zig requires every source file to belong to exactly one module, so
//! this single root re-exports the public surface (`Scanner`,
//! `processDeclarations`, and the supporting types) rather than
//! exposing `scanner.zig` / `emitter.zig` as separate modules, which
//! would duplicate their transitive imports.
//!
//! Stable consumer contract (mirrored by Home's local build stub):
//!   - `Scanner.init(allocator, source, keep_comments, isolated_declarations)`
//!   - `Scanner.scan()` → `!ScanResult`, populating `scanner.declarations`
//!   - `processDeclarations(arena, result_alloc, decls, source, keep_comments, import_order)`

const scanner = @import("scanner.zig");
const emitter = @import("emitter.zig");
const types = @import("types.zig");

/// Top-level declaration scanner. See `scanner.zig` for the full API.
pub const Scanner = scanner.Scanner;

/// Result returned by `Scanner.scan`.
pub const ScanResult = scanner.ScanResult;

/// A single extracted declaration record (`scanner.declarations.items`
/// element type, also the `processDeclarations` input element type).
pub const Declaration = types.Declaration;

/// Declaration variant tag.
pub const DeclarationKind = types.DeclarationKind;

/// Render scanned declarations into `.d.ts` output. The result is
/// allocated from `result_alloc` with a trailing NUL byte (so FFI
/// callers can treat it as a C string); the returned slice excludes
/// that NUL. Callers freeing the buffer must free `ptr[0 .. len + 1]`.
pub const processDeclarations = emitter.processDeclarations;

test {
    // Pull the re-exported declarations into the test build so a
    // `zig build test` on the package keeps this root honest.
    _ = Scanner;
    _ = ScanResult;
    _ = Declaration;
    _ = DeclarationKind;
    _ = processDeclarations;
}
