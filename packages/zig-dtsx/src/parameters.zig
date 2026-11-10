const std = @import("std");
const syntax = @import("module_specifiers.zig");
const Token = syntax.SyntaxToken;
const Allocator = std.mem.Allocator;

fn depthChange(source: []const u8, token: Token) i32 {
    if (token.kind != .punctuation) return 0;
    return switch (source[token.start]) {
        '(', '[', '{', '<' => 1,
        ')', ']', '}' => -1,
        '>' => if (token.start == 0 or source[token.start - 1] != '=') -1 else 0,
        else => 0,
    };
}

const Segment = struct {
    question: ?Token = null,
    first_type: ?Token = null,
    last_type: ?Token = null,
    required: bool = false,
};

fn describe(source: []const u8, tokens: []const Token) Segment {
    if (tokens.len == 0) return .{};
    var result: Segment = .{};
    var depth: i32 = 0;
    for (tokens, 0..) |token, index| {
        if (depth == 0 and token.kind == .punctuation and source[token.start] == ':') {
            if (index > 0 and tokens[index - 1].kind == .punctuation and source[tokens[index - 1].start] == '?') result.question = tokens[index - 1];
            if (index + 1 < tokens.len) {
                result.first_type = tokens[index + 1];
                result.last_type = tokens[tokens.len - 1];
            }
            break;
        }
        depth += depthChange(source, token);
    }
    const name = source[tokens[0].start..tokens[0].end];
    const rest = std.mem.startsWith(u8, source[tokens[0].start..], "...");
    result.required = result.question == null and !rest and !std.mem.eql(u8, name, "this");
    return result;
}

/// Borrow unchanged input; changed output belongs to allocator. A default
/// before a required argument admits undefined while preserving its position.
pub fn normalizeDefaultParameterOrder(allocator: Allocator, parameters: []const u8) syntax.SyntaxError![]const u8 {
    if (std.mem.indexOfScalar(u8, parameters, '?') == null) return parameters;
    const stripped = std.mem.trim(u8, parameters, " \t\r\n");
    const wrapped = stripped.len >= 2 and stripped[0] == '(' and stripped[stripped.len - 1] == ')';
    const base = @intFromPtr(stripped.ptr) - @intFromPtr(parameters.ptr) + @as(usize, if (wrapped) 1 else 0);
    const inner = if (wrapped) stripped[1 .. stripped.len - 1] else stripped;
    const tokens = try syntax.tokenizeDeclarationSyntax(allocator, inner);
    defer allocator.free(tokens);
    var parts = std.array_list.Managed(Segment).init(allocator);
    defer parts.deinit();
    var depth: i32 = 0;
    var start: usize = 0;
    for (tokens, 0..) |token, index| {
        if (token.kind == .punctuation and inner[token.start] == ',' and depth == 0) {
            try parts.append(describe(inner, tokens[start..index]));
            start = index + 1;
        }
        depth += depthChange(inner, token);
    }
    try parts.append(describe(inner, tokens[start..]));
    var last_required: ?usize = null;
    for (parts.items, 0..) |part, index| {
        if (part.required) last_required = index;
    }
    const last = last_required orelse return parameters;
    var output = std.array_list.Managed(u8).init(allocator);
    errdefer output.deinit();
    var cursor: usize = 0;
    var changed = false;
    for (parts.items[0..last]) |part| {
        const question = part.question orelse continue;
        const first_type = part.first_type orelse continue;
        const last_type = part.last_type orelse continue;
        try output.appendSlice(parameters[cursor .. base + question.start]);
        try output.appendSlice(parameters[base + question.end .. base + first_type.start]);
        try output.append('(');
        try output.appendSlice(parameters[base + first_type.start .. base + last_type.end]);
        try output.appendSlice(") | undefined");
        cursor = base + last_type.end;
        changed = true;
    }
    if (!changed) {
        output.deinit();
        return parameters;
    }
    try output.appendSlice(parameters[cursor..]);
    return output.toOwnedSlice();
}

/// One `key = value` or `key: alias = value` element of a defaulted object binding.
pub const DefaultedBindingElement = struct { key: []const u8, alias: []const u8, value: []const u8 };

