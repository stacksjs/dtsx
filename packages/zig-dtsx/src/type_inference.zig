/// Type inference utilities for DTS generation.
/// Port of processor/type-inference.ts.
const std = @import("std");
const ch = @import("char_utils.zig");
const KeyConstants = @import("types.zig").KeyConstants;
const computed_keys = @import("computed_keys.zig");
const comment_utils = @import("comments.zig");
const parameter_order = @import("parameters.zig");

const ClassScope = @import("scanner.zig").Scanner;
const return_scopes = @import("return_type_scope.zig");
const MAX_INFERENCE_DEPTH = 20;

/// Error type for type inference operations
pub const InferError = std.mem.Allocator.Error || error{InvalidContext};

// ---------------------------------------------------------------------------
// Module-level storage for computing clean default alongside type inference.
// This avoids double-parsing: inferObjectType/inferArrayType build the
// @defaultValue content during the same pass that infers types.
// ---------------------------------------------------------------------------
threadlocal var _collect_clean_default: bool = false;
threadlocal var _clean_default_result: ?[]const u8 = null;

/// Enable clean default collection for the next type inference pass.
/// Must be called before inferNarrowType when you need a @defaultValue.
pub fn enableCleanDefaultCollection() void {
    _collect_clean_default = true;
    _clean_default_result = null;
}

/// Consume the computed clean default (also disables collection).
/// Returns null if no clean default was computed.
pub fn consumeCleanDefault() ?[]const u8 {
    _collect_clean_default = false;
    const val = _clean_default_result;
    _clean_default_result = null;
    return val;
}

pub const isNumericLiteral = @import("numeric_literals.zig").isNumericLiteral;
pub const isBigIntLiteral = @import("numeric_literals.zig").isBigIntLiteral;
pub const numericLiteralType = @import("numeric_literals.zig").numericLiteralType;

const StaticTruthiness = enum { unknown, truthy, falsy };

fn isQuotedLiteral(value: []const u8, quote: u8) bool {
    if (value.len < 2 or value[0] != quote) return false;
    var i: usize = 1;
    while (i < value.len) : (i += 1) {
        if (value[i] == quote and !ch.isEscaped(value, i)) return i == value.len - 1;
    }
    return false;
}

fn staticTruthiness(value: []const u8) StaticTruthiness {
    const expression = trim(value);
    if (std.mem.eql(u8, expression, "true")) return .truthy;
    if (std.mem.eql(u8, expression, "false") or std.mem.eql(u8, expression, "null") or
        std.mem.eql(u8, expression, "undefined") or std.mem.eql(u8, expression, "NaN")) return .falsy;
    if (isQuotedLiteral(expression, '\'') or isQuotedLiteral(expression, '"') or
        (isQuotedLiteral(expression, '`') and !ch.contains(expression, "${")))
        return if (expression.len == 2) .falsy else .truthy;
    if (isNumericLiteral(expression)) {
        var normalized = expression;
        if (normalized[0] == '-') normalized = normalized[1..];
        for (normalized) |c| if (c != '0' and c != '.' and c != '_') return .truthy;
        return .falsy;
    }
    if (isBigIntLiteral(expression)) {
        var normalized = expression[0 .. expression.len - 1];
        if (normalized[0] == '-') normalized = normalized[1..];
        for (normalized) |c| if (c != '0' and c != '_' and c != 'x' and c != 'X' and c != 'b' and c != 'B' and c != 'o' and c != 'O') return .truthy;
        return .falsy;
    }
    return .unknown;
}

/// Trim whitespace from both ends
fn trim(s: []const u8) []const u8 {
    var start: usize = 0;
    var end: usize = s.len;
    while (start < end and ch.isWhitespace(s[start])) start += 1;
    while (end > start and ch.isWhitespace(s[end - 1])) end -= 1;
    return s[start..end];
}

/// Count occurrences of needle in haystack
fn countOccurrences(haystack: []const u8, needle: []const u8) usize {
    if (needle.len == 0) return 0;
    var count: usize = 0;
    var pos: usize = 0;
    while (ch.indexOf(haystack, needle, pos)) |idx| {
        count += 1;
        pos = idx + needle.len;
    }
    return count;
}

fn isIdentifierName(value: []const u8) bool {
    if (value.len == 0 or !ch.isIdentStart(value[0])) return false;
    for (value[1..]) |c| if (!ch.isIdentChar(c)) return false;
    return true;
}

fn isEntityName(value: []const u8) bool {
    var expects_start = true;
    for (value) |c| {
        if (c == '.') {
            if (expects_start) return false;
            expects_start = true;
        } else if (expects_start) {
            if (!ch.isIdentStart(c)) return false;
            expects_start = false;
        } else if (!ch.isIdentChar(c)) return false;
    }
    return value.len > 0 and !expects_start;
}

fn isDeclarationType(value: []const u8) bool {
    if (value.len == 0) return false;
    if (std.mem.eql(u8, value, "string") or std.mem.eql(u8, value, "number") or std.mem.eql(u8, value, "boolean") or
        std.mem.eql(u8, value, "bigint") or std.mem.eql(u8, value, "symbol") or std.mem.eql(u8, value, "unknown") or
        std.mem.eql(u8, value, "never") or std.mem.eql(u8, value, "void")) return true;
    return (value[0] == '{' and !ch.contains(value, "return")) or value[0] == '[' or ch.contains(value, " | ") or ch.contains(value, " & ");
}

fn isRegexLiteral(value: []const u8) bool {
    if (value.len < 2 or value[0] != '/') return false;
    var in_character_class = false;
    var i: usize = 1;
    while (i < value.len) : (i += 1) {
        if (value[i] == '\\') {
            i += 1;
            continue;
        }
        if (value[i] == '[') in_character_class = true else if (value[i] == ']') in_character_class = false else if (value[i] == '/' and !in_character_class) {
            for (value[i + 1 ..]) |flag| if (!ch.isIdentChar(flag)) return false;
            return true;
        }
    }
    return false;
}

fn isJsxTagNameChar(c: u8) bool {
    return ch.isIdentChar(c) or c == '.' or c == ':' or c == '-';
}

/// Detect a complete JSX element or fragment without assuming a particular JSX
/// runtime. This deliberately requires a matching outer close or a self-close,
/// keeping angle-bracket assertions and generic arrow functions distinct.
fn isJsxExpression(value: []const u8) bool {
    const expression = trim(value);
    if (expression.len < 3 or expression[0] != '<') return false;
    if (ch.startsWith(expression, "<>")) return ch.endsWith(expression, "</>");
    if (!ch.isIdentStart(expression[1])) return false;

    var tag_end: usize = 2;
    while (tag_end < expression.len and isJsxTagNameChar(expression[tag_end])) tag_end += 1;
    const tag_name = expression[1..tag_end];
    if (tag_name.len == 0 or tag_end >= expression.len) return false;
    const delimiter = expression[tag_end];
    if (!ch.isWhitespace(delimiter) and delimiter != '>' and delimiter != '/') return false;
    if (ch.endsWith(expression, "/>")) return true;

    const close_start = std.mem.lastIndexOf(u8, expression, "</") orelse return false;
    var close_end = close_start + 2;
    while (close_end < expression.len and isJsxTagNameChar(expression[close_end])) close_end += 1;
    return std.mem.eql(u8, expression[close_start + 2 .. close_end], tag_name) and
        close_end < expression.len and expression[close_end] == '>' and close_end == expression.len - 1;
}

fn inferAccessType(alloc: std.mem.Allocator, value: []const u8) InferError!?[]const u8 {
    if (value.len > 3 and value[value.len - 1] == ']') {
        const bracket = std.mem.lastIndexOfScalar(u8, value, '[') orelse return null;
        const base = trim(value[0..bracket]);
        const index = trim(value[bracket + 1 .. value.len - 1]);
        // Only indexes that are valid in a type: an identifier (queried with
        // typeof), a string literal or a number. `a[b as keyof T]` and other
        // value expressions cannot appear inside an indexed access type.
        const is_literal_index = isNumericLiteral(index) or (index.len >= 2 and (index[0] == '\'' or index[0] == '"') and index[index.len - 1] == index[0]);
        if (isEntityName(base) and (isIdentifierName(index) or is_literal_index)) {
            const index_type = if (isIdentifierName(index)) try std.fmt.allocPrint(alloc, "typeof {s}", .{index}) else index;
            return try std.fmt.allocPrint(alloc, "(typeof {s})[{s}]", .{ base, index_type });
        }
    }

    if (ch.indexOf(value, "?.", 0)) |optional_index| {
        const base = trim(value[0..optional_index]);
        const property = trim(value[optional_index + 2 ..]);
        if (isIdentifierName(base) and isIdentifierName(property))
            return try std.fmt.allocPrint(alloc, "NonNullable<typeof {s}>[\"{s}\"] | undefined", .{ base, property });
    }

    // A dotted name is left to the caller, which queries it whole
    // (`typeof console.log`) where a reference is expected.
    return null;
}

fn inferUpdateType(alloc: std.mem.Allocator, operand_value: []const u8) InferError![]const u8 {
    const operand = trim(operand_value);
    if (isEntityName(operand)) return std.fmt.allocPrint(alloc, "typeof {s}", .{operand});
    if (try inferAccessType(alloc, operand)) |access_type| return access_type;
    return "number";
}

/// Find the value-call argument list, skipping parentheses inside type arguments.
/// An unbalanced `<` remains a comparison operator rather than a generic list.
fn findCallParenIndex(value: []const u8) ?usize {
    var i: usize = 0;
    while (i < value.len) : (i += 1) {
        const c = value[i];
        if (c == '\'' or c == '"' or c == '`') {
            i = skipQuotedValue(value, i, c) - 1;
            continue;
        }
        if (c == '(') return i;
        if (c == '<') {
            if (findMatchingBracket(value, i, '<', '>')) |end| i = end;
        }
    }
    return null;
}

pub fn inferCallType(alloc: std.mem.Allocator, value: []const u8) InferError!?[]const u8 {
    if (value.len < 3 or value[value.len - 1] != ')') return null;
    const open = findCallParenIndex(value) orelse return null;
    if (findMatchingBracket(value, open, '(', ')') != value.len - 1) return null;
    var callee = trim(value[0..open]);
    var is_optional = false;
    if (ch.endsWith(callee, "?.")) {
        is_optional = true;
        callee = trim(callee[0 .. callee.len - 2]);
    }

    var entity = callee;
    var has_type_arguments = false;
    if (std.mem.indexOfScalar(u8, callee, '<')) |generic_start| {
        const generic_end = findMatchingBracket(callee, generic_start, '<', '>') orelse return null;
        if (generic_end != callee.len - 1) return null;
        entity = trim(callee[0..generic_start]);
        has_type_arguments = true;
    }
    if (ch.endsWith(entity, "?.")) {
        is_optional = true;
        const type_arguments = callee[entity.len..];
        entity = trim(entity[0 .. entity.len - 2]);
        callee = try std.fmt.allocPrint(alloc, "{s}{s}", .{ entity, type_arguments });
    }
    if (!isEntityName(entity)) return null;
    const arguments = trim(value[open + 1 .. value.len - 1]);
    const has_inline_function = findArrowOutsideParens(arguments) != null or ch.startsWith(arguments, "function") or ch.startsWith(arguments, "async function");
    const has_reference_argument = isEntityName(arguments);
    const has_nested_call = !has_inline_function and ch.endsWith(arguments, ")") and (try inferCallType(alloc, arguments)) != null;
    const dot = std.mem.indexOfScalar(u8, entity, '.');
    if (dot) |index| {
        if (ch.indexOfChar(entity, '.', index + 1) != null) return null;
    } else if (!has_type_arguments and !is_optional and !has_inline_function and !has_reference_argument and !has_nested_call) return null;

    const call_type = try std.fmt.allocPrint(alloc, "ReturnType<typeof {s}>", .{callee});
    if (is_optional) return try std.fmt.allocPrint(alloc, "ReturnType<NonNullable<typeof {s}>> | (null extends typeof {s} ? undefined : undefined extends typeof {s} ? undefined : never)", .{ callee, entity, entity });
    return call_type;
}

fn inferBodyCallType(alloc: std.mem.Allocator, value: []const u8, parameters: []const u8) InferError!?[]const u8 {
    if (value.len < 3 or value[value.len - 1] != ')') return null;
    const open = std.mem.indexOfScalar(u8, value, '(') orelse return null;
    if (findMatchingBracket(value, open, '(', ')') != value.len - 1) return null;
    const callee = trim(value[0..open]);
    if (!isEntityName(callee)) return null;

    const dot = std.mem.indexOfScalar(u8, callee, '.');
    const root = if (dot) |index| callee[0..index] else callee;
    const root_type = findParameterType(parameters, root) orelse {
        // Known Promise operations already have a value-aware inference path.
        // A parameter named Promise keeps its own declared callable type.
        if (std.mem.eql(u8, root, "Promise")) return null;
        return "unknown";
    };
    if (dot == null) return try std.fmt.allocPrint(alloc, "ReturnType<{s}>", .{root_type});
    // A call on a primitive parameter: `value.toFixed(2)` is a string.
    if (primitiveMethodReturnType(trim(root_type), callee[dot.? + 1 ..])) |result| return result;

    // Each member access wraps its object, as the TypeScript emitter's query
    // substitution does: `(Date)["toISOString"]`.
    var callable_type: []const u8 = root_type;
    var properties = std.mem.splitScalar(u8, callee[dot.? + 1 ..], '.');
    while (properties.next()) |property| {
        if (!isIdentifierName(property)) return "unknown";
        callable_type = try std.fmt.allocPrint(alloc, "({s})[\"{s}\"]", .{ callable_type, property });
    }
    return try std.fmt.allocPrint(alloc, "ReturnType<{s}>", .{callable_type});
}

const PrimitiveMethod = struct { name: []const u8, result: []const u8 };

const string_methods = [_]PrimitiveMethod{
    .{ .name = "at", .result = "string | undefined" },
    .{ .name = "charAt", .result = "string" },
    .{ .name = "charCodeAt", .result = "number" },
    .{ .name = "codePointAt", .result = "number | undefined" },
    .{ .name = "concat", .result = "string" },
    .{ .name = "endsWith", .result = "boolean" },
    .{ .name = "includes", .result = "boolean" },
    .{ .name = "indexOf", .result = "number" },
    .{ .name = "lastIndexOf", .result = "number" },
    .{ .name = "localeCompare", .result = "number" },
    .{ .name = "normalize", .result = "string" },
    .{ .name = "padEnd", .result = "string" },
    .{ .name = "padStart", .result = "string" },
    .{ .name = "repeat", .result = "string" },
    .{ .name = "replace", .result = "string" },
    .{ .name = "replaceAll", .result = "string" },
    .{ .name = "search", .result = "number" },
    .{ .name = "slice", .result = "string" },
    .{ .name = "split", .result = "string[]" },
    .{ .name = "startsWith", .result = "boolean" },
    .{ .name = "substring", .result = "string" },
    .{ .name = "toLocaleLowerCase", .result = "string" },
    .{ .name = "toLocaleUpperCase", .result = "string" },
    .{ .name = "toLowerCase", .result = "string" },
    .{ .name = "toString", .result = "string" },
    .{ .name = "toUpperCase", .result = "string" },
    .{ .name = "trim", .result = "string" },
    .{ .name = "trimEnd", .result = "string" },
    .{ .name = "trimStart", .result = "string" },
    .{ .name = "valueOf", .result = "string" },
};
const number_methods = [_]PrimitiveMethod{
    .{ .name = "toExponential", .result = "string" },
    .{ .name = "toFixed", .result = "string" },
    .{ .name = "toLocaleString", .result = "string" },
    .{ .name = "toPrecision", .result = "string" },
    .{ .name = "toString", .result = "string" },
    .{ .name = "valueOf", .result = "number" },
};
const bigint_methods = [_]PrimitiveMethod{
    .{ .name = "toLocaleString", .result = "string" },
    .{ .name = "toString", .result = "string" },
    .{ .name = "valueOf", .result = "bigint" },
};
const boolean_methods = [_]PrimitiveMethod{
    .{ .name = "toString", .result = "string" },
    .{ .name = "valueOf", .result = "boolean" },
};

/// The result of calling `method` on a value of a primitive keyword type,
/// when it is fixed. The TypeScript emitter keeps the identical table
/// (`PRIMITIVE_METHOD_RETURN_TYPES`).
pub fn primitiveMethodReturnType(receiver: []const u8, method: []const u8) ?[]const u8 {
    const methods: []const PrimitiveMethod = if (std.mem.eql(u8, receiver, "string"))
        &string_methods
    else if (std.mem.eql(u8, receiver, "number"))
        &number_methods
    else if (std.mem.eql(u8, receiver, "bigint"))
        &bigint_methods
    else if (std.mem.eql(u8, receiver, "boolean"))
        &boolean_methods
    else
        return null;
    for (methods) |entry| if (std.mem.eql(u8, entry.name, method)) return entry.result;
    return null;
}

/// Parse array elements handling nested structures.
/// Returns slices into the original content string.
pub fn parseArrayElements(alloc: std.mem.Allocator, content: []const u8) InferError![][]const u8 {
    // Fast path: empty content
    if (content.len == 0) return &.{};

    var elements = std.array_list.Managed([]const u8).init(alloc);
    // Pre-size: estimate element count from top-level commas
    var est: usize = 1;
    for (content) |cc| if (cc == ',') {
        est += 1;
    };
    try elements.ensureTotalCapacity(est);
    var depth: i32 = 0;
    var in_string = false;
    var string_char: u8 = 0;
    // Comments are trivia: they never split elements and are trimmed from
    // both ends of an element (`'a', // note` is the element `'a'`).
    var start: ?usize = null; // first code byte of the current element
    var end: usize = 0; // one past its last code byte
    var i: usize = 0;
    while (i < content.len) : (i += 1) {
        const c = content[i];
        if (in_string) {
            if (c == '\\') {
                i += 1;
            } else if (c == string_char) in_string = false;
            end = i + 1;
            continue;
        }
        if (c == '/' and i + 1 < content.len and content[i + 1] == '/') {
            i = (ch.indexOfChar(content, '\n', i + 2) orelse content.len) - 1;
            continue;
        }
        if (c == '/' and i + 1 < content.len and content[i + 1] == '*') {
            i = (if (ch.indexOf(content, "*/", i + 2)) |close| close + 2 else content.len) - 1;
            continue;
        }
        if (ch.isWhitespace(c)) continue;
        if (c == ',' and depth == 0) {
            if (start) |first| try elements.append(content[first..end]);
            start = null;
            continue;
        }
        if (c == '"' or c == '\'' or c == '`') {
            in_string = true;
            string_char = c;
        } else if (c == '[' or c == '{' or c == '(') depth += 1 else if (c == ']' or c == '}' or c == ')') depth -= 1;
        if (start == null) start = i;
        end = i + 1;
    }
    if (start) |first| try elements.append(content[first..end]);

    // toOwnedSlice() trims unused capacity — important for non-arena callers.
    return elements.toOwnedSlice();
}

/// Clean a method signature for a declaration. Port of the TypeScript
/// emitter's cleanMethodSignature: strip `//` comments line by line, drop a
/// leading `async`, clean the outermost parameter list's defaults, then
/// collapse whitespace onto one line. A line break between the members of
/// an object type becomes `; `, so `{\n a?: string\n b?: number\n}` does not
/// collapse into the unparseable `{ a?: string b?: number }` (#3093).
fn cleanMethodSignature(alloc: std.mem.Allocator, signature: []const u8) InferError![]const u8 {
    // Fast path: nothing to strip, clean or collapse.
    const needs_clean = blk: {
        var prev_ws = false;
        for (signature, 0..) |c, i| {
            if (c == '=' and (i + 1 >= signature.len or signature[i + 1] != '>')) break :blk true;
            if (c == '\n' or c == '\r' or c == '\t') break :blk true;
            if (c == '/' and i + 1 < signature.len and signature[i + 1] == '/') break :blk true;
            const is_ws = ch.isWhitespace(c);
            if (is_ws and prev_ws) break :blk true;
            prev_ws = is_ws;
            if (c == 'a' and (i == 0 or !ch.isIdentChar(signature[i - 1])) and ch.startsWith(signature[i..], "async") and
                (i + 5 >= signature.len or !ch.isIdentChar(signature[i + 5])))
                break :blk true;
        }
        break :blk false;
    };
    if (!needs_clean) return trim(signature);

    // 0. Strip inline `//` comments from each line.
    var stripped = std.array_list.Managed(u8).init(alloc);
    try stripped.ensureTotalCapacity(signature.len);
    var line_iter = std.mem.splitScalar(u8, signature, '\n');
    var first_line = true;
    while (line_iter.next()) |line| {
        if (!first_line) try stripped.append('\n');
        first_line = false;
        try stripped.appendSlice(stripTrailingInlineComment(line));
    }
    var cleaned: []const u8 = stripped.items;

    // 1. Strip the first `async` keyword at word boundaries.
    if (std.mem.indexOf(u8, cleaned, "async")) |idx| {
        const before_ok = idx == 0 or !ch.isIdentChar(cleaned[idx - 1]);
        const after_ok = idx + 5 >= cleaned.len or !ch.isIdentChar(cleaned[idx + 5]);
        if (before_ok and after_ok) {
            cleaned = trim(try std.mem.concat(alloc, u8, &.{ cleaned[0..idx], cleaned[idx + 5 ..] }));
        }
    }

    // 2. Clean the defaults of the outermost parameter list.
    if (ch.indexOfChar(cleaned, '(', 0)) |paren_start| {
        if (findMatchingBracket(cleaned, paren_start, '(', ')')) |paren_end| {
            const clean_params = try cleanParameterDefaults(alloc, cleaned[paren_start .. paren_end + 1]);
            cleaned = try std.mem.concat(alloc, u8, &.{ cleaned[0..paren_start], clean_params, cleaned[paren_end + 1 ..] });
        }
    }

    // 3. Collapse whitespace; a line break directly inside `{}` separates
    //    members and becomes `; `.
    var buf = std.array_list.Managed(u8).init(alloc);
    try buf.ensureTotalCapacity(cleaned.len);
    var nest = std.array_list.Managed(u8).init(alloc);
    var last_was_ws = false;
    var ws_had_newline = false;
    for (cleaned) |c| {
        if (c == '{' or c == '(') {
            try nest.append(c);
        } else if ((c == '}' or c == ')') and nest.items.len > 0) {
            _ = nest.pop();
        }
        if (c <= ' ') {
            last_was_ws = true;
            if (c == '\n' or c == '\r') ws_had_newline = true;
            continue;
        }
        if (last_was_ws and buf.items.len > 0) {
            const inside_brace = nest.items.len > 0 and nest.items[nest.items.len - 1] == '{';
            if (ws_had_newline and inside_brace) {
                const last = buf.items[buf.items.len - 1];
                const already_separated = last == ';' or last == ',' or last == '{' or c == '}';
                const after_comment = buf.items.len >= 2 and last == '/' and buf.items[buf.items.len - 2] == '*';
                try buf.appendSlice(if (!already_separated and !after_comment) "; " else " ");
            } else {
                try buf.append(' ');
            }
        }
        last_was_ws = false;
        ws_had_newline = false;
        try buf.append(c);
    }
    return trim(buf.items);
}

/// Strip 'async' keywords from a string without collapsing whitespace.
/// Used when we want to remove async modifiers but preserve multiline formatting.
fn stripAsyncKeyword(alloc: std.mem.Allocator, input: []const u8) InferError![]const u8 {
    // Fast-path: no "async" substring at all → return input unchanged (zero-copy).
    if (std.mem.indexOf(u8, input, "async") == null) return input;

    var buf = std.array_list.Managed(u8).init(alloc);
    try buf.ensureTotalCapacity(input.len);
    var j: usize = 0;
    // Remove leading "async "
    if (ch.startsWith(input, "async ")) {
        j = 6;
        // Skip extra whitespace after
        while (j < input.len and input[j] == ' ') j += 1;
    }
    while (j < input.len) {
        if (j > 0 and ch.startsWith(input[j..], "async ")) {
            // Check word boundary: char before must not be alphanumeric or _
            const before = input[j - 1];
            if (!ch.isIdentChar(before)) {
                j += 6; // skip "async "
                // Skip extra spaces (but not newlines) after
                while (j < input.len and input[j] == ' ') j += 1;
                continue;
            }
        }
        try buf.append(input[j]);
        j += 1;
    }
    // toOwnedSlice trims the unused capacity — important when the caller
    // wraps this in a non-arena allocator.
    return buf.toOwnedSlice();
}

