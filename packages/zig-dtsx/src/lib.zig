/// C ABI exports for Bun FFI integration.
/// Provides process_source(+len variants), result_length, free_result.
const std = @import("std");
const platform = @import("platform.zig");

/// The standard panic handlers print through `std.Io`; see platform.zig for
/// why the Darwin library avoids it. This one prints the message and aborts.
pub const panic = if (platform.direct_libc) std.debug.FullPanic(reportPanic) else std.debug.FullPanic(std.debug.defaultPanic);

extern "c" fn write(fd: c_int, buffer: [*]const u8, count: usize) isize;
extern "c" fn abort() noreturn;

fn reportPanic(message: []const u8, first_trace_address: ?usize) noreturn {
    _ = first_trace_address;
    _ = write(2, "panic: ", 7);
    _ = write(2, message.ptr, message.len);
    _ = write(2, "\n", 1);
    abort();
}
const Scanner = @import("scanner.zig").Scanner;
const emitter = @import("emitter.zig");
const module_specifiers = @import("module_specifiers.zig");

const ProcessResult = struct {
    ptr: [*]const u8,
    len: usize,
};

fn emptyResult() ProcessResult {
    const empty = std.heap.c_allocator.alloc(u8, 1) catch @panic("OOM");
    empty[0] = 0;
    return .{ .ptr = empty.ptr, .len = 0 };
}

fn emissionStatus(err: anyerror) u32 {
    return switch (err) {
        error.InvalidContext => 1,
        error.UnsupportedContextVersion => 2,
        error.UnresolvedModuleSpecifier => 3,
        error.UnsupportedValueFlow => 5,
        else => 4,
    };
}

/// Error-aware source emission. Status zero includes a valid empty declaration
/// result. Every returned pointer follows the existing free_result contract.
export fn process_source_checked_v1(
    input: [*]const u8,
    len: usize,
    keep_comments: bool,
    isolated_declarations: bool,
    out_len: *u64,
    out_status: *u32,
) [*]const u8 {
    out_len.* = 0;
    out_status.* = 0;
    const result = processSourceInternal(input, len, keep_comments, isolated_declarations) catch |err| {
        out_status.* = emissionStatus(err);
        return emptyResult().ptr;
    };
    out_len.* = @intCast(result.len);
    return result.ptr;
}

/// Process TypeScript source → .d.ts output.
/// Returns a pointer to the result string (null-terminated).
/// Caller must call free_result() when done.
export fn process_source(
    input: [*]const u8,
    len: usize,
    keep_comments: bool,
) [*]const u8 {
    const result = processSourceInternal(input, len, keep_comments, false) catch {
        // Return empty string on error — must be c_allocator-allocated so free_result() is safe
        return emptyResult().ptr;
    };
    return result.ptr;
}

/// Process source and return output length through out_len.
/// This avoids an extra pass in result_length() on the JS side.
export fn process_source_with_len(
    input: [*]const u8,
    len: usize,
    keep_comments: bool,
    out_len: *u64,
) [*]const u8 {
    const result = processSourceInternal(input, len, keep_comments, false) catch {
        out_len.* = 0;
        return emptyResult().ptr;
    };
    out_len.* = @intCast(result.len);
    return result.ptr;
}

/// Thread-local arena: reuse across calls to avoid repeated mmap/munmap syscalls.
/// reset(.retain_capacity) keeps the backing memory warm in CPU cache.
threadlocal var tls_arena: ?std.heap.ArenaAllocator = null;

fn getOrInitArena() *std.heap.ArenaAllocator {
    if (tls_arena == null) {
        tls_arena = std.heap.ArenaAllocator.init(std.heap.c_allocator);
    }
    return &(tls_arena.?);
}

fn processSourceInternal(
    input: [*]const u8,
    len: usize,
    keep_comments: bool,
    isolated_declarations: bool,
) !ProcessResult {
    return processSourceInternalWithContext(input, len, keep_comments, isolated_declarations, null);
}

