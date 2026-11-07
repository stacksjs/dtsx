const std = @import("std");
const types = @import("types.zig");
const syntax = @import("module_specifiers.zig");
const Constant = types.KeyConstant;
const Constants = types.KeyConstants;
const Allocator = std.mem.Allocator;
const Error = syntax.SyntaxError;

fn trim(source: []const u8) []const u8 {
    return std.mem.trim(u8, source, " \t\r\n");
}

fn numericPrefix(source: []const u8) usize {
    if (source.len == 0) return 0;
    if (source.len > 2 and source[0] == '0') {
        const base: u8 = switch (source[1]) {
            'x', 'X' => 16,
            'b', 'B' => 2,
            'o', 'O' => 8,
            else => 0,
        };
        if (base > 0) {
            var index: usize = 2;
            while (index < source.len) : (index += 1) {
                if (source[index] == '_') continue;
                const digit = std.fmt.charToDigit(source[index], base) catch break;
                _ = digit;
            }
            return if (index > 2) index else 0;
        }
    }
    var index: usize = 0;
    var digits = false;
    while (index < source.len and (std.ascii.isDigit(source[index]) or source[index] == '_')) : (index += 1) {
        digits = true;
    }
    if (index < source.len and source[index] == '.') {
        index += 1;
        while (index < source.len and (std.ascii.isDigit(source[index]) or source[index] == '_')) : (index += 1) {
            digits = true;
        }
    }
    if (!digits) return 0;
    if (index < source.len and (source[index] == 'e' or source[index] == 'E')) {
        const exponent = index;
        index += 1;
        if (index < source.len and (source[index] == '+' or source[index] == '-')) index += 1;
        const start = index;
        while (index < source.len and (std.ascii.isDigit(source[index]) or source[index] == '_')) : (index += 1) {}
        if (index == start) return exponent;
    }
    return index;
}

fn parseNumber(allocator: Allocator, source: []const u8) Error!?f64 {
    const buffer = try allocator.alloc(u8, source.len);
    defer allocator.free(buffer);
    var length: usize = 0;
    for (source) |byte| {
        if (byte == '_') continue;
        buffer[length] = byte;
        length += 1;
    }
    const text = buffer[0..length];
    var value: f64 = undefined;
    if (text.len > 2 and text[0] == '0' and (text[1] == 'b' or text[1] == 'B' or text[1] == 'o' or text[1] == 'O')) {
        const integer = std.fmt.parseInt(u64, text, 0) catch return null;
        value = @floatFromInt(integer);
    } else value = std.fmt.parseFloat(f64, text) catch return null;
    return if (std.math.isFinite(value)) value else null;
}

/// ECMAScript's shortest decimal representation and exponent thresholds.
fn numberText(allocator: Allocator, value: f64) Error![]const u8 {
    if (value == 0) return "0";
    const scientific = @abs(value) >= 1e21 or @abs(value) < 1e-6;
    var buffer: [std.fmt.float.bufferSize(.decimal, f64)]u8 = undefined;
    const text = std.fmt.float.render(&buffer, value, .{ .mode = if (scientific) .scientific else .decimal }) catch unreachable;
    if (!scientific) return allocator.dupe(u8, text);
    const exponent = std.mem.indexOfScalar(u8, text, 'e') orelse unreachable;
    const power = std.fmt.parseInt(i32, text[exponent + 1 ..], 10) catch unreachable;
    return std.fmt.allocPrint(allocator, "{s}e{s}{d}", .{ text[0..exponent], if (power >= 0) "+" else "", power });
}

fn asText(allocator: Allocator, value: Constant) Error![]const u8 {
    return switch (value) {
        .text => |text| text,
        .number => |number| numberText(allocator, number),
        .symbol => unreachable,
    };
}

fn uint32(value: f64) u32 {
    return @intFromFloat(@mod(@trunc(value), 4294967296.0));
}

fn priority(operator: []const u8) u8 {
    if (std.mem.eql(u8, operator, "|")) return 1;
    if (std.mem.eql(u8, operator, "^")) return 2;
    if (std.mem.eql(u8, operator, "&")) return 3;
    if (std.mem.eql(u8, operator, "<<") or std.mem.eql(u8, operator, ">>") or std.mem.eql(u8, operator, ">>>")) return 4;
    if (std.mem.eql(u8, operator, "+") or std.mem.eql(u8, operator, "-")) return 5;
    if (std.mem.eql(u8, operator, "**")) return 7;
    return 6;
}

fn decoded(allocator: Allocator, literal: []const u8) Error!?Constant {
    const value = syntax.decodeStringLiteral(allocator, literal) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return null,
    };
    return .{ .text = value };
}