/// Convert a method definition to a function type.
/// Input: key = method name (may include generics), value = "(params): ReturnType { body }"
/// Output: "generics(params) => ReturnType"
fn convertMethodToFunctionType(alloc: std.mem.Allocator, key: []const u8, method_def: []const u8) InferError![]const u8 {
    _ = key; // key is already clean, generics are at start of value if present
    var cleaned = trim(method_def);
    var is_async = false;
    var is_generator = false;
    if (ch.startsWith(cleaned, "async") and cleaned.len > 5 and (cleaned[5] == ' ' or cleaned[5] == '\t')) {
        is_async = true;
        cleaned = trim(cleaned[5..]);
    }
    if (ch.startsWith(cleaned, "*")) {
        is_generator = true;
        cleaned = trim(cleaned[1..]);
    }

    // Extract generics (e.g., "<T>(value: T)" -> generics = "<T>")
    var generics: []const u8 = "";
    if (cleaned.len > 0 and cleaned[0] == '<') {
        if (findMatchingBracket(cleaned, 0, '<', '>')) |gen_end| {
            generics = cleaned[0 .. gen_end + 1];
            cleaned = trim(cleaned[gen_end + 1 ..]);
        }
    }

    // Find parameter list
    const param_start = ch.indexOfChar(cleaned, '(', 0) orelse return "() => unknown";
    const param_end = findMatchingBracket(cleaned, param_start, '(', ')') orelse return "() => unknown";
    const params = cleaned[param_start .. param_end + 1];

    // Extract return type
    var return_type: []const u8 = "unknown";
    const after_params = trim(cleaned[param_end + 1 ..]);
    if (after_params.len > 0 and after_params[0] == ':') {
        // Find return type - everything up to '{' or end
        const type_start: usize = 1; // skip ':'
        var type_end: usize = after_params.len;
        var j: usize = type_start;
        var d: i32 = 0;
        while (j < after_params.len) : (j += 1) {
            if (after_params[j] == '<') d += 1 else if (after_params[j] == '>') d -= 1;
            if (d == 0 and after_params[j] == '{') {
                type_end = j;
                break;
            }
        }
        const rt = trim(after_params[type_start..type_end]);
        if (rt.len > 0) return_type = rt;
    } else if (!is_generator and after_params.len > 0 and after_params[0] == '{') {
        // No annotation: what the body returns, as for a function.
        const inferred = try inferFunctionBodyReturnType(alloc, after_params, params, 0);
        if (!std.mem.eql(u8, inferred, "unknown") and !std.mem.eql(u8, inferred, "Promise<unknown>")) {
            return_type = if (is_async and ch.startsWith(inferred, "Promise<") and inferred[inferred.len - 1] == '>') inferred[8 .. inferred.len - 1] else inferred;
        } else if (is_async) {
            return_type = "Promise<unknown>";
        }
    }

    // Apply async/generator defaults when no explicit return type was provided
    if (std.mem.eql(u8, return_type, "unknown")) {
        if (is_async and is_generator) {
            return_type = "AsyncGenerator<unknown, void, unknown>";
        } else if (is_generator) {
            return_type = "Generator<unknown, void, unknown>";
        } else if (is_async) {
            return_type = "Promise<void>";
        }
    } else if (is_async and !ch.startsWith(return_type, "Promise<") and !ch.startsWith(return_type, "AsyncGenerator<")) {
        return_type = try std.fmt.allocPrint(alloc, "Promise<{s}>", .{return_type});
    }

    // Clean parameter defaults
    const clean_params = try cleanParameterDefaults(alloc, params);

    // Build result
    var result = std.array_list.Managed(u8).init(alloc);
    try result.appendSlice(generics);
    try result.appendSlice(clean_params);
    try result.appendSlice(" => ");
    try result.appendSlice(return_type);
    return result.toOwnedSlice();
}

/// Skip a string literal or a comment starting at `i`; returns the index of
/// its last byte, or null when `i` starts neither. Shared by the parameter
/// cleaners so a quote in JSDoc prose ("error's") cannot open a string.
fn skipParamNonCode(text: []const u8, i: usize) ?usize {
    const c = text[i];
    if (c == '"' or c == '\'' or c == '`') {
        var j = i + 1;
        while (j < text.len and text[j] != c) : (j += 1) {
            if (text[j] == '\\' and j + 1 < text.len) j += 1;
        }
        return @min(j, text.len - 1);
    }
    if (c == '/' and i + 1 < text.len) {
        if (text[i + 1] == '*') {
            var j = i + 2;
            while (j + 1 < text.len and !(text[j] == '*' and text[j + 1] == '/')) j += 1;
            return @min(j + 1, text.len - 1);
        }
        if (text[i + 1] == '/') {
            var j = i;
            while (j < text.len and text[j] != '\n') j += 1;
            return if (j > i) j - 1 else i;
        }
    }
    return null;
}

/// Bracket depth delta for one byte. The `>` of an arrow (`=>`) closes
/// nothing: counting it let `cb: () => void = () => {}` hide its default
/// below depth 0, so the initializer reached the declaration (#3093).
fn paramDepthDelta(text: []const u8, i: usize) i32 {
    return switch (text[i]) {
        '(', '[', '{', '<' => 1,
        ')', ']', '}' => -1,
        '>' => if (i > 0 and text[i - 1] == '=') 0 else -1,
        else => 0,
    };
}

/// Strip a trailing `// comment` from a parameter, respecting strings.
fn stripTrailingInlineComment(text: []const u8) []const u8 {
    var i: usize = 0;
    while (i + 1 < text.len) : (i += 1) {
        const c = text[i];
        if (c == '"' or c == '\'' or c == '`') {
            i += 1;
            while (i < text.len and text[i] != c) : (i += 1) {
                if (text[i] == '\\') i += 1;
            }
            continue;
        }
        if (c == '/' and text[i + 1] == '/') return std.mem.trimEnd(u8, text[0..i], " \t\r\n");
    }
    return text;
}

/// Clean one parameter: drop its initializer and mark it optional.
/// `name: T = v` becomes `name?: T`; an unannotated `name = v` gets a type
/// guessed from the literal, as the TypeScript emitter does.
fn cleanSingleParam(alloc: std.mem.Allocator, param: []const u8) InferError![]const u8 {
    if (ch.startsWith(param, "...")) return param;
    var colon_idx: ?usize = null;
    var equal_idx: ?usize = null;
    var depth: i32 = 0;
    var i: usize = 0;
    while (i < param.len) : (i += 1) {
        if (skipParamNonCode(param, i)) |end| {
            i = end;
            continue;
        }
        const delta = paramDepthDelta(param, i);
        if (delta != 0) {
            depth += delta;
            continue;
        }
        if (depth != 0) continue;
        const c = param[i];
        if (c == ':' and colon_idx == null) {
            colon_idx = i;
        } else if (c == '=' and equal_idx == null and
            (i == 0 or param[i - 1] != '=') and
            (i + 1 >= param.len or (param[i + 1] != '=' and param[i + 1] != '>')))
        {
            equal_idx = i;
        }
    }

    if (colon_idx) |colon| {
        if (equal_idx == null or colon < equal_idx.?) {
            const name = trim(param[0..colon]);
            const type_text = trim(if (equal_idx) |eq| param[colon + 1 .. eq] else param[colon + 1 ..]);
            const marker: []const u8 = if (equal_idx != null and !ch.endsWith(name, "?")) "?" else "";
            return std.fmt.allocPrint(alloc, "{s}{s}: {s}", .{ name, marker, type_text });
        }
    }
    if (equal_idx) |eq| {
        const name = trim(param[0..eq]);
        if (try parameter_order.defaultedObjectBinding(alloc, name, param[eq + 1 ..])) |elements| {
            const element_types = try alloc.alloc([]const u8, elements.len);
            for (elements, 0..) |element, index| element_types[index] = simpleDefaultType(element.value);
            return parameter_order.defaultedObjectBindingParameter(alloc, elements, element_types);
        }
        const marker: []const u8 = if (!ch.endsWith(name, "?")) "?" else "";
        return std.fmt.allocPrint(alloc, "{s}{s}: {s}", .{ name, marker, simpleDefaultType(param[eq + 1 ..]) });
    }
    return param;
}

/// A type guessed from a parameter default's literal form.
fn simpleDefaultType(value: []const u8) []const u8 {
    const default_value = trim(value);
    if (std.mem.eql(u8, default_value, "true") or std.mem.eql(u8, default_value, "false")) return "boolean";
    if (isNumericLiteral(default_value)) return "number";
    if (default_value.len >= 2 and ((default_value[0] == '\'' and default_value[default_value.len - 1] == '\'') or
        (default_value[0] == '"' and default_value[default_value.len - 1] == '"'))) return "string";
    if (ch.startsWith(default_value, "[")) return "unknown[]";
    if (ch.startsWith(default_value, "{")) return "Record<string, unknown>";
    return "unknown";
}

/// Clean parameter defaults from a parameter list, with or without its
/// parentheses. Port of the TypeScript emitter's cleanParameterDefaults:
/// separators and line breaks between parameters are kept as written.
fn cleanParameterDefaults(alloc: std.mem.Allocator, params: []const u8) InferError![]const u8 {
    // Fast path: if there's no '=' anywhere, the input is already clean.
    if (std.mem.indexOfScalar(u8, params, '=') == null) return params;
    const stripped = trim(params);
    const had_parens = stripped.len >= 2 and stripped[0] == '(' and stripped[stripped.len - 1] == ')';
    const inner = trim(if (had_parens) stripped[1 .. stripped.len - 1] else stripped);
    if (inner.len == 0) return if (had_parens) "()" else "";

    // Is there an initializer at depth 0 at all?
    const has_real_equal = blk: {
        var d: i32 = 0;
        var i: usize = 0;
        while (i < inner.len) : (i += 1) {
            if (skipParamNonCode(inner, i)) |end| {
                i = end;
                continue;
            }
            const delta = paramDepthDelta(inner, i);
            if (delta != 0) {
                d += delta;
                continue;
            }
            if (d == 0 and inner[i] == '=') {
                const prev: u8 = if (i > 0) inner[i - 1] else 0;
                const next: u8 = if (i + 1 < inner.len) inner[i + 1] else 0;
                if (prev != '=' and prev != '!' and prev != '<' and prev != '>' and next != '=' and next != '>') break :blk true;
            }
        }
        break :blk false;
    };
    if (!has_real_equal) return stripped;

    var parts = std.array_list.Managed([]const u8).init(alloc);
    var separators = std.array_list.Managed([]const u8).init(alloc);
    var start: usize = 0;
    var depth: i32 = 0;
    var i: usize = 0;
    while (i < inner.len) : (i += 1) {
        if (skipParamNonCode(inner, i)) |end| {
            i = end;
            continue;
        }
        const delta = paramDepthDelta(inner, i);
        if (delta != 0) {
            depth += delta;
            continue;
        }
        if (inner[i] == ',' and depth == 0) {
            try parts.append(inner[start..i]);
            var j = i + 1;
            while (j < inner.len and inner[j] <= ' ') j += 1;
            try separators.append(inner[i..j]);
            start = j;
            i = j - 1;
        }
    }
    try parts.append(inner[start..]);

    var out = std.array_list.Managed(u8).init(alloc);
    try out.ensureTotalCapacity(stripped.len);
    if (had_parens) try out.append('(');
    var emitted: usize = 0;
    for (parts.items) |part| {
        const t = trim(part);
        if (t.len > 0 and ch.startsWith(t, "//")) continue;
        if (emitted > 0) try out.appendSlice(if (emitted - 1 < separators.items.len) separators.items[emitted - 1] else ", ");
        emitted += 1;
        if (t.len == 0) {
            try out.appendSlice(part);
            continue;
        }
        const leading = part[0 .. part.len - std.mem.trimStart(u8, part, " \t\r\n").len];
        try out.appendSlice(leading);
        try out.appendSlice(try cleanSingleParam(alloc, stripTrailingInlineComment(t)));
    }
    if (had_parens) try out.append(')');
    const raw = try out.toOwnedSlice();
    errdefer alloc.free(raw);
    const result = try parameter_order.normalizeDefaultParameterOrder(alloc, raw);
    if (result.ptr != raw.ptr) alloc.free(raw);
    return result;
}

/// Parse object properties from content between braces.
/// Returns array of [key, value] pairs as slices into content.
const ObjectProperty = struct {
    key: []const u8,
    value: []const u8,
    is_method: bool,
    comments: []const u8 = "",
};

/// Keep leading property comments separate from the key and its modifiers.
/// Block and JSDoc comments are carried to the property; `//` comments are
/// dropped, as in the TypeScript emitter.
fn splitPropertyComments(alloc: std.mem.Allocator, raw: []const u8) InferError!struct { comments: []const u8, key: []const u8 } {
    const text = trim(raw);
    var kept = std.array_list.Managed(u8).init(alloc);
    var line_comment = false;
    var pos: usize = 0;
    while (pos < text.len) {
        while (pos < text.len and ch.isWhitespace(text[pos])) pos += 1;
        if (ch.startsWith(text[pos..], "/*")) {
            const end = ch.indexOf(text, "*/", pos + 2) orelse break;
            if (kept.items.len > 0) try kept.append('\n');
            try kept.appendSlice(text[pos .. end + 2]);
            pos = end + 2;
        } else if (ch.startsWith(text[pos..], "//")) {
            line_comment = true;
            pos = ch.indexOfChar(text, '\n', pos + 2) orelse text.len;
        } else break;
    }
    // Without line comments the kept text is the original prefix verbatim.
    const comments = if (line_comment) kept.items else trim(text[0..pos]);
    return .{ .comments = comments, .key = trim(text[pos..]) };
}

/// A value without its line comments, as the TypeScript emitter's property
/// parser collects it: the comment and the blanks before it go, the newline stays.
fn withoutLineComments(alloc: std.mem.Allocator, value: []const u8) InferError![]const u8 {
    if (ch.indexOf(value, "//", 0) == null) return value;
    var out = std.array_list.Managed(u8).init(alloc);
    var changed = false;
    var i: usize = 0;
    while (i < value.len) {
        const c = value[i];
        if (c == '"' or c == '\'' or c == '`') {
            var j = i + 1;
            while (j < value.len and value[j] != c) : (j += 1) {
                if (value[j] == '\\') j += 1;
            }
            const end = @min(j + 1, value.len);
            try out.appendSlice(value[i..end]);
            i = end;
            continue;
        }
        if (c == '/' and i + 1 < value.len and value[i + 1] == '*') {
            const end = if (ch.indexOf(value, "*/", i + 2)) |close| close + 2 else value.len;
            try out.appendSlice(value[i..end]);
            i = end;
            continue;
        }
        if (c == '/' and i + 1 < value.len and value[i + 1] == '/') {
            while (out.items.len > 0 and (out.items[out.items.len - 1] == ' ' or out.items[out.items.len - 1] == '\t')) _ = out.pop();
            i = ch.indexOfChar(value, '\n', i + 2) orelse value.len;
            changed = true;
            continue;
        }
        try out.append(c);
        i += 1;
    }
    return if (changed) trim(out.items) else value;
}

/// Move a shorthand method's type parameters from its key to its callable type.
fn objectProperty(alloc: std.mem.Allocator, raw_key: []const u8, raw_value: []const u8, is_method: bool) InferError!ObjectProperty {
    const split = try splitPropertyComments(alloc, raw_key);
    var key = split.key;
    // Line comments are not part of a value: a comment ending a line in a
    // multi-line parameter type would otherwise swallow the next member.
    var value = try withoutLineComments(alloc, trim(raw_value));
    if (is_method) {
        // `async` and `*` stay with the method: they decide its return type.
        var modifiers: []const u8 = "";
        if (ch.startsWith(key, "async") and key.len > 5 and ch.isWhitespace(key[5])) {
            key = trim(key[6..]);
            modifiers = "async ";
        }
        if (ch.startsWith(key, "*")) {
            key = trim(key[1..]);
            modifiers = if (modifiers.len > 0) "async *" else "*";
        }
        if (findTopLevelToken(key, "<", 0)) |start| {
            if (findMatchingBracket(key, start, '<', '>')) |end| {
                if (end == key.len - 1) {
                    value = try std.fmt.allocPrint(alloc, "{s}{s}", .{ key[start..], value });
                    key = trim(key[0..start]);
                }
            }
        }
        if (modifiers.len > 0) value = try std.fmt.allocPrint(alloc, "{s}{s}", .{ modifiers, value });
        value = try convertMethodToFunctionType(alloc, key, value);
    }
    return .{ .key = key, .value = value, .is_method = is_method, .comments = split.comments };
}

fn parseObjectProperties(alloc: std.mem.Allocator, content: []const u8) InferError![]ObjectProperty {
    var properties = std.array_list.Managed(ObjectProperty).init(alloc);
    // Pre-size: estimate property count from top-level commas
    var est: usize = 1;
    for (content) |cc| if (cc == ',') {
        est += 1;
    };
    try properties.ensureTotalCapacity(est);
    var current_start: usize = 0;
    var key_start: usize = 0;
    var key_end: usize = 0;
    var depth: i32 = 0;
    var in_string = false;
    var string_char: u8 = 0;
    var in_key = true;
    var in_comment = false;
    var is_method = false;
    var method_awaiting_body = false;
    var arrow_parameter_list_closed = false;
    var in_arrow_return_type = false;
    var type_argument_depth: i32 = 0;
    var i: usize = 0;

    while (i < content.len) : (i += 1) {
        const c = content[i];
        const prev = if (i > 0) content[i - 1] else @as(u8, 0);
        const next = if (i + 1 < content.len) content[i + 1] else @as(u8, 0);

        // Track single-line comments — SIMD scan to end of line via indexOfChar
        // instead of a byte-by-byte loop.
        if (!in_string and !in_comment and c == '/' and next == '/') {
            const nl = ch.indexOfChar(content, '\n', i + 2);
            i = if (nl) |n| n else content.len;
            continue;
        }

        // Track block comments
        if (!in_string and !in_comment and c == '/' and next == '*') {
            in_comment = true;
            i += 1;
            continue;
        }
        if (in_comment and c == '*' and next == '/') {
            in_comment = false;
            i += 1;
            continue;
        }
        if (in_comment) continue;

        if (!in_string and (c == '"' or c == '\'' or c == '`')) {
            in_string = true;
            string_char = c;
        } else if (in_string and c == string_char and !ch.isEscaped(content, i)) {
            in_string = false;
        }

        if (!in_string) {
            if (c == '.' and next == '.' and i + 2 < content.len and content[i + 2] == '.' and depth == 0 and in_key) {
                // A spread has an expression operand, not a method key. Enter
                // value mode before its parentheses or conditional colon.
                key_start = current_start;
                key_end = i + 3;
                current_start = i + 3;
                in_key = false;
                is_method = false;
                i += 2;
            } else if (c == '(' and depth == 0 and in_key and type_argument_depth == 0) {
                // Method definition — must check BEFORE general bracket tracking
                key_start = current_start;
                key_end = i;
                current_start = i;
                in_key = false;
                is_method = true;
                depth = 1;
            } else if (c == '{' or c == '[' or c == '(') {
                depth += 1;
                if (c == '{' and method_awaiting_body) method_awaiting_body = false;
            } else if (c == '}' or c == ']' or c == ')') {
                depth -= 1;
                if (c == ')' and depth == 0 and !in_key and !is_method) arrow_parameter_list_closed = true;
                if (c == ')' and depth == 0 and is_method) method_awaiting_body = true;
            } else if (c == ':' and depth == 0 and in_key and type_argument_depth == 0) {
                key_start = current_start;
                key_end = i;
                current_start = i + 1;
                in_key = false;
                is_method = false;
            } else if (c == ':' and depth == 0 and arrow_parameter_list_closed) {
                in_arrow_return_type = true;
            } else if (c == '<' and (in_arrow_return_type or (in_key and depth == 0) or method_awaiting_body)) {
                type_argument_depth += 1;
            } else if (c == '>' and type_argument_depth > 0 and prev != '=') {
                type_argument_depth -= 1;
            } else if (c == '=' and next == '>' and in_arrow_return_type and type_argument_depth == 0) {
                in_arrow_return_type = false;
                arrow_parameter_list_closed = false;
            } else if (c == ',' and depth == 0 and type_argument_depth == 0 and !method_awaiting_body) {
                if (!in_key) {
                    const key = trim(content[key_start..key_end]);
                    const val = trim(content[current_start..i]);
                    if (key.len > 0 and val.len > 0) {
                        try properties.append(try objectProperty(alloc, key, val, is_method));
                    }
                } else {
                    const shorthand = trim(content[current_start..i]);
                    if (isIdentifierName(shorthand)) {
                        try properties.append(.{ .key = shorthand, .value = shorthand, .is_method = false });
                    } else if (ch.startsWith(shorthand, "...") and shorthand.len > 3) {
                        try properties.append(.{ .key = "...", .value = trim(shorthand[3..]), .is_method = false });
                    }
                }
                current_start = i + 1;
                in_key = true;
                is_method = false;
                method_awaiting_body = false;
                arrow_parameter_list_closed = false;
                in_arrow_return_type = false;
                type_argument_depth = 0;
            }
        }
    }

    // Last property
    if (!in_key) {
        const key = trim(content[key_start..key_end]);
        const val = trim(content[current_start..content.len]);
        if (key.len > 0 and val.len > 0) {
            try properties.append(try objectProperty(alloc, key, val, is_method));
        }
    } else {
        const shorthand = trim(content[current_start..content.len]);
        if (isIdentifierName(shorthand)) {
            try properties.append(.{ .key = shorthand, .value = shorthand, .is_method = false });
        } else if (ch.startsWith(shorthand, "...") and shorthand.len > 3) {
            try properties.append(.{ .key = "...", .value = trim(shorthand[3..]), .is_method = false });
        }
    }

    // toOwnedSlice() trims unused capacity — important for non-arena callers.
    return properties.toOwnedSlice();
}

test "object spread operands are expressions rather than method declarations" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const properties = try parseObjectProperties(
        arena.allocator(),
        "before: 1, /* optional */ ...(enabled ? { values: [...items] } : {}), ...factory(1, 2), after() { return true }",
    );
    try std.testing.expectEqual(@as(usize, 4), properties.len);
    try std.testing.expectEqualStrings("...", properties[1].key);
    try std.testing.expectEqualStrings("(enabled ? { values: [...items] } : {})", properties[1].value);
    try std.testing.expect(!properties[1].is_method);
    try std.testing.expectEqualStrings("...", properties[2].key);
    try std.testing.expectEqualStrings("factory(1, 2)", properties[2].value);
    try std.testing.expect(!properties[2].is_method);
    try std.testing.expectEqualStrings("after", properties[3].key);
    try std.testing.expect(properties[3].is_method);
}

/// Find matching bracket (open/close) starting from `start`, skipping strings and comments.
fn findMatchingBracket(str: []const u8, start: usize, open: u8, close: u8) ?usize {
    var depth: i32 = 0;
    var i = start;
    while (i < str.len) : (i += 1) {
        const c = str[i];
        // Skip string literals — handle backslash escapes, otherwise SIMD-scan
        // for the next quote/backslash byte.
        if (c == '"' or c == '\'' or c == '`') {
            i += 1;
            while (i < str.len) {
                if (str[i] == '\\') {
                    i += 2;
                    continue;
                }
                if (str[i] == c) break;
                i += 1;
            }
            continue;
        }
        // Skip line comments — SIMD-scan to the next newline instead of walking
        // bytes one at a time.
        if (c == '/' and i + 1 < str.len and str[i + 1] == '/') {
            const nl = ch.indexOfChar(str, '\n', i + 2);
            i = if (nl) |n| n else str.len;
            if (i == str.len) break;
            continue;
        }
        // Skip block comments — indexOf jumps directly to `*/` via SIMD first-byte scan.
        if (c == '/' and i + 1 < str.len and str[i + 1] == '*') {
            const end = ch.indexOf(str, "*/", i + 2);
            i = if (end) |e| e + 1 else str.len;
            if (i == str.len) break;
            continue;
        }
        if (c == open) {
            depth += 1;
        } else if (c == close and !(close == '>' and i > 0 and str[i - 1] == '=')) {
            depth -= 1;
            if (depth == 0) return i;
        }
    }
    return null;
}

/// Find a token outside strings and nested expression delimiters.
fn findTopLevelToken(str: []const u8, token: []const u8, start: usize) ?usize {
    // Only an occurrence of the token can be returned, and most values hold
    // none of the operators they are probed for: a vectorized search skips
    // the bracket-tracking walk.
    if (start >= str.len or ch.indexOf(str, token, start) == null) return null;
    var paren_depth: i32 = 0;
    var bracket_depth: i32 = 0;
    var brace_depth: i32 = 0;
    var i = start;
    while (i + token.len <= str.len) : (i += 1) {
        const c = str[i];
        if (c == '"' or c == '\'' or c == '`') {
            i += 1;
            while (i < str.len and str[i] != c) : (i += 1) {
                if (str[i] == '\\' and i + 1 < str.len) i += 1;
            }
            continue;
        }
        // Comments are trivia: an apostrophe or bracket in one is not code.
        if (c == '/' and i + 1 < str.len and str[i + 1] == '/') {
            i = (std.mem.indexOfScalarPos(u8, str, i + 2, '\n') orelse str.len) - 1;
            continue;
        }
        if (c == '/' and i + 1 < str.len and str[i + 1] == '*') {
            i = (if (std.mem.indexOfPos(u8, str, i + 2, "*/")) |close| close + 2 else str.len) - 1;
            continue;
        }
        if (c == '(') paren_depth += 1 else if (c == ')') paren_depth -= 1 else if (c == '[') bracket_depth += 1 else if (c == ']') bracket_depth -= 1 else if (c == '{') brace_depth += 1 else if (c == '}') brace_depth -= 1;
        if (paren_depth == 0 and bracket_depth == 0 and brace_depth == 0 and std.mem.startsWith(u8, str[i..], token)) return i;
    }
    return null;
}