fn processSourceInternalWithContext(
    input: [*]const u8,
    len: usize,
    keep_comments: bool,
    isolated_declarations: bool,
    context_json: ?[]const u8,
) !ProcessResult {
    if (len == 0 and context_json == null) return emptyResult();
    const source = input[0..len];

    // Reuse thread-local arena — reset frees all allocations but keeps backing pages
    const arena = getOrInitArena();
    _ = arena.reset(.retain_capacity);
    const arena_alloc = arena.allocator();
    var context: ?module_specifiers.Context = if (context_json) |json|
        try module_specifiers.parse(arena_alloc, json, source)
    else
        null;
    defer if (context) |*value| value.deinit();

    // Validate a supplied context even when its source is empty.
    if (len == 0) return emptyResult();

    // Scan
    var scanner = Scanner.init(arena_alloc, source, keep_comments, isolated_declarations);
    if (context) |value| scanner.inference_sources = value.wire.inferenceSources;
    _ = try scanner.scan();

    // Emit — result buffer uses c_allocator directly so it survives arena.reset().
    // processDeclarations appends '\0' before toOwnedSlice, so the result is
    // already null-terminated with no extra copy needed.
    const default_import_order = [_][]const u8{"bun"};
    const dts_output = try emitter.processScannedDeclarations(
        arena_alloc,
        std.heap.c_allocator,
        scanner.declarations.items,
        source,
        keep_comments,
        &default_import_order,
        if (context) |*value| value else null,
        .{ .external_module = scanner.external_module },
    );

    // dts_output[0..len] is content, dts_output.ptr[len] == 0 (null terminator)
    return .{ .ptr = dts_output.ptr, .len = dts_output.len };
}

/// Additive context ABI v1. All legacy signatures and allocation rules remain
/// unchanged. Status: 0 success, 1 invalid context, 2 unsupported version,
/// 3 unresolved module, 4 emission failure, 5 unsupported source value flow.
/// Failure still returns a freeable,
/// empty, NUL-terminated allocation and initializes both output fields.
export fn process_source_with_context_v1(
    input: [*]const u8,
    len: usize,
    keep_comments: bool,
    isolated_declarations: bool,
    context: [*]const u8,
    context_len: usize,
    out_len: *u64,
    out_status: *u32,
) [*]const u8 {
    out_len.* = 0;
    out_status.* = 0;
    const result = processSourceInternalWithContext(input, len, keep_comments, isolated_declarations, context[0..context_len]) catch |err| {
        out_status.* = emissionStatus(err);
        return emptyResult().ptr;
    };
    out_len.* = @intCast(result.len);
    return result.ptr;
}

/// Get the length of a result string (without null terminator).
/// Scan to the null terminator without reading beyond the caller-owned buffer.
export fn result_length(ptr: [*]const u8) usize {
    var i: usize = 0;
    while (ptr[i] != 0) : (i += 1) {}
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
    const result = processSourceInternal(input, len, keep_comments, isolated_declarations) catch {
        return emptyResult().ptr;
    };
    return result.ptr;
}

/// Same as process_source_with_options but returns length through out_len.
export fn process_source_with_options_len(
    input: [*]const u8,
    len: usize,
    keep_comments: bool,
    isolated_declarations: bool,
    out_len: *u64,
) [*]const u8 {
    const result = processSourceInternal(input, len, keep_comments, isolated_declarations) catch {
        out_len.* = 0;
        return emptyResult().ptr;
    };
    out_len.* = @intCast(result.len);
    return result.ptr;
}

// ---------------------------------------------------------------------------
// Batch API — process multiple files in parallel from a single FFI call
// ---------------------------------------------------------------------------

const BatchTask = struct {
    input: [*]const u8,
    input_len: usize,
    keep_comments: bool,
    out_ptr: *usize, // where to write result pointer
    out_len: *u64, // where to write result length
    out_status: ?*u32 = null,
};

fn batchWorker(tasks: []const BatchTask) void {
    for (tasks) |task| {
        if (task.out_status) |status| status.* = 0;
        const result = processSourceInternal(task.input, task.input_len, task.keep_comments, false) catch |err| {
            if (task.out_status) |status| status.* = emissionStatus(err);
            const empty = emptyResult();
            task.out_ptr.* = @intFromPtr(empty.ptr);
            task.out_len.* = 0;
            continue;
        };
        task.out_ptr.* = @intFromPtr(result.ptr);
        task.out_len.* = @intCast(result.len);
    }
}

/// Process multiple files in parallel.
/// inputs: array of pointers to source buffers
/// input_lens: array of source lengths
/// count: number of files
/// keep_comments: whether to preserve comments
/// out_ptrs: pre-allocated array where result pointers are written (as usize)
/// out_lens: pre-allocated array where result lengths are written
/// thread_count: number of worker threads (0 = auto-detect)
export fn process_batch(
    inputs: [*]const [*]const u8,
    input_lens: [*]const u64,
    count: u32,
    keep_comments: bool,
    out_ptrs: [*]usize,
    out_lens: [*]u64,
    thread_count: u32,
) void {
    processBatchInternal(inputs, input_lens, count, keep_comments, out_ptrs, out_lens, thread_count, null);
}

