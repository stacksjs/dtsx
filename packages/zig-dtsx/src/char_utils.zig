/// Character constants and classification functions for the TypeScript scanner.
/// Direct port of scanner.ts lines 9-49.

// Character code constants for fast comparison
pub const CH_SPACE: u8 = 32;
pub const CH_TAB: u8 = 9;
pub const CH_LF: u8 = 10;
pub const CH_CR: u8 = 13;
pub const CH_SLASH: u8 = 47;
pub const CH_STAR: u8 = 42;
pub const CH_SQUOTE: u8 = 39;
pub const CH_DQUOTE: u8 = 34;
pub const CH_BACKTICK: u8 = 96;
pub const CH_BACKSLASH: u8 = 92;
pub const CH_LBRACE: u8 = 123;
pub const CH_RBRACE: u8 = 125;
pub const CH_LPAREN: u8 = 40;
pub const CH_RPAREN: u8 = 41;
pub const CH_LBRACKET: u8 = 91;
pub const CH_RBRACKET: u8 = 93;
pub const CH_LANGLE: u8 = 60;
pub const CH_RANGLE: u8 = 62;
pub const CH_SEMI: u8 = 59;
pub const CH_COLON: u8 = 58;
pub const CH_EQUAL: u8 = 61;
pub const CH_COMMA: u8 = 44;
pub const CH_DOT: u8 = 46;
pub const CH_QUESTION: u8 = 63;
pub const CH_HASH: u8 = 35;
pub const CH_AT: u8 = 64;
pub const CH_DOLLAR: u8 = 36;
pub const CH_UNDERSCORE: u8 = 95;
pub const CH_EXCL: u8 = 33;
pub const CH_PIPE: u8 = 124;
pub const CH_AMP: u8 = 38;
pub const CH_CARET: u8 = 94;
pub const CH_TILDE: u8 = 126;
pub const CH_PLUS: u8 = 43;
pub const CH_MINUS: u8 = 45;
pub const CH_PERCENT: u8 = 37;

pub const CH_BOM: u16 = 0xFEFF;

/// Check if a character is whitespace (space, tab, LF, CR)
pub inline fn isWhitespace(ch: u8) bool {
    return ch == CH_SPACE or ch == CH_TAB or ch == CH_LF or ch == CH_CR;
}

/// Check if a character can start an identifier (A-Z, a-z, _, $, or >127 for Unicode)
pub inline fn isIdentStart(ch: u8) bool {
    return (ch >= 'A' and ch <= 'Z') or (ch >= 'a' and ch <= 'z') or ch == CH_UNDERSCORE or ch == CH_DOLLAR or ch > 127;
}

/// Check if a character can continue an identifier (isIdentStart + 0-9)
pub inline fn isIdentChar(ch: u8) bool {
    return isIdentStart(ch) or (ch >= '0' and ch <= '9');
}

/// Check if a character is a digit (0-9)
pub inline fn isDigit(ch: u8) bool {
    return ch >= '0' and ch <= '9';
}

/// Find needle in haystack starting from start position
pub inline fn indexOf(haystack: []const u8, needle: []const u8, start: usize) ?usize {
    if (needle.len == 0) return start;
    if (start + needle.len > haystack.len) return null;
    return std.mem.indexOfPos(u8, haystack, start, needle);
}

/// Find a single byte in haystack starting from start position
pub inline fn indexOfChar(haystack: []const u8, needle: u8, start: usize) ?usize {
    if (start >= haystack.len) return null;
    return std.mem.indexOfScalarPos(u8, haystack, start, needle);
}

/// Slice source[start..end) with leading/trailing whitespace trimmed
pub fn sliceTrimmed(source: []const u8, start_pos: usize, end_pos: usize) []const u8 {
    var s = start_pos;
    var e = end_pos;
    if (s >= e) return "";

    // Fast path: if endpoints are already non-whitespace, skip trim loops
    if (!isWhitespace(source[s]) and !isWhitespace(source[e - 1])) {
        return source[s..e];
    }

    while (s < e and isWhitespace(source[s])) s += 1;
    while (e > s and isWhitespace(source[e - 1])) e -= 1;
    return source[s..e];
}

/// Check if a string starts with a given prefix
pub inline fn startsWith(str: []const u8, prefix: []const u8) bool {
    if (str.len < prefix.len) return false;
    return std.mem.eql(u8, str[0..prefix.len], prefix);
}

/// Check if a string ends with a given suffix
pub inline fn endsWith(str: []const u8, suffix: []const u8) bool {
    if (str.len < suffix.len) return false;
    return std.mem.eql(u8, str[str.len - suffix.len ..], suffix);
}

/// Check if a string contains a substring
pub inline fn contains(str: []const u8, needle: []const u8) bool {
    return std.mem.indexOf(u8, str, needle) != null;
}

const std = @import("std");

// --- Tests ---
test "isWhitespace" {
    try std.testing.expect(isWhitespace(' '));
    try std.testing.expect(isWhitespace('\t'));
    try std.testing.expect(isWhitespace('\n'));
    try std.testing.expect(isWhitespace('\r'));
    try std.testing.expect(!isWhitespace('a'));
    try std.testing.expect(!isWhitespace('/'));
}

test "isIdentStart" {
    try std.testing.expect(isIdentStart('a'));
    try std.testing.expect(isIdentStart('Z'));
    try std.testing.expect(isIdentStart('_'));
    try std.testing.expect(isIdentStart('$'));
    try std.testing.expect(isIdentStart(200)); // Unicode
    try std.testing.expect(!isIdentStart('0'));
    try std.testing.expect(!isIdentStart(' '));
}

test "isIdentChar" {
    try std.testing.expect(isIdentChar('a'));
    try std.testing.expect(isIdentChar('0'));
    try std.testing.expect(isIdentChar('_'));
    try std.testing.expect(!isIdentChar(' '));
    try std.testing.expect(!isIdentChar(';'));
}

test "sliceTrimmed" {
    const src = "  hello  ";
    try std.testing.expectEqualStrings("hello", sliceTrimmed(src, 0, src.len));
    try std.testing.expectEqualStrings("hello", sliceTrimmed(src, 2, 7));
}

test "indexOf" {
    const s = "hello world";
    try std.testing.expectEqual(@as(?usize, 6), indexOf(s, "world", 0));
    try std.testing.expectEqual(@as(?usize, null), indexOf(s, "xyz", 0));
    try std.testing.expectEqual(@as(?usize, null), indexOf(s, "world", 7));
}

test "startsWith and endsWith" {
    try std.testing.expect(startsWith("export const", "export"));
    try std.testing.expect(!startsWith("import", "export"));
    try std.testing.expect(endsWith("hello world", "world"));
    try std.testing.expect(!endsWith("hello", "world"));
}