pub fn evaluate(allocator: Allocator, expression: []const u8, constants: *const Constants, depth: usize) Error!?Constant {
    if (depth >= 64) return null;
    const source = trim(expression);
    const items = try syntax.tokenizeDeclarationSyntax(allocator, source);
    defer allocator.free(items);
    if (items.len == 0) return null;
    if (items[0].start != 0 or items[items.len - 1].end != source.len) return evaluate(allocator, source[items[0].start..items[items.len - 1].end], constants, depth + 1);
    if (items.len == 1 and items[0].kind == .quoted) return decoded(allocator, source);
    if (items.len == 1 and items[0].kind == .word) {
        const value = constants.get(source) orelse return null;
        return if (value == .symbol) null else value;
    }
    if (numericPrefix(source) == source.len) {
        const number = try parseNumber(allocator, source) orelse return null;
        return .{ .number = number };
    }
    var nesting: isize = 0;
    var selected: ?struct { start: usize, operator: []const u8 } = null;
    const operators = [_][]const u8{ ">>>", "<<", ">>", "**", "+", "-", "*", "/", "%", "|", "^", "&" };
    var index: usize = 0;
    while (index < items.len) : (index += 1) {
        const token = items[index];
        if (token.kind != .punctuation) continue;
        const text = source[token.start..token.end];
        if (std.mem.indexOf(u8, "([{", text) != null) {
            nesting += 1;
            continue;
        }
        if (std.mem.indexOf(u8, ")]}", text) != null) {
            nesting -= 1;
            continue;
        }
        const number = numericPrefix(source[token.start..]);
        if (number > 0) {
            while (index + 1 < items.len and items[index + 1].start < token.start + number) index += 1;
            continue;
        }
        if (nesting != 0) continue;
        for (operators) |operator| {
            if (!std.mem.startsWith(u8, source[token.start..], operator)) continue;
            const before = if (index > 0) source[items[index - 1].start..items[index - 1].end] else "";
            const unary = index == 0 or items[index - 1].kind == .punctuation and !std.mem.eql(u8, before, ")") and !std.mem.eql(u8, before, "]") and !(before.len == 1 and std.ascii.isDigit(before[0]));
            if (!unary and (selected == null or priority(operator) < priority(selected.?.operator) or priority(operator) == priority(selected.?.operator) and !std.mem.eql(u8, operator, "**"))) selected = .{ .start = token.start, .operator = operator };
            while (index + 1 < items.len and items[index + 1].start < token.start + operator.len) index += 1;
            break;
        }
    }
    if (selected) |binary| {
        const left = try evaluate(allocator, source[0..binary.start], constants, depth + 1) orelse return null;
        const right = try evaluate(allocator, source[binary.start + binary.operator.len ..], constants, depth + 1) orelse return null;
        const op = binary.operator;
        if (std.mem.eql(u8, op, "+") and (left == .text or right == .text)) return .{ .text = try std.fmt.allocPrint(allocator, "{s}{s}", .{ try asText(allocator, left), try asText(allocator, right) }) };
        if (left != .number or right != .number) return null;
        const a = left.number;
        const b = right.number;
        const au = uint32(a);
        const bu = uint32(b);
        const shift: u5 = @truncate(bu);
        const signed_a: i32 = @bitCast(au);
        const result: f64 = if (std.mem.eql(u8, op, "+")) a + b else if (std.mem.eql(u8, op, "-")) a - b else if (std.mem.eql(u8, op, "*")) a * b else if (std.mem.eql(u8, op, "/")) a / b else if (std.mem.eql(u8, op, "%")) @rem(a, b) else if (std.mem.eql(u8, op, "**")) std.math.pow(f64, a, b) else if (std.mem.eql(u8, op, "<<")) @floatFromInt(@as(i32, @bitCast(au << shift))) else if (std.mem.eql(u8, op, ">>")) @floatFromInt(signed_a >> shift) else if (std.mem.eql(u8, op, ">>>")) @floatFromInt(au >> shift) else if (std.mem.eql(u8, op, "|")) @floatFromInt(@as(i32, @bitCast(au | bu))) else if (std.mem.eql(u8, op, "^")) @floatFromInt(@as(i32, @bitCast(au ^ bu))) else if (std.mem.eql(u8, op, "&")) @floatFromInt(@as(i32, @bitCast(au & bu))) else return null;
        return if (std.math.isFinite(result)) .{ .number = result } else null;
    }
    if (source[0] == '(' and source[source.len - 1] == ')') {
        var balance: isize = 0;
        var wrapped = true;
        for (items, 0..) |token, item| {
            const text = source[token.start..token.end];
            if (std.mem.eql(u8, text, "(")) balance += 1;
            if (std.mem.eql(u8, text, ")")) balance -= 1;
            if (balance == 0 and item != items.len - 1) {
                wrapped = false;
                break;
            }
        }
        if (wrapped) return evaluate(allocator, source[1 .. source.len - 1], constants, depth + 1);
    }
    if (std.mem.indexOfScalar(u8, "+-~", source[0]) != null) {
        const operand = try evaluate(allocator, source[1..], constants, depth + 1) orelse return null;
        if (operand != .number) return null;
        return .{ .number = if (source[0] == '-') -operand.number else if (source[0] == '~') @floatFromInt(@as(i32, @bitCast(~uint32(operand.number)))) else operand.number };
    }
    if (source[0] != '`' or source[source.len - 1] != '`') return null;
    var result = std.array_list.Managed(u8).init(allocator);
    errdefer result.deinit();
    var start: usize = 1;
    var position: usize = 1;
    while (position < source.len - 1) : (position += 1) {
        if (source[position] == '\\') {
            position += 1;
            continue;
        }
        if (source[position] != '$' or source[position + 1] != '{') continue;
        const raw = try std.fmt.allocPrint(allocator, "`{s}`", .{source[start..position]});
        const cooked = try decoded(allocator, raw) orelse return null;
        try result.appendSlice(cooked.text);
        var braces: usize = 0;
        var closing: ?usize = null;
        for (items) |token| {
            if (token.start < position + 2 or token.kind != .punctuation) continue;
            const text = source[token.start..token.end];
            if (std.mem.eql(u8, text, "{")) braces += 1;
            if (!std.mem.eql(u8, text, "}")) continue;
            if (braces == 0) {
                closing = token.start;
                break;
            }
            braces -= 1;
        }
        const end = closing orelse return null;
        const value = try evaluate(allocator, source[position + 2 .. end], constants, depth + 1) orelse return null;
        try result.appendSlice(try asText(allocator, value));
        position = end;
        start = position + 1;
    }
    const raw = try std.fmt.allocPrint(allocator, "`{s}`", .{source[start .. source.len - 1]});
    const cooked = try decoded(allocator, raw) orelse return null;
    try result.appendSlice(cooked.text);
    return .{ .text = try result.toOwnedSlice() };
}

