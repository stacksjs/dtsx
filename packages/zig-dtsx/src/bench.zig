/// Profiling harness: repeatedly scans + emits one file in-process so a sampling
/// profiler (e.g. `sample`, `perf`) sees only declaration work.
/// Usage: zig build bench -Doptimize=ReleaseFast && ./zig-out/bin/zig-dtsx-bench <file.ts> [iterations] [--isolated|--lex]
const std = @import("std");
const Scanner = @import("scanner.zig").Scanner;
const emitter = @import("emitter.zig");

extern "c" fn fopen(path: [*:0]const u8, mode: [*:0]const u8) ?*anyopaque;
extern "c" fn fread(ptr: [*]u8, size: usize, nmemb: usize, stream: *anyopaque) usize;
extern "c" fn fclose(stream: *anyopaque) c_int;
extern "c" fn printf(fmt: [*:0]const u8, ...) c_int;
extern "c" fn clock_gettime(clk: c_int, ts: *[2]c_long) c_int;

/// CLOCK_PROCESS_CPUTIME_ID: 12 on Darwin, 2 on Linux. CPU time, not wall
/// time, so a busy machine does not distort the per-iteration figure.
const cpu_clock: c_int = if (@import("builtin").os.tag.isDarwin()) 12 else 2;

fn nowNs() u64 {
    var ts: [2]c_long = undefined;
    _ = clock_gettime(cpu_clock, &ts);
    return @as(u64, @intCast(ts[0])) * 1_000_000_000 + @as(u64, @intCast(ts[1]));
}

fn lexOnly(gpa: std.mem.Allocator, path: []const u8, iterations: usize) !void {
    const source = try readFile(gpa, path);
    var arena = std.heap.ArenaAllocator.init(gpa);
    var found = false;
    var start = nowNs();
    for (0..iterations) |_| found = try @import("declaration_references.zig").isExternalModuleSource(arena.allocator(), source);
    const detect = nowNs() - start;
    var count: usize = 0;
    start = nowNs();
    for (0..iterations) |_| {
        _ = arena.reset(.retain_capacity);
        count = (try @import("module_specifiers.zig").tokenizeDeclarationSyntax(arena.allocator(), source)).len;
    }
    const tok = nowNs() - start;
    _ = printf("module=%d detect %.2f us, tokens(%zu) %.2f us\n", @as(c_int, @intFromBool(found)), @as(f64, @floatFromInt(detect)) / @as(f64, @floatFromInt(iterations)) / 1000.0, count, @as(f64, @floatFromInt(tok)) / @as(f64, @floatFromInt(iterations)) / 1000.0);
}

fn readFile(gpa: std.mem.Allocator, path: []const u8) ![]const u8 {
    const path_z = try gpa.dupeSentinel(u8, path, 0);
    const file = fopen(path_z.ptr, "rb") orelse return error.OpenFailed;
    const buf = try gpa.alloc(u8, 16 * 1024 * 1024);
    const len = fread(buf.ptr, 1, buf.len, file);
    _ = fclose(file);
    return buf[0..len];
}

pub fn main(init: std.process.Init.Minimal) !void {
    const gpa = std.heap.c_allocator;
    var args = init.args.iterate();
    defer args.deinit();
    _ = args.next();
    const path = args.next() orelse return error.MissingFile;
    const iterations = if (args.next()) |n| try std.fmt.parseInt(usize, n, 10) else 2000;
    const mode = args.next() orelse "";
    const isolated = std.mem.eql(u8, mode, "--isolated");
    if (std.mem.eql(u8, mode, "--lex")) return lexOnly(gpa, path, iterations);

    const source = try readFile(gpa, path);
    const len = source.len;

    var arena = std.heap.ArenaAllocator.init(gpa);
    const order = [_][]const u8{"bun"};
    var out_len: usize = 0;
    const start = nowNs();
    for (0..iterations) |_| {
        _ = arena.reset(.retain_capacity);
        const a = arena.allocator();
        var scanner = Scanner.init(a, source, true, isolated);
        _ = try scanner.scan();
        const out = try emitter.processScannedDeclarations(a, gpa, scanner.declarations.items, source, true, &order, null, .{ .external_module = scanner.external_module });
        out_len = out.len;
        gpa.free(@constCast(out.ptr)[0 .. out.len + 1]);
    }
    const elapsed = nowNs() - start;
    _ = printf("%zu bytes in, %zu bytes out, %.2f us/iter\n", len, out_len, @as(f64, @floatFromInt(elapsed)) / @as(f64, @floatFromInt(iterations)) / 1000.0);
}
