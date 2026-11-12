//! Shared native regex literal boundaries used by source and declaration scanning.
const std = @import("std");
const ch = @import("char_utils.zig");

/// Index of the last code byte at or before `from`, skipping whitespace,
/// block comments and line comments (a `//` inside a quoted string on the
/// same line is not a comment). Mirrors the TypeScript emitter.
fn previousCodeIndex(source: []const u8, from: isize) isize {
    var p = from;
    while (true) {
        while (p >= 0 and ch.isWhitespace(source[@intCast(p)])) p -= 1;
        if (p < 0) return -1;
        const at: usize = @intCast(p);
        // End of a block comment: jump to just before its opening.
        if (source[at] == '/' and at > 0 and source[at - 1] == '*') {
            const open = if (at >= 2) std.mem.lastIndexOf(u8, source[0 .. at - 1], "/*") else null;
            p = if (open) |o| @as(isize, @intCast(o)) - 1 else return -1;
            continue;
        }
        // Inside a line comment: its line has a `//` before `at`.
        const line_start = if (std.mem.lastIndexOfAny(u8, source[0..at], "\r\n")) |nl| nl + 1 else 0;
        if (lineCommentStart(source, line_start, at)) |comment| {
            p = @as(isize, @intCast(comment)) - 1;
            continue;
        }
        return p;
    }
}

fn lineCommentStart(source: []const u8, line_start: usize, up_to: usize) ?usize {
    if (std.mem.indexOf(u8, source[line_start .. up_to + 1], "//") == null) return null;
    return scanRegexContext(source, up_to).line_comment_start;
}

fn isRegexPrefixWord(word: []const u8) bool {
    const words = [_][]const u8{ "return", "typeof", "void", "delete", "throw", "new", "in", "of", "case", "instanceof", "yield", "await", "else", "do" };
    for (words) |candidate| if (std.mem.eql(u8, word, candidate)) return true;
    return false;
}

fn isRegexPrefixByte(c: u8) bool {
    return switch (c) {
        '=', '(', '[', '!', '&', '|', '?', ':', ',', ';', '{', '}', '^', '~', '+', '-', '*', '%', '<', '>' => true,
        else => false,
    };
}

/// Whether the `)` at `end` closes a control header (`if (...)`, `while`,
/// `for`, `with`, `switch`, `catch`), after which `/` starts a regex; a call's
/// `)` ends an expression instead. Lexes from the start of `source`, as the
/// TypeScript emitter does.
// Keep ordinary nesting on the stack and grow only for deeper authored input.
// Exhaustion must fail explicitly instead of silently losing later comments.
// Use the native C heap: page-allocator diagnostics retain std.Io in Debug dylibs.
fn ContextStack(comptime T: type, comptime capacity: usize) type {
    return struct {
        inline_items: [capacity]T = undefined,
        count: usize = 0,
        overflow: std.ArrayList(T) = .empty,

        fn deinit(self: *@This()) void {
            self.overflow.deinit(std.heap.c_allocator);
        }

        fn push(self: *@This(), value: T) void {
            if (self.count < capacity) {
                self.inline_items[self.count] = value;
            } else {
                self.overflow.append(std.heap.c_allocator, value) catch @panic("Out of memory scanning declaration context");
            }
            self.count += 1;
        }

        fn pop(self: *@This()) ?T {
            if (self.count == 0) return null;
            self.count -= 1;
            return if (self.count >= capacity) self.overflow.pop() else self.inline_items[self.count];
        }

        fn last(self: *const @This()) ?T {
            if (self.count == 0) return null;
            return if (self.count > capacity) self.overflow.items[self.overflow.items.len - 1] else self.inline_items[self.count - 1];
        }
    };
}

const RegexContext = struct {
    regex_allowed: bool = false,
    closes_control_header: bool = false,
    line_comment_start: ?usize = null,
};