fn sourceOrder(_: void, left: *types.Declaration, right: *types.Declaration) bool {
    return left.start < right.start;
}

pub fn attach(allocator: Allocator, declarations: []types.Declaration, candidates: *std.StringHashMap(types.Declaration)) Error!void {
    var ordered = std.array_list.Managed(*types.Declaration).init(allocator);
    defer ordered.deinit();
    for (declarations) |*entry| try ordered.append(entry);
    var values = candidates.valueIterator();
    while (values.next()) |entry| try ordered.append(entry);
    var needed = false;
    for (ordered.items) |entry| {
        if (entry.kind == .variable_decl and std.mem.indexOfScalar(u8, entry.value, '`') != null and std.mem.indexOfScalar(u8, entry.value, '[') != null) {
            needed = true;
            break;
        }
    }
    if (!needed) return;
    std.mem.sort(*types.Declaration, ordered.items, {}, sourceOrder);
    var constants = Constants.init(allocator);
    defer constants.deinit();
    var shadows_symbol = false;
    for (ordered.items) |entry| {
        if (std.mem.eql(u8, entry.name, "Symbol")) shadows_symbol = true;
    }
    for (ordered.items) |entry| {
        if (entry.kind != .variable_decl or entry.value.len == 0) continue;
        if (std.mem.indexOfScalar(u8, entry.value, '`') != null and std.mem.indexOfScalar(u8, entry.value, '[') != null) {
            const snapshot = try allocator.create(Constants);
            snapshot.* = try constants.clone();
            entry.computed_key_constants = snapshot;
        }
        const tokens = try syntax.tokenizeDeclarationSyntax(allocator, entry.value);
        defer allocator.free(tokens);
        const alias = if (tokens.len == 1 and tokens[0].kind == .word) constants.get(entry.value[tokens[0].start..tokens[0].end]) else null;
        const symbol_call = !shadows_symbol and tokens.len > 1 and tokens[0].kind == .word and std.mem.eql(u8, entry.value[tokens[0].start..tokens[0].end], "Symbol") and (std.mem.eql(u8, entry.value[tokens[1].start..tokens[1].end], "(") or std.mem.eql(u8, entry.value[tokens[1].start..tokens[1].end], "."));
        if (std.mem.eql(u8, entry.type_annotation, "unique symbol") or std.mem.eql(u8, entry.type_annotation, "symbol") or alias != null and alias.? == .symbol or symbol_call) {
            try constants.put(entry.name, .symbol);
            continue;
        }
        const modifiers = entry.modifiers orelse continue;
        if (modifiers.len == 0 or !std.mem.eql(u8, modifiers[0], "const") or entry.type_annotation.len > 0 or modifiers.len > 1) continue;
        if (try evaluate(allocator, entry.value, &constants, 0)) |value| try constants.put(entry.name, value);
    }
}