fn findTopLevelComma(alloc: std.mem.Allocator, str: []const u8) InferError!?usize {
    if (ch.indexOfChar(str, ',', 0) == null) return null;
    var paren_depth: i32 = 0;
    var bracket_depth: i32 = 0;
    var brace_depth: i32 = 0;
    var reader: ?@import("initializer_type_spans.zig").Reader = null;
    defer if (reader) |*parser| parser.deinit();
    var complete_operand_end: ?usize = null;
    var last_comma: ?usize = null;
    var i: usize = 0;
    while (i < str.len) : (i += 1) {
        const c = str[i];
        if (c == '"' or c == '\'' or c == '`') {
            i += 1;
            while (i < str.len and str[i] != c) : (i += 1) {
                if (str[i] == '\\' and i + 1 < str.len) i += 1;
            }
            continue;
        }
        // Comments are trivia: an apostrophe or bracket in one is not code.
        if (c == '/' and i + 1 < str.len and str[i + 1] == '/') {
            i = (std.mem.indexOfScalarPos(u8, str, i + 2, '\n') orelse str.len) - 1;
            continue;
        }
        if (c == '/' and i + 1 < str.len and str[i + 1] == '*') {
            i = (if (std.mem.indexOfPos(u8, str, i + 2, "*/")) |close| close + 2 else str.len) - 1;
            continue;
        }
        if (c == '/' and @import("lexical.zig").isRegexStart(str, i)) {
            i = @import("lexical.zig").skipRegex(str, i) - 1;
            continue;
        }
        if (c == '<' and paren_depth == 0 and bracket_depth == 0 and brace_depth == 0) {
            if (reader == null) reader = try @import("initializer_type_spans.zig").Reader.initOwned(alloc, str);
            if (try reader.?.read(i, 0, complete_operand_end)) |span| {
                i = span.end - 1;
                complete_operand_end = if (span.complete_operand) span.end else null;
                continue;
            }
        }
        if (c == '(') paren_depth += 1 else if (c == ')') paren_depth -= 1 else if (c == '[') bracket_depth += 1 else if (c == ']') bracket_depth -= 1 else if (c == '{') brace_depth += 1 else if (c == '}') brace_depth -= 1;
        if (c == ',' and paren_depth == 0 and bracket_depth == 0 and brace_depth == 0) last_comma = i;
    }
    return last_comma;
}

/// Find the main arrow (=>) in a function, ignoring nested arrows
/// Element type contributed by spreading a value of `spread_type`: `T[]` gives
/// `T`, a tuple its members and an empty tuple nothing; a union of those
/// combines its members (tuples only in const contexts). Null when any member
/// is not usable.
fn spreadElementType(alloc: std.mem.Allocator, spread_type: []const u8, is_const: bool) InferError!?[]const u8 {
    var members = std.array_list.Managed([]const u8).init(alloc);
    var depth: i32 = 0;
    var start: usize = 0;
    var i: usize = 0;
    while (i <= spread_type.len) : (i += 1) {
        const c: u8 = if (i == spread_type.len) '|' else spread_type[i];
        switch (c) {
            '(', '[', '{', '<' => depth += 1,
            ')', ']', '}', '>' => depth -= 1,
            '|' => if (depth == 0) {
                var member = trim(spread_type[start..i]);
                start = i + 1;
                if (ch.startsWith(member, "readonly ")) member = trim(member[9..]);
                if (member.len >= 2 and member[0] == '[' and member[member.len - 1] == ']') {
                    // Tuple members carry literal types; a mutable array would
                    // need them widened, so only const contexts use them.
                    if (!is_const or findMatchingBracket(member, 0, '[', ']') != member.len - 1) return null;
                    for (try parseArrayElements(alloc, member[1 .. member.len - 1])) |element| try members.append(element);
                } else if (ch.endsWith(member, "[]")) {
                    const inner = trim(member[0 .. member.len - 2]);
                    // `(A | B)[]` contributes A | B; `T[]` contributes T.
                    const unwrapped = if (inner.len >= 2 and inner[0] == '(' and findMatchingBracket(inner, 0, '(', ')') == inner.len - 1) inner[1 .. inner.len - 1] else inner;
                    try members.append(unwrapped);
                } else return null;
            },
            else => {},
        }
    }
    if (members.items.len == 0) return "never";
    var result: []const u8 = members.items[0];
    for (members.items[1..]) |member| result = try unionOf(alloc, result, member);
    return result;
}

/// `left | right` with duplicate members removed; `unknown` absorbs the union.
fn unionOf(alloc: std.mem.Allocator, left: []const u8, right: []const u8) InferError![]const u8 {
    if (std.mem.eql(u8, left, right)) return left;
    if (std.mem.eql(u8, left, "unknown") or std.mem.eql(u8, right, "unknown")) return "unknown";
    var members = std.array_list.Managed([]const u8).init(alloc);
    defer members.deinit();
    for ([_][]const u8{ left, right }) |side| {
        var depth: i32 = 0;
        var start: usize = 0;
        var i: usize = 0;
        while (i <= side.len) : (i += 1) {
            const at_end = i == side.len;
            const c: u8 = if (at_end) '|' else side[i];
            switch (c) {
                '(', '[', '{', '<' => depth += 1,
                ')', ']', '}', '>' => depth -= 1,
                '|' => if (depth == 0) {
                    const member = trim(side[start..i]);
                    if (member.len > 0) {
                        if (std.mem.eql(u8, member, "unknown")) return "unknown";
                        var seen = false;
                        for (members.items) |existing| {
                            if (std.mem.eql(u8, existing, member)) seen = true;
                        }
                        if (!seen) try members.append(member);
                    }
                    start = i + 1;
                },
                else => {},
            }
        }
    }
    if (members.items.len == 1) return members.items[0];
    return std.mem.join(alloc, " | ", members.items);
}

/// Whether `value` is a single operand (identifier, member chain, call or
/// element access) with no top-level binary operator.
fn inferPrefixAssertion(alloc: std.mem.Allocator, value: []const u8) InferError!?[]const u8 {
    if (!ch.startsWith(value, "<")) return null;
    var reader = try @import("initializer_type_spans.zig").Reader.initOwned(alloc, value);
    defer reader.deinit();
    const span = try reader.read(0, 0, null) orelse return null;
    if (span.parameters or span.complete_operand or trim(value[span.end..]).len == 0 or !try isUnaryOperand(alloc, trim(value[span.end..]))) return null;
    return trim(value[1 .. span.end - 1]);
}

fn isUnaryOperand(alloc: std.mem.Allocator, raw_value: []const u8) InferError!bool {
    const value = withoutEdgeComments(raw_value);
    var reader: ?@import("initializer_type_spans.zig").Reader = null;
    defer if (reader) |*parser| parser.deinit();
    var depth: i32 = 0;
    var i: usize = 0;
    while (i < value.len) : (i += 1) {
        const c = value[i];
        if (c == '/') {
            if (i + 1 < value.len and value[i + 1] == '/') {
                i = ch.lineCommentEnd(value, i + 2);
                continue;
            }
            if (i + 1 < value.len and value[i + 1] == '*') {
                i = if (std.mem.indexOfPos(u8, value, i + 2, "*/")) |end| end + 1 else value.len;
                continue;
            }
            if (@import("lexical.zig").isRegexStart(value, i)) {
                i = @import("lexical.zig").skipRegex(value, i) - 1;
                continue;
            }
        }
        if (c == '<' and depth == 0) {
            if (reader == null) reader = try @import("initializer_type_spans.zig").Reader.initOwned(alloc, value);
            if (try reader.?.read(i, 0, null)) |span| {
                i = span.end - 1;
                continue;
            }
        }
        switch (c) {
            '\'', '"', '`' => {
                var j = i + 1;
                while (j < value.len and value[j] != c) : (j += 1) {
                    if (value[j] == '\\') j += 1;
                }
                i = j;
            },
            '(', '[', '{' => depth += 1,
            ')', ']', '}' => depth -= 1,
            '?' => if (depth == 0 and !(i + 1 < value.len and value[i + 1] == '.')) return false,
            '=', '!', '<', '>', '&', '|', '+', '-', '*', '/', '%', ',', ':' => if (depth == 0) return false,
            ' ', '\t', '\n', '\r' => if (depth == 0) {
                const prefix = withoutEdgeComments(value[0..i]);
                var word_start = prefix.len;
                while (word_start > 0 and std.ascii.isAlphabetic(prefix[word_start - 1])) word_start -= 1;
                const words = [_][]const u8{ "new", "void", "typeof", "delete", "await", "yield" };
                var unary_keyword = false;
                for (words) |word| if (std.mem.eql(u8, prefix[word_start..], word)) {
                    unary_keyword = true;
                    break;
                };
                const rest = std.mem.trimStart(u8, value[i..], " \t\n\r");
                i = value.len - rest.len - 1;
                if (unary_keyword) continue;
                if (rest.len > 0 and rest[0] != '.' and rest[0] != '?' and rest[0] != '(' and rest[0] != '[') return false;
            },
            else => {},
        }
    }
    return true;
}

/// Rightmost `+ - * / %` outside brackets, string/template literals and
/// comments. Splitting inside a literal (`'dist/index.js'`) would hand an
/// unterminated half to later tokenization.
fn lastTopLevelArithmetic(value: []const u8) ?usize {
    var depth: i32 = 0;
    var last: ?usize = null;
    var i: usize = 0;
    while (i < value.len) : (i += 1) {
        const c = value[i];
        switch (c) {
            '\'', '"', '`' => {
                var j = i + 1;
                while (j < value.len and value[j] != c) : (j += 1) {
                    if (value[j] == '\\') j += 1;
                }
                i = j;
            },
            '/' => {
                if (i + 1 < value.len and value[i + 1] == '/') {
                    i = std.mem.indexOfScalarPos(u8, value, i + 2, '\n') orelse value.len;
                } else if (i + 1 < value.len and value[i + 1] == '*') {
                    i = if (std.mem.indexOfPos(u8, value, i + 2, "*/")) |end| end + 1 else value.len;
                } else if (depth == 0) last = i;
            },
            '(', '[', '{' => depth += 1,
            ')', ']', '}' => depth -= 1,
            '+', '-', '*', '%' => if (depth == 0) {
                last = i;
            },
            else => {},
        }
    }
    return last;
}

fn findMainArrowIndex(str: []const u8) ?usize {
    // Only an existing `=>` can be returned; most data initializers have none,
    // so a vectorized substring check avoids the depth-tracking walk.
    if (ch.indexOf(str, "=>", 0) == null) return null;
    var paren_depth: i32 = 0;
    var bracket_depth: i32 = 0;
    var brace_depth: i32 = 0;
    var angle_depth: i32 = 0;
    var in_string = false;
    var string_char: u8 = 0;

    var i: usize = 0;
    while (i + 1 < str.len) : (i += 1) {
        const c = str[i];

        if (in_string) {
            if (c == '\\') {
                i += 1; // skip escaped char
                continue;
            }
            if (c == string_char and !ch.isEscaped(str, i)) in_string = false;
            continue;
        }

        if (c == '"' or c == '\'' or c == '`') {
            in_string = true;
            string_char = c;
            continue;
        }

        if (c == '(') paren_depth += 1 else if (c == ')') paren_depth -= 1 else if (c == '[') bracket_depth += 1 else if (c == ']') bracket_depth -= 1 else if (c == '{') brace_depth += 1 else if (c == '}') brace_depth -= 1 else if (c == '<') angle_depth += 1 else if (c == '>') {
            if (angle_depth > 0) angle_depth -= 1;
        }

        if (c == '=' and str[i + 1] == '>' and paren_depth == 0 and bracket_depth == 0 and brace_depth == 0 and angle_depth == 0) {
            return i;
        }
    }
    return null;
}

/// The TypeScript emitter's arrow search, used where the native engine must
/// decide exactly as it does: braces do not nest, so an arrow inside an object
/// argument counts (`defineStore('id', { state: () => ... })`).
fn findArrowOutsideParens(str: []const u8) ?usize {
    // Only an existing `=>` can be returned; most data initializers have none,
    // so a vectorized substring check avoids the walk.
    if (ch.indexOf(str, "=>", 0) == null) return null;
    // Mirrors the TypeScript emitter: parentheses and brackets nest, braces do
    // not, and a balanced `<...>` (type arguments) is skipped whole so an arrow
    // inside a type argument is not the value's main arrow.
    var paren_depth: i32 = 0;
    var bracket_depth: i32 = 0;
    var in_string = false;
    var string_char: u8 = 0;
    var i: usize = 0;
    while (i + 1 < str.len) : (i += 1) {
        const c = str[i];
        const prev: u8 = if (i > 0) str[i - 1] else 0;
        if (!in_string and (c == '"' or c == '\'' or c == '`')) {
            in_string = true;
            string_char = c;
        } else if (in_string and c == string_char and prev != '\\') {
            in_string = false;
        }
        if (in_string) continue;
        if (c == '<') {
            if (findMatchingBracket(str, i, '<', '>')) |end| {
                i = end;
                continue;
            }
        }
        if (c == '(') paren_depth += 1 else if (c == ')') paren_depth -= 1 else if (c == '[') bracket_depth += 1 else if (c == ']') bracket_depth -= 1;
        if (c == '=' and str[i + 1] == '>' and paren_depth == 0 and bracket_depth == 0) return i;
    }
    return null;
}

/// Extract inner function signature from a higher-order function body.
/// For bodies like "(value: number) => value * factor", extracts "(value: number) => any".
/// For generic functions where generics include 'T' and inner params include 'T',
/// uses 'T' as the return type instead of 'any'.
fn extractInnerFunctionSignature(alloc: std.mem.Allocator, body: []const u8, generics: []const u8) InferError![]const u8 {
    const trimmed_body = trim(body);
    // Match pattern: \s*(params)\s*=>
    if (trimmed_body.len > 0 and trimmed_body[0] == '(') {
        if (findMatchingBracket(trimmed_body, 0, '(', ')')) |paren_end| {
            const inner_params = trim(trimmed_body[1..paren_end]);
            // Check if this is a generic function where T appears in both generics and inner params
            const has_generic_t = generics.len > 0 and ch.contains(generics, "T");
            const inner_has_t = ch.contains(inner_params, "T");
            const inner_return = if (has_generic_t and inner_has_t) "T" else "any";
            var result = std.array_list.Managed(u8).init(alloc);
            try result.appendSlice("(");
            try result.appendSlice(inner_params);
            try result.appendSlice(") => ");
            try result.appendSlice(inner_return);
            return result.toOwnedSlice();
        }
    }
    return "any";
}

const ArrowSignature = struct {
    params: []const u8,
    return_type: []const u8,
};

fn splitArrowSignature(value: []const u8) ArrowSignature {
    const input = trim(value);
    if (input.len == 0 or input[0] != '(') return .{ .params = input, .return_type = "" };
    const close = findMatchingBracket(input, 0, '(', ')') orelse return .{ .params = input, .return_type = "" };
    const suffix = trim(input[close + 1 ..]);
    return .{
        .params = input[0 .. close + 1],
        .return_type = if (suffix.len > 0 and suffix[0] == ':') trim(suffix[1..]) else "",
    };
}

fn skipReturnTrivia(content: []const u8, start: usize) usize {
    var index = start;
    while (index < content.len) {
        if (ch.isWhitespace(content[index])) {
            index += 1;
            continue;
        }
        if (content[index] == '/') {
            if (skipParamNonCode(content, index)) |end| {
                index = end + 1;
                continue;
            }
        }
        break;
    }
    return index;
}

fn nextReturnScopeBlock(content: []const u8, start: usize) ?usize {
    var index = start;
    var parens: isize = 0;
    var brackets: isize = 0;
    var angles: isize = 0;
    var annotation = false;
    var expects_type = false;
    while (index < content.len) : (index += 1) {
        index = skipReturnTrivia(content, index);
        if (index >= content.len) break;
        const byte = content[index];
        if (skipParamNonCode(content, index)) |end| {
            index = end;
            expects_type = false;
            continue;
        }
        if (ch.isIdentChar(byte)) {
            const word_start = index;
            while (index + 1 < content.len and ch.isIdentChar(content[index + 1])) index += 1;
            const word = content[word_start .. index + 1];
            expects_type = false;
            for ([_][]const u8{ "keyof", "typeof", "readonly", "unique", "new", "abstract", "infer", "extends" }) |operator| {
                if (annotation and std.mem.eql(u8, word, operator)) expects_type = true;
            }
            continue;
        }
        if (byte == '=' and index + 1 < content.len and content[index + 1] == '>') {
            index += 1;
            expects_type = annotation;
            continue;
        }
        if (byte == '(') parens += 1 else if (byte == ')') {
            parens -= 1;
            expects_type = false;
        } else if (byte == '[') brackets += 1 else if (byte == ']') {
            brackets -= 1;
            expects_type = false;
        } else if (byte == '<' and parens == 0 and brackets == 0) angles += 1 else if (byte == '>' and angles > 0 and parens == 0 and brackets == 0) {
            angles -= 1;
            expects_type = false;
        } else if (byte == '{') {
            if (parens != 0 or brackets != 0 or angles != 0 or annotation and expects_type) {
                index = findMatchingBracket(content, index, '{', '}') orelse return null;
                expects_type = false;
            } else return index;
        } else if (parens == 0 and brackets == 0 and angles == 0) {
            if (byte == ':') {
                annotation = true;
                expects_type = true;
            } else if (annotation and (byte == '|' or byte == '&' or byte == '?')) expects_type = true else if (byte == ';') return null;
        }
    }
    return null;
}

fn wordAt(content: []const u8, index: usize, word: []const u8) bool {
    return ch.startsWith(content[index..], word) and (index == 0 or !ch.isIdentChar(content[index - 1])) and
        (index + word.len == content.len or !ch.isIdentChar(content[index + word.len]));
}

pub fn inferFunctionBodyReturnType(alloc: std.mem.Allocator, body: []const u8, parameters: []const u8, depth: usize) InferError![]const u8 {
    return inferFunctionBodyReturnTypeScoped(alloc, body, parameters, depth, null);
}

pub fn inferFunctionBodyReturnTypeScoped(alloc: std.mem.Allocator, body: []const u8, parameters: []const u8, depth: usize, class_scope: ?*ClassScope) InferError![]const u8 {
    return inferFunctionBodyReturnTypeGeneric(alloc, body, parameters, depth, class_scope, "");
}

pub fn inferFunctionBodyReturnTypeGeneric(alloc: std.mem.Allocator, body: []const u8, raw_parameters: []const u8, depth: usize, class_scope: ?*ClassScope, generics: []const u8) InferError![]const u8 {
    const parameters = try bodyParameters(alloc, raw_parameters, class_scope);
    const content = if (body.len >= 2 and body[0] == '{' and body[body.len - 1] == '}') body[1 .. body.len - 1] else body;
    var return_scope = return_scopes.Scope.init(alloc, class_scope, content, generics);
    defer return_scope.deinit();
    var return_types = std.array_list.Managed([]const u8).init(alloc);
    var has_bare_return = false;
    var i: usize = 0;
    while (i < content.len) {
        if (content[i] == '"' or content[i] == '\'' or content[i] == '`') {
            const quote = content[i];
            i += 1;
            while (i < content.len) : (i += 1) {
                if (content[i] == quote and !ch.isEscaped(content, i)) {
                    i += 1;
                    break;
                }
            }
            continue;
        }
        if (content[i] == '/' and i + 1 < content.len and content[i + 1] == '/') {
            i = ch.indexOfChar(content, '\n', i + 2) orelse content.len;
            continue;
        }
        if (content[i] == '/' and i + 1 < content.len and content[i + 1] == '*') {
            i = if (ch.indexOf(content, "*/", i + 2)) |end| end + 2 else content.len;
            continue;
        }
        // Nested implementations have their own return signature. Their
        // balanced blocks do not contribute to the enclosing callable.
        if (wordAt(content, i, "function") or wordAt(content, i, "class")) {
            if (nextReturnScopeBlock(content, i)) |open| {
                if (findMatchingBracket(content, open, '{', '}')) |close| {
                    i = close + 1;
                    continue;
                }
            }
        }
        if (ch.startsWith(content[i..], "=>")) {
            const open = skipReturnTrivia(content, i + 2);
            if (open < content.len and content[open] == '{') {
                if (findMatchingBracket(content, open, '{', '}')) |close| {
                    i = close + 1;
                    continue;
                }
            }
        }
        if (!ch.startsWith(content[i..], "return") or (i > 0 and ch.isIdentChar(content[i - 1])) or (i + 6 < content.len and ch.isIdentChar(content[i + 6]))) {
            i += 1;
            continue;
        }

        i += 6;
        var saw_line_break = false;
        while (i < content.len and ch.isWhitespace(content[i])) : (i += 1) {
            if (content[i] == '\n' or content[i] == '\r') saw_line_break = true;
        }
        if (saw_line_break or i >= content.len or content[i] == ';' or content[i] == '}') {
            has_bare_return = true;
            continue;
        }

        // The TypeScript emitter's expression scan: strings and comments do
        // not count toward nesting, and a comment after the expression ends it.
        const expression_start = i;
        var paren_depth: i32 = 0;
        var bracket_depth: i32 = 0;
        var brace_depth: i32 = 0;
        while (i < content.len) {
            const c = content[i];
            if (c == '"' or c == '\'' or c == '`') {
                i = skipQuotedValue(content, i, c);
                continue;
            }
            if (c == '/' and i + 1 < content.len and content[i + 1] == '/') {
                if (paren_depth == 0 and bracket_depth == 0 and brace_depth == 0) break;
                i = ch.lineCommentEnd(content, i + 2);
                continue;
            }
            if (c == '/' and i + 1 < content.len and content[i + 1] == '*') {
                i = if (ch.indexOf(content, "*/", i + 2)) |end| end + 2 else content.len;
                continue;
            }
            if (c == '(') paren_depth += 1 else if (c == ')') paren_depth -= 1 else if (c == '[') bracket_depth += 1 else if (c == ']') bracket_depth -= 1 else if (c == '{') brace_depth += 1 else if (c == '}') {
                if (brace_depth == 0 and paren_depth == 0 and bracket_depth == 0) break;
                brace_depth -= 1;
            } else if (c == ';' and paren_depth == 0 and bracket_depth == 0 and brace_depth == 0) break else if ((c == '\n' or c == '\r') and paren_depth == 0 and bracket_depth == 0 and brace_depth == 0) {
                var next = i + 1;
                while (next < content.len and ch.isWhitespace(content[next])) next += 1;
                if (ch.startsWith(content[next..], "return") and (next + 6 >= content.len or !ch.isIdentChar(content[next + 6]))) break;
            }
            i += 1;
        }
        const expression = trim(content[expression_start..i]);
        // No comments in a return type: a returned literal's properties are
        // not defaults, and an inferred type is embedded in other JSDoc
        // (`@defaultValue`), where a nested `*/` ends the comment early.
        const inferred = try withoutComments(alloc, try inferBodyExpressionTypeScoped(alloc, expression, parameters, depth + 1, class_scope, &return_scope));
        if (!containsType(return_types.items, inferred)) try return_types.append(inferred);
    }

    if (has_bare_return and !containsType(return_types.items, "undefined")) try return_types.append("undefined");
    if (return_types.items.len == 0) return "void";
    if (containsType(return_types.items, "unknown")) return return_scope.finish("unknown");
    if (return_types.items.len == 1) return return_scope.finish(return_types.items[0]);
    var result = std.array_list.Managed(u8).init(alloc);
    for (return_types.items, 0..) |return_type, index| {
        if (index > 0) try result.appendSlice(" | ");
        // A callback beside other results needs parentheses: `(() => void) | undefined`.
        const callable = findArrowOutsideParens(return_type) != null;
        if (callable) try result.append('(');
        try result.appendSlice(return_type);
        if (callable) try result.append(')');
    }
    return return_scope.finish(try result.toOwnedSlice());
}

/// A type without block comments or the blank lines they leave behind.
fn withoutComments(alloc: std.mem.Allocator, value: []const u8) InferError![]const u8 {
    if (ch.indexOf(value, "/*", 0) == null) return value;
    var stripped = std.array_list.Managed(u8).init(alloc);
    var i: usize = 0;
    while (i < value.len) {
        if (value[i] == '/' and i + 1 < value.len and value[i + 1] == '*') {
            i = if (ch.indexOf(value, "*/", i + 2)) |end| end + 2 else value.len;
            continue;
        }
        try stripped.append(value[i]);
        i += 1;
    }
    // Drop lines left empty (`\n<blank>` before another newline).
    var out = std.array_list.Managed(u8).init(alloc);
    var line_start: usize = 0;
    const text = stripped.items;
    while (line_start <= text.len) {
        const nl = ch.indexOfChar(text, '\n', line_start) orelse text.len;
        const line = text[line_start..nl];
        const blank = std.mem.trim(u8, line, " \t").len == 0;
        if (!(blank and line_start > 0 and nl < text.len)) {
            if (line_start > 0) try out.append('\n');
            try out.appendSlice(line);
        }
        if (nl >= text.len) break;
        line_start = nl + 1;
    }
    return trim(out.items);
}