fn isAsciiIdentifierStart(c: u8) bool {
    return (c >= 'A' and c <= 'Z') or (c >= 'a' and c <= 'z') or c == '_' or c == '$';
}

fn asciiIdentifierEnd(text: []const u8, start: usize) usize {
    if (start >= text.len or !isAsciiIdentifierStart(text[start])) return start;
    var end = start + 1;
    while (end < text.len and (isAsciiIdentifierStart(text[end]) or (text[end] >= '0' and text[end] <= '9'))) end += 1;
    return end;
}

fn skipSpaces(text: []const u8, start: usize) usize {
    var index = start;
    while (index < text.len and text[index] <= ' ') index += 1;
    return index;
}

fn trimSpaces(text: []const u8) []const u8 {
    var start: usize = 0;
    var end = text.len;
    while (start < end and text[start] <= ' ') start += 1;
    while (end > start and text[end - 1] <= ' ') end -= 1;
    return text[start..end];
}

/// An object binding parameter defaulted to `{}` whose elements are all
/// `name = value` or `key: alias = value`: `{ ssl = true } = {}`. Any other
/// shape (an element without a default, a nested pattern, a rest element, a
/// comment, or another initializer) is null. Mirrors the TypeScript emitter's
/// `defaultedObjectBinding`; slices borrow `pattern`.
pub fn defaultedObjectBinding(allocator: Allocator, pattern: []const u8, initializer: []const u8) Allocator.Error!?[]const DefaultedBindingElement {
    if (!std.mem.eql(u8, trimSpaces(initializer), "{}")) return null;
    const source = trimSpaces(pattern);
    if (source.len < 2 or source[0] != '{' or source[source.len - 1] != '}') return null;
    const inner = source[1 .. source.len - 1];
    var parts = std.array_list.Managed([]const u8).init(allocator);
    defer parts.deinit();
    var depth: i32 = 0;
    var start: usize = 0;
    var index: usize = 0;
    while (index < inner.len) : (index += 1) {
        const c = inner[index];
        if (c == '"' or c == '\'' or c == '`') {
            index += 1;
            while (index < inner.len and inner[index] != c) {
                if (inner[index] == '\\') index += 1;
                index += 1;
            }
            if (index >= inner.len) return null;
            continue;
        }
        if (c == '/' and index + 1 < inner.len and (inner[index + 1] == '/' or inner[index + 1] == '*')) return null;
        if (c == '(' or c == '[' or c == '{') {
            depth += 1;
        } else if (c == ')' or c == ']' or c == '}') {
            depth -= 1;
            if (depth < 0) return null;
        } else if (c == ',' and depth == 0) {
            try parts.append(inner[start..index]);
            start = index + 1;
        }
    }
    if (depth != 0) return null;
    // A trailing comma leaves an empty final element.
    if (trimSpaces(inner[start..]).len > 0 or parts.items.len == 0) try parts.append(inner[start..]);
    var elements = std.array_list.Managed(DefaultedBindingElement).init(allocator);
    errdefer elements.deinit();
    for (parts.items) |part| {
        const text = trimSpaces(part);
        const key_end = asciiIdentifierEnd(text, 0);
        if (key_end == 0) {
            elements.deinit();
            return null;
        }
        const key = text[0..key_end];
        var alias = key;
        var cursor = skipSpaces(text, key_end);
        if (cursor < text.len and text[cursor] == ':') {
            const alias_start = skipSpaces(text, cursor + 1);
            const alias_end = asciiIdentifierEnd(text, alias_start);
            if (alias_end == alias_start) {
                elements.deinit();
                return null;
            }
            alias = text[alias_start..alias_end];
            cursor = skipSpaces(text, alias_end);
        }
        if (cursor >= text.len or text[cursor] != '=' or (cursor + 1 < text.len and (text[cursor + 1] == '=' or text[cursor + 1] == '>'))) {
            elements.deinit();
            return null;
        }
        const value = trimSpaces(text[cursor + 1 ..]);
        if (value.len == 0) {
            elements.deinit();
            return null;
        }
        try elements.append(.{ .key = key, .alias = alias, .value = value });
    }
    return try elements.toOwnedSlice();
}

