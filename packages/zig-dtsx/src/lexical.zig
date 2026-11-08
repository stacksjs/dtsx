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
        const line_start = if (std.mem.lastIndexOfScalar(u8, source[0..at], '\n')) |nl| nl + 1 else 0;
        if (lineCommentStart(source, line_start, at)) |comment| {
            p = @as(isize, @intCast(comment)) - 1;
            continue;
        }
        return p;
    }
}

fn lineCommentStart(source: []const u8, line_start: usize, up_to: usize) ?usize {
    var quote: u8 = 0;
    var i = line_start;
    while (i <= up_to) : (i += 1) {
        const c = source[i];
        if (quote != 0) {
            if (c == '\\') {
                i += 1;
            } else if (c == quote) quote = 0;
            continue;
        }
        if (c == '\'' or c == '"' or c == '`') {
            quote = c;
            continue;
        }
        if (c == '/' and i + 1 <= up_to and source[i + 1] == '/') return i;
    }
    return null;
}

pub fn isRegexStart(source: []const u8, position: usize) bool {
    const p = previousCodeIndex(source, @as(isize, @intCast(position)) - 1);
    if (p < 0) return true; // start of file
    const prev = source[@intCast(p)];
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
