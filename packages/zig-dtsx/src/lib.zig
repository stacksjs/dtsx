/// C ABI exports for Bun FFI integration.
/// Provides process_source(+len variants), result_length, free_result.
const std = @import("std");
const Scanner = @import("scanner.zig").Scanner;
const emitter = @import("emitter.zig");

const ProcessResult = struct {
    ptr: [*]const u8,
    len: usize,
};

fn emptyResult() ProcessResult {
    const empty = std.heap.c_allocator.alloc(u8, 1) catch @panic("OOM");
    empty[0] = 0;
    return .{ .ptr = empty.ptr, .len = 0 };
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
    // Handle empty input
    if (len == 0) {
        const result = try std.heap.c_allocator.alloc(u8, 1);
        result[0] = 0;
        return .{ .ptr = result.ptr, .len = 0 };
    }

    const source = input[0..len];

    // Reuse thread-local arena — reset frees all allocations but keeps backing pages
    const arena = getOrInitArena();
    _ = arena.reset(.retain_capacity);
    const arena_alloc = arena.allocator();

    // Scan
    var scanner = Scanner.init(arena_alloc, source, keep_comments, isolated_declarations);
    _ = try scanner.scan();

    // Emit — result buffer uses c_allocator directly so it survives arena.reset().
    // processDeclarations appends '\0' before toOwnedSlice, so the result is
    // already null-terminated with no extra copy needed.
    const default_import_order = [_][]const u8{"bun"};
    const dts_output = try emitter.processDeclarations(
        arena_alloc,
        std.heap.c_allocator,
        scanner.declarations.items,
        source,
        keep_comments,
        &default_import_order,
    );

    // dts_output[0..len] is content, dts_output.ptr[len] == 0 (null terminator)
    return .{ .ptr = dts_output.ptr, .len = dts_output.len };
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
};

fn batchWorker(tasks: []const BatchTask) void {
    for (tasks) |task| {
        const result = processSourceInternal(task.input, task.input_len, task.keep_comments, false) catch {
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
    const n: usize = @intCast(count);
    if (n == 0) return;

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
        };
    }

    // Determine thread count
    const max_threads: usize = if (thread_count > 0)
        @intCast(thread_count)
    else
        @intCast(std.Thread.getCpuCount() catch 4);
    const num_threads = @min(max_threads, n);

    if (num_threads <= 1) {
        // Single-threaded: process all sequentially
        batchWorker(tasks);
        return;
    }

    // Distribute tasks across threads
    const threads = std.heap.c_allocator.alloc(std.Thread, num_threads) catch {
        // Fallback to single-threaded
        batchWorker(tasks);
        return;
    };
    defer std.heap.c_allocator.free(threads);

    const chunk_size = (n + num_threads - 1) / num_threads;
    var thread_spawned: [64]bool = .{false} ** 64; // max 64 threads

    for (0..num_threads) |t| {
        const start = t * chunk_size;
        if (start >= n) break;
        const end = @min(start + chunk_size, n);
        threads[t] = std.Thread.spawn(.{}, batchWorker, .{tasks[start..end]}) catch {
            // If spawn fails, process this chunk on the main thread immediately
            batchWorker(tasks[start..end]);
            continue;
        };
        thread_spawned[t] = true;
    }

    // Join all successfully spawned threads
    for (0..num_threads) |t| {
        if (thread_spawned[t]) {
            threads[t].join();
        }
    }
}

/// Free multiple results from a batch call.
export fn free_batch_results(ptrs: [*]const usize, lens: [*]const u64, count: u32) void {
    const n: usize = @intCast(count);
    for (0..n) |i| {
        const p: [*]u8 = @ptrFromInt(ptrs[i]);
        const l: usize = @intCast(lens[i]);
        std.heap.c_allocator.free(p[0 .. l + 1]); // +1 for null terminator
    }
}