/// Checked batch emission retains native parallelism and reports each result's
/// status separately. A failure cannot masquerade as a valid empty result.
export fn process_batch_checked_v1(
    inputs: [*]const [*]const u8,
    input_lens: [*]const u64,
    count: u32,
    keep_comments: bool,
    out_ptrs: [*]usize,
    out_lens: [*]u64,
    thread_count: u32,
    out_statuses: [*]u32,
) void {
    processBatchInternal(inputs, input_lens, count, keep_comments, out_ptrs, out_lens, thread_count, out_statuses);
}

fn processBatchInternal(
    inputs: [*]const [*]const u8,
    input_lens: [*]const u64,
    count: u32,
    keep_comments: bool,
    out_ptrs: [*]usize,
    out_lens: [*]u64,
    thread_count: u32,
    out_statuses: ?[*]u32,
) void {
    const n: usize = @intCast(count);
    if (n == 0) return;

    @memset(out_ptrs[0..n], 0);
    @memset(out_lens[0..n], 0);
    // Unstarted tasks remain explicit failures if task allocation fails.
    if (out_statuses) |statuses| @memset(statuses[0..n], 4);

    // Build task list
    const tasks = std.heap.c_allocator.alloc(BatchTask, n) catch return;
    defer std.heap.c_allocator.free(tasks);

    for (0..n) |i| {
        tasks[i] = .{
            .input = inputs[i],
            .input_len = @intCast(input_lens[i]),
            .keep_comments = keep_comments,
            .out_ptr = &out_ptrs[i],
            .out_len = &out_lens[i],
            .out_status = if (out_statuses) |statuses| &statuses[i] else null,
        };
    }

    // Determine thread count
    const max_threads: usize = if (thread_count > 0)
        @intCast(thread_count)
    else
        platform.cpuCount();
    // Cap the thread count so each thread gets at least ~4 files. Spawn+join
    // overhead (~100µs per thread) dominates if a thread has only 1-2 small
    // files to process. Mirrors the heuristic in main.zig:processProject.
    const min_files_per_thread = 4;
    const desired_threads = @max(n / min_files_per_thread, 1);
    const num_threads = @min(@min(max_threads, desired_threads), n);

    if (num_threads <= 1) {
        // Single-threaded: process all sequentially
        batchWorker(tasks);
        return;
    }

    // Distribute tasks across threads
    const chunks = std.heap.c_allocator.alloc([]const BatchTask, num_threads) catch {
        // Fallback to single-threaded
        batchWorker(tasks);
        return;
    };
    defer std.heap.c_allocator.free(chunks);
    const chunk_size = (n + num_threads - 1) / num_threads;
    var used: usize = 0;
    for (0..num_threads) |t| {
        const start = t * chunk_size;
        if (start >= n) break;
        chunks[used] = tasks[start..@min(start + chunk_size, n)];
        used += 1;
    }
    // A thread that cannot start runs its chunk on this one.
    platform.runOnThreads([]const BatchTask, batchWorker, std.heap.c_allocator, chunks[0..used]) catch batchWorker(tasks);
}

/// Free multiple results from a batch call.
export fn free_batch_results(ptrs: [*]const usize, lens: [*]const u64, count: u32) void {
    const n: usize = @intCast(count);
    for (0..n) |i| {
        if (ptrs[i] == 0) continue;
        const p: [*]u8 = @ptrFromInt(ptrs[i]);
        const l: usize = @intCast(lens[i]);
        std.heap.c_allocator.free(p[0 .. l + 1]); // +1 for null terminator
    }
}

test "result_length stays within the null-terminated allocation" {
    const value = [_]u8{ 'd', 't', 's', 'x', 0 };
    try std.testing.expectEqual(@as(usize, 4), result_length(&value));
    const empty = [_]u8{0};
    try std.testing.expectEqual(@as(usize, 0), result_length(&empty));
}

test "context ABI failure initializes status and returns a freeable empty result" {
    const source = "export const count = 1";
    const invalid_json = "{";
    var length: u64 = 999;
    var status: u32 = 999;
    const result = process_source_with_context_v1(source.ptr, source.len, true, false, invalid_json.ptr, invalid_json.len, &length, &status);
    defer free_result(result, @intCast(length));
    try std.testing.expectEqual(@as(u32, 1), status);
    try std.testing.expectEqual(@as(u64, 0), length);
    try std.testing.expectEqual(@as(u8, 0), result[0]);
}

