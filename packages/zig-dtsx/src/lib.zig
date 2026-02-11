/// C ABI exports for Bun FFI integration.
/// Provides process_source, result_length, free_result.
const std = @import("std");
const Scanner = @import("scanner.zig").Scanner;
const emitter = @import("emitter.zig");

/// Process TypeScript source → .d.ts output.
/// Returns a pointer to the result string (null-terminated).
/// Caller must call free_result() when done.
export fn process_source(
    input: [*]const u8,
    len: usize,
    keep_comments: bool,
) [*]const u8 {
    return processSourceInternal(input, len, keep_comments, false) catch {
        // Return empty string on error — must be c_allocator-allocated so free_result() is safe
        const empty = std.heap.c_allocator.alloc(u8, 1) catch @panic("OOM");
        empty[0] = 0;
        return empty.ptr;
    };
}

fn processSourceInternal(
    input: [*]const u8,
    len: usize,
    keep_comments: bool,
    isolated_declarations: bool,
) ![*]const u8 {
    // Handle empty input
    if (len == 0) {
        const result = try std.heap.c_allocator.alloc(u8, 1);
        result[0] = 0;
        return result.ptr;
    }

    const source = input[0..len];

    // Use arena allocator for all intermediary work
    var arena = std.heap.ArenaAllocator.init(std.heap.c_allocator);
    defer arena.deinit();
    const arena_alloc = arena.allocator();

    // Scan
    var scanner = Scanner.init(arena_alloc, source, keep_comments, isolated_declarations);
    _ = try scanner.scan();

    // Emit
    const default_import_order = [_][]const u8{"bun"};
    const dts_output = try emitter.processDeclarations(
        arena_alloc,
        scanner.declarations.items,
        source,
        keep_comments,
        &default_import_order,
    );

    // Copy result to c_allocator so it survives arena.deinit()
    const result = try std.heap.c_allocator.alloc(u8, dts_output.len + 1);
    @memcpy(result[0..dts_output.len], dts_output);
    result[dts_output.len] = 0; // null terminate

    return result.ptr;
}

/// Get the length of a result string (without null terminator)
export fn result_length(ptr: [*]const u8) usize {
    var i: usize = 0;
    while (ptr[i] != 0) i += 1;
    return i;
}

/// Free a result string previously returned by process_source
export fn free_result(ptr: [*]const u8, len: usize) void {
    const slice = @as([*]u8, @constCast(ptr))[0 .. len + 1]; // +1 for null terminator
    std.heap.c_allocator.free(slice);
}

/// Process source with isolatedDeclarations option
export fn process_source_with_options(
    input: [*]const u8,
    len: usize,
    keep_comments: bool,
    isolated_declarations: bool,
) [*]const u8 {
    return processSourceInternal(input, len, keep_comments, isolated_declarations) catch {
        const empty = std.heap.c_allocator.alloc(u8, 1) catch @panic("OOM");
        empty[0] = 0;
        return empty.ptr;
    };
}