fn inferBodyExpressionType(alloc: std.mem.Allocator, expression: []const u8, parameters: []const u8, depth: usize) InferError![]const u8 {
    return inferBodyExpressionTypeScoped(alloc, expression, parameters, depth, null, null);
}

fn inferBodyExpressionTypeScoped(alloc: std.mem.Allocator, expression: []const u8, parameters: []const u8, depth: usize, class_scope: ?*ClassScope, return_scope: ?*return_scopes.Scope) InferError![]const u8 {
    if (depth >= MAX_INFERENCE_DEPTH) return "unknown";
    var value = trim(expression);
    while (value.len >= 2 and value[0] == '(' and value[value.len - 1] == ')' and findMatchingBracket(value, 0, '(', ')') == value.len - 1) {
        value = trim(value[1 .. value.len - 1]);
    }
    if (class_scope) |scope| {
        if (try @import("class_expressions.zig").resolve(scope, value)) |class_type| return class_type;
    }
    if (class_scope) |scope| {
        if (try @import("semantic_context.zig").expressionType(scope, value)) |known| return known;
    }
    if (isJsxExpression(value)) return "JSX.Element";
    if (std.mem.indexOfScalar(u8, value, '.')) |dot| {
        if (findParameterType(parameters, value[0..dot])) |object| {
            if (try objectMemberType(alloc, object, value[dot + 1 ..])) |property| return property;
            if (isEntityName(value)) return substituteBodyQueries(alloc, try std.fmt.allocPrint(alloc, "typeof {s}", .{value}), parameters);
        }
    }
    if (findParameterType(parameters, value)) |parameter_type| return parameter_type;
    // The checks below follow the TypeScript emitter's order.
    if (value.len > 0 and value[0] == '!') return "boolean";
    if (ch.startsWith(value, "fetch(")) return "Promise<Response>";
    if (try inferBodyCallType(alloc, value, parameters)) |call_type| return call_type;
    // A callback's signature and body belong to that value, not to the
    // enclosing expression's comparison/conditional operators.
    if (isFunctionExpression(value)) return inferNarrowType(alloc, value, false, false, depth + 1);

    if (splitTopLevelConditional(value)) |conditional| {
        const when_true = try inferBodyExpressionTypeScoped(alloc, conditional.when_true, parameters, depth + 1, class_scope, return_scope);
        const when_false = try inferBodyExpressionTypeScoped(alloc, conditional.when_false, parameters, depth + 1, class_scope, return_scope);
        if (std.mem.eql(u8, when_true, when_false)) return when_true;
        const left = if (findMainArrowIndex(when_true) != null) try std.fmt.allocPrint(alloc, "({s})", .{when_true}) else when_true;
        const right = if (findMainArrowIndex(when_false) != null) try std.fmt.allocPrint(alloc, "({s})", .{when_false}) else when_false;
        return std.fmt.allocPrint(alloc, "{s} | {s}", .{ left, right });
    }
    // Assertions bind more tightly than logical expressions. Resolve each
    // operand in its scope before combining their public value types.
    inline for (.{ "??", "||", "&&" }) |operator| {
        if (findTopLevelToken(value, operator, 0)) |index| {
            const left = try inferBodyExpressionTypeScoped(alloc, value[0..index], parameters, depth + 1, class_scope, return_scope);
            const right = try inferBodyExpressionTypeScoped(alloc, value[index + operator.len ..], parameters, depth + 1, class_scope, return_scope);
            return logicalBodyType(alloc, left, right, operator);
        }
    }
    if (return_scope) |scope| {
        if (try return_scopes.assertion(alloc, value)) |asserted| {
            if (try scope.resolve(asserted)) |resolved| return resolved;
        }
    }
    if (try inferPrefixAssertion(alloc, value)) |asserted| {
        if (return_scope) |scope| {
            if (try scope.resolve(asserted)) |resolved| return resolved;
        }
        return asserted;
    }
    if (try hasTopLevelComparison(alloc, value)) return "boolean";

    if (lastTopLevelArithmetic(value)) |i| {
        const c = value[i];
        const left = try inferBodyExpressionTypeScoped(alloc, value[0..i], parameters, depth + 1, class_scope, return_scope);
        const right = try inferBodyExpressionTypeScoped(alloc, value[i + 1 ..], parameters, depth + 1, class_scope, return_scope);
        if (c == '+' and (std.mem.eql(u8, left, "string") or std.mem.eql(u8, right, "string"))) return "string";
        if (std.mem.eql(u8, left, "number") and std.mem.eql(u8, right, "number")) return "number";
    }

    if (value.len >= 2 and value[0] == '[' and value[value.len - 1] == ']') spread_array: {
        const elements = try parseArrayElements(alloc, value[1 .. value.len - 1]);
        var has_spread = false;
        for (elements) |element| {
            if (ch.startsWith(trim(element), "...")) has_spread = true;
        }
        if (!has_spread) break :spread_array;
        var element_type: ?[]const u8 = null;
        for (elements) |element| {
            const item = trim(element);
            const spread = ch.startsWith(item, "...");
            const inferred_item = if (item.len == 0) "undefined" else try inferBodyExpressionTypeScoped(alloc, if (spread) trim(item[3..]) else item, parameters, depth + 1, class_scope, return_scope);
            // A source-valid spread supplies an iterable, potentially narrowed
            // by its enclosing branch. Its iteration value, not a readonly
            // tuple or an optional indexed access, is the new array's element.
            const item_type = if (spread)
                try std.fmt.allocPrint(alloc, "(NonNullable<{s}> extends Iterable<infer Element> ? Element : never)", .{inferred_item})
            else
                inferred_item;
            element_type = if (element_type) |previous| try unionOf(alloc, previous, item_type) else item_type;
        }
        return std.fmt.allocPrint(alloc, "({s})[]", .{element_type orelse "never"});
    }
    const inferred = if (value.len >= 2 and value[0] == '{' and value[value.len - 1] == '}')
        try inferObjectTypeContextual(alloc, value, false, depth + 1, null, parameters, class_scope, return_scope)
    else
        try inferNarrowType(alloc, value, false, false, depth + 1);
    if (std.mem.eql(u8, inferred, "unknown") and isIdentifierName(value)) {
        if (return_scope) |scope| {
            if (try scope.resolveValue(value)) |resolved| return resolved;
        }
    }
    return substituteBodyQueries(alloc, inferred, parameters);
}

/// Top-level members of a union type, or null when the text is not safely
/// splittable (an arrow's `>` would unbalance the bracket count).
fn unionMembers(alloc: std.mem.Allocator, type_text: []const u8) InferError!?[]const []const u8 {
    if (ch.contains(type_text, "=>")) return null;
    var members = std.array_list.Managed([]const u8).init(alloc);
    var depth: i32 = 0;
    var start: usize = 0;
    var index: usize = 0;
    while (index <= type_text.len) : (index += 1) {
        const c: u8 = if (index == type_text.len) '|' else type_text[index];
        switch (c) {
            '\'', '"', '`' => {
                index += 1;
                while (index < type_text.len and type_text[index] != c) index += if (type_text[index] == '\\') 2 else 1;
                if (index >= type_text.len) return null;
            },
            '(', '[', '{', '<' => depth += 1,
            ')', ']', '}', '>' => depth -= 1,
            '|' => if (depth == 0) {
                const member = trim(type_text[start..@min(index, type_text.len)]);
                if (member.len > 0) try members.append(member);
                start = index + 1;
            },
            else => {},
        }
        if (depth < 0) return null;
    }
    if (depth != 0) return null;
    return members.items;
}

fn isQuotedLiteralType(member: []const u8) bool {
    if (member.len < 2) return false;
    const quote = member[0];
    if ((quote != '\'' and quote != '"') or member[member.len - 1] != quote) return false;
    return std.mem.indexOfScalar(u8, member[1 .. member.len - 1], quote) == null;
}

fn isPlainNumberType(member: []const u8) bool {
    const digits = if (member.len > 0 and member[0] == '-') member[1..] else member;
    if (digits.len == 0) return false;
    var seen_dot = false;
    for (digits, 0..) |c, i| {
        if (c == '.') {
            if (seen_dot or i == 0 or i + 1 == digits.len) return false;
            seen_dot = true;
        } else if (c < '0' or c > '9') return false;
    }
    return true;
}

/// `first | second` with duplicate members removed and literals absorbed by
/// their own primitive (`true | false` and `true | boolean` are `boolean`).
fn logicalUnion(alloc: std.mem.Allocator, first: []const u8, second: []const u8) InferError![]const u8 {
    const split = try unionMembers(alloc, second) orelse return std.fmt.allocPrint(alloc, "{s} | {s}", .{ first, second });
    var members = std.array_list.Managed([]const u8).init(alloc);
    try members.append(first);
    for (split) |member| {
        if (!containsType(members.items, member)) try members.append(member);
    }
    if (containsType(members.items, "unknown")) return "unknown";
    const has_boolean = containsType(members.items, "boolean") or (containsType(members.items, "true") and containsType(members.items, "false"));
    const has_string = containsType(members.items, "string");
    const has_number = containsType(members.items, "number");
    var result = std.array_list.Managed([]const u8).init(alloc);
    var placed_boolean = false;
    for (members.items) |member| {
        if (has_boolean and (std.mem.eql(u8, member, "true") or std.mem.eql(u8, member, "false") or std.mem.eql(u8, member, "boolean"))) {
            if (!placed_boolean) try result.append("boolean");
            placed_boolean = true;
        } else if (has_string and isQuotedLiteralType(member)) {
            continue;
        } else if (has_number and isPlainNumberType(member)) {
            continue;
        } else try result.append(member);
    }
    return std.mem.join(alloc, " | ", result.items);
}

fn logicalBodyType(alloc: std.mem.Allocator, left: []const u8, raw_right: []const u8, operator: []const u8) InferError![]const u8 {
    // A function type is only a union member inside parentheses.
    const right = if (findMainArrowIndex(raw_right) != null) try std.fmt.allocPrint(alloc, "({s})", .{trim(raw_right)}) else raw_right;
    // The conditionals below are already decided for an `unknown` left
    // operand: `??` and `||` yield its non-nullish values (`{}`) or the right
    // operand, and `&&` yields `unknown`. Print that result instead.
    if (std.mem.eql(u8, trim(left), "unknown")) {
        if (std.mem.eql(u8, operator, "&&") or std.mem.eql(u8, trim(right), "unknown")) return "unknown";
        return std.fmt.allocPrint(alloc, "{{}} | {s}", .{right});
    }
    // They are decided for a plain primitive too: it is never nullish, so
    // `??` keeps it; `||` yields its truthy values or the right operand; `&&`
    // yields its one falsy value or the right operand.
    const primitive = trim(left);
    const is_boolean = std.mem.eql(u8, primitive, "boolean");
    const is_string = std.mem.eql(u8, primitive, "string");
    if (is_boolean or is_string or std.mem.eql(u8, primitive, "number")) {
        if (std.mem.eql(u8, operator, "??")) return primitive;
        const falsy_value: []const u8 = if (is_boolean) "false" else if (is_string) "''" else "0";
        const truthy: []const u8 = if (is_boolean) "true" else primitive;
        return logicalUnion(alloc, if (std.mem.eql(u8, operator, "||")) truthy else falsy_value, right);
    }
    const falsy = "false | 0 | 0n | '' | null | undefined";
    if (std.mem.eql(u8, operator, "??"))
        return std.fmt.allocPrint(alloc, "([{s}] extends [NonNullable<{s}>] ? {s} : NonNullable<{s}> | {s})", .{ left, left, left, left, right });
    if (std.mem.eql(u8, operator, "||"))
        return std.fmt.allocPrint(alloc, "([{s}] extends [object] ? {s} : [Exclude<{s}, object> & ({s})] extends [never] ? {s} : Exclude<NonNullable<{s}>, {s}> | {s})", .{ left, left, left, falsy, left, left, falsy, right });
    return std.fmt.allocPrint(alloc, "([{s}] extends [object] ? {s} : [{s}] extends [{s}] ? {s} : unknown extends ({s}) ? {s} : (Exclude<{s}, object> & ({s})) | {s})", .{ left, right, left, falsy, left, left, left, left, falsy, right });
}

/// A nullable object spread makes its copied fields optional and writable.
/// Bind the input before introducing mapped-type names so authored generics
/// cannot be captured by the generated iterator names.
fn nullableSpreadType(alloc: std.mem.Allocator, left: []const u8) InferError![]const u8 {
    const mutable = try std.fmt.allocPrint(alloc, "(NonNullable<{s}> extends infer __dtsx_spread_value ? {{ -readonly [__dtsx_spread_key in keyof __dtsx_spread_value]: __dtsx_spread_value[__dtsx_spread_key] }} : never)", .{left});
    const optional = try std.fmt.allocPrint(alloc, "(NonNullable<{s}> extends infer __dtsx_spread_value ? {{ -readonly [__dtsx_spread_key in keyof __dtsx_spread_value]?: __dtsx_spread_value[__dtsx_spread_key] }} : never)", .{left});
    return std.fmt.allocPrint(alloc, "([{s}] extends [null | undefined] ? {{}} : [{s}] extends [NonNullable<{s}>] ? {s} : {s})", .{ left, left, left, mutable, optional });
}

/// Body locals are not visible in a declaration: `typeof p.a.b` for a
/// parameter `p: T` becomes `(T)["a"]["b"]`, any other `typeof x` becomes
/// `unknown`, and `ReturnType<typeof x>` over an unresolved query collapses
/// to one `unknown` (mirrors the TypeScript emitter).
fn substituteBodyQueries(alloc: std.mem.Allocator, inferred: []const u8, parameters: []const u8) InferError![]const u8 {
    if (std.mem.indexOf(u8, inferred, "typeof") == null) return inferred;
    const syntax = @import("module_specifiers.zig");
    // The TypeScript tokenizer is lenient; a type the strict native tokenizer
    // cannot read is left as it is rather than failing the file.
    const tokens = syntax.tokenizeDeclarationSyntax(alloc, inferred) catch |err| switch (err) {
        error.InvalidContext => return inferred,
        else => |e| return e,
    };
    const text = struct {
        fn of(source: []const u8, items: []const syntax.SyntaxToken, index: usize) []const u8 {
            return if (index < items.len) source[items[index].start..items[index].end] else "";
        }
    }.of;
    var result = std.array_list.Managed(u8).init(alloc);
    var cursor: usize = 0;
    var index: usize = 0;
    while (index < tokens.len) : (index += 1) {
        const token = tokens[index];
        if (token.kind != .word or !std.mem.eql(u8, text(inferred, tokens, index), "typeof")) continue;
        if (index + 1 >= tokens.len or tokens[index + 1].kind != .word) continue;
        var query_type: ?[]const u8 = findParameterType(parameters, text(inferred, tokens, index + 1));
        const root_type = query_type;
        const unresolved = query_type == null;
        var start: usize = token.start;
        var end: usize = tokens[index + 1].end;
        const query_index = index;
        var property_count: usize = 0;
        var last_property: []const u8 = "";
        index += 1;
        while (index + 2 < tokens.len and std.mem.eql(u8, text(inferred, tokens, index + 1), ".") and tokens[index + 2].kind == .word) {
            property_count += 1;
            last_property = text(inferred, tokens, index + 2);
            if (!unresolved) query_type = try std.fmt.allocPrint(alloc, "({s})[\"{s}\"]", .{ query_type.?, text(inferred, tokens, index + 2) });
            end = tokens[index + 2].end;
            index += 2;
        }
        const wrapped_in_return_type = query_index >= 2 and
            std.mem.eql(u8, text(inferred, tokens, query_index - 2), "ReturnType") and
            std.mem.eql(u8, text(inferred, tokens, query_index - 1), "<") and
            std.mem.eql(u8, text(inferred, tokens, index + 1), ">");
        // A call on a primitive parameter: `value.toFixed(2)` is a string.
        if (root_type != null and wrapped_in_return_type and property_count == 1) {
            if (primitiveMethodReturnType(trim(root_type.?), last_property)) |primitive_result| {
                start = tokens[query_index - 2].start;
                index += 1;
                end = tokens[index].end;
                const whole = start == 0 and end == inferred.len;
                try result.appendSlice(inferred[cursor..start]);
                if (whole or std.mem.indexOfScalar(u8, primitive_result, '|') == null) {
                    try result.appendSlice(primitive_result);
                } else {
                    try result.append('(');
                    try result.appendSlice(primitive_result);
                    try result.append(')');
                }
                cursor = end;
                continue;
            }
        }
        if (unresolved and wrapped_in_return_type) {
            start = tokens[query_index - 2].start;
            index += 1;
            end = tokens[index].end;
        }
        try result.appendSlice(inferred[cursor..start]);
        try result.appendSlice(query_type orelse "unknown");
        cursor = end;
    }
    try result.appendSlice(inferred[cursor..]);
    return result.items;
}

/// A top-level comparison operator makes an expression boolean.
fn hasTopLevelComparison(alloc: std.mem.Allocator, value: []const u8) InferError!bool {
    var reader: ?@import("initializer_type_spans.zig").Reader = null;
    defer if (reader) |*parser| parser.deinit();
    var depth: i32 = 0;
    var index: usize = 0;
    while (index < value.len) : (index += 1) {
        const c = value[index];
        if (c == '"' or c == '\'' or c == '`') {
            index = skipQuotedValue(value, index, c) - 1;
            continue;
        }
        if (c == '/') {
            if (index + 1 < value.len and value[index + 1] == '/') {
                index = ch.lineCommentEnd(value, index + 2);
                continue;
            }
            if (index + 1 < value.len and value[index + 1] == '*') {
                index = if (std.mem.indexOfPos(u8, value, index + 2, "*/")) |end| end + 1 else value.len;
                continue;
            }
            if (@import("lexical.zig").isRegexStart(value, index)) {
                index = @import("lexical.zig").skipRegex(value, index) - 1;
                continue;
            }
        }
        if (c == '(' or c == '[' or c == '{') {
            depth += 1;
            continue;
        }
        if (c == ')' or c == ']' or c == '}') {
            depth -= 1;
            continue;
        }
        if (depth != 0) continue;
        if (c == '<') {
            if (reader == null) reader = try @import("initializer_type_spans.zig").Reader.initOwned(alloc, value);
            if (try reader.?.read(index, 0, null)) |span| {
                index = span.end - 1;
                continue;
            }
        }
        const rest = value[index..];
        if (ch.startsWith(rest, "===") or ch.startsWith(rest, "!==") or ch.startsWith(rest, "==") or
            ch.startsWith(rest, "!=") or ch.startsWith(rest, ">=") or ch.startsWith(rest, "<=")) return true;
        if ((c == '>' or c == '<') and index + 1 < value.len and value[index + 1] == c) {
            while (index + 1 < value.len and value[index + 1] == c) index += 1;
            continue;
        }
        if ((c == '>' or c == '<') and (index == 0 or value[index - 1] != '=') and (index + 1 >= value.len or value[index + 1] != '=')) return true;
    }
    return false;
}

fn splitTopLevelConditional(value: []const u8) ?struct { when_true: []const u8, when_false: []const u8 } {
    var depth: i32 = 0;
    var question: ?usize = null;
    var i: usize = 0;
    while (i < value.len) : (i += 1) {
        const c = value[i];
        // Literal text and comments cannot hold the operator.
        if (c == '"' or c == '\'' or c == '`') {
            i = skipQuotedValue(value, i, c) - 1;
            continue;
        }
        if (c == '/' and i + 1 < value.len and (value[i + 1] == '/' or value[i + 1] == '*')) {
            i = if (value[i + 1] == '/') ch.lineCommentEnd(value, i + 2) - 1 else (if (std.mem.indexOfPos(u8, value, i + 2, "*/")) |close| close + 1 else value.len - 1);
            continue;
        }
        if (c == '(' or c == '[' or c == '{') {
            depth += 1;
        } else if (c == ')' or c == ']' or c == '}') {
            depth -= 1;
        } else if (c == '?' and depth == 0 and !(i + 1 < value.len and value[i + 1] == '?')) {
            question = i;
        } else if (c == ':' and depth == 0) {
            if (question) |q| return .{ .when_true = withoutEdgeComments(value[q + 1 .. i]), .when_false = withoutEdgeComments(value[i + 1 ..]) };
        }
    }
    return null;
}

/// An expression without the comments before its first token and after its last.
fn withoutEdgeComments(value: []const u8) []const u8 {
    var start: usize = 0;
    while (start < value.len) {
        if (ch.isWhitespace(value[start])) {
            start += 1;
        } else if (start + 1 < value.len and value[start] == '/' and value[start + 1] == '/') {
            start = ch.lineCommentEnd(value, start + 2);
        } else if (start + 1 < value.len and value[start] == '/' and value[start + 1] == '*') {
            start = if (ch.indexOf(value, "*/", start + 2)) |close| close + 2 else value.len;
        } else break;
    }
    return trim(@import("extractors.zig").withoutTrailingComments(value[start..]));
}

/// A complete function value: `function ...`, or an arrow whose header is a
/// parameter list (optionally async, generic, annotated) or one identifier.
fn isFunctionExpression(value: []const u8) bool {
    if (ch.startsWith(value, "function") and (value.len == 8 or !ch.isIdentChar(value[8]))) return true;
    const arrow = findMainArrowIndex(value) orelse return false;
    var header = trim(value[0..arrow]);
    if (ch.startsWith(header, "async") and (header.len == 5 or !ch.isIdentChar(header[5]))) header = trim(header[5..]);
    if (header.len > 0 and header[0] == '<') {
        const end = findMatchingBracket(header, 0, '<', '>') orelse return false;
        header = trim(header[end + 1 ..]);
    }
    if (header.len > 0 and header[0] == '(') {
        const close = findMatchingBracket(header, 0, '(', ')') orelse return false;
        const suffix = trim(header[close + 1 ..]);
        return suffix.len == 0 or suffix[0] == ':';
    }
    return isIdentifierName(header);
}

/// Implementation bindings differ from the externally optional call signature.
pub fn bodyParameters(alloc: std.mem.Allocator, raw: []const u8, scope: ?*ClassScope) InferError![]const u8 {
    const syntax = @import("module_specifiers.zig");
    const stripped = trim(raw);
    const content = if (stripped.len >= 2 and stripped[0] == '(' and stripped[stripped.len - 1] == ')') stripped[1 .. stripped.len - 1] else stripped;
    const tokens = try syntax.tokenizeDeclarationSyntax(alloc, content);
    var result = std.array_list.Managed(u8).init(alloc);
    var start: usize = 0;
    var depth: isize = 0;
    var index: usize = 0;
    while (index <= tokens.len) : (index += 1) {
        const token = if (index < tokens.len) tokens[index] else null;
        const text = if (token) |item| content[item.start..item.end] else ",";
        if (depth == 0 and std.mem.eql(u8, text, ",")) {
            const part = trim(content[start..if (token) |item| item.start else content.len]);
            if (part.len > 0) {
                const items = try syntax.tokenizeDeclarationSyntax(alloc, part);
                var nesting: isize = 0;
                var colon: ?usize = null;
                var equal: ?usize = null;
                for (items) |item| {
                    const piece = part[item.start..item.end];
                    if (nesting == 0 and std.mem.eql(u8, piece, ":") and colon == null) colon = item.start;
                    if (nesting == 0 and std.mem.eql(u8, piece, "=") and (item.end == part.len or part[item.end] != '>')) {
                        equal = item.start;
                        break;
                    }
                    if (oneOfSyntax(piece, &.{ "(", "[", "{", "<" })) nesting += 1 else if (oneOfSyntax(piece, &.{ ")", "]", "}" }) or std.mem.eql(u8, piece, ">") and (item.start == 0 or part[item.start - 1] != '=')) nesting -= 1;
                }
                var name = trim(part[0 .. colon orelse equal orelse part.len]);
                const optional = ch.endsWith(name, "?");
                if (optional) name = name[0 .. name.len - 1];
                const is_rest = ch.startsWith(name, "...");
                if (is_rest) name = name[3..];
                // `{ ssl = true } = {}` binds each name to its own default's type.
                const binding = if (colon == null and !is_rest) if (equal) |at| try parameter_order.defaultedObjectBinding(alloc, name, part[at + 1 ..]) else null else null;
                if (binding) |elements| {
                    for (elements) |element| {
                        const inferred = if (scope) |root| @import("extractors.zig").inferTypeFromDefault(root, element.value) else try inferNarrowType(alloc, element.value, false, false, 0);
                        if (result.items.len > 0) try result.appendSlice(", ");
                        try result.appendSlice(element.alias);
                        try result.appendSlice(": ");
                        try result.appendSlice(inferred);
                    }
                } else if (isIdentifierName(name)) {
                    const inferred = if (colon) |at| trim(part[at + 1 .. equal orelse part.len]) else if (equal) |at| if (scope) |root| @import("extractors.zig").inferTypeFromDefault(root, trim(part[at + 1 ..])) else try inferNarrowType(alloc, trim(part[at + 1 ..]), false, false, 0) else "unknown";
                    if (result.items.len > 0) try result.appendSlice(", ");
                    try result.appendSlice(name);
                    try result.appendSlice(": ");
                    if (optional and equal == null) try result.append('(');
                    try result.appendSlice(inferred);
                    if (optional and equal == null) try result.appendSlice(") | undefined");
                } else if (ch.startsWith(name, "{") or ch.startsWith(name, "[")) {
                    // Preserve callable ownership even when the parameter's
                    // projected type is unknown to this inference path.
                    const names = @import("binding_patterns.zig").bindingPatternNames(alloc, name) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.InvalidContext;
                    for (names) |binding_name| {
                        if (result.items.len > 0) try result.appendSlice(", ");
                        try result.appendSlice(binding_name);
                        try result.appendSlice(": unknown");
                    }
                }
            }
            start = if (token) |item| item.end else content.len;
        }
        if (oneOfSyntax(text, &.{ "(", "[", "{", "<" })) depth += 1 else if (oneOfSyntax(text, &.{ ")", "]", "}" }) or std.mem.eql(u8, text, ">") and token != null and (token.?.start == 0 or content[token.?.start - 1] != '=')) depth -= 1;
    }
    return result.toOwnedSlice();
}

