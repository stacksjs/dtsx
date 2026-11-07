//! Native project augmentation activation. Source-only emission stays independent.
const std = @import("std");
const builtin = @import("builtin");
const Scanner = @import("scanner.zig").Scanner;
const emitter = @import("emitter.zig");
const modules = @import("module_specifiers.zig");

pub const File = struct {
    /// Absolute source identity, with the native path separator.
    path: []const u8,
    source: []const u8,
};
const Edge = struct { target: usize, specifier: []const u8, is_import: bool };
const Node = struct {
    edges: std.array_list.Managed(Edge),
    visible: std.array_list.Managed(usize),
    augmented: std.array_list.Managed(usize),
    required: std.array_list.Managed([]const u8),
};

fn key(allocator: std.mem.Allocator, path: []const u8) ![]const u8 {
    const value = try std.fs.path.resolveAlloc(allocator, &.{path});
    if (builtin.os.tag == .windows) for (value) |*byte| {
        byte.* = std.ascii.toLower(byte.*);
    };
    return value;
}

fn resolve(allocator: std.mem.Allocator, paths: *const std.StringHashMap(usize), from: []const u8, specifier: []const u8) !?usize {
    if (!std.mem.startsWith(u8, specifier, ".") and !std.fs.path.isAbsolute(specifier)) return null;
    const end = std.mem.indexOfAny(u8, specifier, "?#") orelse specifier.len;
    const candidate = try std.fs.path.resolveAlloc(allocator, &.{ std.fs.path.dirname(from) orelse "", specifier[0..end] });
    if (paths.get(try key(allocator, candidate))) |index| return index;
    if (std.mem.endsWith(u8, candidate, ".js")) {
        const source = try std.fmt.allocPrint(allocator, "{s}.ts", .{candidate[0 .. candidate.len - 3]});
        if (paths.get(try key(allocator, source))) |index| return index;
    }
    for ([_][]const u8{ ".ts", "/index.ts" }) |suffix| {
        const source = try std.fmt.allocPrint(allocator, "{s}{s}", .{ candidate, suffix });
        if (paths.get(try key(allocator, source))) |index| return index;
    }
    return null;
}

fn addUnique(list: *std.array_list.Managed(usize), value: usize) !bool {
    if (std.mem.indexOfScalar(usize, list.items, value) != null) return false;
    try list.append(value);
    return true;
}

fn requireImport(node: *Node, specifier: []const u8) !void {
    for (node.required.items) |existing| if (std.mem.eql(u8, existing, specifier)) return;
    try node.required.append(specifier);
}

pub fn free(allocator: std.mem.Allocator, required: [][][]const u8) void {
    for (required) |specifiers| {
        for (specifiers) |specifier| allocator.free(specifier);
        allocator.free(specifiers);
    }
    allocator.free(required);
}

/// Output owns its strings and slices. All graph work is temporary; storage is
/// linear in sources/edges, not a permanent source-by-source reachability matrix.
pub const Options = struct { isolated_declarations: bool = false, failure_file: ?*?[]const u8 = null };

