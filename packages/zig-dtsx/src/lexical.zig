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
fn closesControlHeader(source: []const u8, end: usize) bool {
    var parentheses: [256]bool = undefined;
    var paren_count: usize = 0;
    var template_expressions: [64]i64 = undefined;
    var template_count: usize = 0;
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
                if (template_count == template_expressions.len) return false;
                template_expressions[template_count] = brace_depth;
                template_count += 1;
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
            pos = @min(ch.lineCommentEnd(source, pos + 2) + 1, source.len);
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
        if (c == '(') {
            const control = !std.mem.eql(u8, before_previous, ".") and (std.mem.eql(u8, previous, "if") or
                std.mem.eql(u8, previous, "while") or std.mem.eql(u8, previous, "for") or
                std.mem.eql(u8, previous, "with") or std.mem.eql(u8, previous, "switch") or
                std.mem.eql(u8, previous, "catch") or
                (std.mem.eql(u8, previous, "await") and std.mem.eql(u8, before_previous, "for")));
            if (paren_count == parentheses.len) return false;
            parentheses[paren_count] = control;
            paren_count += 1;
            before_previous = previous;
            previous = "(";
            regex_allowed = true;
        } else if (c == ')') {
            var control = false;
            if (paren_count > 0) {
                paren_count -= 1;
                control = parentheses[paren_count];
            }
            if (pos == end) return control;
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
                if (template_count > 0 and template_expressions[template_count - 1] == brace_depth) {
                    template_count -= 1;
                    in_template = true;
                }
            }
            before_previous = previous;
            previous = source[pos .. pos + 1];
            regex_allowed = c == '/' or isRegexPrefixByte(c);
        }
        pos += 1;
    }
    return false;
}

pub fn isRegexStart(source: []const u8, position: usize) bool {
    const p = previousCodeIndex(source, @as(isize, @intCast(position)) - 1);
    if (p < 0) return true; // start of file
    const prev = source[@intCast(p)];
    if (prev == ')') return closesControlHeader(source, @intCast(p));
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