fn oneOfSyntax(value: []const u8, choices: []const []const u8) bool {
    for (choices) |choice| if (std.mem.eql(u8, value, choice)) return true;
    return false;
}

/// A type embedded as a member of an object type literal (or class body)
/// moves one level in: each of its continuation lines gains two spaces, so
/// nested literals indent by level. Mirrors the TypeScript emitter's `indentNestedType`.
pub fn indentNestedType(alloc: std.mem.Allocator, type_text: []const u8) InferError![]const u8 {
    if (std.mem.indexOfScalar(u8, type_text, '\n') == null) return type_text;
    var indented = std.array_list.Managed(u8).init(alloc);
    try indented.ensureTotalCapacity(type_text.len + 2 * std.mem.count(u8, type_text, "\n"));
    try appendIndentedType(&indented, type_text);
    return indented.toOwnedSlice();
}

/// Append `type_text` with every line after the first indented one more
/// level: what `indentNestedType` returns, written straight into `out`.
fn appendIndentedType(out: *std.array_list.Managed(u8), type_text: []const u8) InferError!void {
    var start: usize = 0;
    while (std.mem.indexOfScalarPos(u8, type_text, start, '\n')) |newline| {
        try out.appendSlice(type_text[start .. newline + 1]);
        try out.appendSlice("  ");
        start = newline + 1;
    }
    try out.appendSlice(type_text[start..]);
}

fn objectMemberType(alloc: std.mem.Allocator, raw_type: []const u8, name: []const u8) InferError!?[]const u8 {
    const object = trim(raw_type);
    if (object.len < 2 or object[0] != '{' or object[object.len - 1] != '}') return null;
    const content = object[1 .. object.len - 1];
    const tokens = try @import("module_specifiers.zig").tokenizeDeclarationSyntax(alloc, content);
    var start: usize = 0;
    var depth: isize = 0;
    var index: usize = 0;
    while (index <= tokens.len) : (index += 1) {
        const token = if (index < tokens.len) tokens[index] else null;
        const text = if (token) |item| content[item.start..item.end] else ";";
        if (depth == 0 and (std.mem.eql(u8, text, ";") or std.mem.eql(u8, text, ","))) {
            const member = trim(content[start..if (token) |item| item.start else content.len]);
            if (std.mem.indexOfScalar(u8, member, ':')) |colon| {
                if (std.mem.eql(u8, trim(member[0..colon]), name)) return trim(member[colon + 1 ..]);
            }
            start = if (token) |item| item.end else content.len;
        }
        if (oneOfSyntax(text, &.{ "(", "[", "{", "<" })) depth += 1 else if (oneOfSyntax(text, &.{ ")", "]", "}" }) or std.mem.eql(u8, text, ">") and token != null and (token.?.start == 0 or content[token.?.start - 1] != '=')) depth -= 1;
    }
    return null;
}

fn findParameterType(parameters: []const u8, name: []const u8) ?[]const u8 {
    if (!isIdentifierName(name)) return null;
    var search_from: usize = 0;
    while (ch.indexOf(parameters, name, search_from)) |index| {
        search_from = index + name.len;
        if ((index > 0 and ch.isIdentChar(parameters[index - 1])) or (index + name.len < parameters.len and ch.isIdentChar(parameters[index + name.len]))) continue;
        var cursor = index + name.len;
        while (cursor < parameters.len and ch.isWhitespace(parameters[cursor])) cursor += 1;
        if (cursor < parameters.len and parameters[cursor] == '?') cursor += 1;
        while (cursor < parameters.len and ch.isWhitespace(parameters[cursor])) cursor += 1;
        if (cursor >= parameters.len or parameters[cursor] != ':') continue;
        cursor += 1;
        while (cursor < parameters.len and ch.isWhitespace(parameters[cursor])) cursor += 1;
        const type_start = cursor;
        var nesting: i32 = 0;
        while (cursor < parameters.len) : (cursor += 1) {
            const c = parameters[cursor];
            if (c == '(' or c == '[' or c == '{' or c == '<') nesting += 1 else if (c == ')' or c == ']' or c == '}' or (c == '>' and (cursor == 0 or parameters[cursor - 1] != '='))) {
                if (nesting == 0) break;
                nesting -= 1;
            } else if (nesting == 0 and (c == ',' or (c == '=' and !(cursor + 1 < parameters.len and parameters[cursor + 1] == '>')))) break;
        }
        const parameter_type = trim(parameters[type_start..cursor]);
        if (parameter_type.len > 0) return parameter_type;
    }
    return null;
}

fn containsType(types_list: []const []const u8, expected: []const u8) bool {
    for (types_list) |item| if (std.mem.eql(u8, item, expected)) return true;
    return false;
}

/// Single-pass scan hints to avoid multiple ch.contains() calls.
const ValueHints = struct {
    has_dollar_brace: bool = false, // "${" — template interpolation
    has_arrow: bool = false, // "=>" — arrow function
    has_raw_template: bool = false, // ".raw`" — tagged template literal

    fn scan(s: []const u8) ValueHints {
        var h = ValueHints{};
        if (s.len < 2) return h;
        var i: usize = 0;
        while (i < s.len - 1) : (i += 1) {
            const c = s[i];
            if (c == '$' and s[i + 1] == '{') {
                h.has_dollar_brace = true;
            }
            if (c == '=' and s[i + 1] == '>') {
                h.has_arrow = true;
            }
            if (c == '.' and i + 4 < s.len and s[i + 1] == 'r' and s[i + 2] == 'a' and s[i + 3] == 'w' and s[i + 4] == '`') {
                h.has_raw_template = true;
            }
        }
        return h;
    }
};

/// Infer narrow type from a value expression.
/// Returns a type string (allocated from `alloc`).
pub fn inferNarrowType(alloc: std.mem.Allocator, value: []const u8, is_const: bool, in_union: bool, depth: usize) InferError![]const u8 {
    return inferNarrowTypeWithKeyConstants(alloc, value, is_const, in_union, depth, null);
}

pub fn inferNarrowTypeWithKeyConstants(alloc: std.mem.Allocator, value: []const u8, is_const: bool, in_union: bool, depth: usize, key_constants: ?*const KeyConstants) InferError![]const u8 {
    if (value.len == 0) return "unknown";
    if (depth >= MAX_INFERENCE_DEPTH) return "unknown";

    const trimmed = trim(value);
    if (trimmed.len == 0) return "unknown";

    // A value that is one bracketed literal from its first byte to its last
    // is an object or an array, whatever it contains. Deciding that here keeps
    // the operator probes below from walking a nested literal once per level
    // of nesting, and keeps text inside it (a `String.raw` template, an arrow)
    // from being read as the kind of the whole value.
    if (trimmed.len >= 2) {
        const last = trimmed.len - 1;
        if (trimmed[0] == '{' and trimmed[last] == '}' and findMatchingBracket(trimmed, 0, '{', '}') == last)
            return inferObjectTypeWithKeyConstants(alloc, trimmed, is_const, depth + 1, key_constants);
        if (trimmed[0] == '[' and trimmed[last] == ']' and findMatchingBracket(trimmed, 0, '[', ']') == last)
            return inferArrayTypeWithKeyConstants(alloc, trimmed, is_const, depth + 1, key_constants);
    }

    while (trimmed.len >= 2 and trimmed[0] == '(' and trimmed[trimmed.len - 1] == ')' and findMatchingBracket(trimmed, 0, '(', ')') == trimmed.len - 1) {
        return inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[1 .. trimmed.len - 1]), is_const, in_union, depth + 1, key_constants);
    }

    if (isJsxExpression(trimmed)) return "JSX.Element";
    if (try inferPrefixAssertion(alloc, trimmed)) |asserted| return asserted;

    // Recognize an outer arrow before comma-operator handling because JSX text
    // and children may contain commas that are not JavaScript operators.
    if (findMainArrowIndex(trimmed) != null) return inferFunctionType(alloc, trimmed, in_union, depth, is_const);

    // The comma operator evaluates to its final operand. Reuse the balanced
    // element splitter so commas inside calls, arrays, and objects are ignored.
    if (try findTopLevelComma(alloc, trimmed)) |comma| return inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[comma + 1 ..]), is_const, in_union, depth + 1, key_constants);

    if (trimmed.len > 2 and (ch.startsWith(trimmed, "++") or ch.startsWith(trimmed, "--")))
        return inferUpdateType(alloc, trimmed[2..]);
    if (trimmed.len > 2 and (ch.endsWith(trimmed, "++") or ch.endsWith(trimmed, "--")))
        return inferUpdateType(alloc, trimmed[0 .. trimmed.len - 2]);

    if (ch.startsWith(trimmed, "await ")) {
        var awaited = try inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[6..]), false, false, depth + 1, key_constants);
        while (ch.startsWith(awaited, "Promise<") and awaited.len > 9 and awaited[awaited.len - 1] == '>')
            awaited = awaited[8 .. awaited.len - 1];
        return awaited;
    }
    // `typeof x` is a string, but `typeof x === 'object' && ...` is a larger
    // expression; leave those to the comparison and logical rules below.
    if (ch.startsWith(trimmed, "typeof ") and try isUnaryOperand(alloc, trimmed[7..])) return "string";
    if (ch.startsWith(trimmed, "void ")) return "undefined";
    if (ch.startsWith(trimmed, "delete ")) return "boolean";
    if (trimmed[0] == '!') return "boolean";
    if ((trimmed[0] == '+' or trimmed[0] == '~') and trimmed.len > 1) return "number";
    if (trimmed[0] == '-' and trimmed.len > 1 and !(trimmed[1] >= '0' and trimmed[1] <= '9')) return "number";
    if (isRegexLiteral(trimmed)) return "RegExp";

    // Recognize functions before expression operators so the `>` in `=>` and
    // generic parameter lists cannot be mistaken for a comparison. A value
    // with a main arrow has already returned above.
    if (ch.startsWith(trimmed, "function") or ch.startsWith(trimmed, "async")) {
        return inferFunctionType(alloc, trimmed, in_union, depth, is_const);
    }

    // Fast path: if first char is a digit, it's almost certainly a number or BigInt literal
    if (trimmed[0] >= '0' and trimmed[0] <= '9') {
        if (isNumericLiteral(trimmed)) {
            return if (!is_const) "number" else try numericLiteralType(alloc, trimmed);
        }
        // BigInt literal: digits followed by 'n'
        if (isBigIntLiteral(trimmed)) {
            return if (is_const) try numericLiteralType(alloc, trimmed) else "bigint";
        }
    }

    // Fast path: negative numbers
    if (trimmed[0] == '-' and trimmed.len > 1 and trimmed[1] >= '0' and trimmed[1] <= '9') {
        if (isBigIntLiteral(trimmed)) return if (is_const) try numericLiteralType(alloc, trimmed) else "bigint";
        if (isNumericLiteral(trimmed)) {
            return if (!is_const) "number" else try numericLiteralType(alloc, trimmed);
        }
    }

    // BigInt expressions
    if (ch.startsWith(trimmed, "BigInt(")) return "bigint";

    // Symbol.for
    if (ch.startsWith(trimmed, "Symbol.for(")) return "symbol";

    // Single-pass scan for substring hints — skip for short values where hints can't appear
    const hints = if (trimmed.len >= 4) ValueHints.scan(trimmed) else ValueHints{};

    // Tagged template literals
    if (hints.has_raw_template) return "string";

    // Runtime template interpolation contains value expressions, not type nodes,
    // so it cannot be copied into a declaration's template-literal type. Large
    // multiline literals are also widened to keep declarations compact and to
    // prevent their embedded CSS/HTML comments from being parsed as declarations.
    if (trimmed[0] == '`' and trimmed[trimmed.len - 1] == '`') {
        if (!is_const or hints.has_dollar_brace or ch.contains(trimmed, "\n") or ch.contains(trimmed, "\r")) return "string";
        return trimmed;
    }

    // String literals — exactly one literal, or a concatenation of literals
    // (the joined literal for const, string otherwise); a `+` with any string
    // literal operand is a string. Other quoted expressions (`'x' as const`,
    // `'x'.repeat(3)`) fall through to the handling below.
    if (trimmed[0] == '\'' or trimmed[0] == '"') {
        if (@import("extractors.zig").classifyStringExpression(alloc, trimmed)) |string_type| {
            if (!is_const or std.mem.eql(u8, string_type, "string")) return "string";
            return string_type;
        }
    }

    // Number literals
    if (isNumericLiteral(trimmed)) {
        if (!is_const) return "number";
        return try numericLiteralType(alloc, trimmed);
    }

    // Boolean literals (length-first to skip most comparisons)
    if (trimmed.len == 4 and std.mem.eql(u8, trimmed, "true")) {
        return if (!is_const) "boolean" else trimmed;
    }
    if (trimmed.len == 5 and std.mem.eql(u8, trimmed, "false")) {
        return if (!is_const) "boolean" else trimmed;
    }

    // Null and undefined (length-first)
    if (trimmed.len == 4 and std.mem.eql(u8, trimmed, "null")) return "null";
    if (trimmed.len == 9 and std.mem.eql(u8, trimmed, "undefined")) return "undefined";
    if (std.mem.eql(u8, trimmed, "NaN") or std.mem.eql(u8, trimmed, "Infinity")) return "number";

    // Strip const assertions before classifying the underlying expression. This
    // prevents arrows nested inside asserted arrays or objects from making the
    // whole initializer look like a function.
    if (ch.endsWith(trimmed, "as const")) {
        const without_as_const = trim(trimmed[0 .. trimmed.len - 8]);
        if (without_as_const.len > 1 and without_as_const[0] == '[' and without_as_const[without_as_const.len - 1] == ']') {
            return inferArrayTypeWithKeyConstants(alloc, without_as_const, true, depth + 1, key_constants);
        }
        return inferNarrowTypeWithKeyConstants(alloc, without_as_const, true, in_union, depth + 1, key_constants);
    }

    // Named class expressions have the constructor type of their inner name.
    if (ch.startsWith(trimmed, "class ")) {
        const rest = trim(trimmed[6..]);
        var end: usize = 0;
        while (end < rest.len and ch.isIdentChar(rest[end])) end += 1;
        if (end > 0) return std.fmt.allocPrint(alloc, "typeof {s}", .{rest[0..end]});
        return "new (...args: any[]) => unknown";
    }

    // Array literals
    if (trimmed[0] == '[' and trimmed[trimmed.len - 1] == ']') {
        return inferArrayTypeWithKeyConstants(alloc, trimmed, is_const, depth + 1, key_constants);
    }

    // Object literals
    if (trimmed[0] == '{' and trimmed[trimmed.len - 1] == '}') {
        return inferObjectTypeWithKeyConstants(alloc, trimmed, is_const, depth + 1, key_constants);
    }

    // New expressions
    if (ch.startsWith(trimmed, "new ")) {
        return inferNewExpressionType(alloc, trimmed);
    }

    // Template literal
    if (trimmed[0] == '`' and trimmed[trimmed.len - 1] == '`') {
        if (!is_const) return "string";
        if (!hints.has_dollar_brace) return trimmed;
        return "string";
    }

    // Promise expressions
    if (ch.startsWith(trimmed, "Promise.")) {
        return inferPromiseType(alloc, trimmed, is_const, depth, key_constants);
    }

    // BigInt literals (digits followed by 'n')
    if (isBigIntLiteral(trimmed)) {
        if (is_const) return try numericLiteralType(alloc, trimmed);
        return "bigint";
    }

    // Symbol
    if (ch.startsWith(trimmed, "Symbol(") or std.mem.eql(u8, trimmed, "Symbol.for")) return "symbol";

    if (try inferCallType(alloc, trimmed)) |call_type| return call_type;
    // Element and member reads stay unknown, as in the TypeScript emitter: the
    // object may be an undeclared global (`$props['metadata']`), and a
    // declaration cannot query it.

    // Conditional expressions become the union of their possible result types.
    if (findTopLevelToken(trimmed, "?", 0)) |question| {
        if (question + 1 < trimmed.len and trimmed[question + 1] != '?' and trimmed[question + 1] != '.') {
            if (findTopLevelToken(trimmed, ":", question + 1)) |colon| {
                switch (staticTruthiness(trimmed[0..question])) {
                    .truthy => return inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[question + 1 .. colon]), is_const, in_union, depth + 1, key_constants),
                    .falsy => return inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[colon + 1 ..]), is_const, in_union, depth + 1, key_constants),
                    .unknown => {},
                }
                const when_true = try inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[question + 1 .. colon]), true, true, depth + 1, key_constants);
                const when_false = try inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[colon + 1 ..]), true, true, depth + 1, key_constants);
                if (std.mem.eql(u8, when_true, when_false)) return when_true;
                return std.fmt.allocPrint(alloc, "{s} | {s}", .{ when_true, when_false });
            }
        }
    }

    // Nullish and logical expressions use their operand types instead of
    // collapsing the whole expression to unknown.
    inline for (.{ "??", "||", "&&" }) |operator| {
        if (findTopLevelToken(trimmed, operator, 0)) |index| {
            const left_expression = trim(trimmed[0..index]);
            const right_expression = trim(trimmed[index + operator.len ..]);
            const left = try inferNarrowTypeWithKeyConstants(alloc, left_expression, is_const, true, depth + 1, key_constants);
            const right = try inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[index + operator.len ..]), is_const, true, depth + 1, key_constants);
            if (std.mem.eql(u8, operator, "??") and (std.mem.eql(u8, left, "null") or std.mem.eql(u8, left, "undefined"))) return right;
            if (std.mem.eql(u8, operator, "??") and staticTruthiness(left_expression) != .unknown) return left;
            if (std.mem.eql(u8, operator, "&&")) switch (staticTruthiness(left_expression)) {
                .truthy => return inferNarrowTypeWithKeyConstants(alloc, right_expression, is_const, in_union, depth + 1, key_constants),
                .falsy => return left,
                .unknown => {},
            };
            if (std.mem.eql(u8, operator, "||")) switch (staticTruthiness(left_expression)) {
                .truthy => return left,
                .falsy => return inferNarrowTypeWithKeyConstants(alloc, right_expression, is_const, in_union, depth + 1, key_constants),
                .unknown => {},
            };
            return unionOf(alloc, left, right);
        }
    }

    if (try hasTopLevelComparison(alloc, trimmed)) return "boolean";
    if (findTopLevelToken(trimmed, " instanceof ", 0) != null or findTopLevelToken(trimmed, " in ", 0) != null) return "boolean";

    // Numeric and bitwise operators. Infer BigInt when either operand is
    // statically BigInt; unsigned right shift is always a number operation.
    inline for (.{ ">>>", "<<", ">>", "**", "&", "|", "^" }) |operator| {
        if (findTopLevelToken(trimmed, operator, 0)) |index| {
            if (std.mem.eql(u8, operator, ">>>")) return "number";
            const left = try inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[0..index]), false, false, depth + 1, key_constants);
            const right = try inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[index + operator.len ..]), false, false, depth + 1, key_constants);
            return if (std.mem.eql(u8, left, "bigint") or std.mem.eql(u8, right, "bigint")) "bigint" else "number";
        }
    }

    // Arithmetic expressions widen literal operands to their runtime numeric
    // result. Addition additionally models JavaScript string concatenation.
    inline for (.{ "+", "-", "*", "/", "%" }) |operator| {
        if (findTopLevelToken(trimmed, operator, 0)) |index| {
            if (index > 0 and index + operator.len < trimmed.len) {
                const previous = trimmed[index - 1];
                const next = trimmed[index + operator.len];
                if (next != '=' and next != operator[0] and previous != operator[0]) {
                    const left = try inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[0..index]), false, false, depth + 1, key_constants);
                    const right = try inferNarrowTypeWithKeyConstants(alloc, trim(trimmed[index + operator.len ..]), false, false, depth + 1, key_constants);
                    if (std.mem.eql(u8, operator, "+") and (std.mem.eql(u8, left, "string") or std.mem.eql(u8, right, "string"))) return "string";
                    if (std.mem.eql(u8, left, "bigint") or std.mem.eql(u8, right, "bigint")) return "bigint";
                    return "number";
                }
            }
        }
    }

    return "unknown";
}

/// Infer narrow type in union context (widens number/boolean)
pub fn inferNarrowTypeInUnion(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize) InferError![]const u8 {
    return inferNarrowTypeInUnionWithKeyConstants(alloc, value, is_const, depth, null);
}

pub fn inferNarrowTypeInUnionWithKeyConstants(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize, key_constants: ?*const KeyConstants) InferError![]const u8 {
    return inferNarrowTypeWithKeyConstants(alloc, value, is_const, true, depth, key_constants);
}

/// Infer array type from array literal
pub fn inferArrayType(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize) InferError![]const u8 {
    return inferArrayTypeWithKeyConstants(alloc, value, is_const, depth, null);
}

