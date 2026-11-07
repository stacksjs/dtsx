const std = @import("std");
const types = @import("types.zig");
const syntax = @import("module_specifiers.zig");
const inference = @import("type_inference.zig");
const Allocator = std.mem.Allocator;
const Declaration = types.Declaration;
const TypeList = std.array_list.Managed([]const u8);
const Members = std.StringHashMap(TypeList);

fn text(source: []const u8, tokens: []const syntax.SyntaxToken, index: usize) []const u8 {
    return if (index < tokens.len) source[tokens[index].start..tokens[index].end] else "";
}
fn is(value: []const u8, expected: []const u8) bool {
    return std.mem.eql(u8, value, expected);
}
fn opens(value: []const u8) bool {
    return is(value, "(") or is(value, "[") or is(value, "{");
}
fn closes(value: []const u8) bool {
    return is(value, ")") or is(value, "]") or is(value, "}");
}

/// Preserve source expando assignments by merging a namespace into its function.
/// Temporary maps and emitted text are owned by the source's arena.
pub fn attach(allocator: Allocator, source: []const u8, declarations: []Declaration, candidates: *std.StringHashMap(Declaration), groups: *const std.StringHashMapUnmanaged(std.array_list.Managed(Declaration))) !void {
    var overloaded = std.StringHashMap(void).init(allocator);
    defer overloaded.deinit();
    var counts = std.StringHashMap(usize).init(allocator);
    defer counts.deinit();
    for (declarations) |declaration| if (declaration.kind == .function_decl) {
        const count = (counts.get(declaration.name) orelse 0) + 1;
        try counts.put(declaration.name, count);
        if (count > 1) try overloaded.put(declaration.name, {});
    };
    var group_counts = groups.iterator();
    while (group_counts.next()) |group| if (group.value_ptr.items.len > 1) {
        try overloaded.put(group.key_ptr.*, {});
    };
    var bindings = std.StringHashMap(*Declaration).init(allocator);
    defer bindings.deinit();
    for (declarations) |*declaration| try bindings.put(declaration.name, declaration);
    var values = candidates.valueIterator();
    while (values.next()) |declaration| try bindings.put(declaration.name, declaration);
    var functions = std.StringHashMap(*Declaration).init(allocator);
    defer functions.deinit();
    for (declarations) |*declaration| if (declaration.kind == .function_decl and !functions.contains(declaration.name)) {
        try functions.put(declaration.name, declaration);
    };
    var private = candidates.valueIterator();
    while (private.next()) |declaration| if (declaration.kind == .function_decl and !functions.contains(declaration.name)) {
        try functions.put(declaration.name, declaration);
    };
    var overloads = groups.iterator();
    while (overloads.next()) |group| if (group.value_ptr.items.len > 0) {
        try functions.put(group.key_ptr.*, &group.value_ptr.items[0]);
    };
    if (functions.count() == 0) return;
    const tokens = try syntax.tokenizeDeclarationSyntax(allocator, source);
    defer allocator.free(tokens);
    var properties = std.StringHashMap(Members).init(allocator);
    var depth: i32 = 0;
    var index: usize = 0;
    while (index < tokens.len) : (index += 1) {
        const word = text(source, tokens, index);
        if (opens(word)) {
            depth += 1;
            continue;
        }
        if (closes(word)) {
            depth -= 1;
            continue;
        }
        if (depth != 0 or !functions.contains(word) or !is(text(source, tokens, index + 1), ".") or index + 3 >= tokens.len or tokens[index + 2].kind != .word or !is(text(source, tokens, index + 3), "=")) continue;
        const property = text(source, tokens, index + 2);
        const start = index + 4;
        var end = start;
        var nesting: i32 = 0;
        while (end < tokens.len) : (end += 1) {
            const token = text(source, tokens, end);
            if (nesting == 0 and is(token, ";")) break;
            if (nesting == 0 and end > start and std.mem.indexOfAny(u8, source[tokens[end - 1].end..tokens[end].start], "\r\n") != null and
                (is(token, "export") or is(token, "const") or is(token, "let") or is(token, "var") or is(token, "function") or is(token, "class") or functions.contains(token) and is(text(source, tokens, end + 1), "."))) break;
            if (opens(token)) nesting += 1 else if (closes(token)) nesting -= 1;
        }
        if (end == start) continue;
        const inferred = try assignedType(allocator, source[tokens[start].start..tokens[end - 1].end], &bindings, &overloaded, 0);
        const function = try properties.getOrPut(word);
        if (!function.found_existing) function.value_ptr.* = Members.init(allocator);
        const member = try function.value_ptr.getOrPut(property);
        if (!member.found_existing) member.value_ptr.* = TypeList.init(allocator);
        var duplicate = false;
        for (member.value_ptr.items) |previous| if (is(previous, inferred)) {
            duplicate = true;
            break;
        };
        if (!duplicate) try member.value_ptr.append(inferred);
        index = end - 1;
    }
    var entries = properties.iterator();
    while (entries.next()) |entry| {
        const declaration = functions.get(entry.key_ptr.*).?;
        var result = std.array_list.Managed(u8).init(allocator);
        const original = if (declaration.is_default) try std.mem.replaceOwned(u8, allocator, declaration.text, "export default function ", "declare function ") else declaration.text;
        try result.appendSlice(original);
        try result.appendSlice(if (declaration.is_exported and !declaration.is_default) "\nexport declare namespace " else "\ndeclare namespace ");
        try result.appendSlice(entry.key_ptr.*);
        try result.appendSlice(" {\n");
        var members = entry.value_ptr.iterator();
        while (members.next()) |member| {
            try result.appendSlice("  let ");
            try result.appendSlice(member.key_ptr.*);
            try result.appendSlice(": ");
            for (member.value_ptr.items, 0..) |value_type, i| {
                if (i > 0) try result.appendSlice(" | ");
                const parenthesize = member.value_ptr.items.len > 1 and std.mem.indexOf(u8, value_type, "=>") != null;
                if (parenthesize) try result.append('(');
                try result.appendSlice(value_type);
                if (parenthesize) try result.append(')');
            }
            try result.appendSlice(";\n");
        }
        try result.append('}');
        if (declaration.is_default) {
            try result.appendSlice("\nexport default ");
            try result.appendSlice(entry.key_ptr.*);
            try result.append(';');
        }
        declaration.text = try result.toOwnedSlice();
    }
}

