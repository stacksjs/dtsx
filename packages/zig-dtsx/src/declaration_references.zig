//! Value references of private function candidates, separate from type names.
const std = @import("std");
const syntax = @import("module_specifiers.zig");
const Declaration = @import("types.zig").Declaration;
const Token = syntax.SyntaxToken;

pub fn directConstValueAlias(allocator: std.mem.Allocator, value: []const u8) !?[]const u8 {
    const items = try syntax.tokenizeDeclarationSyntax(allocator, value);
    defer allocator.free(items);
    if (items.len != 1 or items[0].kind != .word) return null;
    const name = value[items[0].start..items[0].end];
    return if (oneOf(name, &.{ "true", "false", "null", "undefined", "this", "super" })) null else name;
}

pub fn returnTypeExpectsObject(allocator: std.mem.Allocator, prefix: []const u8) syntax.SyntaxError!bool {
    const items = try syntax.tokenizeDeclarationSyntax(allocator, prefix);
    defer allocator.free(items);
    if (items.len == 0) return true;
    const last = text(prefix, items, items.len - 1);
    if (items[items.len - 1].kind == .word and oneOf(last, &.{ "is", "extends" })) return true;
    return oneOf(last, &.{ "|", "&" }) or (std.mem.eql(u8, last, ">") and items.len >= 2 and eq(prefix, items, items.len - 2, "="));
}

fn text(source: []const u8, items: []const Token, index: usize) []const u8 {
    return if (index < items.len) source[items[index].start..items[index].end] else "";
}

fn eq(source: []const u8, items: []const Token, index: usize, value: []const u8) bool {
    return std.mem.eql(u8, text(source, items, index), value);
}

pub fn isExternalModuleSource(allocator: std.mem.Allocator, source: []const u8) !bool {
    const items = try syntax.tokenizeDeclarationSyntax(allocator, source);
    defer allocator.free(items);
    var depth: usize = 0;
    for (items, 0..) |token, i| {
        if (depth == 0 and token.kind == .word and (eq(source, items, i, "export") or
            (eq(source, items, i, "import") and !eq(source, items, i + 1, "(") and !eq(source, items, i + 1, ".")))) return true;
        if (eq(source, items, i, "{") or eq(source, items, i, "(") or eq(source, items, i, "[")) depth += 1 else if ((eq(source, items, i, "}") or eq(source, items, i, ")") or eq(source, items, i, "]")) and depth > 0) depth -= 1;
    }
    return false;
}

pub fn isPrivateImportableDeclaration(declaration: Declaration) bool {
    if (declaration.is_exported) return false;
    return switch (declaration.kind) {
        .function_decl, .variable_decl, .interface_decl, .type_decl, .class_decl, .enum_decl, .namespace_decl => true,
        .module_decl => declaration.module_form == .namespace or declaration.module_form == .identifier,
        else => false,
    };
}

const Scope = struct { start: usize, end: usize, names: std.StringHashMap(void) };

fn addReference(source: []const u8, items: []const Token, index: usize, scopes: []const Scope, references: *std.StringHashMap(void)) !void {
    if (index >= items.len or items[index].kind != .word) return;
    const name = text(source, items, index);
    for (scopes) |scope| {
        if (index >= scope.start and index < scope.end and scope.names.contains(name)) return;
    }
    try references.put(name, {});
}

fn oneOf(value: []const u8, values: []const []const u8) bool {
    for (values) |candidate| if (std.mem.eql(u8, value, candidate)) return true;
    return false;
}

fn expressionReferences(source: []const u8, items: []const Token, start: usize, end: usize, pairs: *const std.AutoHashMap(usize, usize), scopes: []const Scope, references: *std.StringHashMap(void)) !void {
    var i = start;
    while (i < end) : (i += 1) {
        if (eq(source, items, i, "<")) {
            if (pairs.get(i)) |close| {
                i = close;
                continue;
            }
        }
        if (items[i].kind != .word or (i > 0 and eq(source, items, i - 1, ".")) or eq(source, items, i + 1, ":")) continue;
        if (oneOf(text(source, items, i), &.{ "true", "false", "null", "undefined", "new", "this", "super", "as", "satisfies", "typeof", "void", "keyof" })) continue;
        try addReference(source, items, i, scopes, references);
    }
}

