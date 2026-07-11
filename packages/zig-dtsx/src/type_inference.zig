/// Type inference utilities for DTS generation.
/// Port of processor/type-inference.ts.
const std = @import("std");
const ch = @import("char_utils.zig");

const MAX_INFERENCE_DEPTH = 20;

/// Error type for type inference operations
pub const InferError = std.mem.Allocator.Error;

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

fn isDigitForBase(c: u8, base: u8) bool {
    return switch (base) {
        2 => c == '0' or c == '1',
        8 => c >= '0' and c <= '7',
        10 => c >= '0' and c <= '9',
        16 => (c >= '0' and c <= '9') or (c >= 'a' and c <= 'f') or (c >= 'A' and c <= 'F'),
        else => false,
    };
}

fn consumeDigits(s: []const u8, cursor: *usize, base: u8) bool {
    var saw_digit = false;
    var previous_separator = false;
    while (cursor.* < s.len) {
        const c = s[cursor.*];
        if (isDigitForBase(c, base)) {
            saw_digit = true;
            previous_separator = false;
            cursor.* += 1;
        } else if (c == '_' and saw_digit and !previous_separator and cursor.* + 1 < s.len and isDigitForBase(s[cursor.* + 1], base)) {
            previous_separator = true;
            cursor.* += 1;
        } else break;
    }
    return saw_digit and !previous_separator;
}

/// Check decimal, scientific, hexadecimal, binary, and octal numeric literals.
pub fn isNumericLiteral(s: []const u8) bool {
    if (s.len == 0) return false;
    var i: usize = 0;
    if (s[i] == '-') i += 1;
    if (i >= s.len) return false;
    if (i + 2 <= s.len and s[i] == '0' and i + 1 < s.len) {
        const base: ?u8 = switch (s[i + 1]) {
            'x', 'X' => 16,
            'b', 'B' => 2,
            'o', 'O' => 8,
            else => null,
        };
        if (base) |b| {
            i += 2;
            return consumeDigits(s, &i, b) and i == s.len;
        }
    }
    if (!consumeDigits(s, &i, 10)) return false;
    if (i < s.len and s[i] == '.') {
        i += 1;
        if (!consumeDigits(s, &i, 10)) return false;
    }
    if (i < s.len and (s[i] == 'e' or s[i] == 'E')) {
        i += 1;
        if (i < s.len and (s[i] == '+' or s[i] == '-')) i += 1;
        if (!consumeDigits(s, &i, 10)) return false;
    }
    return i == s.len;
}