fn scanRegexContext(source: []const u8, end: usize) RegexContext {
    var parentheses: ContextStack(bool, 256) = .{};
    defer parentheses.deinit();
    var template_expressions: ContextStack(i64, 64) = .{};
    defer template_expressions.deinit();
    var brace_depth: i64 = 0;
    var in_template = false;
    var previous: []const u8 = "";
    var before_previous: []const u8 = "";
    var regex_allowed = true;
    var pos: usize = 0;
    while (pos <= end and pos < source.len) {
        const c = source[pos];
        if (in_template) {
            if (c == '\\') {
                pos += 2;
                continue;
            }
            if (c == '`') {
                in_template = false;
                before_previous = previous;
                previous = "literal";
                regex_allowed = false;
            } else if (c == '$' and pos + 1 < source.len and source[pos + 1] == '{') {
                template_expressions.push(brace_depth);
                brace_depth += 1;
                in_template = false;
                before_previous = previous;
                previous = "{";
                regex_allowed = true;
                pos += 1;
            }
            pos += 1;
            continue;
        }
        if (ch.isWhitespace(c)) {
            pos += 1;
            continue;
        }
        if (c == '/' and pos + 1 < source.len and source[pos + 1] == '/') {
            const newline = ch.lineCommentEnd(source, pos + 2);
            if (newline > end) return .{ .regex_allowed = regex_allowed, .line_comment_start = pos };
            pos = @min(newline + 1, source.len);
            continue;
        }
        if (c == '/' and pos + 1 < source.len and source[pos + 1] == '*') {
            pos = if (std.mem.indexOfPos(u8, source, pos + 2, "*/")) |close| close + 2 else source.len;
            continue;
        }
        if (c == '\'' or c == '"') {
            pos += 1;
            while (pos < source.len) {
                const next = source[pos];
                pos += 1;
                if (next == '\\') {
                    pos += 1;
                } else if (next == c) break;
            }
            before_previous = previous;
            previous = "literal";
            regex_allowed = false;
            continue;
        }
        if (c == '`') {
            in_template = true;
            pos += 1;
            continue;
        }
        // Private identifiers are one value token, even when named like a keyword.
        if (ch.isIdentStart(c) or (c == '#' and pos + 1 < source.len and ch.isIdentStart(source[pos + 1]))) {
            const start = pos;
            pos += 1;
            while (pos < source.len and ch.isIdentChar(source[pos])) pos += 1;
            const word = source[start..pos];
            const allows = !std.mem.eql(u8, previous, ".") and isRegexPrefixWord(word);
            before_previous = previous;
            previous = word;
            regex_allowed = allows;
            continue;
        }
        if ((c == '+' or c == '-') and pos + 1 < source.len and source[pos + 1] == c) {
            before_previous = previous;
            previous = source[pos .. pos + 2];
            pos += 2;
            continue;
        }
        if (c == '!' and (pos + 1 == source.len or source[pos + 1] != '=')) {
            before_previous = previous;
            previous = "!";
            pos += 1;
            continue;
        }
        if (c == '(') {
            const control = !std.mem.eql(u8, before_previous, ".") and (std.mem.eql(u8, previous, "if") or
                std.mem.eql(u8, previous, "while") or std.mem.eql(u8, previous, "for") or
                std.mem.eql(u8, previous, "with") or std.mem.eql(u8, previous, "switch") or
                std.mem.eql(u8, previous, "catch") or
                (std.mem.eql(u8, previous, "await") and std.mem.eql(u8, before_previous, "for")));
            parentheses.push(control);
            before_previous = previous;
            previous = "(";
            regex_allowed = true;
        } else if (c == ')') {
            const control = parentheses.pop() orelse false;
            if (pos == end) return .{ .regex_allowed = control, .closes_control_header = control };
            before_previous = previous;
            previous = ")";
            regex_allowed = control;
        } else if (c == '/' and regex_allowed) {
            pos = skipRegex(source, pos);
            before_previous = previous;
            previous = "literal";
            regex_allowed = false;
            continue;
        } else {
            if (c == '{') {
                brace_depth += 1;
            } else if (c == '}') {
                brace_depth -= 1;
                if (template_expressions.last()) |template_depth| {
                    if (template_depth == brace_depth) {
                        _ = template_expressions.pop();
                        in_template = true;
                    }
                }
            }
            before_previous = previous;
            previous = source[pos .. pos + 1];
            regex_allowed = c == '/' or isRegexPrefixByte(c);
        }
        pos += 1;
    }
    return .{ .regex_allowed = regex_allowed };
}