pub fn inferArrayTypeWithKeyConstants(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize, key_constants: ?*const KeyConstants) InferError![]const u8 {
    const content = trim(value[1 .. value.len - 1]);
    if (content.len == 0) return if (is_const) "readonly []" else "never[]";
    if (depth >= MAX_INFERENCE_DEPTH) return "unknown[]";

    const elements = try parseArrayElements(alloc, content);

    // Check for 'as const' in any element
    var has_as_const = false;
    for (elements) |el| {
        if (ch.endsWith(trim(el), "as const")) {
            has_as_const = true;
            break;
        }
    }

    if (has_as_const) {
        var parts = std.array_list.Managed(u8).init(alloc);
        try parts.ensureTotalCapacity(content.len + 32);
        try parts.appendSlice("readonly [\n    ");
        for (elements, 0..) |el, idx| {
            if (idx > 0) try parts.appendSlice(" |\n    ");
            const trimmed_el = trim(el);
            if (ch.endsWith(trimmed_el, "as const")) {
                const without = trim(trimmed_el[0 .. trimmed_el.len - 8]);
                if (without.len > 1 and without[0] == '[' and without[without.len - 1] == ']') {
                    const inner_content = trim(without[1 .. without.len - 1]);
                    const inner_elements = try parseArrayElements(alloc, inner_content);
                    try parts.appendSlice("readonly [");
                    for (inner_elements, 0..) |inner_el, iidx| {
                        if (iidx > 0) try parts.appendSlice(", ");
                        const t = try inferNarrowTypeWithKeyConstants(alloc, inner_el, true, false, depth + 1, key_constants);
                        try parts.appendSlice(t);
                    }
                    try parts.append(']');
                } else {
                    const t = try inferNarrowTypeWithKeyConstants(alloc, without, true, false, depth + 1, key_constants);
                    try parts.appendSlice(t);
                }
            } else if (trimmed_el.len > 1 and trimmed_el[0] == '[' and trimmed_el[trimmed_el.len - 1] == ']') {
                const t = try inferArrayTypeWithKeyConstants(alloc, trimmed_el, true, depth + 1, key_constants);
                try parts.appendSlice(t);
            } else {
                const t = try inferNarrowTypeWithKeyConstants(alloc, trimmed_el, true, false, depth + 1, key_constants);
                try parts.appendSlice(t);
            }
        }
        try parts.appendSlice("\n  ]");
        return parts.toOwnedSlice();
    }

    // Regular array processing — also track nested defaults for clean default building
    const track_defaults = _collect_clean_default and !is_const;
    var element_types = std.array_list.Managed([]const u8).init(alloc);
    try element_types.ensureTotalCapacity(elements.len);
    var nested_defaults = std.array_list.Managed(?[]const u8).init(alloc);
    if (track_defaults) try nested_defaults.ensureTotalCapacity(elements.len);
    for (elements) |el| {
        const trimmed_el = trim(el);
        const saved = _clean_default_result;
        _clean_default_result = null;
        if (ch.startsWith(trimmed_el, "...") and trimmed_el.len > 3) {
            const spread_value = trim(trimmed_el[3..]);
            const spread_type = try inferNarrowTypeWithKeyConstants(alloc, spread_value, is_const, false, depth + 1, key_constants);
            if (is_const and isEntityName(spread_value)) {
                try element_types.append(try std.fmt.allocPrint(alloc, "...typeof {s}", .{spread_value}));
            } else if (is_const) {
                // A tuple spread keeps order and variadic length: it is never
                // one element of the tuple (`readonly [unknown]`).
                if (ch.startsWith(spread_type, "readonly [") or ch.endsWith(spread_type, "[]"))
                    try element_types.append(try std.fmt.allocPrint(alloc, "...{s}", .{spread_type}))
                else
                    try element_types.append("...unknown[]");
            } else if (try spreadElementType(alloc, spread_type, is_const)) |element| {
                try element_types.append(element);
            } else if (isIdentifierName(spread_value)) {
                try element_types.append(try std.fmt.allocPrint(alloc, "(typeof {s})[number]", .{spread_value}));
            } else {
                try element_types.append("unknown");
            }
        } else if (trimmed_el.len > 1 and trimmed_el[0] == '[' and trimmed_el[trimmed_el.len - 1] == ']') {
            try element_types.append(try inferArrayTypeWithKeyConstants(alloc, trimmed_el, is_const, depth + 1, key_constants));
        } else {
            try element_types.append(try inferNarrowTypeInUnionWithKeyConstants(alloc, trimmed_el, is_const, depth + 1, key_constants));
        }
        if (track_defaults) try nested_defaults.append(_clean_default_result);
        _clean_default_result = saved;
    }

    const types = element_types.items;

    // Build clean default for non-const arrays (same pass, no re-parse)
    if (track_defaults) {
        if (isSimpleArrayDefault(value)) {
            _clean_default_result = try collapseWhitespace(alloc, value);
        } else {
            var clean_elems = std.array_list.Managed([]const u8).init(alloc);
            try clean_elems.ensureTotalCapacity(elements.len);
            for (elements, 0..) |el, ei| {
                const te = trim(el);
                if (ch.endsWith(te, " as const") or ch.endsWith(te, "as const")) continue;
                if (isPrimitiveLiteral(te) or std.mem.eql(u8, te, "null") or std.mem.eql(u8, te, "undefined")) {
                    try clean_elems.append(te);
                } else if (ch.startsWith(te, "...") and te.len > 3) {
                    try clean_elems.append(te);
                } else if (te.len > 0 and te[0] == '[' and isSimpleArrayDefault(te)) {
                    try clean_elems.append(try collapseWhitespace(alloc, te));
                } else if (te.len > 0 and te[0] == '{') {
                    if (nested_defaults.items[ei]) |nd| try clean_elems.append(nd);
                } else {
                    // Re-infer without union context for the clean default
                    // (types[ei] was inferred via inferNarrowTypeInUnion which
                    // wraps function types in parens and widens return types)
                    const clean_type = try inferNarrowTypeWithKeyConstants(alloc, te, false, false, 0, key_constants);
                    if (!std.mem.eql(u8, clean_type, "unknown")) {
                        try clean_elems.append(clean_type);
                    }
                }
            }
            if (clean_elems.items.len > 0) {
                var buf = std.array_list.Managed(u8).init(alloc);
                try buf.append('[');
                for (clean_elems.items, 0..) |item, ci| {
                    if (ci > 0) try buf.appendSlice(", ");
                    try buf.appendSlice(item);
                }
                try buf.append(']');
                _clean_default_result = try buf.toOwnedSlice();
            }
        }
    }

    // For const arrays, always create readonly tuples
    if (is_const) {
        var parts = std.array_list.Managed(u8).init(alloc);
        try parts.ensureTotalCapacity(content.len + 16);
        try parts.appendSlice("readonly [");
        for (types, 0..) |t, idx| {
            if (idx > 0) try parts.appendSlice(", ");
            try parts.appendSlice(t);
        }
        try parts.append(']');
        return parts.toOwnedSlice();
    }

    // Single-pass: deduplicate types (O(1) HashMap lookup) AND check if all are literals
    var unique = std.array_list.Managed([]const u8).init(alloc);
    var unique_set = std.StringHashMap(void).init(alloc);
    try unique_set.ensureTotalCapacity(@intCast(@max(types.len, 4)));
    var all_literals = true;
    for (types) |t| {
        // O(1) dedup check via HashMap
        if (!unique_set.contains(t)) {
            try unique_set.put(t, {});
            try unique.append(t);
        }
        // Literal check — reuse isPrimitiveLiteral, which first-byte-dispatches
        // through string/boolean/numeric branches without retesting other kinds.
        if (all_literals and !isPrimitiveLiteral(t)) all_literals = false;
    }

    if (all_literals and types.len <= 10) {
        var parts = std.array_list.Managed(u8).init(alloc);
        try parts.appendSlice("readonly [");
        for (types, 0..) |t, idx| {
            if (idx > 0) try parts.appendSlice(", ");
            try parts.appendSlice(t);
        }
        try parts.append(']');
        return parts.toOwnedSlice();
    }

    if (unique.items.len == 1) {
        var parts = std.array_list.Managed(u8).init(alloc);
        try parts.appendSlice(unique.items[0]);
        try parts.appendSlice("[]");
        return parts.toOwnedSlice();
    }

    var parts = std.array_list.Managed(u8).init(alloc);
    try parts.append('(');
    for (unique.items, 0..) |t, idx| {
        if (idx > 0) try parts.appendSlice(" | ");
        try parts.appendSlice(t);
    }
    try parts.appendSlice(")[]");
    return parts.toOwnedSlice();
}

/// Check if a value string is a primitive literal (number, string, boolean)
pub fn isPrimitiveLiteral(val: []const u8) bool {
    if (val.len == 0) return false;
    // First-byte dispatch: each kind of literal has a distinct prefix byte —
    // saves running every check on every value.
    return switch (val[0]) {
        '"' => val.len >= 2 and val[val.len - 1] == '"',
        '\'' => val.len >= 2 and val[val.len - 1] == '\'',
        't' => val.len == 4 and std.mem.eql(u8, val, "true"),
        'f' => val.len == 5 and std.mem.eql(u8, val, "false"),
        '-', '.', '0'...'9' => isNumericLiteral(val),
        else => false,
    };
}

/// Check if a type is a base/widened type
pub fn isBaseType(t: []const u8) bool {
    // Length-first dispatch: number=6, string=6, boolean=7. Reject all other
    // lengths in O(1) without invoking std.mem.eql.
    return switch (t.len) {
        6 => std.mem.eql(u8, t, "number") or std.mem.eql(u8, t, "string"),
        7 => std.mem.eql(u8, t, "boolean"),
        else => false,
    };
}

/// The comments that open a parameter's source text (`/** doc */ public x = 1`),
/// in order. Mirrors the TypeScript emitter's `leadingSourceComments`.
pub fn leadingSourceComments(alloc: std.mem.Allocator, text: []const u8) InferError![]const []const u8 {
    var comments = std.array_list.Managed([]const u8).init(alloc);
    errdefer comments.deinit();
    var index: usize = 0;
    while (index < text.len) {
        while (index < text.len and text[index] <= ' ') index += 1;
        if (ch.startsWith(text[index..], "/*")) {
            const close = ch.indexOf(text, "*/", index + 2) orelse break;
            try comments.append(text[index .. close + 2]);
            index = close + 2;
        } else if (ch.startsWith(text[index..], "//")) {
            var end = index;
            while (end < text.len and text[end] != '\n' and text[end] != '\r') end += 1;
            try comments.append(std.mem.trimEnd(u8, text[index..end], " \t"));
            index = end;
        } else break;
    }
    return comments.toOwnedSlice();
}

/// The doc block a class field (or constructor parameter property) gets for
/// its initializer: `@defaultValue` exactly as a widened object-literal
/// property gets it, merged with the member's own doc comment the way a
/// variable's is. Each line carries the two-space class member indent. Empty
/// when the field gets no `@defaultValue`. Mirrors the TypeScript emitter's
/// `classFieldDefaultDoc`.
pub fn classFieldDefaultDoc(alloc: std.mem.Allocator, comments: ?[]const []const u8, initializer: []const u8, field_type: []const u8) InferError![]const u8 {
    const raw = trim(initializer);
    if (!isBaseType(field_type) or !isPrimitiveLiteral(raw)) return "";
    var joined = std.array_list.Managed(u8).init(alloc);
    for (comments orelse &.{}) |comment| {
        const text = trim(comment);
        // Doc comments only: a plain `/* note */` is not documentation to merge into.
        if (!ch.startsWith(text, "/**") and !ch.startsWith(text, "//")) continue;
        if (joined.items.len > 0) try joined.append('\n');
        try joined.appendSlice(text);
    }
    const existing = joined.items;
    var doc = std.array_list.Managed(u8).init(alloc);
    if (std.mem.indexOf(u8, existing, "@defaultValue") != null) {
        try doc.appendSlice(existing);
    } else {
        const escaped = try comment_utils.escapeJsdocContent(alloc, raw);
        const tag = try std.fmt.allocPrint(alloc, "@defaultValue {s}", .{escaped});
        if (existing.len == 0) {
            try doc.appendSlice("/** ");
            try doc.appendSlice(tag);
            try doc.appendSlice(" */");
        } else if (std.mem.lastIndexOf(u8, existing, "*/")) |closing| {
            var before = std.mem.trimEnd(u8, existing[0..closing], " \t\r\n");
            // A single-line `/** text` opens onto its own line, as for variables.
            if (ch.startsWith(before, "/** ") and std.mem.indexOfScalar(u8, before, '\n') == null) {
                try doc.appendSlice("/**\n * ");
                before = before[4..];
            }
            try doc.appendSlice(before);
            try doc.appendSlice("\n * ");
            try doc.appendSlice(tag);
            try doc.appendSlice("\n */");
        } else {
            const text = if (ch.startsWith(existing, "// ")) existing[3..] else if (ch.startsWith(existing, "//")) existing[2..] else existing;
            try doc.appendSlice("/**\n * ");
            try doc.appendSlice(text);
            try doc.appendSlice("\n * ");
            try doc.appendSlice(tag);
            try doc.appendSlice("\n */");
        }
    }
    var out = std.array_list.Managed(u8).init(alloc);
    var lines = std.mem.splitScalar(u8, doc.items, '\n');
    var first = true;
    while (lines.next()) |line| {
        if (!first) try out.append('\n');
        first = false;
        const content = trim(line);
        if (content.len == 0) continue;
        try out.appendSlice(if (content[0] == '*') "   " else "  ");
        try out.appendSlice(content);
    }
    try out.append('\n');
    return out.toOwnedSlice();
}

/// Check if an array literal only contains primitives/nested arrays/objects (no runtime expressions)
fn isSimpleArrayDefault(val: []const u8) bool {
    // Quick scan: reject if it contains runtime keywords or arrow functions
    var i: usize = 0;
    var in_string: bool = false;
    var quote_char: u8 = 0;
    while (i < val.len) : (i += 1) {
        const c = val[i];
        if (in_string) {
            if (c == '\\') {
                i += 1; // skip escaped char
                continue;
            }
            if (c == quote_char) in_string = false;
            continue;
        }
        if (c == '\'' or c == '"' or c == '`') {
            in_string = true;
            quote_char = c;
            continue;
        }
        // Check for arrow =>
        if (c == '=' and i + 1 < val.len and val[i + 1] == '>') return false;
        // Check for keywords: new, console, process, async, await, function, yield
        if (ch.isIdentStart(c)) {
            const start = i;
            while (i < val.len and ch.isIdentChar(val[i])) : (i += 1) {}
            const word = val[start..i];
            // Check what follows the identifier
            var j = i;
            while (j < val.len and ch.isWhitespace(val[j])) : (j += 1) {}
            // If followed by ':', it's an object property key — skip it
            if (j < val.len and val[j] == ':') {
                if (i > 0) i -= 1;
                continue;
            }
            if (j < val.len and val[j] == '(') return false; // function call
            // Identifier classification dispatched on first byte — replaces 13
            // sequential std.mem.eql calls. Anything not on the allow-list (true,
            // false, null, undefined, const, as) is treated as a runtime reference.
            const word_ok = wo: switch (word[0]) {
                't' => break :wo std.mem.eql(u8, word, "true"),
                'f' => break :wo std.mem.eql(u8, word, "false"),
                'n' => break :wo std.mem.eql(u8, word, "null"),
                'u' => break :wo std.mem.eql(u8, word, "undefined"),
                'c' => break :wo std.mem.eql(u8, word, "const"),
                'a' => break :wo std.mem.eql(u8, word, "as"),
                else => break :wo false,
            };
            if (!word_ok) return false;
            if (i > 0) i -= 1; // back up since outer loop will increment
        }
    }
    return true;
}

/// Collapse whitespace in a string to single spaces
pub fn collapseWhitespace(alloc: std.mem.Allocator, val: []const u8) ![]const u8 {
    // Fast path: check if there's actually any consecutive whitespace or non-space ws
    var needs_collapse = false;
    {
        var prev_ws = false;
        var in_str = false;
        var qc: u8 = 0;
        for (val) |c| {
            if (in_str) {
                if (c == '\\') {
                    prev_ws = false;
                    continue;
                }
                if (c == qc) in_str = false;
                prev_ws = false;
                continue;
            }
            if (c == '\'' or c == '"' or c == '`') {
                in_str = true;
                qc = c;
                prev_ws = false;
                continue;
            }
            if (ch.isWhitespace(c)) {
                if (c != ' ' or prev_ws) {
                    needs_collapse = true;
                    break;
                }
                prev_ws = true;
            } else {
                prev_ws = false;
            }
        }
    }
    if (!needs_collapse) return val;

    // Slow path: actually collapse
    var result = std.array_list.Managed(u8).init(alloc);
    try result.ensureTotalCapacity(val.len);
    var in_ws = false;
    var in_string = false;
    var quote_char: u8 = 0;
    for (val) |c| {
        if (in_string) {
            try result.append(c);
            if (c == '\\') {
                // next char is escaped, handled on next iteration
            } else if (c == quote_char) {
                in_string = false;
            }
            continue;
        }
        if (c == '\'' or c == '"' or c == '`') {
            in_string = true;
            quote_char = c;
            in_ws = false;
            try result.append(c);
            continue;
        }
        if (ch.isWhitespace(c)) {
            if (!in_ws) {
                try result.append(' ');
                in_ws = true;
            }
        } else {
            in_ws = false;
            try result.append(c);
        }
    }
    return result.toOwnedSlice();
}

/// Accessor implementation functions are not the property's readable type.
fn accessorValueType(getter: bool, value: []const u8) []const u8 {
    const input = trim(value);
    if (!ch.startsWith(input, "(")) return "unknown";
    const end = findMatchingBracket(input, 0, '(', ')') orelse return "unknown";
    if (getter) {
        const tail = trim(input[end + 1 ..]);
        return if (ch.startsWith(tail, "=>")) trim(tail[2..]) else "unknown";
    }
    const parameter = trim(input[1..end]);
    const binding_end = if (ch.startsWith(parameter, "{")) findMatchingBracket(parameter, 0, '{', '}') orelse return "unknown" else if (ch.startsWith(parameter, "[")) findMatchingBracket(parameter, 0, '[', ']') orelse return "unknown" else 0;
    const colon = ch.indexOfChar(parameter, ':', binding_end) orelse return "unknown";
    return trim(parameter[colon + 1 ..]);
}

/// Infer object type from object literal.
/// When _collect_clean_default is set and !is_const, also builds the @defaultValue
/// content during the same pass — avoiding double-parsing of parseObjectProperties.
pub fn inferObjectType(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize) InferError![]const u8 {
    return inferObjectTypeWithKeyConstants(alloc, value, is_const, depth, null);
}

pub fn inferObjectTypeWithKeyConstants(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize, key_constants: ?*const KeyConstants) InferError![]const u8 {
    return inferObjectTypeContextual(alloc, value, is_const, depth, key_constants, null, null, null);
}

fn inferObjectTypeContextual(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize, key_constants: ?*const KeyConstants, parameters: ?[]const u8, class_scope: ?*ClassScope, return_scope: ?*return_scopes.Scope) InferError![]const u8 {
    const content = trim(value[1 .. value.len - 1]);
    if (content.len == 0) return "{}";
    if (depth >= MAX_INFERENCE_DEPTH) return "Record<string, unknown>";

    const properties = try parseObjectProperties(alloc, content);
    var getter_names = std.StringHashMap(void).init(alloc);
    defer getter_names.deinit();
    for (properties) |property| {
        if (ch.startsWith(property.key, "get ")) try getter_names.put(trim(property.key[4..]), {});
    }

    // Track clean default parts when collecting and this is a non-const container
    const build_default = _collect_clean_default and !is_const;
    var clean_props = std.array_list.Managed([]const u8).init(alloc);
    // Function entries only repeat their signatures from the type.
    var function_props: usize = 0;
    var spread_types = std.array_list.Managed([]const u8).init(alloc);
    var property_types = std.array_list.Managed([]const u8).init(alloc);
    var string_index = false;

    var parts = std.array_list.Managed(u8).init(alloc);
    try parts.ensureTotalCapacity(content.len + 32);
    try parts.appendSlice("{\n  ");
    var emitted_count: usize = 0;
    for (properties) |prop| {
        if ((ch.startsWith(prop.key, "get ") or ch.startsWith(prop.key, "set ")) and try computed_keys.hasTemplateSubstitution(alloc, trim(prop.key[4..]))) continue;
        if (std.mem.eql(u8, prop.key, "...")) {
            const spread_value = trim(prop.value);
            const spread_type = if (parameters) |body_parameters|
                try inferBodySpreadType(alloc, spread_value, body_parameters, depth + 1, class_scope, return_scope)
            else if (isEntityName(spread_value))
                try std.fmt.allocPrint(alloc, "typeof {s}", .{spread_value})
            else
                try inferNarrowTypeWithKeyConstants(alloc, spread_value, is_const, false, depth + 1, key_constants);
            if (!std.mem.eql(u8, spread_type, "unknown")) try spread_types.append(spread_type);
            if (build_default) try clean_props.append(try std.fmt.allocPrint(alloc, "...{s}", .{spread_value}));
            continue;
        }
        // Save parent's clean default before recursive call (nested objects overwrite it)
        const saved_default = _clean_default_result;
        _clean_default_result = null;

        var val_type = if (prop.is_method)
            prop.value
        else if (parameters != null)
            try inferBodyExpressionTypeScoped(alloc, prop.value, parameters.?, depth + 1, class_scope, return_scope)
        else if (std.mem.eql(u8, prop.key, prop.value) and isIdentifierName(prop.value))
            (if (!is_const and key_constants != null) key_constants.?.mutable_binding_types.get(prop.value) else null) orelse try std.fmt.allocPrint(alloc, "typeof {s}", .{prop.value})
        else
            try inferNarrowTypeWithKeyConstants(alloc, prop.value, is_const, false, depth + 1, key_constants);
        // A property naming another binding (`driver: paymentDriver`,
        // `webhook: manage.webhook`) has that binding's type, as a shorthand
        // property does (mirrors the TypeScript emitter).
        if (!prop.is_method and parameters == null and std.mem.eql(u8, val_type, "unknown") and isEntityName(trim(prop.value))) {
            const reference = trim(prop.value);
            val_type = (if (!is_const and key_constants != null) key_constants.?.mutable_binding_types.get(reference) else null) orelse try std.fmt.allocPrint(alloc, "typeof {s}", .{reference});
        }

        // Capture nested clean default (set by recursive inferObjectType/inferArrayType)
        const nested_default = _clean_default_result;
        _clean_default_result = saved_default; // restore parent's

        // The inferred function type as written, before it is collapsed onto
        // one line; the @defaultValue block shows this form, as the
        // TypeScript emitter does.
        const fn_type_raw = val_type;

        // Clean function signatures in inferred types, as the TypeScript
        // emitter does. A method shorthand was already converted to a clean
        // function type by parseObjectProperties and keeps its line breaks.
        if (!prop.is_method and (ch.indexOf(val_type, "=>", 0) != null or
            ch.indexOf(val_type, "function", 0) != null or ch.indexOf(val_type, "async", 0) != null))
        {
            val_type = try cleanMethodSignature(alloc, val_type);
        }

        const is_getter = ch.startsWith(prop.key, "get ");
        const is_setter = ch.startsWith(prop.key, "set ");
        const property_name = if (is_getter or is_setter) trim(prop.key[4..]) else prop.key;
        const has_getter = is_setter and getter_names.contains(property_name);
        if (!try computed_keys.isSymbolKey(alloc, property_name, key_constants) and !has_getter)
            try property_types.append(if (is_getter or is_setter) accessorValueType(is_getter, val_type) else val_type);
        var emit_key = prop.key;
        var index_key = false;
        const raw_val = trim(prop.value);
        if (try computed_keys.resolve(alloc, prop.key, key_constants)) |key| {
            switch (key) {
                .name => |name| emit_key = name,
                .index => {
                    string_index = true;
                    index_key = true;
                },
            }
        }
        if (!index_key) {
            if (emitted_count > 0) try parts.appendSlice(";\n  ");
            emitted_count += 1;

            // Add inline @defaultValue for widened primitive properties
            if (prop.comments.len > 0) {
                try parts.appendSlice(prop.comments);
                try parts.appendSlice("\n  ");
            }
            if (!is_const and isBaseType(val_type) and isPrimitiveLiteral(raw_val)) {
                try parts.appendSlice("/** @defaultValue ");
                try parts.appendSlice(try comment_utils.escapeJsdocContent(alloc, raw_val));
                try parts.appendSlice(" */\n  ");
            }
            if (ch.startsWith(prop.key, "get ")) {
                const getter_type = accessorValueType(true, val_type);
                try parts.appendSlice("get ");
                try parts.appendSlice(trim(prop.key[4..]));
                try parts.appendSlice("(): ");
                try appendIndentedType(&parts, getter_type);
            } else if (ch.startsWith(prop.key, "set ")) {
                const end = if (ch.startsWith(val_type, "(")) findMatchingBracket(val_type, 0, '(', ')') else null;
                const setter_params = if (end) |index| val_type[0 .. index + 1] else "(value: unknown)";
                try parts.appendSlice("set ");
                try parts.appendSlice(trim(prop.key[4..]));
                try appendIndentedType(&parts, setter_params);
            } else {
                if (is_const) try parts.appendSlice("readonly ");
                try parts.appendSlice(emit_key);
                try parts.appendSlice(": ");
                try appendIndentedType(&parts, val_type);
            }
        }

        // Build clean default entry for this property (same loop, no re-parse).
        // Accessors carry no default: `get X: () => T` is not even a type.
        if (build_default and !ch.startsWith(prop.key, "get ") and !ch.startsWith(prop.key, "set ")) {
            if (ch.endsWith(raw_val, " as const") or ch.endsWith(raw_val, "as const")) {
                // skip — type already narrow
            } else if (isPrimitiveLiteral(raw_val)) {
                var ps = std.array_list.Managed(u8).init(alloc);
                try ps.appendSlice(prop.key);
                try ps.appendSlice(": ");
                try ps.appendSlice(raw_val);
                try clean_props.append(try ps.toOwnedSlice());
            } else if (raw_val.len > 0 and raw_val[0] == '[' and isSimpleArrayDefault(raw_val)) {
                var ps = std.array_list.Managed(u8).init(alloc);
                try ps.appendSlice(prop.key);
                try ps.appendSlice(": ");
                try ps.appendSlice(try collapseWhitespace(alloc, raw_val));
                try clean_props.append(try ps.toOwnedSlice());
            } else if (raw_val.len > 0 and raw_val[0] == '{') {
                if (nested_default) |nd| {
                    var ps = std.array_list.Managed(u8).init(alloc);
                    try ps.appendSlice(prop.key);
                    try ps.appendSlice(": ");
                    try ps.appendSlice(nd);
                    try clean_props.append(try ps.toOwnedSlice());
                }
            } else if (raw_val.len > 0 and raw_val[0] != '[' and
                (ch.contains(raw_val, "=>") or ch.startsWith(raw_val, "function") or ch.startsWith(raw_val, "async")))
            {
                // Reuse the already-inferred type instead of re-inferring: a
                // method shorthand collapsed onto one line, an arrow as written.
                var ps = std.array_list.Managed(u8).init(alloc);
                try ps.appendSlice(prop.key);
                try ps.appendSlice(": ");
                try ps.appendSlice(if (prop.is_method) try cleanMethodSignature(alloc, val_type) else fn_type_raw);
                try clean_props.append(try ps.toOwnedSlice());
                function_props += 1;
            }
        }
    }
    if (string_index and spread_types.items.len == 0) {
        if (emitted_count > 0) try parts.appendSlice(";\n  ");
        if (is_const) try parts.appendSlice("readonly ");
        try parts.appendSlice("[x: string]: ");
        var emitted_types = std.array_list.Managed([]const u8).init(alloc);
        for (property_types.items) |property_type| {
            if (containsType(emitted_types.items, property_type)) continue;
            if (emitted_types.items.len > 0) try parts.appendSlice(" | ");
            const grouped = ch.contains(property_type, "=>") or ch.contains(property_type, " & ");
            if (grouped) try parts.append('(');
            try appendIndentedType(&parts, property_type);
            if (grouped) try parts.append(')');
            try emitted_types.append(property_type);
        }
    }
    try parts.appendSlice("\n}");

    // Store computed clean default for parent/emitter to consume
    // A block of function signatures alone repeats the type: no default.
    if (build_default and clean_props.items.len > function_props) {
        var one_line = std.array_list.Managed(u8).init(alloc);
        try one_line.appendSlice("{ ");
        for (clean_props.items, 0..) |item, ci| {
            if (ci > 0) try one_line.appendSlice(", ");
            try one_line.appendSlice(item);
        }
        try one_line.appendSlice(" }");
        const one_line_str = try one_line.toOwnedSlice();
        if (one_line_str.len <= 80) {
            _clean_default_result = one_line_str;
        } else {
            // Multi-line with proper indentation based on nesting depth.
            // depth increments by 2 per nesting level (once in inferNarrowType, once here),
            // so indent = (depth - 1) / 2 maps depth to the correct indent level.
            const indent = if (depth > 0) (depth - 1) / 2 else 0;
            const pad_size = (indent + 1) * 2;
            const close_pad_size = indent * 2;
            // Pre-compute total length so we can do one alloc + memcpy/memset.
            var total: usize = 2; // "{\n"
            for (clean_props.items) |item| total += pad_size + item.len + 1; // pad + item + '\n'
            // Each non-final line gets a comma before its newline.
            if (clean_props.items.len > 0) total += clean_props.items.len - 1;
            total += close_pad_size + 1; // close pad + '}'

            const ml_buf = try alloc.alloc(u8, total);
            var mp: usize = 0;
            ml_buf[mp] = '{';
            mp += 1;
            ml_buf[mp] = '\n';
            mp += 1;
            for (clean_props.items, 0..) |item, ci| {
                @memset(ml_buf[mp..][0..pad_size], ' ');
                mp += pad_size;
                @memcpy(ml_buf[mp..][0..item.len], item);
                mp += item.len;
                if (ci < clean_props.items.len - 1) {
                    ml_buf[mp] = ',';
                    mp += 1;
                }
                ml_buf[mp] = '\n';
                mp += 1;
            }
            @memset(ml_buf[mp..][0..close_pad_size], ' ');
            mp += close_pad_size;
            ml_buf[mp] = '}';
            mp += 1;
            _clean_default_result = ml_buf[0..mp];
        }
    }

    const own_type = try parts.toOwnedSlice();
    if (spread_types.items.len == 0) return own_type;

    var merged_type: []const u8 = spread_types.items[0];
    for (spread_types.items[1..]) |spread_type| {
        merged_type = if (findTopLevelToken(spread_type, "|", 0) != null)
            try std.fmt.allocPrint(alloc, "Omit<{s}, keyof ({s})> & ({s})", .{ merged_type, spread_type, spread_type })
        else
            try std.fmt.allocPrint(alloc, "Omit<{s}, keyof {s}> & {s}", .{ merged_type, spread_type, spread_type });
    }
    if (emitted_count == 0) return merged_type;
    return std.fmt.allocPrint(alloc, "Omit<{s}, keyof {s}> & {s}", .{ merged_type, own_type, own_type });
}

