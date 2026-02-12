/// Type inference utilities for DTS generation.
/// Port of processor/type-inference.ts.
const std = @import("std");
const ch = @import("char_utils.zig");

const MAX_INFERENCE_DEPTH = 20;

/// Error type for type inference operations
pub const InferError = std.mem.Allocator.Error;

/// Check if a string is a numeric literal (matches /^-?\d+(\.\d+)?$/)
pub fn isNumericLiteral(s: []const u8) bool {
    if (s.len == 0) return false;
    var i: usize = 0;
    if (s[i] == '-') i += 1;
    if (i >= s.len) return false;
    const digit_start = i;
    while (i < s.len and s[i] >= '0' and s[i] <= '9') i += 1;
    if (i == digit_start) return false;
    if (i < s.len and s[i] == '.') {
        i += 1;
        const frac_start = i;
        while (i < s.len and s[i] >= '0' and s[i] <= '9') i += 1;
        if (i == frac_start) return false;
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

/// Parse array elements handling nested structures.
/// Returns slices into the original content string.
pub fn parseArrayElements(alloc: std.mem.Allocator, content: []const u8) InferError![][]const u8 {
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
        const prev = if (i > 0) content[i - 1] else @as(u8, 0);

        if (!in_string and (c == '"' or c == '\'' or c == '`')) {
            in_string = true;
            string_char = c;
        } else if (in_string and c == string_char and prev != '\\') {
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

    return elements.items;
}

/// Clean a method signature: strip async, replace defaults with ?, collapse whitespace.
/// Single-pass implementation combining all transformations.
fn cleanMethodSignature(alloc: std.mem.Allocator, signature: []const u8) InferError![]const u8 {
    var input = signature;
    // Remove leading "async "
    if (ch.startsWith(input, "async ")) {
        input = trim(input[5..]);
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
                        if (!in_ws) { try buf.append(' '); in_ws = true; }
                    } else {
                        try buf.append(wc); in_ws = false;
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
                    if (!in_ws) { try buf.append(' '); in_ws = true; }
                } else {
                    try buf.append(wc); in_ws = false;
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
    var buf = std.array_list.Managed(u8).init(alloc);
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
    return buf.items;
}

/// Convert a method definition to a function type.
/// Input: key = method name (may include generics), value = "(params): ReturnType { body }"
/// Output: "generics(params) => ReturnType"
fn convertMethodToFunctionType(alloc: std.mem.Allocator, key: []const u8, method_def: []const u8) InferError![]const u8 {
    var cleaned = method_def;
    // Remove leading async
    if (ch.startsWith(cleaned, "async ")) {
        cleaned = trim(cleaned[5..]);
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
    var buf = std.array_list.Managed(u8).init(alloc);
    var j: usize = 0;
    while (j < params.len) {
        // Try to match word= pattern (not =>)
        const word_start = j;
        while (j < params.len and ch.isIdentChar(params[j])) j += 1;
        const word_end = j;
        if (word_end > word_start) {
            // Skip whitespace
            while (j < params.len and ch.isWhitespace(params[j])) j += 1;
            if (j < params.len and params[j] == '=' and (j + 1 >= params.len or params[j + 1] != '>')) {
                // Default value - skip to , or )
                j += 1;
                var d: i32 = 0;
                while (j < params.len) {
                    if (params[j] == '(' or params[j] == '[' or params[j] == '{') d += 1;
                    if (params[j] == ')' or params[j] == ']' or params[j] == '}') {
                        if (d == 0) break;
                        d -= 1;
                    }
                    if (params[j] == ',' and d == 0) break;
                    j += 1;
                }
                try buf.appendSlice(params[word_start..word_end]);
                try buf.append('?');
                continue;
            }
            try buf.appendSlice(params[word_start..j]);
        } else {
            try buf.append(params[j]);
            j += 1;
        }
    }
    return buf.items;
}

/// Parse object properties from content between braces.
/// Returns array of [key, value] pairs as slices into content.
fn parseObjectProperties(alloc: std.mem.Allocator, content: []const u8) InferError![][2][]const u8 {
    var properties = std.array_list.Managed([2][]const u8).init(alloc);
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
    var i: usize = 0;

    while (i < content.len) : (i += 1) {
        const c = content[i];
        const prev = if (i > 0) content[i - 1] else @as(u8, 0);
        const next = if (i + 1 < content.len) content[i + 1] else @as(u8, 0);

        // Track single-line comments — skip to end of line
        if (!in_string and !in_comment and c == '/' and next == '/') {
            i += 2; // Skip '//'
            while (i < content.len and content[i] != '\n') : (i += 1) {}
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
        } else if (in_string and c == string_char and prev != '\\') {
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
            } else if (c == ':' and depth == 0 and in_key) {
                key_start = current_start;
                key_end = i;
                current_start = i + 1;
                in_key = false;
                is_method = false;
            } else if (c == ',' and depth == 0) {
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
                        if (val.len > 0 and val[0] == '(') {
                            val = try convertMethodToFunctionType(alloc, key, val);
                        } else if (ch.contains(val, "=>") or ch.startsWith(val, "function") or ch.startsWith(val, "async")) {
                            val = try cleanMethodSignature(alloc, val);
                        }
                        try properties.append(.{ key, val });
                    }
                }
                current_start = i + 1;
                in_key = true;
                is_method = false;
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
            if (val.len > 0 and val[0] == '(') {
                val = try convertMethodToFunctionType(alloc, key, val);
            } else if (ch.contains(val, "=>") or ch.startsWith(val, "function") or ch.startsWith(val, "async")) {
                val = try cleanMethodSignature(alloc, val);
            }
            try properties.append(.{ key, val });
        }
    }

    return properties.items;
}

/// Find matching bracket (open/close) starting from `start`
fn findMatchingBracket(str: []const u8, start: usize, open: u8, close: u8) ?usize {
    var depth: i32 = 0;
    var i = start;
    while (i < str.len) : (i += 1) {
        if (str[i] == open) {
            depth += 1;
        } else if (str[i] == close) {
            depth -= 1;
            if (depth == 0) return i;
        }
    }
    return null;
}

/// Find the main arrow (=>) in a function, ignoring nested arrows
fn findMainArrowIndex(str: []const u8) ?usize {
    var paren_depth: i32 = 0;
    var bracket_depth: i32 = 0;
    var in_string = false;
    var string_char: u8 = 0;

    var i: usize = 0;
    while (i + 1 < str.len) : (i += 1) {
        const c = str[i];
        const prev = if (i > 0) str[i - 1] else @as(u8, 0);

        if (!in_string and (c == '"' or c == '\'' or c == '`')) {
            in_string = true;
            string_char = c;
        } else if (in_string and c == string_char and prev != '\\') {
            in_string = false;
        }

        if (!in_string) {
            if (c == '(') paren_depth += 1 else if (c == ')') paren_depth -= 1 else if (c == '[') bracket_depth += 1 else if (c == ']') bracket_depth -= 1;

            if (c == '=' and str[i + 1] == '>' and paren_depth == 0 and bracket_depth == 0) {
                return i;
            }
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

/// Infer narrow type from a value expression.
/// Returns a type string (allocated from `alloc`).
pub fn inferNarrowType(alloc: std.mem.Allocator, value: []const u8, is_const: bool, in_union: bool, depth: usize) InferError![]const u8 {
    if (value.len == 0) return "unknown";
    if (depth >= MAX_INFERENCE_DEPTH) return "unknown";

    const trimmed = trim(value);
    if (trimmed.len == 0) return "unknown";

    // BigInt expressions
    if (ch.startsWith(trimmed, "BigInt(")) return "bigint";

    // Symbol.for
    if (ch.startsWith(trimmed, "Symbol.for(")) return "symbol";

    // Tagged template literals
    if (ch.contains(trimmed, ".raw`") or ch.contains(trimmed, "String.raw`")) return "string";

    // String literals
    if ((trimmed[0] == '"' and trimmed[trimmed.len - 1] == '"') or
        (trimmed[0] == '\'' and trimmed[trimmed.len - 1] == '\'') or
        (trimmed[0] == '`' and trimmed[trimmed.len - 1] == '`'))
    {
        if (!ch.contains(trimmed, "${")) {
            if (!is_const) return "string";
            return trimmed;
        }
        if (is_const) return trimmed;
        return "string";
    }

    // Number literals
    if (isNumericLiteral(trimmed)) {
        if (!is_const) return "number";
        return trimmed;
    }

    // Boolean literals
    if (std.mem.eql(u8, trimmed, "true") or std.mem.eql(u8, trimmed, "false")) {
        if (!is_const) return "boolean";
        return trimmed;
    }

    // Null and undefined
    if (std.mem.eql(u8, trimmed, "null")) return "null";
    if (std.mem.eql(u8, trimmed, "undefined")) return "undefined";

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
    if (ch.contains(trimmed, "=>") or ch.startsWith(trimmed, "function") or ch.startsWith(trimmed, "async")) {
        return inferFunctionType(alloc, trimmed, in_union, depth, is_const);
    }

    // As const assertions
    if (ch.endsWith(trimmed, "as const")) {
        const without_as_const = trim(trimmed[0 .. trimmed.len - 8]);
        if (without_as_const.len > 1 and without_as_const[0] == '[' and without_as_const[without_as_const.len - 1] == ']') {
            const content = trim(without_as_const[1 .. without_as_const.len - 1]);
            if (content.len == 0) return "readonly []";
            const elements = try parseArrayElements(alloc, content);
            var parts = std.array_list.Managed(u8).init(alloc);
            try parts.appendSlice("readonly [");
            for (elements, 0..) |el, idx| {
                if (idx > 0) try parts.appendSlice(", ");
                const el_type = try inferNarrowType(alloc, el, true, false, depth + 1);
                try parts.appendSlice(el_type);
            }
            try parts.append(']');
            return parts.toOwnedSlice();
        }
        return inferNarrowType(alloc, without_as_const, true, in_union, depth + 1);
    }

    // Template literal
    if (trimmed[0] == '`' and trimmed[trimmed.len - 1] == '`') {
        if (!is_const) return "string";
        if (!ch.contains(trimmed, "${")) return trimmed;
        return "string";
    }

    // Promise expressions
    if (ch.startsWith(trimmed, "Promise.")) {
        return inferPromiseType(alloc, trimmed, is_const, depth);
    }

    // Await expressions
    if (ch.startsWith(trimmed, "await ")) return "unknown";

    // BigInt literals (digits followed by 'n')
    if (trimmed.len > 1 and trimmed[trimmed.len - 1] == 'n' and isBigIntDigits(trimmed)) {
        if (is_const) return trimmed;
        return "bigint";
    }

    // Symbol
    if (ch.startsWith(trimmed, "Symbol(") or std.mem.eql(u8, trimmed, "Symbol.for")) return "symbol";

    return "unknown";
}

/// Infer narrow type in union context (widens number/boolean)
pub fn inferNarrowTypeInUnion(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize) InferError![]const u8 {
    return inferNarrowType(alloc, value, is_const, true, depth);
}

/// Infer array type from array literal
pub fn inferArrayType(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize) InferError![]const u8 {
    const content = trim(value[1 .. value.len - 1]);
    if (content.len == 0) return "never[]";
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

    // Regular array processing
    var element_types = std.array_list.Managed([]const u8).init(alloc);
    for (elements) |el| {
        const trimmed_el = trim(el);
        if (trimmed_el.len > 1 and trimmed_el[0] == '[' and trimmed_el[trimmed_el.len - 1] == ']') {
            try element_types.append(try inferArrayType(alloc, trimmed_el, is_const, depth + 1));
        } else {
            try element_types.append(try inferNarrowTypeInUnion(alloc, trimmed_el, is_const, depth + 1));
        }
    }

    const types = element_types.items;

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

    // Check if all are literals
    var all_literals = true;
    for (types) |t| {
        const is_literal = isNumericLiteral(t) or
            std.mem.eql(u8, t, "true") or std.mem.eql(u8, t, "false") or
            (t.len >= 2 and t[0] == '"' and t[t.len - 1] == '"') or
            (t.len >= 2 and t[0] == '\'' and t[t.len - 1] == '\'');
        if (!is_literal) {
            all_literals = false;
            break;
        }
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

    // Deduplicate types
    var unique = std.array_list.Managed([]const u8).init(alloc);
    for (types) |t| {
        var found = false;
        for (unique.items) |u| {
            if (std.mem.eql(u8, t, u)) {
                found = true;
                break;
            }
        }
        if (!found) try unique.append(t);
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
    if (isNumericLiteral(val)) return true;
    if (std.mem.eql(u8, val, "true") or std.mem.eql(u8, val, "false")) return true;
    if (val.len >= 2 and ((val[0] == '"' and val[val.len - 1] == '"') or
        (val[0] == '\'' and val[val.len - 1] == '\''))) return true;
    return false;
}

/// Check if a type is a base/widened type
fn isBaseType(t: []const u8) bool {
    return std.mem.eql(u8, t, "number") or std.mem.eql(u8, t, "string") or std.mem.eql(u8, t, "boolean");
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
            if (std.mem.eql(u8, word, "new") or
                std.mem.eql(u8, word, "console") or
                std.mem.eql(u8, word, "process") or
                std.mem.eql(u8, word, "async") or
                std.mem.eql(u8, word, "await") or
                std.mem.eql(u8, word, "function") or
                std.mem.eql(u8, word, "yield")) return false;
            // Bare identifiers that aren't true/false are also runtime refs
            if (!std.mem.eql(u8, word, "true") and
                !std.mem.eql(u8, word, "false") and
                !std.mem.eql(u8, word, "null") and
                !std.mem.eql(u8, word, "undefined") and
                !std.mem.eql(u8, word, "const") and
                !std.mem.eql(u8, word, "as")) return false;
            if (i > 0) i -= 1; // back up since outer loop will increment
        }
    }
    return true;
}

/// Collapse whitespace in a string to single spaces
pub fn collapseWhitespace(alloc: std.mem.Allocator, val: []const u8) ![]const u8 {
    var result = std.array_list.Managed(u8).init(alloc);
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

/// Build a clean @default annotation value from a container literal.
/// Only includes properties with primitive or simple array values.
/// Returns null if no clean representation is possible.
pub fn buildCleanDefault(alloc: std.mem.Allocator, value: []const u8) !?[]const u8 {
    return buildCleanDefaultIndented(alloc, value, 0);
}

fn buildCleanDefaultIndented(alloc: std.mem.Allocator, value: []const u8, indent: usize) !?[]const u8 {
    const trimmed = trim(value);

    // Arrays: build a clean representation
    if (trimmed.len > 0 and trimmed[0] == '[') {
        // Fast path: fully simple arrays — collapse whitespace and return
        if (isSimpleArrayDefault(trimmed)) {
            return try collapseWhitespace(alloc, trimmed);
        }
        // Slow path: parse elements, keep simple ones, replace complex with inferred types
        if (trimmed.len > 1 and trimmed[trimmed.len - 1] == ']') {
            const content = trim(trimmed[1 .. trimmed.len - 1]);
            if (content.len == 0) return "[]";
            const elements = try parseArrayElements(alloc, content);
            var clean_elems = std.array_list.Managed([]const u8).init(alloc);
            for (elements) |el| {
                const te = trim(el);
                // Skip 'as const' elements — type already narrow
                if (ch.endsWith(te, " as const") or ch.endsWith(te, "as const")) continue;
                if (isPrimitiveLiteral(te) or std.mem.eql(u8, te, "null") or std.mem.eql(u8, te, "undefined")) {
                    try clean_elems.append(te);
                } else if (te.len > 0 and te[0] == '[' and isSimpleArrayDefault(te)) {
                    try clean_elems.append(try collapseWhitespace(alloc, te));
                } else if (te.len > 0 and te[0] == '{') {
                    if (try buildCleanDefaultIndented(alloc, te, indent)) |nested| {
                        try clean_elems.append(nested);
                    }
                } else {
                    // Complex element: show inferred type instead
                    const inferred = try inferNarrowType(alloc, te, false, false, 0);
                    if (!std.mem.eql(u8, inferred, "unknown")) {
                        try clean_elems.append(inferred);
                    }
                }
            }
            const items = clean_elems.items;
            if (items.len == 0) return null;
            var result = std.array_list.Managed(u8).init(alloc);
            try result.append('[');
            for (items, 0..) |item, idx| {
                if (idx > 0) try result.appendSlice(", ");
                try result.appendSlice(item);
            }
            try result.append(']');
            const slice = try result.toOwnedSlice();
            return @as(?[]const u8, slice);
        }
        return null;
    }

    // Objects: include only properties with primitive/simple values
    if (trimmed.len > 1 and trimmed[0] == '{' and trimmed[trimmed.len - 1] == '}') {
        const content = trim(trimmed[1 .. trimmed.len - 1]);
        if (content.len == 0) return "{}";

        const properties = try parseObjectProperties(alloc, content);

        // Collect clean props
        var prop_strs = std.array_list.Managed([]const u8).init(alloc);
        for (properties) |prop| {
            const tv = trim(prop[1]);
            // Skip 'as const' properties — their types are already narrow literals,
            // so @defaultValue would be redundant (the type IS the value)
            if (ch.endsWith(tv, " as const") or ch.endsWith(tv, "as const")) continue;
            var prop_str = std.array_list.Managed(u8).init(alloc);
            if (isPrimitiveLiteral(tv)) {
                try prop_str.appendSlice(prop[0]);
                try prop_str.appendSlice(": ");
                try prop_str.appendSlice(tv);
                try prop_strs.append(try prop_str.toOwnedSlice());
            } else if (tv.len > 0 and tv[0] == '[' and isSimpleArrayDefault(tv)) {
                try prop_str.appendSlice(prop[0]);
                try prop_str.appendSlice(": ");
                const collapsed = try collapseWhitespace(alloc, tv);
                try prop_str.appendSlice(collapsed);
                try prop_strs.append(try prop_str.toOwnedSlice());
            } else if (tv.len > 0 and tv[0] == '{') {
                if (try buildCleanDefaultIndented(alloc, tv, indent + 1)) |nested| {
                    try prop_str.appendSlice(prop[0]);
                    try prop_str.appendSlice(": ");
                    try prop_str.appendSlice(nested);
                    try prop_strs.append(try prop_str.toOwnedSlice());
                }
            } else if (tv.len > 0 and tv[0] != '[' and (ch.contains(tv, "=>") or ch.startsWith(tv, "function") or ch.startsWith(tv, "async"))) {
                // Functions: include with their inferred type signature
                const fn_type = try inferFunctionType(alloc, tv, false, 0, true);
                try prop_str.appendSlice(prop[0]);
                try prop_str.appendSlice(": ");
                try prop_str.appendSlice(fn_type);
                try prop_strs.append(try prop_str.toOwnedSlice());
            }
        }

        const items = prop_strs.items;
        if (items.len == 0) return null;

        // Try one-line first
        var one_line = std.array_list.Managed(u8).init(alloc);
        try one_line.appendSlice("{ ");
        for (items, 0..) |item, idx| {
            if (idx > 0) try one_line.appendSlice(", ");
            try one_line.appendSlice(item);
        }
        try one_line.appendSlice(" }");
        const one_line_str = try one_line.toOwnedSlice();

        if (one_line_str.len <= 80) return one_line_str;

        // Multi-line with proper indentation
        const pad_size = (indent + 1) * 2;
        const close_pad_size = indent * 2;
        var result = std.array_list.Managed(u8).init(alloc);
        try result.appendSlice("{\n");
        for (items, 0..) |item, idx| {
            var p: usize = 0;
            while (p < pad_size) : (p += 1) try result.append(' ');
            try result.appendSlice(item);
            if (idx < items.len - 1) try result.append(',');
            try result.append('\n');
        }
        {
            var p: usize = 0;
            while (p < close_pad_size) : (p += 1) try result.append(' ');
        }
        try result.append('}');
        return try result.toOwnedSlice();
    }

    return null;
}

/// Infer object type from object literal
pub fn inferObjectType(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize) InferError![]const u8 {
    const content = trim(value[1 .. value.len - 1]);
    if (content.len == 0) return "{}";
    if (depth >= MAX_INFERENCE_DEPTH) return "Record<string, unknown>";

    const properties = try parseObjectProperties(alloc, content);

    var parts = std.array_list.Managed(u8).init(alloc);
    try parts.ensureTotalCapacity(content.len + 32);
    try parts.appendSlice("{\n  ");
    for (properties, 0..) |prop, idx| {
        if (idx > 0) try parts.appendSlice(";\n  ");
        var val_type = try inferNarrowType(alloc, prop[1], is_const, false, depth + 1);
        // Clean method signatures in inferred types
        if (ch.contains(val_type, "=>")) {
            // Full cleaning including whitespace collapse for arrow function types
            val_type = try cleanMethodSignature(alloc, val_type);
        } else if (ch.contains(val_type, "async")) {
            // Only strip async keyword without collapsing whitespace
            val_type = try stripAsyncKeyword(alloc, val_type);
        }

        // Add inline @defaultValue for widened primitive properties
        const raw_val = trim(prop[1]);
        if (!is_const and isBaseType(val_type) and isPrimitiveLiteral(raw_val)) {
            try parts.appendSlice("/** @defaultValue ");
            try parts.appendSlice(raw_val);
            try parts.appendSlice(" */\n  ");
        }
        try parts.appendSlice(prop[0]); // key
        try parts.appendSlice(": ");
        try parts.appendSlice(val_type);
    }
    try parts.appendSlice("\n}");
    return parts.toOwnedSlice();
}

/// Infer type from new expression
fn inferNewExpressionType(alloc: std.mem.Allocator, value: []const u8) InferError![]const u8 {
    // Extract class name after "new "
    var i: usize = 4; // skip "new "
    while (i < value.len and ch.isWhitespace(value[i])) i += 1;
    const name_start = i;

    // Read class name (must start with uppercase)
    if (i >= value.len or value[i] < 'A' or value[i] > 'Z') return "unknown";
    while (i < value.len and ch.isIdentChar(value[i])) i += 1;
    const class_name = value[name_start..i];

    // Check for explicit generic type parameters
    if (i < value.len and value[i] == '<') {
        if (findMatchingBracket(value, i, '<', '>')) |end| {
            var result = std.array_list.Managed(u8).init(alloc);
            try result.appendSlice(class_name);
            try result.appendSlice(value[i .. end + 1]);
            return result.toOwnedSlice();
        }
    }

    // Fallback for known built-in types
    if (std.mem.eql(u8, class_name, "Date")) return "Date";
    if (std.mem.eql(u8, class_name, "Map")) return "Map<any, any>";
    if (std.mem.eql(u8, class_name, "Set")) return "Set<any>";
    if (std.mem.eql(u8, class_name, "WeakMap")) return "WeakMap<any, any>";
    if (std.mem.eql(u8, class_name, "WeakSet")) return "WeakSet<any>";
    if (std.mem.eql(u8, class_name, "RegExp")) return "RegExp";
    if (std.mem.eql(u8, class_name, "Error")) return "Error";
    if (std.mem.eql(u8, class_name, "Array")) return "any[]";
    if (std.mem.eql(u8, class_name, "Object")) return "object";
    if (std.mem.eql(u8, class_name, "Function")) return "Function";
    if (std.mem.eql(u8, class_name, "Promise")) return "Promise<any>";

    return class_name;
}

/// Infer type from Promise expression
fn inferPromiseType(alloc: std.mem.Allocator, value: []const u8, is_const: bool, depth: usize) InferError![]const u8 {
    if (ch.startsWith(value, "Promise.resolve(")) {
        // Extract argument
        const paren_start = std.mem.indexOf(u8, value, "(") orelse return "Promise<unknown>";
        const paren_end = std.mem.lastIndexOf(u8, value, ")") orelse return "Promise<unknown>";
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
        const paren_start = std.mem.indexOf(u8, value, "(") orelse return "Promise<unknown[]>";
        const paren_end = std.mem.lastIndexOf(u8, value, ")") orelse return "Promise<unknown[]>";
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
                            const ps = std.mem.indexOf(u8, elem, "(") orelse {
                                try result.appendSlice("unknown");
                                continue;
                            };
                            const pe = std.mem.lastIndexOf(u8, elem, ")") orelse {
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
        const async_removed = trim(trimmed[5..]);
        if (findMainArrowIndex(async_removed)) |arrow_idx| {
            var params = trim(async_removed[0..arrow_idx]);
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

            var return_type: []const u8 = "unknown";
            if (body.len > 0 and body[0] != '{') {
                return_type = try inferNarrowType(alloc, body, is_const, false, depth + 1);
            }

            var result = std.array_list.Managed(u8).init(alloc);
            try result.appendSlice(params);
            try result.appendSlice(" => Promise<");
            try result.appendSlice(return_type);
            try result.append('>');
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
            var params = trim(remaining[0..arrow_idx]);
            const body = trim(remaining[arrow_idx + 2 ..]);

            // Check for explicit return type annotation
            var explicit_return_type: []const u8 = "";
            // Look for ): ReturnType pattern at end of params
            if (std.mem.lastIndexOf(u8, params, "):")) |ri| {
                explicit_return_type = trim(params[ri + 2 ..]);
                params = params[0 .. ri + 1];
            }

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
                return_type = "unknown";
            } else if (ch.contains(body, "=>")) {
                // Higher-order function returning another function
                // Try to extract the outer function signature: (params) =>
                const inner = try extractInnerFunctionSignature(alloc, body, generics);
                return_type = inner;
            } else if (!in_union) {
                return_type = try inferNarrowType(alloc, body, is_const, false, depth + 1);
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
    const trimmed = trim(type_annotation);
    if (std.mem.eql(u8, trimmed, "any") or std.mem.eql(u8, trimmed, "object") or std.mem.eql(u8, trimmed, "unknown")) return true;
    if (ch.startsWith(trimmed, "Record<") and ch.endsWith(trimmed, ">")) return true;
    if (ch.startsWith(trimmed, "Array<") and ch.endsWith(trimmed, ">")) return true;
    // Object types like { [key: string]: any|string|number|unknown }
    if (trimmed.len > 4 and trimmed[0] == '{' and trimmed[trimmed.len - 1] == '}') {
        if (ch.indexOfChar(trimmed, '[', 0)) |bracket_start| {
            if (ch.indexOfChar(trimmed, ']', bracket_start)) |bracket_end| {
                var vi = bracket_end + 1;
                while (vi < trimmed.len and (trimmed[vi] == ':' or trimmed[vi] == ' ')) vi += 1;
                const value_type_start = vi;
                while (vi < trimmed.len and trimmed[vi] != ' ' and trimmed[vi] != '}') vi += 1;
                const value_type = trim(trimmed[value_type_start..vi]);
                if (std.mem.eql(u8, value_type, "any") or std.mem.eql(u8, value_type, "string") or
                    std.mem.eql(u8, value_type, "number") or std.mem.eql(u8, value_type, "unknown"))
                {
                    return true;
                }
            }
        }
    }
    return false;
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
}

test "inferNarrowType basics" {
    const alloc = std.testing.allocator;
    try std.testing.expectEqualStrings("42", try inferNarrowType(alloc, "42", true, false, 0));
    try std.testing.expectEqualStrings("number", try inferNarrowType(alloc, "42", false, true, 0));
    try std.testing.expectEqualStrings("true", try inferNarrowType(alloc, "true", true, false, 0));
    try std.testing.expectEqualStrings("null", try inferNarrowType(alloc, "null", false, false, 0));
    try std.testing.expectEqualStrings("unknown", try inferNarrowType(alloc, "", false, false, 0));
}

test "extractSatisfiesType" {
    try std.testing.expectEqualStrings("Config", extractSatisfiesType("{ port: 3000 } satisfies Config").?);
    try std.testing.expect(extractSatisfiesType("just a value without it") == null);
}