pub fn isRegexStart(source: []const u8, position: usize) bool {
    return isRegexAfter(source, previousCodeIndex(source, @as(isize, @intCast(position)) - 1));
}

pub fn isRegexStartAfterToken(source: []const u8, token_end: usize) bool {
    return isRegexAfter(source, @as(isize, @intCast(token_end)) - 1);
}

fn isRegexAfter(source: []const u8, p: isize) bool {
    if (p < 0) return true; // start of file
    const prev = source[@intCast(p)];
    const at: usize = @intCast(p);
    if (prev == '!' or ((prev == '+' or prev == '-') and at > 0 and source[at - 1] == prev))
        return scanRegexContext(source, at).regex_allowed;
    if (prev == ')') return scanRegexContext(source, at).closes_control_header;
    // After these chars, `/` starts a regex
    if (prev == ch.CH_EQUAL or prev == ch.CH_LPAREN or prev == ch.CH_LBRACKET or
        prev == ch.CH_EXCL or prev == ch.CH_AMP or prev == ch.CH_PIPE or
        prev == ch.CH_QUESTION or prev == ch.CH_COLON or prev == ch.CH_COMMA or
        prev == ch.CH_SEMI or prev == ch.CH_LBRACE or prev == ch.CH_RBRACE or
        prev == ch.CH_CARET or prev == ch.CH_TILDE or
        prev == ch.CH_PLUS or prev == ch.CH_MINUS or prev == ch.CH_STAR or
        prev == ch.CH_PERCENT or prev == ch.CH_LANGLE or prev == ch.CH_RANGLE)
    {
        return true;
    }
    // After keywords like return, typeof, void, etc.
    if (ch.isIdentChar(prev)) {
        var wp = p;
        while (wp >= 0 and ch.isIdentChar(source[@intCast(wp)])) wp -= 1;
        const word_start: usize = @intCast(wp + 1);
        const word_end: usize = @intCast(p + 1);
        const word = source[word_start..word_end];
        // Member names and private identifiers end value expressions.
        const before = previousCodeIndex(source, wp);
        if (before >= 0 and (source[@intCast(before)] == '.' or source[@intCast(before)] == '#')) return false;
        // First-char dispatch to avoid many std.mem.eql calls per slash.
        if (word.len < 2 or word.len > 10) return false;
        return switch (word[0]) {
            'r' => std.mem.eql(u8, word, "return"),
            't' => std.mem.eql(u8, word, "typeof") or std.mem.eql(u8, word, "throw"),
            'v' => std.mem.eql(u8, word, "void"),
            'd' => std.mem.eql(u8, word, "delete") or std.mem.eql(u8, word, "do"),
            'n' => std.mem.eql(u8, word, "new"),
            'i' => std.mem.eql(u8, word, "in") or std.mem.eql(u8, word, "instanceof"),
            'o' => std.mem.eql(u8, word, "of"),
            'c' => std.mem.eql(u8, word, "case"),
            'y' => std.mem.eql(u8, word, "yield"),
            'a' => std.mem.eql(u8, word, "await"),
            'e' => std.mem.eql(u8, word, "else"),
            else => false,
        };
    }
    return false;
}