/// A conditional spread with an empty branch contributes optional properties,
/// while its values are still inferred in the function's parameter scope.
fn inferBodySpreadType(alloc: std.mem.Allocator, expression: []const u8, parameters: []const u8, depth: usize, class_scope: ?*ClassScope, return_scope: ?*return_scopes.Scope) InferError![]const u8 {
    var value = trim(expression);
    while (value.len >= 2 and value[0] == '(' and findMatchingBracket(value, 0, '(', ')') == value.len - 1) value = trim(value[1 .. value.len - 1]);
    if (findTopLevelToken(value, "??", 0)) |index| {
        if (std.mem.eql(u8, trim(value[index + 2 ..]), "{}"))
            return nullableSpreadType(alloc, try inferBodyExpressionTypeScoped(alloc, value[0..index], parameters, depth + 1, class_scope, return_scope));
    }
    if (splitTopLevelConditional(value)) |conditional| {
        const nonempty = if (std.mem.eql(u8, trim(conditional.when_false), "{}")) conditional.when_true else if (std.mem.eql(u8, trim(conditional.when_true), "{}")) conditional.when_false else null;
        if (nonempty) |branch| return std.fmt.allocPrint(alloc, "Partial<{s}>", .{try inferBodyExpressionTypeScoped(alloc, branch, parameters, depth + 1, class_scope, return_scope)});
    }
    return inferBodyExpressionTypeScoped(alloc, value, parameters, depth + 1, class_scope, return_scope);
}

/// Infer type from new expression
fn inferNewExpressionType(alloc: std.mem.Allocator, value: []const u8) InferError![]const u8 {
    // Extract class name after "new "
    var i: usize = 4; // skip "new "
    while (i < value.len and ch.isWhitespace(value[i])) i += 1;
    const name_start = i;

    // Constructors may be namespace-qualified or held in lower-case values.
    if (i >= value.len or !ch.isIdentStart(value[i])) return "unknown";
    while (i < value.len and (ch.isIdentChar(value[i]) or value[i] == '.')) i += 1;
    const class_name = value[name_start..i];

    // Check for explicit generic type parameters
    if (i < value.len and value[i] == '<') {
        if (findMatchingBracket(value, i, '<', '>')) |end| {
            const after_generics = trim(value[end + 1 ..]);
            if (after_generics.len > 0 and after_generics[0] == '(') {
                if (findMatchingBracket(after_generics, 0, '(', ')')) |constructor_end| {
                    if (trim(after_generics[constructor_end + 1 ..]).len > 0) return "unknown";
                }
            }
            var result = std.array_list.Managed(u8).init(alloc);
            try result.appendSlice(class_name);
            try result.appendSlice(value[i .. end + 1]);
            return result.toOwnedSlice();
        }
    }

    const after_class = trim(value[i..]);
    if (after_class.len > 0 and after_class[0] == '(') {
        if (findMatchingBracket(after_class, 0, '(', ')')) |constructor_end| {
            if (trim(after_class[constructor_end + 1 ..]).len > 0) return "unknown";
        }
    }

    // Fallback for known built-in types — first-byte dispatch avoids 11 sequential
    // std.mem.eql calls. For unknown class names we fall through to returning
    // the original identifier directly.
    if (class_name.len == 0) return class_name;
    if (std.mem.indexOfScalar(u8, class_name, '.') != null) return class_name;
    if (class_name[0] >= 'a' and class_name[0] <= 'z') return std.fmt.allocPrint(alloc, "InstanceType<typeof {s}>", .{class_name});
    return switch (class_name[0]) {
        'A' => if (std.mem.eql(u8, class_name, "Array")) "any[]" else class_name,
        'D' => if (std.mem.eql(u8, class_name, "Date")) "Date" else class_name,
        'E' => if (std.mem.eql(u8, class_name, "Error")) "Error" else class_name,
        'F' => if (std.mem.eql(u8, class_name, "Function")) "Function" else class_name,
        'M' => if (std.mem.eql(u8, class_name, "Map")) "Map<any, any>" else class_name,
        'O' => if (std.mem.eql(u8, class_name, "Object")) "object" else class_name,
        'P' => if (std.mem.eql(u8, class_name, "Promise")) "Promise<any>" else class_name,
        'R' => if (std.mem.eql(u8, class_name, "RegExp")) "RegExp" else class_name,
        'S' => if (std.mem.eql(u8, class_name, "Set")) "Set<any>" else class_name,
        'W' => blk: {
            if (std.mem.eql(u8, class_name, "WeakMap")) break :blk "WeakMap<any, any>";
            if (std.mem.eql(u8, class_name, "WeakSet")) break :blk "WeakSet<any>";
            break :blk class_name;
        },
        else => class_name,
    };
}

fn inferPromiseRaceType(alloc: std.mem.Allocator, value: []const u8, depth: usize, key_constants: ?*const KeyConstants) InferError![]const u8 {
    const paren_start = std.mem.indexOfScalar(u8, value, '(') orelse return "Promise<unknown>";
    const paren_end = std.mem.lastIndexOfScalar(u8, value, ')') orelse return "Promise<unknown>";
    if (paren_end <= paren_start + 1) return "Promise<never>";
    const argument = trim(value[paren_start + 1 .. paren_end]);
    if (argument.len < 2 or argument[0] != '[' or argument[argument.len - 1] != ']') return "Promise<unknown>";
    const elements = try parseArrayElements(alloc, argument[1 .. argument.len - 1]);
    if (elements.len == 0) return "Promise<never>";

    var types = std.array_list.Managed([]const u8).init(alloc);
    for (elements) |element| {
        var element_type = try inferNarrowTypeWithKeyConstants(alloc, element, false, true, depth + 1, key_constants);
        if (ch.startsWith(element_type, "Promise<") and element_type.len > 9 and element_type[element_type.len - 1] == '>')
            element_type = element_type[8 .. element_type.len - 1];
        if (!containsType(types.items, element_type) and !std.mem.eql(u8, element_type, "never")) try types.append(element_type);
    }
    if (types.items.len == 0) return "Promise<never>";

    var result = std.array_list.Managed(u8).init(alloc);
    try result.appendSlice("Promise<");
    for (types.items, 0..) |element_type, index| {
        if (index > 0) try result.appendSlice(" | ");
        try result.appendSlice(element_type);
    }
    try result.append('>');
    return result.toOwnedSlice();
}

fn unwrapPromiseType(value: []const u8) []const u8 {
    var result = value;
    while (ch.startsWith(result, "Promise<") and result.len > 9 and result[result.len - 1] == '>')
        result = result[8 .. result.len - 1];
    return result;
}

fn inferPromiseAllSettledType(alloc: std.mem.Allocator, value: []const u8, depth: usize, key_constants: ?*const KeyConstants) InferError![]const u8 {
    const paren_start = std.mem.indexOfScalar(u8, value, '(') orelse return "Promise<PromiseSettledResult<unknown>[]>";
    const paren_end = std.mem.lastIndexOfScalar(u8, value, ')') orelse return "Promise<PromiseSettledResult<unknown>[]>";
    if (paren_end <= paren_start + 1) return "Promise<[]>";
    const argument = trim(value[paren_start + 1 .. paren_end]);
    if (argument.len < 2 or argument[0] != '[' or argument[argument.len - 1] != ']') return "Promise<PromiseSettledResult<unknown>[]>";
    const elements = try parseArrayElements(alloc, argument[1 .. argument.len - 1]);

    var result = std.array_list.Managed(u8).init(alloc);
    try result.appendSlice("Promise<[");
    for (elements, 0..) |element, index| {
        if (index > 0) try result.appendSlice(", ");
        const element_type = unwrapPromiseType(try inferNarrowTypeWithKeyConstants(alloc, element, false, false, depth + 1, key_constants));
        try result.appendSlice("PromiseSettledResult<");
        try result.appendSlice(element_type);
        try result.append('>');
    }
    try result.appendSlice("]>");
    return result.toOwnedSlice();
}

/// Infer type from Promise expression
fn inferPromiseType(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize, key_constants: ?*const KeyConstants) InferError![]const u8 {
    if (ch.startsWith(value, "Promise.resolve(")) {
        // Extract argument — single-byte searches use the SIMD scalar paths.
        const paren_start = std.mem.indexOfScalar(u8, value, '(') orelse return "Promise<unknown>";
        const paren_end = std.mem.lastIndexOfScalar(u8, value, ')') orelse return "Promise<unknown>";
        if (paren_end > paren_start + 1) {
            const arg = trim(value[paren_start + 1 .. paren_end]);
            // Promise resolved values are immutable, so preserve is_const from context
            const arg_type = try inferNarrowTypeWithKeyConstants(alloc, arg, is_const, false, depth + 1, key_constants);
            var result = std.array_list.Managed(u8).init(alloc);
            try result.appendSlice("Promise<");
            try result.appendSlice(arg_type);
            try result.append('>');
            return result.toOwnedSlice();
        }
        return "Promise<unknown>";
    }
    if (ch.startsWith(value, "Promise.reject(")) return "Promise<never>";
    if (ch.startsWith(value, "Promise.race(") or ch.startsWith(value, "Promise.any(")) return inferPromiseRaceType(alloc, value, depth, key_constants);
    if (ch.startsWith(value, "Promise.allSettled(")) return inferPromiseAllSettledType(alloc, value, depth, key_constants);
    if (ch.startsWith(value, "Promise.all(")) {
        // Extract the array argument and infer element types
        const paren_start = std.mem.indexOfScalar(u8, value, '(') orelse return "Promise<unknown[]>";
        const paren_end = std.mem.lastIndexOfScalar(u8, value, ')') orelse return "Promise<unknown[]>";
        if (paren_end > paren_start + 1) {
            const arg = trim(value[paren_start + 1 .. paren_end]);
            if (arg.len > 1 and arg[0] == '[' and arg[arg.len - 1] == ']') {
                // It's an array argument — infer as tuple
                const elements = try parseArrayElements(alloc, arg[1 .. arg.len - 1]);
                if (elements.len > 0) {
                    var result = std.array_list.Managed(u8).init(alloc);
                    try result.appendSlice("Promise<[");
                    for (elements, 0..) |elem, idx| {
                        if (idx > 0) try result.appendSlice(", ");
                        // For Promise.resolve(x), extract x's type
                        if (ch.startsWith(elem, "Promise.resolve(")) {
                            const ps = std.mem.indexOfScalar(u8, elem, '(') orelse {
                                try result.appendSlice("unknown");
                                continue;
                            };
                            const pe = std.mem.lastIndexOfScalar(u8, elem, ')') orelse {
                                try result.appendSlice("unknown");
                                continue;
                            };
                            if (pe > ps + 1) {
                                const inner_arg = trim(elem[ps + 1 .. pe]);
                                const inner_type = try inferNarrowTypeWithKeyConstants(alloc, inner_arg, is_const, false, depth + 1, key_constants);
                                try result.appendSlice(inner_type);
                            } else {
                                try result.appendSlice("unknown");
                            }
                        } else {
                            const elem_type = try inferNarrowTypeWithKeyConstants(alloc, elem, is_const, false, depth + 1, key_constants);
                            try result.appendSlice(elem_type);
                        }
                    }
                    try result.appendSlice("]>");
                    return result.toOwnedSlice();
                }
            }
        }
        return "Promise<unknown[]>";
    }

    return "Promise<unknown>";
}

/// Infer function type from function expression
pub fn inferFunctionType(alloc: std.mem.Allocator, value: []const u8, in_union: bool, depth: usize, is_const: bool) InferError![]const u8 {
    const trimmed = trim(value);

    if (ch.startsWith(trimmed, "async function")) {
        const sync_type = try inferFunctionType(alloc, trim(trimmed[6..]), false, depth + 1, is_const);
        const arrow = std.mem.lastIndexOf(u8, sync_type, " => ") orelse return if (in_union) "((...args: any[]) => Promise<unknown>)" else "(...args: any[]) => Promise<unknown>";
        const return_type = trim(sync_type[arrow + 4 ..]);
        var result = std.array_list.Managed(u8).init(alloc);
        if (in_union) try result.append('(');
        try result.appendSlice(sync_type[0 .. arrow + 4]);
        if (ch.startsWith(return_type, "Generator<")) {
            try result.appendSlice("AsyncGenerator<");
            try result.appendSlice(return_type["Generator<".len..]);
        } else if (ch.startsWith(return_type, "Promise<")) {
            try result.appendSlice(return_type);
        } else {
            try result.appendSlice("Promise<");
            try result.appendSlice(return_type);
            try result.append('>');
        }
        if (in_union) try result.append(')');
        return result.toOwnedSlice();
    }

    // Handle very complex function types early
    if (trimmed.len > 200 and countOccurrences(trimmed, "=>") > 2 and countOccurrences(trimmed, "<") > 5 and !ch.startsWith(trimmed, "function")) {
        const func_type = "(...args: any[]) => any";
        if (in_union) {
            var result = std.array_list.Managed(u8).init(alloc);
            try result.append('(');
            try result.appendSlice(func_type);
            try result.append(')');
            return result.toOwnedSlice();
        }
        return func_type;
    }

    // Handle async arrow functions
    if (ch.startsWith(trimmed, "async ") and ch.contains(trimmed, "=>")) {
        var async_removed = trim(trimmed[5..]);
        var generics: []const u8 = "";
        if (async_removed.len > 0 and async_removed[0] == '<') {
            if (findMatchingBracket(async_removed, 0, '<', '>')) |generic_end| {
                generics = async_removed[0 .. generic_end + 1];
                async_removed = trim(async_removed[generic_end + 1 ..]);
            }
        }
        if (findMainArrowIndex(async_removed)) |arrow_idx| {
            const signature = splitArrowSignature(async_removed[0..arrow_idx]);
            // Initializers are not allowed in a declaration: `(a: T = v)` is `(a?: T)`.
            var params = try cleanParameterDefaults(alloc, signature.params);
            const body = trim(async_removed[arrow_idx + 2 ..]);

            // Wrap bare params
            if (params.len == 0 or std.mem.eql(u8, params, "()")) {
                params = "()";
            } else if (params[0] != '(') {
                var p = std.array_list.Managed(u8).init(alloc);
                try p.append('(');
                try p.appendSlice(params);
                try p.append(')');
                params = try p.toOwnedSlice();
            }

            var return_type: []const u8 = signature.return_type;
            if (return_type.len == 0 and body.len > 0 and body[0] == '{') {
                return_type = try inferFunctionBodyReturnType(alloc, body, signature.params, depth + 1);
            } else if (return_type.len == 0 and body.len > 0) {
                return_type = try inferBodyExpressionType(alloc, body, try bodyParameters(alloc, signature.params, null), depth + 1);
            }
            if (return_type.len == 0) return_type = "unknown";

            var result = std.array_list.Managed(u8).init(alloc);
            try result.appendSlice(generics);
            try result.appendSlice(params);
            try result.appendSlice(" => ");
            if (signature.return_type.len > 0 or ch.startsWith(return_type, "Promise<")) {
                try result.appendSlice(return_type);
            } else {
                try result.appendSlice("Promise<");
                try result.appendSlice(return_type);
                try result.append('>');
            }
            const func_type = try result.toOwnedSlice();

            if (in_union) {
                var wrapped = std.array_list.Managed(u8).init(alloc);
                try wrapped.append('(');
                try wrapped.appendSlice(func_type);
                try wrapped.append(')');
                return wrapped.toOwnedSlice();
            }
            return func_type;
        }
    }

    // Regular arrow functions
    if (ch.contains(trimmed, "=>")) {
        var generics: []const u8 = "";
        var remaining = trimmed;

        if (trimmed[0] == '<') {
            if (findMatchingBracket(trimmed, 0, '<', '>')) |gen_end| {
                generics = trimmed[0 .. gen_end + 1];
                remaining = trim(trimmed[gen_end + 1 ..]);
            }
        }

        if (findMainArrowIndex(remaining)) |arrow_idx| {
            const signature = splitArrowSignature(remaining[0..arrow_idx]);
            // Initializers are not allowed in a declaration: `(a: T = v)` is `(a?: T)`.
            var params = try cleanParameterDefaults(alloc, signature.params);
            const body = trim(remaining[arrow_idx + 2 ..]);

            const explicit_return_type = signature.return_type;

            if (params.len == 0 or std.mem.eql(u8, params, "()")) {
                params = "()";
            } else if (params[0] != '(') {
                var p = std.array_list.Managed(u8).init(alloc);
                try p.append('(');
                try p.appendSlice(params);
                try p.append(')');
                params = try p.toOwnedSlice();
            }

            var return_type: []const u8 = "unknown";
            if (explicit_return_type.len > 0) {
                return_type = explicit_return_type;
            } else if (body.len > 0 and body[0] == '{') {
                return_type = try inferFunctionBodyReturnType(alloc, body, signature.params, depth + 1);
            } else if (isDeclarationType(body)) {
                return_type = body;
            } else if (isJsxExpression(body) or (body.len >= 2 and body[0] == '(' and body[body.len - 1] == ')' and
                findMatchingBracket(body, 0, '(', ')') == body.len - 1 and isJsxExpression(trim(body[1 .. body.len - 1]))))
            {
                // An arrow inside JSX attributes or children is an
                // implementation detail, not a higher-order return value.
                return_type = "JSX.Element";
            } else if (ch.contains(body, "=>")) {
                // Higher-order function returning another function
                // Try to extract the outer function signature: (params) =>
                const inner = try extractInnerFunctionSignature(alloc, body, generics);
                return_type = inner;
            } else {
                return_type = try inferBodyExpressionType(alloc, body, try bodyParameters(alloc, signature.params, null), depth + 1);
            }

            var result = std.array_list.Managed(u8).init(alloc);
            try result.appendSlice(generics);
            try result.appendSlice(params);
            try result.appendSlice(" => ");
            try result.appendSlice(return_type);
            const func_type = try result.toOwnedSlice();

            if (in_union) {
                var wrapped = std.array_list.Managed(u8).init(alloc);
                try wrapped.append('(');
                try wrapped.appendSlice(func_type);
                try wrapped.append(')');
                return wrapped.toOwnedSlice();
            }
            return func_type;
        }

        const fallback = "() => unknown";
        if (in_union) {
            var result = std.array_list.Managed(u8).init(alloc);
            try result.append('(');
            try result.appendSlice(fallback);
            try result.append(')');
            return result.toOwnedSlice();
        }
        return fallback;
    }

    // function expressions
    if (ch.startsWith(trimmed, "function")) {
        // Try to extract params
        if (ch.indexOfChar(trimmed, '(', 0)) |paren_start| {
            if (findMatchingBracket(trimmed, paren_start, '(', ')')) |paren_end| {
                const params = try cleanParameterDefaults(alloc, trim(trimmed[paren_start .. paren_end + 1]));
                // Check for generator
                const is_generator = ch.indexOfChar(trimmed[0..paren_start], '*', 0) != null;
                // Check for generics
                var generics: []const u8 = "";
                if (ch.indexOfChar(trimmed, '<', 0)) |angle_start| {
                    if (angle_start < paren_start) {
                        if (findMatchingBracket(trimmed, angle_start, '<', '>')) |angle_end| {
                            generics = trimmed[angle_start .. angle_end + 1];
                        }
                    }
                }

                // Check for explicit return type annotation after params
                var return_type: []const u8 = if (is_generator) "Generator<any, any, any>" else "unknown";
                const after_params = trim(trimmed[paren_end + 1 ..]);
                if (after_params.len > 0 and after_params[0] == ':') {
                    // Extract return type up to '{'
                    var rt_end: usize = after_params.len;
                    var rt_depth: i32 = 0;
                    var rt_i: usize = 1;
                    while (rt_i < after_params.len) : (rt_i += 1) {
                        if (after_params[rt_i] == '<') rt_depth += 1 else if (after_params[rt_i] == '>') rt_depth -= 1;
                        if (rt_depth == 0 and after_params[rt_i] == '{') {
                            rt_end = rt_i;
                            break;
                        }
                    }
                    const rt = trim(after_params[1..rt_end]);
                    if (rt.len > 0) return_type = rt;
                } else if (!is_generator and after_params.len > 0 and after_params[0] == '{') {
                    return_type = try inferFunctionBodyReturnType(alloc, after_params, params, depth + 1);
                }

                var result = std.array_list.Managed(u8).init(alloc);
                if (in_union) try result.append('(');
                try result.appendSlice(generics);
                try result.appendSlice(params);
                try result.appendSlice(" => ");
                try result.appendSlice(return_type);
                if (in_union) try result.append(')');
                return result.toOwnedSlice();
            }
        }

        const fallback = "(...args: any[]) => unknown";
        if (in_union) {
            var result = std.array_list.Managed(u8).init(alloc);
            try result.append('(');
            try result.appendSlice(fallback);
            try result.append(')');
            return result.toOwnedSlice();
        }
        return fallback;
    }

    const fallback = "() => unknown";
    if (in_union) {
        var result = std.array_list.Managed(u8).init(alloc);
        try result.append('(');
        try result.appendSlice(fallback);
        try result.append(')');
        return result.toOwnedSlice();
    }
    return fallback;
}

/// Extract type from 'satisfies' operator
/// Index just past a quoted value starting at `start`; template literals skip
/// `${...}` substitutions whole (mirrors the TypeScript emitter).
fn skipQuotedValue(value: []const u8, start: usize, quote: u8) usize {
    var i = start + 1;
    while (i < value.len) {
        const c = value[i];
        if (c == '\\') {
            i += 2;
            continue;
        }
        if (quote == '`' and c == '$' and i + 1 < value.len and value[i + 1] == '{') {
            i = skipBalancedCodeBlock(value, i + 1);
            continue;
        }
        i += 1;
        if (c == quote) break;
    }
    return @min(i, value.len);
}

fn skipBalancedCodeBlock(value: []const u8, start: usize) usize {
    var depth: i32 = 1;
    var i = start + 1;
    while (i < value.len and depth > 0) {
        const c = value[i];
        if (c == '"' or c == '\'' or c == '`') {
            i = skipQuotedValue(value, i, c);
            continue;
        }
        if (c == '/' and i + 1 < value.len and value[i + 1] == '/') {
            i += 2;
            while (i < value.len and value[i] != '\n' and value[i] != '\r') i += 1;
            continue;
        }
        if (c == '/' and i + 1 < value.len and value[i + 1] == '*') {
            i = if (std.mem.indexOfPos(u8, value, i + 2, "*/")) |close| close + 2 else value.len;
            continue;
        }
        if (c == '{') depth += 1 else if (c == '}') depth -= 1;
        i += 1;
    }
    return i;
}