pub fn collectValueReferences(allocator: std.mem.Allocator, declaration: Declaration, references: *std.StringHashMap(void)) !void {
    const source = declaration.text;
    const items = try syntax.tokenizeDeclarationSyntax(allocator, source);
    defer allocator.free(items);
    var pairs = std.AutoHashMap(usize, usize).init(allocator);
    defer pairs.deinit();
    var stack = std.array_list.Managed(usize).init(allocator);
    defer stack.deinit();
    for (items, 0..) |_, i| {
        const token = text(source, items, i);
        if (oneOf(token, &.{ "(", "[", "{", "<" })) try stack.append(i) else if ((oneOf(token, &.{ ")", "]", "}" }) or (std.mem.eql(u8, token, ">") and !eq(source, items, i -| 1, "="))) and stack.items.len > 0) {
            const open = stack.items[stack.items.len - 1];
            if ((eq(source, items, open, "(") and std.mem.eql(u8, token, ")")) or
                (eq(source, items, open, "[") and std.mem.eql(u8, token, "]")) or
                (eq(source, items, open, "{") and std.mem.eql(u8, token, "}")) or
                (eq(source, items, open, "<") and std.mem.eql(u8, token, ">")))
            {
                _ = stack.pop();
                try pairs.put(open, i);
            }
        }
    }

    var scopes = std.array_list.Managed(Scope).init(allocator);
    defer {
        for (scopes.items) |*scope| scope.names.deinit();
        scopes.deinit();
    }
    for (items, 0..) |_, open| {
        if (!eq(source, items, open, "(")) continue;
        const close = pairs.get(open) orelse continue;
        if (!eq(source, items, close + 1, ":") and !(eq(source, items, close + 1, "=") and eq(source, items, close + 2, ">"))) continue;
        var names = std.StringHashMap(void).init(allocator);
        errdefer names.deinit();
        var parameter = open + 1;
        while (parameter < close) {
            var end = parameter;
            while (end < close and !eq(source, items, end, ",")) {
                end = if (pairs.get(end)) |nested| nested + 1 else end + 1;
            }
            var binding_end = parameter;
            while (binding_end < end and !eq(source, items, binding_end, ":") and !eq(source, items, binding_end, "=")) {
                binding_end = if (pairs.get(binding_end)) |nested| nested + 1 else binding_end + 1;
            }
            var first = parameter;
            while (oneOf(text(source, items, first), &.{ ".", "public", "private", "protected", "readonly", "override" })) first += 1;
            if (first < items.len and items[first].kind == .word) try names.put(text(source, items, first), {});
            var i = parameter;
            while (i < binding_end) : (i += 1) {
                if (items[i].kind == .word and !eq(source, items, i + 1, ":") and
                    !oneOf(text(source, items, i), &.{ "public", "private", "protected", "readonly", "override" })) try names.put(text(source, items, i), {});
            }
            parameter = end + 1;
        }
        var end = close + @as(usize, if (eq(source, items, close + 1, ":")) 2 else 3);
        while (end < items.len) {
            if (oneOf(text(source, items, end), &.{ ";", ",", ")", "]", "}" }) or
                (eq(source, items, end, ">") and !eq(source, items, end -| 1, "="))) break;
            end = if (pairs.get(end)) |nested| nested + 1 else end + 1;
        }
        try scopes.append(.{ .start = open, .end = end, .names = names });
    }

    for (items, 0..) |_, i| {
        if (eq(source, items, i, "typeof")) try addReference(source, items, i + 1, scopes.items, references);
        if (eq(source, items, i, "export")) {
            var next = i + 1;
            if (eq(source, items, next, "default")) {
                if (!oneOf(text(source, items, next + 1), &.{ "function", "class", "abstract" }))
                    try expressionReferences(source, items, next + 1, items.len, &pairs, scopes.items, references);
                continue;
            }
            if (eq(source, items, next, "type")) next += 1;
            if (eq(source, items, next, "{")) {
                const close = pairs.get(next) orelse continue;
                if (eq(source, items, close + 1, "from")) continue;
                var item = next + 1;
                while (item < close) {
                    if (eq(source, items, item, "type") and item + 1 < items.len and items[item + 1].kind == .word and !eq(source, items, item + 1, "as")) item += 1;
                    try addReference(source, items, item, scopes.items, references);
                    while (item < close and !eq(source, items, item, ",")) item += 1;
                    item += 1;
                }
            }
        }
        if (eq(source, items, i, "[")) {
            if (pairs.get(i)) |close| {
                if (oneOf(text(source, items, close + 1), &.{ ":", "?", "(" }) and !eq(source, items, i + 2, ":") and !eq(source, items, i + 2, "in"))
                    try expressionReferences(source, items, i + 1, close, &pairs, scopes.items, references);
            }
        }
    }
    if (declaration.kind == .class_decl) {
        var i: usize = 0;
        while (i < items.len and !eq(source, items, i, "{")) : (i += 1) {
            if (eq(source, items, i, "<")) {
                if (pairs.get(i)) |close| {
                    i = close;
                    continue;
                }
            }
            if (!eq(source, items, i, "extends")) continue;
            var end = i + 1;
            while (end < items.len and !eq(source, items, end, "{") and !eq(source, items, end, "implements")) {
                end = if (pairs.get(end)) |nested| nested + 1 else end + 1;
            }
            try expressionReferences(source, items, i + 1, end, &pairs, scopes.items, references);
            break;
        }
    }
}