pub fn skipRegex(source: []const u8, start: usize) usize {
    var position = start;
    position += 1; // skip opening /
    var in_char_class = false;
    while (position < source.len) {
        const c = source[position];
        if (c == ch.CH_BACKSLASH) {
            position += 2;
            continue;
        }
        if (in_char_class) {
            if (c == ch.CH_RBRACKET) in_char_class = false;
            position += 1;
            continue;
        }
        if (c == ch.CH_LBRACKET) {
            in_char_class = true;
            position += 1;
            continue;
        }
        if (c == ch.CH_SLASH) {
            position += 1;
            break;
        }
        if (c == ch.CH_LF or c == ch.CH_CR) break;
        position += 1;
    }
    // Skip flags
    while (position < source.len and ch.isIdentChar(source[position])) position += 1;
    return position;
}

/// Whether the preceding code token permits a JSX primary expression.
pub fn canStartJsx(source: []const u8, before: usize) bool {
    return canStartJsxAfter(source, previousCodeIndex(source, @as(isize, @intCast(before)) - 1));
}

pub fn canStartJsxAfterToken(source: []const u8, token_end: usize) bool {
    return canStartJsxAfter(source, @as(isize, @intCast(token_end)) - 1);
}

fn canStartJsxAfter(source: []const u8, previous: isize) bool {
    if (previous < 0) return true;
    const last: usize = @intCast(previous);
    const char = source[last];
    if (std.mem.indexOfScalar(u8, "=([{,:;!?+-*/%&|^~<", char) != null) return true;
    if (char == '>' and last > 0 and source[last - 1] == '=') return true;
    var start = last + 1;
    while (start > 0 and ch.isIdentChar(source[start - 1])) start -= 1;
    const words = [_][]const u8{ "return", "throw", "yield", "await", "case", "void", "typeof", "delete", "new", "else", "do" };
    for (words) |word| if (std.mem.eql(u8, source[start .. last + 1], word)) return true;
    return false;
}

pub const JsxTagInfo = struct { delta: isize, end: usize };

