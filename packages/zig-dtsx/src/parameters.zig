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