/// The declaration of a defaulted object binding, as tsc writes it:
/// `{ ssl, poolSize }?: { ssl?: boolean | undefined; poolSize?: number | undefined }`.
/// `types[i]` is the inferred type of `elements[i].value`.
pub fn defaultedObjectBindingParameter(allocator: Allocator, elements: []const DefaultedBindingElement, types: []const []const u8) Allocator.Error![]const u8 {
    var out = std.array_list.Managed(u8).init(allocator);
    errdefer out.deinit();
    try out.appendSlice("{ ");
    for (elements, 0..) |element, index| {
        if (index > 0) try out.appendSlice(", ");
        try out.appendSlice(element.key);
        if (!std.mem.eql(u8, element.key, element.alias)) {
            try out.appendSlice(": ");
            try out.appendSlice(element.alias);
        }
    }
    try out.appendSlice(" }?: { ");
    for (elements, types, 0..) |element, element_type, index| {
        if (index > 0) try out.appendSlice("; ");
        try out.appendSlice(element.key);
        try out.appendSlice("?: ");
        if (std.mem.eql(u8, element_type, "unknown") or std.mem.eql(u8, element_type, "any")) {
            try out.appendSlice(element_type);
        } else {
            const callable = std.mem.indexOf(u8, element_type, "=>") != null;
            if (callable) try out.append('(');
            try out.appendSlice(element_type);
            if (callable) try out.append(')');
            try out.appendSlice(" | undefined");
        }
    }
    try out.appendSlice(" }");
    return out.toOwnedSlice();
}

fn bindingControl(allocator: Allocator) !void {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const elements = (try defaultedObjectBinding(a, "{ ssl = true, timeout: ms = 'a,b', }", " {} ")).?;
    try std.testing.expectEqual(@as(usize, 2), elements.len);
    try std.testing.expectEqualStrings("ssl", elements[0].alias);
    try std.testing.expectEqualStrings("timeout", elements[1].key);
    try std.testing.expectEqualStrings("ms", elements[1].alias);
    try std.testing.expectEqualStrings("'a,b'", elements[1].value);
    try std.testing.expectEqualStrings(
        "{ ssl, timeout: ms }?: { ssl?: boolean | undefined; timeout?: (() => number) | undefined }",
        try defaultedObjectBindingParameter(a, elements, &.{ "boolean", "() => number" }),
    );
}

test "defaulted object bindings read only all-default shapes" {
    try bindingControl(std.testing.allocator);
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    for ([_][2][]const u8{
        .{ "{ a, b = 1 }", "{}" },
        .{ "{ a: { b = 1 } = {} }", "{}" },
        .{ "{ a = 1, ...rest }", "{}" },
        .{ "{ a = 1 }", "{ a: 2 }" },
        .{ "{ a = 1 /* doc */ }", "{}" },
        .{ "[a = 1]", "[]" },
        .{ "{}", "{}" },
    }) |case| try std.testing.expect((try defaultedObjectBinding(a, case[0], case[1])) == null);
}

test "defaulted object bindings retain allocation failures" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, bindingControl, .{});
}

test "default parameter order matches shared declaration grammar vectors" {
    const allocator = std.testing.allocator;
    const Vector = struct { input: []const u8, expected: []const u8 };
    const parsed = try std.json.parseFromSlice([]const Vector, allocator, @embedFile("fixtures/parameter-order.json"), .{});
    defer parsed.deinit();
    for (parsed.value) |vector| {
        const output = try normalizeDefaultParameterOrder(allocator, vector.input);
        defer if (output.ptr != vector.input.ptr) allocator.free(output);
        try std.testing.expectEqualStrings(vector.expected, output);
    }
}

fn allocationControl(allocator: Allocator) !void {
    const input = "(callback?: <T>(value: T) => T, required: number)";
    const output = try normalizeDefaultParameterOrder(allocator, input);
    defer if (output.ptr != input.ptr) allocator.free(output);
    try std.testing.expectEqualStrings("(callback: (<T>(value: T) => T) | undefined, required: number)", output);
}

test "default parameter normalization retains allocation failures" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocationControl, .{});
}