fn checkAllocations(backing: Allocator) !void {
    var arena = std.heap.ArenaAllocator.init(backing);
    defer arena.deinit();
    const allocator = arena.allocator();
    var declarations = [_]Declaration{.{ .kind = .function_decl, .name = "read", .text = "export declare function read(): number;", .is_exported = true }};
    var candidates = std.StringHashMap(Declaration).init(allocator);
    try candidates.put("version", .{ .kind = .variable_decl, .name = "version", .value = "'ready'" });
    try candidates.put("makeVersion", .{ .kind = .function_decl, .name = "makeVersion", .text = "declare function makeVersion(): string;" });
    var groups: std.StringHashMapUnmanaged(std.array_list.Managed(Declaration)) = .empty;
    try attach(allocator, "export function read(): number { return 7 } read.version = version; read.value = makeVersion(); read.reset = (value: number): number => value;", &declarations, &candidates, &groups);
    try std.testing.expect(std.mem.indexOf(u8, declarations[0].text, "export declare namespace read") != null);
    try std.testing.expect(std.mem.indexOf(u8, declarations[0].text, "let version: string;") != null);
    try std.testing.expect(std.mem.indexOf(u8, declarations[0].text, "let reset:") != null);
    try std.testing.expect(std.mem.indexOf(u8, declarations[0].text, "ReturnType<typeof makeVersion>") != null);
}

test "function properties propagate backing allocation failures" {
    try checkAllocations(std.testing.allocator);
    try std.testing.checkAllAllocationFailures(std.testing.allocator, checkAllocations, .{});
}

fn assignedType(allocator: Allocator, expression: []const u8, bindings: *const std.StringHashMap(*Declaration), overloaded: *const std.StringHashMap(void), depth: usize) ![]const u8 {
    const value = std.mem.trim(u8, expression, " \t\r\n");
    if (bindings.get(value)) |binding| {
        if (binding.kind == .variable_decl and depth < 64) {
            if (binding.type_annotation.len > 0) return if (is(binding.type_annotation, "unique symbol")) std.fmt.allocPrint(allocator, "typeof {s}", .{value}) else binding.type_annotation;
            if (binding.value.len > 0) return assignedType(allocator, binding.value, bindings, overloaded, depth + 1);
        }
    }
    const inferred = try inference.inferNarrowType(allocator, value, false, false, 0);
    if (!is(inferred, "unknown")) return inferred;
    const tokens = try syntax.tokenizeDeclarationSyntax(allocator, value);
    defer allocator.free(tokens);
    if (tokens.len >= 3 and tokens[0].kind == .word and is(text(value, tokens, 1), "(") and value[value.len - 1] == ')') {
        var nesting: usize = 0;
        var closing: ?usize = null;
        for (tokens[1..], 1..) |_, index| {
            const token = text(value, tokens, index);
            if (is(token, "(")) nesting += 1 else if (is(token, ")")) {
                nesting -= 1;
                if (nesting == 0) {
                    closing = index;
                    break;
                }
            }
        }
        if (closing == null or closing.? != tokens.len - 1) return inferred;
        const name = text(value, tokens, 0);
        if (bindings.get(name)) |callee| {
            if (callee.kind == .function_decl and callee.generics.len == 0 and !overloaded.contains(name)) return std.fmt.allocPrint(allocator, "ReturnType<typeof {s}>", .{name});
        }
    }
    if (tokens.len == 1 and tokens[0].kind == .word) return std.fmt.allocPrint(allocator, "typeof {s}", .{value});
    return inferred;
}