/// Recognize a JSX tag while skipping an implementation statement. Requiring
/// a matching close for non-self-closing tags keeps comparisons, assertions,
/// and generic type parameters out of JSX depth accounting.
fn jsxTagAt(source: []const u8, index: usize, closing_tags: ?*const std.StringHashMapUnmanaged(usize), reader: ?*JsxReader) std.mem.Allocator.Error!?JsxTagInfo {
    if (index + 1 >= source.len or source[index] != ch.CH_LANGLE) return null;
    const next = source[index + 1];
    if (next == ch.CH_RANGLE) return .{ .delta = 1, .end = index + 1 };
    if (next == ch.CH_SLASH) {
        var end = index + 2;
        if (end >= source.len) return null;
        if (source[end] != ch.CH_RANGLE) {
            if (!ch.isIdentStart(source[end])) return null;
            while (end < source.len and (ch.isIdentChar(source[end]) or std.mem.indexOfScalar(u8, ".:-", source[end]) != null)) end += 1;
            while (end < source.len and ch.isWhitespace(source[end])) end += 1;
        }
        return if (end < source.len and source[end] == ch.CH_RANGLE) .{ .delta = -1, .end = end } else null;
    }
    if (!ch.isIdentStart(next)) return null;

    var name_end = index + 2;
    while (name_end < source.len) : (name_end += 1) {
        const code = source[name_end];
        if (!ch.isIdentChar(code) and code != ch.CH_DOT and code != ':' and code != '-') break;
    }
    if (name_end >= source.len) return null;
    const tag_name = source[index + 1 .. name_end];
    const delimiter = source[name_end];
    if (!ch.isWhitespace(delimiter) and delimiter != ch.CH_RANGLE and delimiter != ch.CH_SLASH) return null;

    var brace_depth: usize = 0;
    var quote: u8 = 0;
    var tag_end = name_end;
    var code_end = name_end;
    while (tag_end < source.len) : (tag_end += 1) {
        const code = source[tag_end];
        if (quote != 0) {
            if (code == ch.CH_BACKSLASH) {
                tag_end += 1;
            } else if (code == quote) {
                quote = 0;
                code_end = tag_end + 1;
            }
            continue;
        }
        if (code == ch.CH_LANGLE and brace_depth > 0 and
            ((tag_end + 1 < source.len and source[tag_end + 1] == '/') or canStartJsxAfterToken(source, code_end)))
        {
            if (try if (reader) |cached| cached.read(tag_end) else jsxTagAt(source, tag_end, closing_tags, null)) |nested| {
                tag_end = nested.end;
                code_end = tag_end + 1;
                continue;
            }
        }
        if (code == ch.CH_SLASH and brace_depth > 0) {
            const next_code = if (tag_end + 1 < source.len) source[tag_end + 1] else 0;
            if (next_code == ch.CH_SLASH) {
                while (tag_end < source.len and source[tag_end] != ch.CH_LF and source[tag_end] != ch.CH_CR) tag_end += 1;
                continue;
            }
            if (next_code == ch.CH_STAR) {
                const end = std.mem.indexOfPos(u8, source, tag_end + 2, "*/") orelse return null;
                tag_end = end + 1;
                continue;
            }
            if (isRegexStartAfterToken(source, code_end)) {
                tag_end = skipRegex(source, tag_end) - 1;
                code_end = tag_end + 1;
                continue;
            }
        }
        if (code == ch.CH_SQUOTE or code == ch.CH_DQUOTE or code == ch.CH_BACKTICK) {
            quote = code;
        } else if (code == ch.CH_LBRACE) {
            brace_depth += 1;
        } else if (code == ch.CH_RBRACE and brace_depth > 0) {
            brace_depth -= 1;
        } else if (code == ch.CH_LANGLE and brace_depth == 0) {
            return null;
        } else if (code == ch.CH_RANGLE and brace_depth == 0) {
            break;
        }
        if (!ch.isWhitespace(code)) code_end = tag_end + 1;
    }
    if (tag_end >= source.len) return null;

    var before_end = tag_end - 1;
    while (before_end > index and ch.isWhitespace(source[before_end])) before_end -= 1;
    if (source[before_end] == ch.CH_SLASH) return .{ .delta = 0, .end = tag_end };

    if (closing_tags) |tags| {
        const closing = tags.get(tag_name) orelse return null;
        return if (closing > tag_end) .{ .delta = 1, .end = tag_end } else null;
    }
    var search_from = tag_end + 1;
    while (ch.indexOf(source, "</", search_from)) |close_start| {
        const close_name_start = close_start + 2;
        const close_name_end = close_name_start + tag_name.len;
        if (close_name_end < source.len and std.mem.eql(u8, source[close_name_start..close_name_end], tag_name) and
            (source[close_name_end] == ch.CH_RANGLE or ch.isWhitespace(source[close_name_end])))
            return .{ .delta = 1, .end = tag_end };
        search_from = close_start + 2;
    }
    return null;
}

/// Per-source closing-tag index; names borrow the source until deinit.
pub const JsxReader = struct {
    source: []const u8,
    allocator: std.mem.Allocator,
    indexed: bool = false,
    closing_tags: std.StringHashMapUnmanaged(usize) = .empty,
    headers: std.AutoHashMapUnmanaged(usize, ?JsxTagInfo) = .empty,
    syntax_slashes: std.AutoHashMapUnmanaged(usize, void) = .empty,

    pub fn deinit(self: *JsxReader) void {
        self.closing_tags.deinit(self.allocator);
        self.headers.deinit(self.allocator);
        self.syntax_slashes.deinit(self.allocator);
    }

    pub fn isTagSlash(self: *const JsxReader, index: usize) bool {
        return self.syntax_slashes.contains(index);
    }

    pub fn read(self: *JsxReader, index: usize) std.mem.Allocator.Error!?JsxTagInfo {
        if (self.headers.get(index)) |cached| return cached;
        if (!self.indexed) {
            var position: usize = 0;
            while (std.mem.indexOfPos(u8, self.source, position, "</")) |opening| {
                if (try jsxTagAt(self.source, opening, null, null)) |tag| {
                    var end = opening + 2;
                    while (end < tag.end and !ch.isWhitespace(self.source[end])) end += 1;
                    try self.closing_tags.put(self.allocator, self.source[opening + 2 .. end], opening);
                }
                position = opening + 2;
            }
            self.indexed = true;
        }
        const tag = try jsxTagAt(self.source, index, &self.closing_tags, self);
        try self.headers.put(self.allocator, index, tag);
        if (tag) |header| {
            if (header.end > 0 and self.source[header.end - 1] == '/') try self.syntax_slashes.put(self.allocator, header.end - 1, {});
        }
        return tag;
    }
};