/// The type after the last top-level `satisfies`, skipping strings, template
/// substitutions, comments and regex literals (mirrors the TypeScript emitter).
pub fn extractSatisfiesType(value: []const u8) ?[]const u8 {
    var satisfies_index: ?usize = null;
    var depth: i32 = 0;
    var i: usize = 0;
    while (i < value.len) : (i += 1) {
        const c = value[i];
        if (c == '"' or c == '\'' or c == '`') {
            i = skipQuotedValue(value, i, c) - 1;
            continue;
        }
        if (c == '/' and i + 1 < value.len and value[i + 1] == '/') {
            while (i < value.len and value[i] != '\n') i += 1;
            continue;
        }
        if (c == '/' and i + 1 < value.len and value[i + 1] == '*') {
            i = if (std.mem.indexOfPos(u8, value, i + 2, "*/")) |close| close + 1 else value.len;
            continue;
        }
        if (c == '/') {
            var previous: isize = @as(isize, @intCast(i)) - 1;
            while (previous >= 0 and value[@intCast(previous)] <= 32) previous -= 1;
            if (previous < 0 or std.mem.indexOfScalar(u8, "([{:;,=!?&|+*-~>", value[@intCast(previous)]) != null) {
                var in_class = false;
                i += 1;
                while (i < value.len) : (i += 1) {
                    const r = value[i];
                    if (r == '\\') {
                        i += 1;
                    } else if (r == '[') {
                        in_class = true;
                    } else if (r == ']') {
                        in_class = false;
                    } else if (r == '/' and !in_class) break;
                }
                continue;
            }
        }
        if (c == '(' or c == '[' or c == '{') {
            depth += 1;
        } else if (c == ')' or c == ']' or c == '}') {
            depth -= 1;
        } else if (depth == 0 and ch.startsWith(value[i..], "satisfies") and
            (i == 0 or !ch.isIdentChar(value[i - 1])) and
            (i + 9 >= value.len or !ch.isIdentChar(value[i + 9])) and
            (i == 0 or value[i - 1] != '.'))
        {
            satisfies_index = i;
        }
    }
    const index = satisfies_index orelse return null;
    var type_str = trim(value[index + 9 ..]);
    if (type_str.len > 0 and type_str[type_str.len - 1] == ';') type_str = trim(type_str[0 .. type_str.len - 1]);
    return if (type_str.len > 0) type_str else null;
}

/// Check if a type annotation is a generic/broad type that should be replaced with narrow inference
pub fn isGenericType(type_annotation: []const u8) bool {
    if (type_annotation.len < 3) return false;
    return switch (type_annotation[0]) {
        'R' => ch.startsWith(type_annotation, "Record<"),
        'A' => ch.startsWith(type_annotation, "Array<"),
        '{' => ch.contains(type_annotation, "[") and ch.contains(type_annotation, "]:"),
        'a' => std.mem.eql(u8, type_annotation, "any"),
        'o' => std.mem.eql(u8, type_annotation, "object"),
        'u' => std.mem.eql(u8, type_annotation, "unknown"),
        else => false,
    };
}

// --- Tests ---
test "isNumericLiteral" {
    try std.testing.expect(isNumericLiteral("42"));
    try std.testing.expect(isNumericLiteral("-3.14"));
    try std.testing.expect(isNumericLiteral("0"));
    try std.testing.expect(!isNumericLiteral(""));
    try std.testing.expect(!isNumericLiteral("abc"));
    try std.testing.expect(!isNumericLiteral("-"));
    try std.testing.expect(isNumericLiteral("3."));
    try std.testing.expect(isNumericLiteral(".5"));
    try std.testing.expect(isNumericLiteral("0xff"));
    try std.testing.expect(isNumericLiteral("0b1010"));
    try std.testing.expect(isNumericLiteral("0o755"));
    try std.testing.expect(isNumericLiteral("1e3"));
    try std.testing.expect(isNumericLiteral("1_000.5"));
    try std.testing.expect(!isNumericLiteral("0x"));
    try std.testing.expect(!isNumericLiteral("1__0"));
}

test "inferNarrowType basics" {
    const alloc = std.testing.allocator;
    try std.testing.expectEqualStrings("42", try inferNarrowType(alloc, "42", true, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "42", false, true, 0));
    try std.testing.expectEqualStrings("true", try inferNarrowType(alloc, "true", true, false, 0));
    try std.testing.expectEqualStrings("null", try inferNarrowType(alloc, "null", false, false, 0));
    try std.testing.expectEqualStrings("unknown", try inferNarrowType(alloc, "", false, false, 0));
}

test "inferFunctionType preserves explicit async arrow returns" {
    const result = try inferFunctionType(std.testing.allocator, "async (value: number) : Promise<number> => value", false, 0, true);
    defer std.testing.allocator.free(result);
    try std.testing.expectEqualStrings("(value: number) => Promise<number>", result);
}

test "inferFunctionType infers block returns and unions" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    const number_result = try inferFunctionType(alloc, "() => { return 1 }", false, 0, true);
    try std.testing.expectEqualStrings("() => number", number_result);

    const union_result = try inferFunctionType(alloc, "() => { if (flag) return 1; return 'none' }", false, 0, true);
    try std.testing.expectEqualStrings("() => number | string", union_result);
}

test "inferObjectType retains shorthand and spread types" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    const shorthand = try inferObjectType(alloc, "{ hidden }", false, 0);
    try std.testing.expect(std.mem.indexOf(u8, shorthand, "hidden: typeof hidden") != null);

    const spread = try inferObjectType(alloc, "{ ...base, value: 1 }", false, 0);
    try std.testing.expect(std.mem.indexOf(u8, spread, "Omit<typeof base") != null);
}

test "inference handles expression and function edge cases" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("1 | 'fallback'", try inferNarrowType(alloc, "flag ? 1 : 'fallback'", false, false, 0));
    try std.testing.expectEqualStrings("string", try inferNarrowType(alloc, "undefined ?? 'fallback'", false, false, 0));
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "value >= 2", false, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "NaN", false, false, 0));
    try std.testing.expectEqualStrings("typeof Example", try inferNarrowType(alloc, "class Example {}", false, false, 0));
    try std.testing.expectEqualStrings("<T>(value: T) => Promise<T>", try inferNarrowType(alloc, "async <T>(value: T): Promise<T> => value", false, false, 0));
    try std.testing.expectEqualStrings("(value: number) => number", try inferNarrowType(alloc, "function (value: number) { return value + 1 }", false, false, 0));
}

test "object methods accessors and defaults emit valid signatures" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("number", try inferFunctionBodyReturnType(alloc, "{ return value }", "(value: number = 1)", 0));
    try std.testing.expectEqualStrings("(value?: number) => number", try convertMethodToFunctionType(alloc, "method", "(value: number = 1) { return value }"));
    const result = try inferObjectType(alloc, "{ method(value: number = 1) { return value }, get size() { return 1 }, set size(value: number) {} }", false, 0);
    try std.testing.expect(std.mem.indexOf(u8, result, "method: (value?: number) => number") != null);
    try std.testing.expect(std.mem.indexOf(u8, result, "get size(): number") != null);
    try std.testing.expect(std.mem.indexOf(u8, result, "set size(value: number)") != null);
}

test "object arrow properties infer block and expression returns" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const result = try inferObjectType(arena.allocator(), "{ effect: () => { console.log('done') }, value: () => 2 }", false, 0);
    try std.testing.expect(std.mem.indexOf(u8, result, "effect: () => void") != null);
    try std.testing.expect(std.mem.indexOf(u8, result, "value: () => number") != null);
}

test "const tuple spreads preserve tuple identity" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectEqualStrings("readonly [...typeof values, 3]", try inferNarrowType(arena.allocator(), "[...values, 3] as const", false, false, 0));
}

test "mixed arrays retain nested arrow element types" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectEqualStrings("(number | (() => number))[]", try inferNarrowType(arena.allocator(), "[1, () => 2]", false, false, 0));
}

test "unary and await expressions retain semantic types" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "!enabled", false, false, 0));
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "!!enabled", false, false, 0));
    try std.testing.expectEqualStrings("string", try inferNarrowType(alloc, "typeof value", false, false, 0));
    try std.testing.expectEqualStrings("undefined", try inferNarrowType(alloc, "void run()", false, false, 0));
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "delete object.key", false, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "+value", false, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "-value", false, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "~value", false, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "await Promise.resolve(1)", false, false, 0));
}

test "access and call expressions use type queries" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("RegExp", try inferNarrowType(alloc, "/[a-z\\/]+/gi", false, false, 0));
    try std.testing.expectEqualStrings("unknown", try inferNarrowType(alloc, "createValue()", false, false, 0));
    try std.testing.expectEqualStrings("ReturnType<typeof Math.max>", try inferNarrowType(alloc, "Math.max(1, 2)", false, false, 0));
    // Element and member reads are not queried; a dotted name is the
    // caller's to query whole (`typeof user.name`).
    inline for (.{ "values[0]", "values[index]", "user.name", "user?.name", "$props['metadata']" }) |expression|
        try std.testing.expectEqualStrings("unknown", try inferNarrowType(alloc, expression, false, false, 0));
}

test "parameter and relational expressions infer through arrows" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("(value?: number) => (number) | undefined", try inferNarrowType(alloc, "(value?: number) => value", false, false, 0));
    try std.testing.expectEqualStrings("(...values: number[]) => number[]", try inferNarrowType(alloc, "(...values: number[]) => values", false, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "(((1)))", false, false, 0));
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "key in object", false, false, 0));
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "value instanceof Date", false, false, 0));
}

test "generic and optional calls retain callable types" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("ReturnType<typeof factory<string>>", try inferNarrowType(alloc, "factory<string>()", false, false, 0));
    try std.testing.expectEqualStrings("ReturnType<typeof api.factory<number>>", try inferNarrowType(alloc, "api.factory<number>()", false, false, 0));
    try std.testing.expectEqualStrings("ReturnType<NonNullable<typeof factory>> | (null extends typeof factory ? undefined : undefined extends typeof factory ? undefined : never)", try inferNarrowType(alloc, "factory?.()", false, false, 0));
    try std.testing.expectEqualStrings("ReturnType<NonNullable<typeof api.factory>> | (null extends typeof api.factory ? undefined : undefined extends typeof api.factory ? undefined : never)", try inferNarrowType(alloc, "api.factory?.(1)", false, false, 0));
    inline for (.{
        "typeof import('./model.js').default",
        "ReturnType<typeof import('./model.js').factory>",
        "{ run: (value: string) => number }",
        "(value: string) => number",
    }) |argument| {
        const expression = try std.fmt.allocPrint(alloc, "factory<{s}>('model')", .{argument});
        const expected = try std.fmt.allocPrint(alloc, "ReturnType<typeof factory<{s}>>", .{argument});
        try std.testing.expectEqualStrings(expected, try inferNarrowType(alloc, expression, false, false, 0));
    }
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "value < factory(1)", false, false, 0));
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "factory(1) > value", false, false, 0));
}

test "numeric operators distinguish number and bigint" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    inline for (.{ "value & mask", "value | mask", "value ^ mask", "value << 2", "value >> 2", "value >>> 2", "value ** 2" }) |expression|
        try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, expression, false, false, 0));
    try std.testing.expectEqualStrings("bigint", try inferNarrowType(alloc, "value & 1n", false, false, 0));
    try std.testing.expectEqualStrings("bigint", try inferNarrowType(alloc, "value ** 2n", false, false, 0));
}

test "promise races and async expressions infer resolved values" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("Promise<number | string>", try inferNarrowType(alloc, "Promise.race([Promise.resolve(1), Promise.resolve('ready')])", false, false, 0));
    try std.testing.expectEqualStrings("Promise<boolean>", try inferNarrowType(alloc, "Promise.any([Promise.resolve(true), Promise.reject('no')])", false, false, 0));
    try std.testing.expectEqualStrings("() => Promise<number>", try inferNarrowType(alloc, "async function () { return 1 }", false, false, 0));
    try std.testing.expectEqualStrings("() => AsyncGenerator<any, any, any>", try inferNarrowType(alloc, "async function* () { yield 1 }", false, false, 0));
}

test "constructor and comma expressions preserve final types" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("widgets.Item", try inferNarrowType(alloc, "new widgets.Item()", false, false, 0));
    try std.testing.expectEqualStrings("InstanceType<typeof constructor>", try inferNarrowType(alloc, "new constructor()", false, false, 0));
    try std.testing.expectEqualStrings("string", try inferNarrowType(alloc, "(1, 'last')", false, false, 0));
}

test "literal edge cases and static branches preserve precise types" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, ".5", false, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "3.", false, false, 0));
    try std.testing.expectEqualStrings("bigint", try inferNarrowType(alloc, "-1n", false, false, 0));
    try std.testing.expectEqualStrings("bigint", try inferNarrowType(alloc, "0xffn", false, false, 0));
    try std.testing.expectEqualStrings("string", try inferNarrowType(alloc, "true ? 'yes' : 0", false, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "false ? 'no' : 1", false, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "true && 1", false, false, 0));
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "false && 1", false, false, 0));
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "true || 'fallback'", false, false, 0));
    try std.testing.expectEqualStrings("string", try inferNarrowType(alloc, "false || 'fallback'", false, false, 0));
    try std.testing.expectEqualStrings("string", try inferNarrowType(alloc, "'ready' ?? 0", false, false, 0));
}

test "allSettled and nested promises infer awaited tuple members" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("Promise<[PromiseSettledResult<number>, PromiseSettledResult<string>]>", try inferNarrowType(alloc, "Promise.allSettled([Promise.resolve(1), 'ready'])", false, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "await Promise.resolve(Promise.resolve(1))", false, false, 0));
}

test "arithmetic and update expressions emit valid result types" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    inline for (.{ "1 + 2", "1 - 2", "1 * 2", "1 / 2", "1 % 2" }) |expression|
        try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, expression, true, false, 0));
    try std.testing.expectEqualStrings("'leftright'", try inferNarrowType(alloc, "'left' + 'right'", true, false, 0));
    try std.testing.expectEqualStrings("string", try inferNarrowType(alloc, "'left' + 'right'", false, false, 0));
    try std.testing.expectEqualStrings("string", try inferNarrowType(alloc, "'left' + right", true, false, 0));
    try std.testing.expectEqualStrings("bigint", try inferNarrowType(alloc, "1n + 2n", true, false, 0));
    try std.testing.expectEqualStrings("typeof counter", try inferNarrowType(alloc, "counter++", false, false, 0));
    try std.testing.expectEqualStrings("typeof state.count", try inferNarrowType(alloc, "--state.count", false, false, 0));
}

test "JSX expressions infer portable element types" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("JSX.Element", try inferNarrowType(alloc, "<button>Save</button>", false, false, 0));
    try std.testing.expectEqualStrings("JSX.Element", try inferNarrowType(alloc, "<Form.Field name='email' />", false, false, 0));
    try std.testing.expectEqualStrings("JSX.Element", try inferNarrowType(alloc, "<><span>One</span><span>Two</span></>", false, false, 0));
    try std.testing.expectEqualStrings("JSX.Element", try inferFunctionBodyReturnType(alloc, "{ return <Card title={title} /> }", "(title: string)", 0));
    try std.testing.expectEqualStrings("null | JSX.Element", try inferFunctionBodyReturnType(alloc, "{ if (hidden) return null; return <Panel /> }", "(hidden: boolean)", 0));
    try std.testing.expectEqualStrings("() => JSX.Element", try inferNarrowType(alloc, "() => (<List render={item => <span>{item}</span>} />)", false, false, 0));
    try std.testing.expectEqualStrings("() => JSX.Element", try inferNarrowType(alloc, "() => <List render={item => <span>{item}</span>} />", false, false, 0));
    try std.testing.expectEqualStrings("() => JSX.Element", try inferNarrowType(alloc, "() => (\n<List title=\"score > threshold\" render={item => item.score > 0 ? <strong>{item.label}</strong> : <em>none</em>} />\n)", false, false, 0));
    try std.testing.expectEqualStrings("Value", try inferNarrowType(alloc, "<Value>input", false, false, 0));
}

test "extractSatisfiesType" {
    try std.testing.expectEqualStrings("Config", extractSatisfiesType("{ port: 3000 } satisfies Config").?);
    try std.testing.expect(extractSatisfiesType("just a value without it") == null);
}

test "stripAsyncKeyword zero-copy fast path when no async present" {
    const alloc = std.testing.allocator;
    // The fast-path return is a zero-copy slice of the input — no allocation
    // is made, so we don't need to free the result.
    const src: []const u8 = "function foo(): void {}";
    const out = try stripAsyncKeyword(alloc, src);
    try std.testing.expectEqualStrings(src, out);
    // Same backing pointer = zero-copy was taken.
    try std.testing.expect(out.ptr == src.ptr);
}

test "stripAsyncKeyword removes leading async" {
    const alloc = std.testing.allocator;
    const out = try stripAsyncKeyword(alloc, "async function foo(): void {}");
    defer alloc.free(out);
    try std.testing.expectEqualStrings("function foo(): void {}", out);
}

test "stripAsyncKeyword removes embedded async at word boundary" {
    const alloc = std.testing.allocator;
    const out = try stripAsyncKeyword(alloc, "{ run: async () => 1 }");
    defer alloc.free(out);
    // "async " is stripped, leaving the arrow function intact.
    try std.testing.expectEqualStrings("{ run: () => 1 }", out);
}

test "stripAsyncKeyword preserves identifiers that contain async substring" {
    // The fast-path indexOf("async") will short-circuit to the slow loop, but
    // the slow loop must respect the word boundary. "asynchronous" must NOT
    // be touched because the byte before "async" is not a word boundary
    // *and* the byte after is alphanumeric.
    const alloc = std.testing.allocator;
    const src: []const u8 = "let asynchronous = true";
    const out = try stripAsyncKeyword(alloc, src);
    defer if (out.ptr != src.ptr) alloc.free(out);
    try std.testing.expectEqualStrings(src, out);
}

test "callable returns exclude nested implementation signatures and infer built-in promises" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    try std.testing.expectEqualStrings("number", try inferFunctionBodyReturnType(allocator, "{ function hidden() { return 'text' }; return 7 }", "()", 0));
    try std.testing.expectEqualStrings("number", try inferFunctionBodyReturnType(allocator, "{ const callback = () => { return 'text' }; return 7 }", "()", 0));
    try std.testing.expectEqualStrings("number", try inferFunctionBodyReturnType(allocator, "{ class Hidden { method() { return 'text' } }; return 7 }", "()", 0));
    try std.testing.expectEqualStrings("Promise<number>", try inferFunctionBodyReturnType(allocator, "{ return Promise.resolve(7) }", "()", 0));
    try std.testing.expectEqualStrings("ReturnType<({ resolve: (value: number) => string })[\"resolve\"]>", try inferFunctionBodyReturnType(allocator, "{ return Promise.resolve(7) }", "(Promise: { resolve: (value: number) => string })", 0));
}

test "return types drop comments and parenthesize callbacks beside other results" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("{\n  answer: number\n}", try withoutComments(alloc, "{\n  /** @defaultValue 42 */\n  answer: number\n}"));
    try std.testing.expectEqualStrings("(() => boolean) | undefined", try inferFunctionBodyReturnType(alloc, "{ if (!flag) return\n return () => true }", "(flag: boolean)", 0));
    try std.testing.expectEqualStrings("number", try inferFunctionBodyReturnType(alloc, "{ return 1 // trailing\n}", "()", 0));
}

test "object values drop line comments but keep their line breaks" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("{\n  id?: string\n  column?: string\n}", try withoutLineComments(alloc, "{\n  id?: string // payee\n  column?: string\n}"));
    try std.testing.expectEqualStrings("'a // b'", try withoutLineComments(alloc, "'a // b'"));
}

test "object methods keep async and generator return types" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("(amount: number) => Promise<number>", try convertMethodToFunctionType(alloc, "total", "async (amount: number) { return amount * 2 }"));
    try std.testing.expectEqualStrings("() => Generator<unknown, void, unknown>", try convertMethodToFunctionType(alloc, "ids", "*() { yield 1 }"));
    try std.testing.expectEqualStrings("() => Promise<void>", try convertMethodToFunctionType(alloc, "run", "async () { await go() }"));
}

test "string concatenations and unary operators" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("'ab'", try inferNarrowType(alloc, "'a' + \"b\"", true, false, 0));
    try std.testing.expectEqualStrings("string", try inferNarrowType(alloc, "'a' + String(1)", true, false, 0));
    try std.testing.expectEqualStrings("string", try inferNarrowType(alloc, "typeof value", false, false, 0));
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "typeof value === 'string'", false, false, 0));
}

test "conditional splitting ignores operators inside literals and comments" {
    const split = splitTopLevelConditional("ok ? 'a:b' /* x ? y : z */ : 'c?d'").?;
    try std.testing.expectEqualStrings("'a:b'", split.when_true);
    try std.testing.expectEqualStrings("'c?d'", split.when_false);
    const commented = splitTopLevelConditional("ok ? /* yes */ 1 : // no\n 2").?;
    try std.testing.expectEqualStrings("1", commented.when_true);
    try std.testing.expectEqualStrings("2", commented.when_false);
}

test "const tuple spreads keep variadic length" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("readonly [...unknown[]]", try inferNarrowType(alloc, "[...(flag ? a : b)] as const", false, false, 0));
    try std.testing.expectEqualStrings("readonly [...readonly [1, 2], 3]", try inferNarrowType(alloc, "[...[1, 2], 3] as const", false, false, 0));
}

test "primitive receivers resolve fixed method results" {
    try std.testing.expectEqualStrings("string", primitiveMethodReturnType("number", "toFixed").?);
    try std.testing.expectEqualStrings("string | undefined", primitiveMethodReturnType("string", "at").?);
    try std.testing.expectEqualStrings("string[]", primitiveMethodReturnType("string", "split").?);
    try std.testing.expectEqualStrings("bigint", primitiveMethodReturnType("bigint", "valueOf").?);
    try std.testing.expectEqualStrings("string", primitiveMethodReturnType("boolean", "toString").?);
    try std.testing.expect(primitiveMethodReturnType("string", "custom") == null);
    try std.testing.expect(primitiveMethodReturnType("Date", "toString") == null);

    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("string", try inferFunctionBodyReturnType(alloc, "{ return value.toFixed(2) }", "(value: number)", 0));
    try std.testing.expectEqualStrings("(string | undefined)[]", try inferFunctionBodyReturnType(alloc, "{ return [s.at(0)] }", "(s: string)", 0));
    try std.testing.expectEqualStrings("ReturnType<(string)[\"custom\"]>", try inferFunctionBodyReturnType(alloc, "{ return s.custom() }", "(s: string)", 0));
}

test "defaulted object bindings are visible to body inference" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("{\n  ssl: boolean;\n  ms: number\n}", try inferFunctionBodyReturnType(alloc, "{ return { ssl, ms } }", "({ ssl = true, timeout: ms = 10 } = {})", 0));
    try std.testing.expectEqualStrings("({ a }?: { a?: number | undefined })", try cleanParameterDefaults(alloc, "({ a = 1 } = {})"));
}

test "numeric literal types drop separators" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("5000", try inferNarrowType(alloc, "5_000", true, false, 0));
    try std.testing.expectEqualStrings("-1000.5", try inferNarrowType(alloc, "-1_000.5", true, false, 0));
    try std.testing.expectEqualStrings("1000n", try inferNarrowType(alloc, "1_000n", true, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "5_000", false, false, 0));
    const plain = "42";
    try std.testing.expectEqual(plain.ptr, (try numericLiteralType(alloc, plain)).ptr);
}

test "class field defaults merge with doc comments" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("  /** @defaultValue 3 */\n", try classFieldDefaultDoc(alloc, null, "3", "number"));
    try std.testing.expectEqualStrings("  /**\n   * The port\n   * @defaultValue 8080\n   */\n", try classFieldDefaultDoc(alloc, &.{"/** The port */"}, " 8080 ", "number"));
    try std.testing.expectEqualStrings("  /**\n   * note\n   * @defaultValue 'a'\n   */\n", try classFieldDefaultDoc(alloc, &.{"// note"}, "'a'", "string"));
    try std.testing.expectEqualStrings("  /** @defaultValue true */\n", try classFieldDefaultDoc(alloc, &.{"/* plain */"}, "true", "boolean"));
    try std.testing.expectEqualStrings("  /** @defaultValue 9 */\n", try classFieldDefaultDoc(alloc, &.{"/** @defaultValue 9 */"}, "1", "number"));
    try std.testing.expectEqualStrings("  /** @defaultValue '*\\/' */\n", try classFieldDefaultDoc(alloc, null, "'*/'", "string"));
    try std.testing.expectEqualStrings("", try classFieldDefaultDoc(alloc, null, "[1]", "number[]"));
    try std.testing.expectEqualStrings("", try classFieldDefaultDoc(alloc, null, "'fast'", "'fast'"));
    const comments = try leadingSourceComments(alloc, " /** doc */ // line\n public x = 1");
    try std.testing.expectEqual(@as(usize, 2), comments.len);
    try std.testing.expectEqualStrings("/** doc */", comments[0]);
    try std.testing.expectEqualStrings("// line", comments[1]);
}

test "nested object type literals indent by level" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings(
        "{\n  readonly a: {\n    readonly b: {\n      readonly c: 1\n    }\n  }\n}",
        try inferNarrowType(alloc, "{ a: { b: { c: 1 } } } as const", true, false, 0),
    );
    try std.testing.expectEqualStrings("number", try indentNestedType(alloc, "number"));
}
