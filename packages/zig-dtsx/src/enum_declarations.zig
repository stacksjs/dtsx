const std = @import("std");
const types = @import("types.zig");
const syntax = @import("module_specifiers.zig");
const expressions = @import("computed_keys.zig");
const Allocator = std.mem.Allocator;
const Constants = types.KeyConstants;
const Constant = types.KeyConstant;
const Error = syntax.SyntaxError;

fn literal(allocator: Allocator, value: Constant) Error![]const u8 {
    return switch (value) {
        .text => |text| syntax.quoteStringLiteral(allocator, text, '\''),
        .number => |number| expressions.numberText(allocator, number),
        .symbol => error.InvalidContext,
    };
}

/// Source runtime values have no initializer in an ambient numeric enum.
/// `outer` retains source constants and gains qualified enum member constants.
/// The caller owns all returned text and constant storage through `allocator`.
pub fn lowerEnumBody(allocator: Allocator, body: []const u8, name: []const u8, outer: *Constants) Error![]const u8 {
    const tokens = try syntax.tokenizeDeclarationSyntax(allocator, body);
    defer allocator.free(tokens);
    var constants = try outer.clone();
    defer constants.deinit();
    var output = std.array_list.Managed(u8).init(allocator);
    errdefer output.deinit();
    var cursor: usize = 0;
    var start: usize = 1;
    var depth: isize = 0;
    var next: ?f64 = 0;
    var index: usize = 1;
    while (index < tokens.len) : (index += 1) {
        const token = tokens[index];
        const text = body[token.start..token.end];
        if (token.kind == .punctuation and depth == 0 and (std.mem.eql(u8, text, ",") or std.mem.eql(u8, text, "}"))) {
            const entry = tokens[start..index];
            if (entry.len > 0) {
                const key = entry[0];
                const member_name = if (key.kind == .quoted) try syntax.decodeStringLiteral(allocator, body[key.start..key.end]) else body[key.start..key.end];
                var equals: ?usize = null;
                for (entry, 0..) |item, i| {
                    if (item.kind == .punctuation and body[item.start] == '=') {
                        equals = i;
                        break;
                    }
                }
                var value: ?Constant = if (next) |number| .{ .number = number } else null;
                if (equals) |eq| {
                    var rewritten = std.array_list.Managed(u8).init(allocator);
                    defer rewritten.deinit();
                    var position = entry[eq].end;
                    var i = eq + 1;
                    while (i + 2 < entry.len) : (i += 1) {
                        const left = entry[i];
                        const dot = entry[i + 1];
                        const right = entry[i + 2];
                        if (left.kind != .word or right.kind != .word or !std.mem.eql(u8, body[dot.start..dot.end], ".")) continue;
                        const qualified = try std.fmt.allocPrint(allocator, "{s}.{s}", .{ body[left.start..left.end], body[right.start..right.end] });
                        const binding = constants.get(qualified) orelse continue;
                        if (binding == .symbol) continue;
                        try rewritten.appendSlice(body[position..left.start]);
                        try rewritten.appendSlice(try literal(allocator, binding));
                        position = right.end;
                        i += 2;
                    }
                    try rewritten.appendSlice(body[position..entry[entry.len - 1].end]);
                    value = try expressions.evaluate(allocator, rewritten.items, &constants, 0);
                    try output.appendSlice(body[cursor..entry[eq].start]);
                    if (value) |known| {
                        try output.appendSlice("= ");
                        try output.appendSlice(try literal(allocator, known));
                    }
                    cursor = entry[entry.len - 1].end;
                } else if (value) |known| {
                    try output.appendSlice(body[cursor..key.end]);
                    try output.appendSlice(" = ");
                    try output.appendSlice(try literal(allocator, known));
                    cursor = key.end;
                }
                next = if (value != null and value.? == .number) value.?.number + 1 else null;
                const qualified = try std.fmt.allocPrint(allocator, "{s}.{s}", .{ name, member_name });
                _ = constants.remove(member_name);
                _ = constants.remove(qualified);
                if (value) |known| {
                    try constants.put(member_name, known);
                    try constants.put(qualified, known);
                    try outer.put(qualified, known);
                } else _ = outer.remove(qualified);
            }
            start = index + 1;
        } else if (token.kind == .punctuation) {
            if (std.mem.indexOf(u8, "([{", text) != null) depth += 1 else if (std.mem.indexOf(u8, ")]}", text) != null) depth -= 1;
        }
    }
    try output.appendSlice(body[cursor..]);
    return output.toOwnedSlice();
}

fn sourceOrder(_: void, left: *types.Declaration, right: *types.Declaration) bool {
    return left.start < right.start;
}

pub fn attach(allocator: Allocator, declarations: []types.Declaration, candidates: *std.StringHashMap(types.Declaration)) Error!void {
    var ordered = std.array_list.Managed(*types.Declaration).init(allocator);
    defer ordered.deinit();
    var needed = false;
    for (declarations) |*entry| {
        try ordered.append(entry);
        if (entry.kind == .enum_decl) needed = true;
    }
    var iterator = candidates.valueIterator();
    while (iterator.next()) |entry| {
        try ordered.append(entry);
        if (entry.kind == .enum_decl) needed = true;
    }
    if (!needed) return;
    std.mem.sort(*types.Declaration, ordered.items, {}, sourceOrder);
    var constants = Constants.init(allocator);
    defer constants.deinit();
    for (ordered.items) |entry| {
        if (entry.kind == .enum_decl) {
            const start = std.mem.indexOfScalar(u8, entry.text, '{') orelse continue;
            const prefix = try syntax.tokenizeDeclarationSyntax(allocator, entry.text[0..start]);
            defer allocator.free(prefix);
            var ambient = false;
            for (prefix) |token| {
                if (std.mem.eql(u8, entry.text[token.start..token.end], "declare")) ambient = true;
            }
            if (ambient) continue;
            const body = try lowerEnumBody(allocator, entry.text[start..], entry.name, &constants);
            defer allocator.free(body);
            entry.text = try std.fmt.allocPrint(allocator, "{s}{s}", .{ entry.text[0..start], body });
        } else if (entry.kind == .variable_decl and entry.value.len > 0 and entry.type_annotation.len == 0) {
            const modifiers = entry.modifiers orelse continue;
            if (modifiers.len != 1 or !std.mem.eql(u8, modifiers[0], "const")) continue;
            if (try expressions.evaluate(allocator, entry.value, &constants, 0)) |value| try constants.put(entry.name, value);
        }
    }
}

fn vectorControl(backing: Allocator) !void {
    var arena = std.heap.ArenaAllocator.init(backing);
    defer arena.deinit();
    const allocator = arena.allocator();
    const Binding = struct { name: []const u8, number: ?f64 = null, text: ?[]const u8 = null };
    const Vector = struct { input: []const u8, expected: []const u8, constants: []const Binding = &.{} };
    const parsed = try std.json.parseFromSlice([]const Vector, allocator, @embedFile("fixtures/enum-declarations.json"), .{});
    for (parsed.value) |vector| {
        var constants = Constants.init(allocator);
        for (vector.constants) |binding| {
            try constants.put(binding.name, if (binding.number) |number| .{ .number = number } else .{ .text = binding.text.? });
        }
        const output = try lowerEnumBody(allocator, vector.input, "E", &constants);
        try std.testing.expectEqualStrings(vector.expected, output);
    }
}

test "enum declaration lowering matches shared grammar vectors" {
    try vectorControl(std.testing.allocator);
}

test "enum lowering propagates every allocation failure" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, vectorControl, .{});
}