pub const TemplateKey = union(enum) { name: []const u8, index };

pub fn resolve(allocator: Allocator, key: []const u8, constants: ?*const Constants) Error!?TemplateKey {
    if (trim(key).len == 0 or trim(key)[0] != '[' or std.mem.indexOfScalar(u8, key, '`') == null) return null;
    const items = try syntax.tokenizeDeclarationSyntax(allocator, key);
    defer allocator.free(items);
    if (items.len < 3 or key[items[0].start] != '[' or key[items[1].start] != '`' or key[items[items.len - 1].start] != ']') return null;
    var empty = Constants.init(allocator);
    defer empty.deinit();
    const value = try evaluate(allocator, trim(key[items[0].end..items[items.len - 1].start]), constants orelse &empty, 0);
    if (value) |constant| {
        if (constant == .text) return .{ .name = try syntax.quoteStringLiteral(allocator, constant.text, '\'') };
    }
    return .index;
}

pub fn isSymbolKey(allocator: Allocator, key: []const u8, constants: ?*const Constants) Error!bool {
    const bindings = constants orelse return false;
    if (trim(key).len == 0 or trim(key)[0] != '[') return false;
    const tokens = try syntax.tokenizeDeclarationSyntax(allocator, key);
    defer allocator.free(tokens);
    if (tokens.len != 3 or key[tokens[0].start] != '[' or tokens[1].kind != .word or key[tokens[2].start] != ']') return false;
    const value = bindings.get(key[tokens[1].start..tokens[1].end]) orelse return false;
    return value == .symbol;
}

pub fn hasTemplateSubstitution(allocator: Allocator, key: []const u8) Error!bool {
    if (trim(key).len == 0 or trim(key)[0] != '[' or std.mem.indexOfScalar(u8, key, '`') == null) return false;
    const tokens = try syntax.tokenizeDeclarationSyntax(allocator, key);
    defer allocator.free(tokens);
    if (tokens.len < 2 or key[tokens[1].start] != '`') return false;
    for (tokens) |token| {
        if (token.kind == .punctuation and key[token.start] == '{') return true;
    }
    return false;
}

test "computed template constants use lexical substitutions and JavaScript number spelling" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var constants = Constants.init(allocator);
    try constants.put("KEY", .{ .text = "root" });
    try constants.put("ORDINAL", .{ .number = 7 });
    const cases = [_][2][]const u8{
        .{ "`prefix_${KEY}_${ORDINAL}`", "prefix_root_7" },
        .{ "`prefix_${/* comment */ KEY}`", "prefix_root" },
        .{ "`prefix_${`nested_${KEY}`}`", "prefix_nested_root" },
        .{ "`prefix_${(1 + 2) * 4}`", "prefix_12" },
        .{ "`prefix_${1 << 3}`", "prefix_8" },
        .{ "`prefix_${0xff}`", "prefix_255" },
        .{ "`prefix_${0b1010}`", "prefix_10" },
        .{ "`prefix_${0o7}`", "prefix_7" },
        .{ "`prefix_${1_000}`", "prefix_1000" },
        .{ "`prefix_${1e21}`", "prefix_1e+21" },
        .{ "`prefix_${1e-7}`", "prefix_1e-7" },
        .{ "`prefix_${0.000001}`", "prefix_0.000001" },
        .{ "`prefix_${-0}`", "prefix_0" },
        .{ "`escaped\\n\\u0061`", "escaped\na" },
    };
    for (cases) |fixture| {
        const value = try evaluate(allocator, fixture[0], &constants, 0);
        try std.testing.expect(value != null and value.? == .text);
        try std.testing.expectEqualStrings(fixture[1], value.?.text);
    }
    for ([_][]const u8{ "`prefix_${true}`", "`prefix_${missing}`", "`prefix_${runtimeCall()}`" }) |source| {
        try std.testing.expect(try evaluate(allocator, source, &constants, 0) == null);
        const property = try std.fmt.allocPrint(allocator, "[{s}]", .{source});
        try std.testing.expect((try resolve(allocator, property, &constants)).? == .index);
    }
}

test "constant template key strings preserve NUL and UTF-16 surrogate identity" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var constants = Constants.init(allocator);
    const cases = [_][2][]const u8{
        .{ "[`a\\0b`]", "'a\\u0000b'" },
        .{ "[`a\\uD800b`]", "'a\\ud800b'" },
        .{ "[`a\\uDC00b`]", "'a\\udc00b'" },
        .{ "[`a\\uD800\\u{61}`]", "'a\\ud800a'" },
        .{ "[`a\\uD83D\\uDE00`]", "'a😀'" },
    };
    for (cases) |fixture| {
        const key = (try resolve(allocator, fixture[0], &constants)).?;
        try std.testing.expect(key == .name);
        try std.testing.expectEqualStrings(fixture[1], key.name);
    }
}