pub fn plan(allocator: std.mem.Allocator, files: []const File, options: Options) ![][][]const u8 {
    var failed_source: ?[]const u8 = null;
    errdefer if (options.failure_file) |failure| {
        failure.* = failed_source;
    };
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var paths = std.StringHashMap(usize).init(a);
    const nodes = try a.alloc(Node, files.len);
    const references = try a.alloc([]const modules.ModuleReference, files.len);
    for (files, 0..) |file, index| {
        failed_source = file.path;
        try paths.put(try key(a, file.path), index);
        nodes[index] = .{ .edges = .init(a), .visible = .init(a), .augmented = .init(a), .required = .init(a) };
        references[index] = if (std.mem.indexOf(u8, file.source, "declare") != null and std.mem.indexOf(u8, file.source, "module") != null)
            try modules.collectModuleReferences(a, file.source)
        else
            &.{};
    }
    var has_augmentation = false;
    for (files, 0..) |file, index| {
        failed_source = file.path;
        for (references[index]) |reference| {
            if (reference.kind != .augmentation) continue;
            if (try resolve(a, &paths, file.path, reference.specifier)) |target| {
                _ = try addUnique(&nodes[index].augmented, target);
                _ = try addUnique(&nodes[index].visible, target);
                has_augmentation = true;
            }
        }
    }
    if (has_augmentation) {
        for (files, 0..) |file, index| {
            failed_source = file.path;
            if (references[index].len == 0) references[index] = try modules.collectModuleReferences(a, file.source);
            for (references[index]) |reference| {
                if (reference.kind != .static_import and reference.kind != .re_export) continue;
                if (try resolve(a, &paths, file.path, reference.specifier)) |target| {
                    try nodes[index].edges.append(.{ .target = target, .specifier = reference.specifier, .is_import = reference.kind == .static_import });
                }
            }
            // Actual native pruning determines declaration-visible identities.
            // This is not TypeScript emission and does not publish any output.
            var scanner = Scanner.init(a, file.source, false, options.isolated_declarations);
            _ = try scanner.scan();
            const import_order = [_][]const u8{"bun"};
            const declarations = try emitter.processDeclarations(a, a, scanner.declarations.items, file.source, false, &import_order);
            const emitted = try modules.collectModuleReferences(a, declarations);
            for (emitted) |reference| {
                if (try resolve(a, &paths, file.path, reference.specifier)) |target| {
                    _ = try addUnique(&nodes[index].visible, target);
                    if (reference.kind == .import_type or reference.kind == .augmentation) {
                        try nodes[index].edges.append(.{ .target = target, .specifier = reference.specifier, .is_import = false });
                    }
                }
            }
        }
        const visible = try a.alloc(bool, files.len);
        const Parent = struct { from: usize, edge: usize };
        const parents = try a.alloc(?Parent, files.len);
        var pending = std.array_list.Managed(usize).init(a);
        var changed = true;
        while (changed) {
            changed = false;
            for (0..files.len) |start| {
                @memset(visible, false);
                visible[start] = true;
                pending.clearRetainingCapacity();
                try pending.append(start);
                var cursor: usize = 0;
                while (cursor < pending.items.len) : (cursor += 1) {
                    for (nodes[pending.items[cursor]].visible.items) |target| {
                        if (visible[target]) continue;
                        visible[target] = true;
                        try pending.append(target);
                    }
                }
                for (nodes, 0..) |provider, provider_index| {
                    if (visible[provider_index]) continue;
                    var relevant = false;
                    for (provider.augmented.items) |target| if (visible[target]) {
                        relevant = true;
                        break;
                    };
                    if (!relevant) continue;
                    @memset(parents, null);
                    parents[start] = .{ .from = start, .edge = 0 };
                    pending.clearRetainingCapacity();
                    try pending.append(start);
                    cursor = 0;
                    while (cursor < pending.items.len and parents[provider_index] == null) : (cursor += 1) {
                        const current = pending.items[cursor];
                        for (nodes[current].edges.items, 0..) |edge, edge_index| {
                            if (parents[edge.target] != null) continue;
                            parents[edge.target] = .{ .from = current, .edge = edge_index };
                            try pending.append(edge.target);
                        }
                    }
                    if (parents[provider_index] == null) continue;
                    var target = provider_index;
                    while (target != start) {
                        const parent = parents[target].?;
                        const edge = nodes[parent.from].edges.items[parent.edge];
                        if (edge.is_import) try requireImport(&nodes[parent.from], edge.specifier);
                        if (try addUnique(&nodes[parent.from].visible, target)) changed = true;
                        target = parent.from;
                    }
                }
            }
        }
    }
    failed_source = null;
    const output = try allocator.alloc([][]const u8, files.len);
    var copied: usize = 0;
    errdefer {
        for (output[0..copied]) |specifiers| {
            for (specifiers) |specifier| allocator.free(specifier);
            allocator.free(specifiers);
        }
        allocator.free(output);
    }
    for (nodes, 0..) |node, index| {
        const specifiers = try allocator.alloc([]const u8, node.required.items.len);
        var strings: usize = 0;
        errdefer {
            for (specifiers[0..strings]) |specifier| allocator.free(specifier);
            allocator.free(specifiers);
        }
        for (node.required.items, 0..) |specifier, item| {
            specifiers[item] = try allocator.dupe(u8, specifier);
            strings += 1;
        }
        output[index] = specifiers;
        copied += 1;
    }
    return output;
}

fn checkPlanAllocations(allocator: std.mem.Allocator) !void {
    const files = [_]File{
        .{ .path = "/src/index.ts", .source = "import { unrelated } from './cycle.js'; import { install } from './bridge.js'; export class ParentThing implements ParentThing {} install(ParentThing.prototype); unrelated();" },
        .{ .path = "/src/bridge.ts", .source = "import type { ParentThing } from './index.js'; import { install as apply } from './nested/provider.js'; export function install(target: ParentThing): void { apply(target) }" },
        .{ .path = "/src/nested/provider.ts", .source = "import type { ParentThing } from '../index.js'; declare module '../index.js' { interface ParentThing { add: (a: number, b: number) => number } } export function install(target: ParentThing): void { target.add = (a: number, b: number) => a + b }" },
        .{ .path = "/src/cycle.ts", .source = "import type { ParentThing } from './index.js'; export function unrelated(value?: ParentThing): void { void value }" },
    };
    const required = try plan(allocator, &files, .{});
    defer free(allocator, required);
    try std.testing.expectEqual(@as(usize, 1), required[0].len);
    try std.testing.expectEqualStrings("./bridge.js", required[0][0]);
    try std.testing.expectEqual(@as(usize, 1), required[1].len);
    try std.testing.expectEqualStrings("./nested/provider.js", required[1][0]);
    try std.testing.expectEqual(@as(usize, 0), required[2].len);
    try std.testing.expectEqual(@as(usize, 0), required[3].len);
}

test "native activation chooses the shortest original path without unrelated cycle imports" {
    try checkPlanAllocations(std.testing.allocator);
}

test "native project graph propagates every allocation failure without leaking" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, checkPlanAllocations, .{});
}
