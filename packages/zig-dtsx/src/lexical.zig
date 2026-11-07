//! Shared native regex literal boundaries used by source and declaration scanning.
const std = @import("std");
const ch = @import("char_utils.zig");

pub fn isRegexStart(source: []const u8, position: usize) bool {
    var p: isize = @as(isize, @intCast(position)) - 1;
    while (p >= 0 and ch.isWhitespace(source[@intCast(p)])) p -= 1;
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
        // First-char dispatch to avoid 12 std.mem.eql calls per slash. The
        // hot path here runs on every '/' that might start division.
        if (word.len < 2 or word.len > 10) return false;
        return switch (word[0]) {
            'r' => std.mem.eql(u8, word, "return"),
            't' => std.mem.eql(u8, word, "typeof") or std.mem.eql(u8, word, "throw"),
            'v' => std.mem.eql(u8, word, "void"),
            'd' => std.mem.eql(u8, word, "delete"),
            'n' => std.mem.eql(u8, word, "new"),
            'i' => std.mem.eql(u8, word, "in") or std.mem.eql(u8, word, "instanceof"),
            'o' => std.mem.eql(u8, word, "of"),
            'c' => std.mem.eql(u8, word, "case"),
            'y' => std.mem.eql(u8, word, "yield"),
            'a' => std.mem.eql(u8, word, "await"),
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