test "checked source ABI distinguishes unsupported flow from valid empty output" {
    const unsupported = "let value: number | undefined = 7; if (Math.random() > 0.5) { value = undefined; } export const alias = value;";
    for ([_][]const u8{ unsupported, "", "export const healthy: number = 1;" }, 0..) |source, index| {
        var length: u64 = 999;
        var status: u32 = 999;
        const result = process_source_checked_v1(source.ptr, source.len, true, false, &length, &status);
        defer free_result(result, @intCast(length));
        try std.testing.expectEqual(@as(u32, if (index == 0) 5 else 0), status);
        if (index < 2) {
            try std.testing.expectEqual(@as(u64, 0), length);
            try std.testing.expectEqual(@as(u8, 0), result[0]);
        } else {
            try std.testing.expectEqualStrings("export declare const healthy: number;", result[0..@intCast(length)]);
        }
    }
}

test "checked parallel batch ABI initializes every status and retains successful siblings" {
    const sources = [_][]const u8{
        "export const healthy: number = 1;",
        "let value: number | undefined = 7; if (Math.random() > 0.5) { value = undefined; } export const alias = value;",
        "",
    };
    const inputs = [_][*]const u8{ sources[0].ptr, sources[1].ptr, sources[2].ptr };
    const lengths = [_]u64{ sources[0].len, sources[1].len, sources[2].len };
    for ([_]u32{ 1, 2, 4 }) |threads| {
        var pointers: [3]usize = undefined;
        var output_lengths: [3]u64 = undefined;
        var statuses: [3]u32 = undefined;
        process_batch_checked_v1(&inputs, &lengths, 3, true, &pointers, &output_lengths, threads, &statuses);
        defer free_batch_results(&pointers, &output_lengths, 3);
        try std.testing.expectEqualSlices(u32, &.{ 0, 5, 0 }, &statuses);
        const healthy: [*]const u8 = @ptrFromInt(pointers[0]);
        try std.testing.expectEqualStrings("export declare const healthy: number;", healthy[0..@intCast(output_lengths[0])]);
        try std.testing.expectEqualSlices(u64, &.{ 0, 0 }, output_lengths[1..]);
        try std.testing.expect(pointers[1] != 0 and pointers[2] != 0);
    }
}

test "legacy source and batch ABI exports keep their allocation and result contracts" {
    const source = "export const healthy: number = 1;";
    const expected = "export declare const healthy: number;";
    const plain = process_source(source.ptr, source.len, true);
    defer free_result(plain, @intCast(result_length(plain)));
    try std.testing.expectEqualStrings(expected, plain[0..@intCast(result_length(plain))]);
    var length: u64 = 999;
    const counted = process_source_with_len(source.ptr, source.len, true, &length);
    defer free_result(counted, @intCast(length));
    try std.testing.expectEqualStrings(expected, counted[0..@intCast(length)]);
    const options = process_source_with_options(source.ptr, source.len, true, false);
    defer free_result(options, @intCast(result_length(options)));
    try std.testing.expectEqualStrings(expected, options[0..@intCast(result_length(options))]);
    var options_length: u64 = 999;
    const counted_options = process_source_with_options_len(source.ptr, source.len, true, false, &options_length);
    defer free_result(counted_options, @intCast(options_length));
    try std.testing.expectEqualStrings(expected, counted_options[0..@intCast(options_length)]);
    const inputs = [_][*]const u8{source.ptr};
    const lengths = [_]u64{source.len};
    var pointers: [1]usize = undefined;
    var output_lengths: [1]u64 = undefined;
    process_batch(&inputs, &lengths, 1, true, &pointers, &output_lengths, 1);
    defer free_batch_results(&pointers, &output_lengths, 1);
    const batched: [*]const u8 = @ptrFromInt(pointers[0]);
    try std.testing.expectEqualStrings(expected, batched[0..@intCast(output_lengths[0])]);
}

test "processSourceInternal preserves nested JSX declarations end to end" {
    const source =
        \\export const Results = () => (
        \\  <List title="score > threshold" render={item => item.score > 0 ? <strong>{item.label}</strong> : <em>none</em>} />
        \\)
        \\export const resultCount = 2
    ;
    const result = try processSourceInternal(source.ptr, source.len, true, false);
    defer std.heap.c_allocator.free(@constCast(result.ptr)[0 .. result.len + 1]);
    const output = result.ptr[0..result.len];
    try std.testing.expect(std.mem.indexOf(u8, output, "Results: () => JSX.Element;") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "resultCount: 2;") != null);
}