/// Check if s (excluding last char 'n') is all digits — for BigInt literals
fn isBigIntDigits(s: []const u8) bool {
    if (s.len < 2) return false;
    for (s[0 .. s.len - 1]) |c| {
        if (c < '0' or c > '9') return false;
    }
    return true;
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

fn inferAccessType(alloc: std.mem.Allocator, value: []const u8) InferError!?[]const u8 {
    if (value.len > 3 and value[value.len - 1] == ']') {
        const bracket = std.mem.lastIndexOfScalar(u8, value, '[') orelse return null;
        const base = trim(value[0..bracket]);
        const index = trim(value[bracket + 1 .. value.len - 1]);
        if (isEntityName(base) and index.len > 0) {
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

    if (std.mem.lastIndexOfScalar(u8, value, '.')) |dot| {
        const base = trim(value[0..dot]);
        const property = trim(value[dot + 1 ..]);
        if (isIdentifierName(base) and isIdentifierName(property))
            return try std.fmt.allocPrint(alloc, "(typeof {s})[\"{s}\"]", .{ base, property });
    }
    return null;
}

fn inferCallType(alloc: std.mem.Allocator, value: []const u8) InferError!?[]const u8 {
    if (value.len < 3 or value[value.len - 1] != ')') return null;
    const open = std.mem.indexOfScalar(u8, value, '(') orelse return null;
    if (findMatchingBracket(value, open, '(', ')') != value.len - 1) return null;
    const callee = trim(value[0..open]);
    if (!isEntityName(callee)) return null;
    const dot = std.mem.indexOfScalar(u8, callee, '.') orelse return null;
    if (ch.indexOfChar(callee, '.', dot + 1) != null) return null;
    return try std.fmt.allocPrint(alloc, "ReturnType<typeof {s}>", .{callee});
}

fn inferBodyCallType(alloc: std.mem.Allocator, value: []const u8, parameters: []const u8) InferError!?[]const u8 {
    if (value.len < 3 or value[value.len - 1] != ')') return null;
    const open = std.mem.indexOfScalar(u8, value, '(') orelse return null;
    if (findMatchingBracket(value, open, '(', ')') != value.len - 1) return null;
    const callee = trim(value[0..open]);
    if (!isEntityName(callee)) return null;

    const dot = std.mem.indexOfScalar(u8, callee, '.');
    const root = if (dot) |index| callee[0..index] else callee;
    const root_type = findParameterType(parameters, root) orelse return "unknown";
    if (dot == null) return try std.fmt.allocPrint(alloc, "ReturnType<{s}>", .{root_type});

    var callable_type = std.array_list.Managed(u8).init(alloc);
    try callable_type.appendSlice(root_type);
    var properties = std.mem.splitScalar(u8, callee[dot.? + 1 ..], '.');
    while (properties.next()) |property| {
        if (!isIdentifierName(property)) return "unknown";
        try callable_type.appendSlice("[\"");
        try callable_type.appendSlice(property);
        try callable_type.appendSlice("\"]");
    }
    return try std.fmt.allocPrint(alloc, "ReturnType<{s}>", .{callable_type.items});
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
    var current_start: usize = 0;
    var depth: i32 = 0;
    var in_string = false;
    var string_char: u8 = 0;
    var i: usize = 0;

    // Skip leading whitespace for current_start
    while (current_start < content.len and ch.isWhitespace(content[current_start])) current_start += 1;

    while (i < content.len) : (i += 1) {
        const c = content[i];
        if (!in_string and (c == '"' or c == '\'' or c == '`')) {
            in_string = true;
            string_char = c;
        } else if (in_string and c == string_char and !ch.isEscaped(content, i)) {
            in_string = false;
        }

        if (!in_string) {
            if (c == '[' or c == '{' or c == '(') depth += 1;
            if (c == ']' or c == '}' or c == ')') depth -= 1;

            if (c == ',' and depth == 0) {
                const elem = trim(content[current_start..i]);
                if (elem.len > 0) {
                    try elements.append(elem);
                }
                current_start = i + 1;
                while (current_start < content.len and ch.isWhitespace(content[current_start])) current_start += 1;
                continue;
            }
        }
    }

    // Last element
    const last = trim(content[current_start..content.len]);
    if (last.len > 0) {
        try elements.append(last);
    }

    // toOwnedSlice() trims unused capacity — important for non-arena callers.
    return elements.toOwnedSlice();
}

/// Clean a method signature: strip async, replace defaults with ?, collapse whitespace.
/// Single-pass implementation combining all transformations.
fn cleanMethodSignature(alloc: std.mem.Allocator, signature: []const u8) InferError![]const u8 {
    var input = signature;
    // Remove leading "async " (6 chars including the trailing space)
    if (ch.startsWith(input, "async ")) {
        input = trim(input[6..]);
    }

    // Fast path: if no async, no defaults (=), no consecutive whitespace, return as-is
    const needs_clean = blk: {
        var prev_ws = false;
        for (input, 0..) |c, i| {
            if (c == '=' and (i + 1 >= input.len or input[i + 1] != '>')) break :blk true;
            const is_ws = ch.isWhitespace(c);
            if (is_ws and prev_ws) break :blk true;
            prev_ws = is_ws;
            if (c == 'a' and i > 0 and !ch.isIdentChar(input[i - 1]) and i + 5 < input.len and
                input[i + 1] == 's' and input[i + 2] == 'y' and
                input[i + 3] == 'n' and input[i + 4] == 'c' and ch.isWhitespace(input[i + 5]))
                break :blk true;
        }
        break :blk false;
    };
    if (!needs_clean) return input;

    // Single pass: remove async keywords, replace defaults with ?, collapse whitespace
    var buf = std.array_list.Managed(u8).init(alloc);
    try buf.ensureTotalCapacity(input.len);
    var j: usize = 0;
    var in_ws = false;

    while (j < input.len) {
        const c = input[j];

        // Skip "async " at word boundaries
        if (j > 0 and !ch.isIdentChar(input[j - 1]) and j + 5 < input.len and
            input[j] == 'a' and input[j + 1] == 's' and input[j + 2] == 'y' and
            input[j + 3] == 'n' and input[j + 4] == 'c' and ch.isWhitespace(input[j + 5]))
        {
            j += 6;
            while (j < input.len and ch.isWhitespace(input[j])) j += 1;
            continue;
        }

        // Handle identifiers - check for default value patterns (word = value)
        if (ch.isIdentChar(c)) {
            const word_start = j;
            while (j < input.len and ch.isIdentChar(input[j])) j += 1;
            const word_end = j;

            // Peek past whitespace for '='
            var peek = j;
            while (peek < input.len and ch.isWhitespace(input[peek])) peek += 1;

            if (peek < input.len and input[peek] == '=' and (peek + 1 >= input.len or input[peek + 1] != '>')) {
                // Default value: skip to , or ) and replace with word?
                var skip = peek + 1;
                while (skip < input.len and input[skip] != ',' and input[skip] != ')') skip += 1;
                // Emit word with collapsed whitespace
                for (input[word_start..word_end]) |wc| {
                    if (ch.isWhitespace(wc)) {
                        if (!in_ws) {
                            try buf.append(' ');
                            in_ws = true;
                        }
                    } else {
                        try buf.append(wc);
                        in_ws = false;
                    }
                }
                try buf.append('?');
                in_ws = false;
                j = skip;
                continue;
            }

            // Not a default - emit the word + any whitespace we peeked past
            for (input[word_start..j]) |wc| {
                if (ch.isWhitespace(wc)) {
                    if (!in_ws) {
                        try buf.append(' ');
                        in_ws = true;
                    }
                } else {
                    try buf.append(wc);
                    in_ws = false;
                }
            }
            continue;
        }

        // Collapse whitespace
        if (ch.isWhitespace(c)) {
            if (!in_ws) {
                try buf.append(' ');
                in_ws = true;
            }
            j += 1;
        } else {
            try buf.append(c);
            in_ws = false;
            j += 1;
        }
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
    var cleaned = method_def;
    // Remove leading async (6 chars including the trailing space)
    if (ch.startsWith(cleaned, "async ")) {
        cleaned = trim(cleaned[6..]);
    }

    // Extract generics from key (e.g., "onSuccess<T>" -> generics = "<T>")
    var generics: []const u8 = "";
    _ = key; // key is already clean, generics are at start of value if present
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
        // Look for opening brace (function body)
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
    } else if (after_params.len > 0 and after_params[0] == '{') {
        return_type = try inferFunctionBodyReturnType(alloc, after_params, params, 0);
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

/// Clean parameter defaults: replace `param = value` with `param?`
fn cleanParameterDefaults(alloc: std.mem.Allocator, params: []const u8) InferError![]const u8 {
    // Fast path: if there's no '=' anywhere, the input is already clean.
    if (std.mem.indexOfScalar(u8, params, '=') == null) return params;
    var buf = std.array_list.Managed(u8).init(alloc);
    try buf.ensureTotalCapacity(params.len);
    var depth: i32 = 0;
    var segment_start: usize = 0;
    var default_at: ?usize = null;
    var i: usize = 0;
    while (i < params.len) : (i += 1) {
        const c = params[i];
        if (c == '"' or c == '\'' or c == '`') {
            i += 1;
            while (i < params.len and params[i] != c) : (i += 1) {
                if (params[i] == '\\' and i + 1 < params.len) i += 1;
            }
            continue;
        }
        if (c == '(' or c == '[' or c == '{' or c == '<') depth += 1 else if (c == ')' or c == ']' or c == '}' or c == '>') depth -= 1;
        if (c == '=' and depth == 1 and (i + 1 >= params.len or params[i + 1] != '>')) default_at = i;
        if ((c == ',' and depth == 1) or (c == ')' and depth == 0)) {
            const end = default_at orelse i;
            var declaration = trim(params[segment_start..end]);
            if (default_at != null) {
                if (std.mem.indexOfScalar(u8, declaration, ':')) |colon| {
                    const name = trim(declaration[0..colon]);
                    const annotation = trim(declaration[colon + 1 ..]);
                    try buf.appendSlice(name);
                    if (!ch.endsWith(name, "?")) try buf.append('?');
                    try buf.appendSlice(": ");
                    try buf.appendSlice(annotation);
                } else {
                    try buf.appendSlice(declaration);
                    if (!ch.endsWith(declaration, "?")) try buf.append('?');
                }
            } else try buf.appendSlice(declaration);
            try buf.append(c);
            segment_start = i + 1;
            default_at = null;
            if (c == ',') try buf.append(' ');
        } else if (segment_start == 0 and i == 0 and c == '(') {
            try buf.append('(');
            segment_start = 1;
        }
    }
    // toOwnedSlice() trims unused capacity — safer for non-arena allocators.
    return buf.toOwnedSlice();
}

/// Parse object properties from content between braces.
/// Returns array of [key, value] pairs as slices into content.
const ObjectProperty = struct {
    key: []const u8,
    value: []const u8,
    is_method: bool,
};

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
            // Update current_start if in key mode so the key slice doesn't include comment text
            if (in_key and i < content.len) {
                current_start = i + 1;
                while (current_start < content.len and ch.isWhitespace(content[current_start])) current_start += 1;
            }
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
            if (c == '(' and depth == 0 and in_key) {
                // Method definition — must check BEFORE general bracket tracking
                key_start = current_start;
                key_end = i;
                current_start = i;
                in_key = false;
                is_method = true;
                depth = 1;
            } else if (c == '{' or c == '[' or c == '(') {
                depth += 1;
            } else if (c == '}' or c == ']' or c == ')') {
                depth -= 1;
                if (c == ')' and depth == 0 and !in_key and !is_method) arrow_parameter_list_closed = true;
            } else if (c == ':' and depth == 0 and in_key) {
                key_start = current_start;
                key_end = i;
                current_start = i + 1;
                in_key = false;
                is_method = false;
            } else if (c == ':' and depth == 0 and arrow_parameter_list_closed) {
                in_arrow_return_type = true;
            } else if (c == '<' and in_arrow_return_type) {
                type_argument_depth += 1;
            } else if (c == '>' and type_argument_depth > 0 and prev != '=') {
                type_argument_depth -= 1;
            } else if (c == '=' and next == '>' and in_arrow_return_type and type_argument_depth == 0) {
                in_arrow_return_type = false;
                arrow_parameter_list_closed = false;
            } else if (c == ',' and depth == 0 and type_argument_depth == 0) {
                if (!in_key) {
                    var key = trim(content[key_start..key_end]);
                    var val = trim(content[current_start..i]);
                    if (key.len > 0 and val.len > 0) {
                        // Strip async from key if method
                        if (is_method and ch.startsWith(key, "async ")) {
                            key = trim(key[6..]);
                        }
                        // Process value based on type - match TS behavior:
                        // ANY value starting with '(' goes through convertMethodToFunctionType
                        if (is_method and val.len > 0 and val[0] == '(') {
                            val = try convertMethodToFunctionType(alloc, key, val);
                        } else if (ch.contains(val, "=>") or ch.startsWith(val, "function") or ch.startsWith(val, "async")) {
                            val = try cleanMethodSignature(alloc, val);
                        }
                        try properties.append(.{ .key = key, .value = val, .is_method = is_method });
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
                arrow_parameter_list_closed = false;
                in_arrow_return_type = false;
                type_argument_depth = 0;
            }
        }
    }

    // Last property
    if (!in_key) {
        var key = trim(content[key_start..key_end]);
        var val = trim(content[current_start..content.len]);
        if (key.len > 0 and val.len > 0) {
            if (is_method and ch.startsWith(key, "async ")) {
                key = trim(key[6..]);
            }
            if (is_method and val.len > 0 and val[0] == '(') {
                val = try convertMethodToFunctionType(alloc, key, val);
            } else if (ch.contains(val, "=>") or ch.startsWith(val, "function") or ch.startsWith(val, "async")) {
                val = try cleanMethodSignature(alloc, val);
            }
            try properties.append(.{ .key = key, .value = val, .is_method = is_method });
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
        } else if (c == close) {
            depth -= 1;
            if (depth == 0) return i;
        }
    }
    return null;
}

/// Find a token outside strings and nested expression delimiters.
fn findTopLevelToken(str: []const u8, token: []const u8, start: usize) ?usize {
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
        if (c == '(') paren_depth += 1 else if (c == ')') paren_depth -= 1 else if (c == '[') bracket_depth += 1 else if (c == ']') bracket_depth -= 1 else if (c == '{') brace_depth += 1 else if (c == '}') brace_depth -= 1;
        if (paren_depth == 0 and bracket_depth == 0 and brace_depth == 0 and std.mem.startsWith(u8, str[i..], token)) return i;
    }
    return null;
}

/// Find the main arrow (=>) in a function, ignoring nested arrows
fn findMainArrowIndex(str: []const u8) ?usize {
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

pub fn inferFunctionBodyReturnType(alloc: std.mem.Allocator, body: []const u8, parameters: []const u8, depth: usize) InferError![]const u8 {
    const content = if (body.len >= 2 and body[0] == '{' and body[body.len - 1] == '}') body[1 .. body.len - 1] else body;
    var return_types = std.array_list.Managed([]const u8).init(alloc);
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
            if (!containsType(return_types.items, "undefined")) try return_types.append("undefined");
            continue;
        }

        const expression_start = i;
        var expression_depth: i32 = 0;
        while (i < content.len) : (i += 1) {
            const c = content[i];
            if (c == '(' or c == '[' or c == '{') expression_depth += 1 else if (c == ')' or c == ']' or c == '}') {
                if (expression_depth == 0) break;
                expression_depth -= 1;
            } else if (c == ';' and expression_depth == 0) break;
        }
        const expression = trim(content[expression_start..i]);
        const inferred = try inferBodyExpressionType(alloc, expression, parameters, depth + 1);
        if (!containsType(return_types.items, inferred)) try return_types.append(inferred);
    }

    if (return_types.items.len == 0) return "void";
    if (containsType(return_types.items, "unknown")) return "unknown";
    if (return_types.items.len == 1) return return_types.items[0];
    var result = std.array_list.Managed(u8).init(alloc);
    for (return_types.items, 0..) |return_type, index| {
        if (index > 0) try result.appendSlice(" | ");
        try result.appendSlice(return_type);
    }
    return result.toOwnedSlice();
}

fn inferBodyExpressionType(alloc: std.mem.Allocator, expression: []const u8, parameters: []const u8, depth: usize) InferError![]const u8 {
    var value = trim(expression);
    while (value.len >= 2 and value[0] == '(' and value[value.len - 1] == ')' and findMatchingBracket(value, 0, '(', ')') == value.len - 1) {
        value = trim(value[1 .. value.len - 1]);
    }
    if (findParameterType(parameters, value)) |parameter_type| return parameter_type;
    if (try inferBodyCallType(alloc, value, parameters)) |call_type| return call_type;

    var expression_depth: i32 = 0;
    var i = value.len;
    while (i > 0) {
        i -= 1;
        const c = value[i];
        if (c == ')' or c == ']' or c == '}') expression_depth += 1 else if (c == '(' or c == '[' or c == '{') expression_depth -= 1 else if (expression_depth == 0 and (c == '+' or c == '-' or c == '*' or c == '/' or c == '%')) {
            const left = try inferBodyExpressionType(alloc, value[0..i], parameters, depth + 1);
            const right = try inferBodyExpressionType(alloc, value[i + 1 ..], parameters, depth + 1);
            if (c == '+' and (std.mem.eql(u8, left, "string") or std.mem.eql(u8, right, "string"))) return "string";
            if (std.mem.eql(u8, left, "number") and std.mem.eql(u8, right, "number")) return "number";
            break;
        }
    }

    var inferred = try inferNarrowType(alloc, value, false, false, depth + 1);
    var parameter_iter = std.mem.tokenizeAny(u8, parameters, "(),");
    while (parameter_iter.next()) |parameter| {
        const colon = std.mem.indexOfScalar(u8, parameter, ':') orelse continue;
        const name = trim(parameter[0..colon]);
        const parameter_type = trim(parameter[colon + 1 ..]);
        if (!isIdentifierName(name) or parameter_type.len == 0) continue;
        const needle = try std.fmt.allocPrint(alloc, "typeof {s}", .{name});
        if (std.mem.indexOf(u8, inferred, needle) != null) inferred = try std.mem.replaceOwned(u8, alloc, inferred, needle, parameter_type);
    }
    return inferred;
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
            } else if ((c == ',' or c == '=') and nesting == 0) break;
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
    if (value.len == 0) return "unknown";
    if (depth >= MAX_INFERENCE_DEPTH) return "unknown";

    const trimmed = trim(value);
    if (trimmed.len == 0) return "unknown";

    while (trimmed.len >= 2 and trimmed[0] == '(' and trimmed[trimmed.len - 1] == ')' and findMatchingBracket(trimmed, 0, '(', ')') == trimmed.len - 1) {
        return inferNarrowType(alloc, trim(trimmed[1 .. trimmed.len - 1]), is_const, in_union, depth + 1);
    }

    if (ch.startsWith(trimmed, "await ")) {
        const awaited = try inferNarrowType(alloc, trim(trimmed[6..]), false, false, depth + 1);
        if (ch.startsWith(awaited, "Promise<") and awaited.len > 9 and awaited[awaited.len - 1] == '>') return awaited[8 .. awaited.len - 1];
        return awaited;
    }
    if (ch.startsWith(trimmed, "typeof ")) return "string";
    if (ch.startsWith(trimmed, "void ")) return "undefined";
    if (ch.startsWith(trimmed, "delete ")) return "boolean";
    if (trimmed[0] == '!') return "boolean";
    if ((trimmed[0] == '+' or trimmed[0] == '~') and trimmed.len > 1) return "number";
    if (trimmed[0] == '-' and trimmed.len > 1 and !(trimmed[1] >= '0' and trimmed[1] <= '9')) return "number";
    if (isRegexLiteral(trimmed)) return "RegExp";

    // Recognize functions before expression operators so the `>` in `=>` and
    // generic parameter lists cannot be mistaken for a comparison.
    if (findMainArrowIndex(trimmed) != null or ch.startsWith(trimmed, "function") or ch.startsWith(trimmed, "async")) {
        return inferFunctionType(alloc, trimmed, in_union, depth, is_const);
    }

    // Fast path: if first char is a digit, it's almost certainly a number or BigInt literal
    if (trimmed[0] >= '0' and trimmed[0] <= '9') {
        if (isNumericLiteral(trimmed)) {
            return if (!is_const) "number" else trimmed;
        }
        // BigInt literal: digits followed by 'n'
        if (trimmed.len > 1 and trimmed[trimmed.len - 1] == 'n' and isBigIntDigits(trimmed)) {
            return if (is_const) trimmed else "bigint";
        }
        return "unknown";
    }

    // Fast path: negative numbers
    if (trimmed[0] == '-' and trimmed.len > 1 and trimmed[1] >= '0' and trimmed[1] <= '9') {
        if (isNumericLiteral(trimmed)) {
            return if (!is_const) "number" else trimmed;
        }
        return "unknown";
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

    // String literals
    if ((trimmed[0] == '"' and trimmed[trimmed.len - 1] == '"') or
        (trimmed[0] == '\'' and trimmed[trimmed.len - 1] == '\''))
    {
        if (!is_const) return "string";
        return trimmed;
    }

    // Number literals
    if (isNumericLiteral(trimmed)) {
        if (!is_const) return "number";
        return trimmed;
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
            return inferArrayType(alloc, without_as_const, true, depth + 1);
        }
        return inferNarrowType(alloc, without_as_const, true, in_union, depth + 1);
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
        return inferArrayType(alloc, trimmed, is_const, depth + 1);
    }

    // Object literals
    if (trimmed[0] == '{' and trimmed[trimmed.len - 1] == '}') {
        return inferObjectType(alloc, trimmed, is_const, depth + 1);
    }

    // New expressions
    if (ch.startsWith(trimmed, "new ")) {
        return inferNewExpressionType(alloc, trimmed);
    }

    // Function expressions
    if (findMainArrowIndex(trimmed) != null or ch.startsWith(trimmed, "function") or ch.startsWith(trimmed, "async")) {
        return inferFunctionType(alloc, trimmed, in_union, depth, is_const);
    }

    // Template literal
    if (trimmed[0] == '`' and trimmed[trimmed.len - 1] == '`') {
        if (!is_const) return "string";
        if (!hints.has_dollar_brace) return trimmed;
        return "string";
    }

    // Promise expressions
    if (ch.startsWith(trimmed, "Promise.")) {
        return inferPromiseType(alloc, trimmed, is_const, depth);
    }

    // BigInt literals (digits followed by 'n')
    if (trimmed.len > 1 and trimmed[trimmed.len - 1] == 'n' and isBigIntDigits(trimmed)) {
        if (is_const) return trimmed;
        return "bigint";
    }

    // Symbol
    if (ch.startsWith(trimmed, "Symbol(") or std.mem.eql(u8, trimmed, "Symbol.for")) return "symbol";

    if (try inferCallType(alloc, trimmed)) |call_type| return call_type;
    if (try inferAccessType(alloc, trimmed)) |access_type| return access_type;

    // Conditional expressions become the union of their possible result types.
    if (findTopLevelToken(trimmed, "?", 0)) |question| {
        if (question + 1 < trimmed.len and trimmed[question + 1] != '?' and trimmed[question + 1] != '.') {
            if (findTopLevelToken(trimmed, ":", question + 1)) |colon| {
                const when_true = try inferNarrowType(alloc, trim(trimmed[question + 1 .. colon]), true, true, depth + 1);
                const when_false = try inferNarrowType(alloc, trim(trimmed[colon + 1 ..]), true, true, depth + 1);
                if (std.mem.eql(u8, when_true, when_false)) return when_true;
                return std.fmt.allocPrint(alloc, "{s} | {s}", .{ when_true, when_false });
            }
        }
    }

    // Nullish and logical expressions use their operand types instead of
    // collapsing the whole expression to unknown.
    inline for (.{ "??", "||", "&&" }) |operator| {
        if (findTopLevelToken(trimmed, operator, 0)) |index| {
            const left = try inferNarrowType(alloc, trim(trimmed[0..index]), is_const, true, depth + 1);
            const right = try inferNarrowType(alloc, trim(trimmed[index + operator.len ..]), is_const, true, depth + 1);
            if (std.mem.eql(u8, operator, "??") and (std.mem.eql(u8, left, "null") or std.mem.eql(u8, left, "undefined"))) return right;
            if (std.mem.eql(u8, left, right)) return left;
            return std.fmt.allocPrint(alloc, "{s} | {s}", .{ left, right });
        }
    }

    inline for (.{ "===", "!==", "==", "!=", ">=", "<=", ">", "<" }) |operator| {
        if (findTopLevelToken(trimmed, operator, 0) != null) return "boolean";
    }
    if (findTopLevelToken(trimmed, " instanceof ", 0) != null or findTopLevelToken(trimmed, " in ", 0) != null) return "boolean";

    return "unknown";
}

/// Infer narrow type in union context (widens number/boolean)
pub fn inferNarrowTypeInUnion(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize) InferError![]const u8 {
    return inferNarrowType(alloc, value, is_const, true, depth);
}

/// Infer array type from array literal
pub fn inferArrayType(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize) InferError![]const u8 {
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
                        const t = try inferNarrowType(alloc, inner_el, true, false, depth + 1);
                        try parts.appendSlice(t);
                    }
                    try parts.append(']');
                } else {
                    const t = try inferNarrowType(alloc, without, true, false, depth + 1);
                    try parts.appendSlice(t);
                }
            } else if (trimmed_el.len > 1 and trimmed_el[0] == '[' and trimmed_el[trimmed_el.len - 1] == ']') {
                const t = try inferArrayType(alloc, trimmed_el, true, depth + 1);
                try parts.appendSlice(t);
            } else {
                const t = try inferNarrowType(alloc, trimmed_el, true, false, depth + 1);
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
            const spread_type = try inferNarrowType(alloc, spread_value, false, false, depth + 1);
            if (is_const and isEntityName(spread_value)) {
                try element_types.append(try std.fmt.allocPrint(alloc, "...typeof {s}", .{spread_value}));
            } else if (is_const and ch.startsWith(spread_type, "readonly [")) {
                try element_types.append(try std.fmt.allocPrint(alloc, "...{s}", .{spread_type}));
            } else if (ch.endsWith(spread_type, "[]")) {
                try element_types.append(spread_type[0 .. spread_type.len - 2]);
            } else if (isIdentifierName(spread_value)) {
                try element_types.append(try std.fmt.allocPrint(alloc, "(typeof {s})[number]", .{spread_value}));
            } else {
                try element_types.append("unknown");
            }
        } else if (trimmed_el.len > 1 and trimmed_el[0] == '[' and trimmed_el[trimmed_el.len - 1] == ']') {
            try element_types.append(try inferArrayType(alloc, trimmed_el, is_const, depth + 1));
        } else {
            try element_types.append(try inferNarrowTypeInUnion(alloc, trimmed_el, is_const, depth + 1));
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
                    const clean_type = try inferNarrowType(alloc, te, false, false, 0);
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
fn isPrimitiveLiteral(val: []const u8) bool {
    if (val.len == 0) return false;
    // First-byte dispatch: each kind of literal has a distinct prefix byte —
    // saves running every check on every value.
    return switch (val[0]) {
        '"' => val.len >= 2 and val[val.len - 1] == '"',
        '\'' => val.len >= 2 and val[val.len - 1] == '\'',
        't' => val.len == 4 and std.mem.eql(u8, val, "true"),
        'f' => val.len == 5 and std.mem.eql(u8, val, "false"),
        '-', '0'...'9' => isNumericLiteral(val),
        else => false,
    };
}

/// Check if a type is a base/widened type
fn isBaseType(t: []const u8) bool {
    // Length-first dispatch: number=6, string=6, boolean=7. Reject all other
    // lengths in O(1) without invoking std.mem.eql.
    return switch (t.len) {
        6 => std.mem.eql(u8, t, "number") or std.mem.eql(u8, t, "string"),
        7 => std.mem.eql(u8, t, "boolean"),
        else => false,
    };
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

/// Infer object type from object literal.
/// When _collect_clean_default is set and !is_const, also builds the @defaultValue
/// content during the same pass — avoiding double-parsing of parseObjectProperties.
pub fn inferObjectType(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize) InferError![]const u8 {
    const content = trim(value[1 .. value.len - 1]);
    if (content.len == 0) return "{}";
    if (depth >= MAX_INFERENCE_DEPTH) return "Record<string, unknown>";

    const properties = try parseObjectProperties(alloc, content);

    // Track clean default parts when collecting and this is a non-const container
    const build_default = _collect_clean_default and !is_const;
    var clean_props = std.array_list.Managed([]const u8).init(alloc);
    var spread_types = std.array_list.Managed([]const u8).init(alloc);

    var parts = std.array_list.Managed(u8).init(alloc);
    try parts.ensureTotalCapacity(content.len + 32);
    try parts.appendSlice("{\n  ");
    var emitted_count: usize = 0;
    for (properties) |prop| {
        if (std.mem.eql(u8, prop.key, "...")) {
            const spread_value = trim(prop.value);
            const spread_type = if (isEntityName(spread_value))
                try std.fmt.allocPrint(alloc, "typeof {s}", .{spread_value})
            else
                try inferNarrowType(alloc, spread_value, is_const, false, depth + 1);
            if (!std.mem.eql(u8, spread_type, "unknown")) try spread_types.append(spread_type);
            if (build_default) try clean_props.append(try std.fmt.allocPrint(alloc, "...{s}", .{spread_value}));
            continue;
        }
        if (emitted_count > 0) try parts.appendSlice(";\n  ");
        emitted_count += 1;

        // Save parent's clean default before recursive call (nested objects overwrite it)
        const saved_default = _clean_default_result;
        _clean_default_result = null;

        var val_type = if (prop.is_method)
            prop.value
        else if (std.mem.eql(u8, prop.key, prop.value) and isIdentifierName(prop.value))
            try std.fmt.allocPrint(alloc, "typeof {s}", .{prop.value})
        else
            try inferNarrowType(alloc, prop.value, is_const, false, depth + 1);

        // Capture nested clean default (set by recursive inferObjectType/inferArrayType)
        const nested_default = _clean_default_result;
        _clean_default_result = saved_default; // restore parent's

        // Clean method signatures in inferred types — single scan for the
        // first interesting byte. Most val_types are bare types like "string"
        // or "number" that contain neither marker.
        if (ch.indexOfChar(val_type, '=', 0)) |_| {
            // Confirm '=>' rather than just '='
            if (ch.indexOf(val_type, "=>", 0) != null) {
                val_type = try cleanMethodSignature(alloc, val_type);
            }
        } else if (ch.indexOfChar(val_type, 'a', 0)) |_| {
            if (ch.indexOf(val_type, "async", 0) != null) {
                val_type = try stripAsyncKeyword(alloc, val_type);
            }
        }

        // Add inline @defaultValue for widened primitive properties
        const raw_val = trim(prop.value);
        if (!is_const and isBaseType(val_type) and isPrimitiveLiteral(raw_val)) {
            try parts.appendSlice("/** @defaultValue ");
            try parts.appendSlice(raw_val);
            try parts.appendSlice(" */\n  ");
        }
        if (ch.startsWith(prop.key, "get ")) {
            const arrow = ch.indexOf(val_type, "=>", 0);
            const getter_type = if (arrow) |index| trim(val_type[index + 2 ..]) else val_type;
            try parts.appendSlice("get ");
            try parts.appendSlice(trim(prop.key[4..]));
            try parts.appendSlice("(): ");
            try parts.appendSlice(getter_type);
        } else if (ch.startsWith(prop.key, "set ")) {
            const arrow = ch.indexOf(val_type, "=>", 0);
            const setter_params = if (arrow) |index| trim(val_type[0..index]) else "(value: unknown)";
            try parts.appendSlice("set ");
            try parts.appendSlice(trim(prop.key[4..]));
            try parts.appendSlice(setter_params);
        } else {
            try parts.appendSlice(prop.key);
            try parts.appendSlice(": ");
            try parts.appendSlice(val_type);
        }

        // Build clean default entry for this property (same loop, no re-parse)
        if (build_default) {
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
                // Use already-computed val_type instead of re-inferring
                var ps = std.array_list.Managed(u8).init(alloc);
                try ps.appendSlice(prop.key);
                try ps.appendSlice(": ");
                try ps.appendSlice(val_type);
                try clean_props.append(try ps.toOwnedSlice());
            }
        }
    }
    try parts.appendSlice("\n}");

    // Store computed clean default for parent/emitter to consume
    if (build_default and clean_props.items.len > 0) {
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
        merged_type = try std.fmt.allocPrint(alloc, "Omit<{s}, keyof {s}> & {s}", .{ merged_type, spread_type, spread_type });
    }
    if (emitted_count == 0) return merged_type;
    return std.fmt.allocPrint(alloc, "Omit<{s}, keyof {s}> & {s}", .{ merged_type, own_type, own_type });
}

/// Infer type from new expression
fn inferNewExpressionType(alloc: std.mem.Allocator, value: []const u8) InferError![]const u8 {
    // Extract class name after "new "
    var i: usize = 4; // skip "new "
    while (i < value.len and ch.isWhitespace(value[i])) i += 1;
    const name_start = i;

    // Read class name (must start with uppercase)
    if (i >= value.len or value[i] < 'A' or value[i] > 'Z') return "unknown";
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

/// Infer type from Promise expression
fn inferPromiseType(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize) InferError![]const u8 {
    if (ch.startsWith(value, "Promise.resolve(")) {
        // Extract argument — single-byte searches use the SIMD scalar paths.
        const paren_start = std.mem.indexOfScalar(u8, value, '(') orelse return "Promise<unknown>";
        const paren_end = std.mem.lastIndexOfScalar(u8, value, ')') orelse return "Promise<unknown>";
        if (paren_end > paren_start + 1) {
            const arg = trim(value[paren_start + 1 .. paren_end]);
            // Promise resolved values are immutable, so preserve is_const from context
            const arg_type = try inferNarrowType(alloc, arg, is_const, false, depth + 1);
            var result = std.array_list.Managed(u8).init(alloc);
            try result.appendSlice("Promise<");
            try result.appendSlice(arg_type);
            try result.append('>');
            return result.toOwnedSlice();
        }
        return "Promise<unknown>";
    }
    if (ch.startsWith(value, "Promise.reject(")) return "Promise<never>";
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
                                const inner_type = try inferNarrowType(alloc, inner_arg, is_const, false, depth + 1);
                                try result.appendSlice(inner_type);
                            } else {
                                try result.appendSlice("unknown");
                            }
                        } else {
                            const elem_type = try inferNarrowType(alloc, elem, is_const, false, depth + 1);
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
    _ = is_const; // Function return literals are widened regardless of const binding.
    const trimmed = trim(value);

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
            var params = signature.params;
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
                return_type = try inferFunctionBodyReturnType(alloc, body, params, depth + 1);
            } else if (return_type.len == 0 and body.len > 0) {
                return_type = try inferBodyExpressionType(alloc, body, params, depth + 1);
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
            var params = signature.params;
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
                return_type = try inferFunctionBodyReturnType(alloc, body, params, depth + 1);
            } else if (isDeclarationType(body)) {
                return_type = body;
            } else if (ch.contains(body, "=>")) {
                // Higher-order function returning another function
                // Try to extract the outer function signature: (params) =>
                const inner = try extractInnerFunctionSignature(alloc, body, generics);
                return_type = inner;
            } else {
                return_type = try inferBodyExpressionType(alloc, body, params, depth + 1);
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
                const params = trim(trimmed[paren_start .. paren_end + 1]);
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
pub fn extractSatisfiesType(value: []const u8) ?[]const u8 {
    const needle = " satisfies ";
    // Find last occurrence
    var last_idx: ?usize = null;
    var search_from: usize = 0;
    while (ch.indexOf(value, needle, search_from)) |idx| {
        last_idx = idx;
        search_from = idx + 1;
    }

    if (last_idx) |si| {
        var type_str = trim(value[si + needle.len ..]);
        // Remove trailing semicolon
        if (type_str.len > 0 and type_str[type_str.len - 1] == ';') {
            type_str = trim(type_str[0 .. type_str.len - 1]);
        }
        if (type_str.len > 0) return type_str;
    }
    return null;
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
    try std.testing.expect(!isNumericLiteral("3."));
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
    try std.testing.expectEqualStrings("(typeof values)[0]", try inferNarrowType(alloc, "values[0]", false, false, 0));
    try std.testing.expectEqualStrings("(typeof values)[typeof index]", try inferNarrowType(alloc, "values[index]", false, false, 0));
    try std.testing.expectEqualStrings("(typeof user)[\"name\"]", try inferNarrowType(alloc, "user.name", false, false, 0));
    try std.testing.expectEqualStrings("NonNullable<typeof user>[\"name\"] | undefined", try inferNarrowType(alloc, "user?.name", false, false, 0));
}

test "parameter and relational expressions infer through arrows" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    try std.testing.expectEqualStrings("(value?: number) => number", try inferNarrowType(alloc, "(value?: number) => value", false, false, 0));
    try std.testing.expectEqualStrings("(...values: number[]) => number[]", try inferNarrowType(alloc, "(...values: number[]) => values", false, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "(((1)))", false, false, 0));
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "key in object", false, false, 0));
    try std.testing.expectEqualStrings("boolean", try inferNarrowType(alloc, "value instanceof Date", false, false, 0));
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