test "nested JSX headers are memoized at every opening" {
    const alloc = std.testing.allocator;
    var source: std.ArrayList(u8) = .empty;
    defer source.deinit(alloc);
    var openings: std.ArrayList(usize) = .empty;
    defer openings.deinit(alloc);
    const depth = 128;
    for (0..depth) |_| {
        try openings.append(alloc, source.items.len);
        try source.appendSlice(alloc, "<A child={");
    }
    try openings.append(alloc, source.items.len);
    try source.appendSlice(alloc, "<A />");
    for (0..depth) |_| try source.appendSlice(alloc, "} />");
    var reader = JsxReader{ .source = source.items, .allocator = alloc };
    defer reader.deinit();
    try std.testing.expectEqual(source.items.len - 1, (try reader.read(0)).?.end);
    try std.testing.expectEqual(depth + 1, reader.headers.count());
    try std.testing.expectEqual(depth + 1, reader.syntax_slashes.count());
    for (openings.items) |opening| try std.testing.expect((try reader.read(opening)) != null);
    try std.testing.expectEqual(depth + 1, reader.headers.count());
    try std.testing.expect((try reader.read(1)) == null);
    try std.testing.expect((try reader.read(1)) == null);
    try std.testing.expectEqual(depth + 2, reader.headers.count());
}

test "division and postfix operand context preserve real comments" {
    const cases = [_][]const u8{
        "function ratio(total: number, divisor: number, object: { return: number }): number {\n return total\n / 2 // return\n / divisor }\nexport const after = 1",
        "function ratio(total: number, divisor: number, object: { return: number }): number {\n return total++\n / 2 // return\n / divisor }\nexport const after = 1",
        "function ratio(total: number, divisor: number, object: { return: number }): number {\n return total--\n / 2 // return\n / divisor }\nexport const after = 1",
        "function ratio(total: number, divisor: number, object: { return: number }): number {\n return total!\n / 2 // return\n / divisor }\nexport const after = 1",
        "function ratio(total: number, divisor: number, object: { return: number }): number {\n return object.\n return\n / 2 // return\n / divisor }\nexport const after = 1",
        "function ratio(total: number, divisor: number): number {\n return total++ / divisor // actual comment {\n / 2\n}\nexport const after = 1",
    };
    for (cases) |source| {
        const position = std.mem.lastIndexOf(u8, source, "/ divisor").?;
        try std.testing.expect(!isRegexStart(source, position));
    }
}

test "completed deep nesting does not hide later line comments" {
    for ([_]bool{ false, true }) |templates| {
        var source: std.ArrayList(u8) = .empty;
        defer source.deinit(std.testing.allocator);
        try source.appendSlice(std.testing.allocator, "const deep = ");
        const depth: usize = if (templates) 65 else 257;
        for (0..depth) |_| try source.appendSlice(std.testing.allocator, if (templates) "`${" else "(");
        try source.appendSlice(std.testing.allocator, "total");
        for (0..depth) |_| try source.appendSlice(std.testing.allocator, if (templates) "}`" else ")");
        try source.appendSlice(std.testing.allocator, "; return total / 2 // return\n / divisor }");
        const position = std.mem.lastIndexOf(u8, source.items, "/ divisor").?;
        try std.testing.expect(!isRegexStart(source.items, position));
    }
}
