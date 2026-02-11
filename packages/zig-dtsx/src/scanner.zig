/// Core TypeScript declaration scanner.
/// Single-pass character-by-character scanner that extracts declarations
/// and builds DTS text inline. Port of scanner.ts (~3200 lines).
const std = @import("std");
const ch = @import("char_utils.zig");
const types = @import("types.zig");
const Declaration = types.Declaration;
const DeclarationKind = types.DeclarationKind;
const Allocator = std.mem.Allocator;

/// Result of scanning: declarations + non-exported types
pub const ScanResult = struct {
    declarations: std.array_list.Managed(Declaration),
    non_exported_types: std.StringHashMap(Declaration),
};

/// The main scanner state
pub const Scanner = struct {
    source: []const u8,
    pos: usize,
    len: usize,
    allocator: Allocator,
    declarations: std.array_list.Managed(Declaration),
    non_exported_types: std.StringHashMap(Declaration),
    func_body_indices: std.AutoHashMap(usize, void),
    keep_comments: bool,
    isolated_declarations: bool,

    pub fn init(allocator: Allocator, source: []const u8, keep_comments: bool, isolated_declarations: bool) Scanner {
        // Pre-size declarations: typical TS file has ~1 declaration per 200 bytes
        var declarations = std.array_list.Managed(Declaration).init(allocator);
        declarations.ensureTotalCapacity(@max(source.len / 200, 8)) catch {};
        return .{
            .source = source,
            .pos = 0,
            .len = source.len,
            .allocator = allocator,
            .declarations = declarations,
            .non_exported_types = std.StringHashMap(Declaration).init(allocator),
            .func_body_indices = std.AutoHashMap(usize, void).init(allocator),
            .keep_comments = keep_comments,
            .isolated_declarations = isolated_declarations,
        };
    }

    pub fn deinit(self: *Scanner) void {
        self.declarations.deinit();
        self.non_exported_types.deinit();
        self.func_body_indices.deinit();
    }

    // ========================================================================
    // Primitive scanning helpers (port of scanner.ts lines 70-588)
    // ========================================================================

    /// Slice source[start..end) with leading/trailing whitespace trimmed
    pub fn sliceTrimmed(self: *const Scanner, start: usize, end: usize) []const u8 {
        return ch.sliceTrimmed(self.source, start, end);
    }

    /// Skip whitespace and comments (line and block)
    pub fn skipWhitespaceAndComments(self: *Scanner) void {
        if (self.pos >= self.len) return;
        const first = self.source[self.pos];
        if (first != ch.CH_SPACE and first != ch.CH_TAB and first != ch.CH_LF and first != ch.CH_CR and first != ch.CH_SLASH) return;

        while (self.pos < self.len) {
            // SIMD fast path: skip 16 whitespace bytes at a time
            // All whitespace chars (space=32, tab=9, LF=10, CR=13) are <= 32;
            // non-whitespace control chars (0-8, 14-31) are absent in TS source.
            while (self.pos + 16 <= self.len) {
                const chunk: @Vector(16, u8) = self.source[self.pos..][0..16].*;
                if (@reduce(.And, chunk <= @as(@Vector(16, u8), @splat(32)))) {
                    self.pos += 16;
                } else {
                    break;
                }
            }
            if (self.pos >= self.len) break;

            const c = self.source[self.pos];
            if (c == ch.CH_SPACE or c == ch.CH_TAB or c == ch.CH_LF or c == ch.CH_CR) {
                self.pos += 1;
                continue;
            }
            if (c == ch.CH_SLASH and self.pos + 1 < self.len) {
                const next = self.source[self.pos + 1];
                if (next == ch.CH_SLASH) {
                    // Line comment
                    const nl = ch.indexOfChar(self.source, ch.CH_LF, self.pos + 2);
                    self.pos = if (nl) |n| n + 1 else self.len;
                    continue;
                }
                if (next == ch.CH_STAR) {
                    // Block comment
                    const end_idx = ch.indexOf(self.source, "*/", self.pos + 2);
                    self.pos = if (end_idx) |e| e + 2 else self.len;
                    continue;
                }
            }
            break;
        }
    }

    /// Skip past a quoted string (single or double quote)
    pub fn skipString(self: *Scanner, quote: u8) void {
        self.pos += 1; // skip opening quote
        while (self.pos < self.len) {
            const idx = std.mem.indexOfScalarPos(u8, self.source, self.pos, quote) orelse {
                self.pos = self.len;
                return;
            };
            // Count consecutive backslashes before quote
            var bs: usize = 0;
            var p: usize = idx;
            while (p > 0 and self.source[p - 1] == ch.CH_BACKSLASH) {
                bs += 1;
                p -= 1;
            }
            if (bs % 2 == 0) {
                // Not escaped — found closing quote
                self.pos = idx + 1;
                return;
            }
            self.pos = idx + 1; // Escaped quote, keep searching
        }
    }

    /// Skip past a template literal (backtick string with ${} interpolation)
    pub fn skipTemplateLiteral(self: *Scanner) void {
        self.pos += 1; // skip opening backtick
        var depth: usize = 0;
        while (self.pos < self.len) {
            const c = self.source[self.pos];
            if (c == ch.CH_BACKSLASH) {
                self.pos += 1;
                if (self.pos < self.len) self.pos += 1;
                continue;
            }
            if (c == ch.CH_BACKTICK and depth == 0) {
                self.pos += 1;
                return;
            }
            if (c == ch.CH_DOLLAR and self.pos + 1 < self.len and self.source[self.pos + 1] == ch.CH_LBRACE) {
                self.pos += 2;
                depth += 1;
                continue;
            }
            if (c == ch.CH_RBRACE and depth > 0) {
                depth -= 1;
                self.pos += 1;
                continue;
            }
            self.pos += 1;
        }
    }

    /// Check if `/` at current pos starts a regex literal (not division)
    pub fn isRegexStart(self: *const Scanner) bool {
        var p: isize = @as(isize, @intCast(self.pos)) - 1;
        while (p >= 0 and ch.isWhitespace(self.source[@intCast(p)])) p -= 1;
        if (p < 0) return true; // start of file
        const prev = self.source[@intCast(p)];
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
            while (wp >= 0 and ch.isIdentChar(self.source[@intCast(wp)])) wp -= 1;
            const word_start: usize = @intCast(wp + 1);
            const word_end: usize = @intCast(p + 1);
            const word = self.source[word_start..word_end];
            const keywords = [_][]const u8{ "return", "typeof", "void", "delete", "throw", "new", "in", "of", "case", "instanceof", "yield", "await" };
            for (keywords) |kw| {
                if (std.mem.eql(u8, word, kw)) return true;
            }
        }
        return false;
    }

    /// Skip a regex literal /.../ including flags
    pub fn skipRegex(self: *Scanner) void {
        self.pos += 1; // skip opening /
        var in_char_class = false;
        while (self.pos < self.len) {
            const c = self.source[self.pos];
            if (c == ch.CH_BACKSLASH) {
                self.pos += 2;
                continue;
            }
            if (in_char_class) {
                if (c == ch.CH_RBRACKET) in_char_class = false;
                self.pos += 1;
                continue;
            }
            if (c == ch.CH_LBRACKET) {
                in_char_class = true;
                self.pos += 1;
                continue;
            }
            if (c == ch.CH_SLASH) {
                self.pos += 1;
                break;
            }
            if (c == ch.CH_LF or c == ch.CH_CR) break;
            self.pos += 1;
        }
        // Skip flags
        while (self.pos < self.len and ch.isIdentChar(self.source[self.pos])) self.pos += 1;
    }

    /// Skip past a string/comment/template literal if at one. Returns true if skipped.
    pub fn skipNonCode(self: *Scanner) bool {
        if (self.pos >= self.len) return false;
        const c = self.source[self.pos];
        if (c == ch.CH_SQUOTE or c == ch.CH_DQUOTE) {
            self.skipString(c);
            return true;
        }
        if (c == ch.CH_BACKTICK) {
            self.skipTemplateLiteral();
            return true;
        }
        if (c == ch.CH_SLASH and self.pos + 1 < self.len) {
            const next = self.source[self.pos + 1];
            if (next == ch.CH_SLASH) {
                const nl = ch.indexOfChar(self.source, ch.CH_LF, self.pos + 2);
                self.pos = if (nl) |n| n + 1 else self.len;
                return true;
            }
            if (next == ch.CH_STAR) {
                const end_idx = ch.indexOf(self.source, "*/", self.pos + 2);
                self.pos = if (end_idx) |e| e + 2 else self.len;
                return true;
            }
            if (self.isRegexStart()) {
                self.skipRegex();
                return true;
            }
        }
        return false;
    }

    /// Read an identifier at current position
    pub fn readIdent(self: *Scanner) []const u8 {
        const start = self.pos;
        while (self.pos < self.len and ch.isIdentChar(self.source[self.pos])) self.pos += 1;
        return self.source[start..self.pos];
    }

    /// Check if source matches a word at pos (followed by non-ident char)
    pub fn matchWord(self: *const Scanner, word: []const u8) bool {
        if (self.pos + word.len > self.len) return false;
        if (!std.mem.eql(u8, self.source[self.pos .. self.pos + word.len], word)) return false;
        if (self.pos + word.len < self.len and ch.isIdentChar(self.source[self.pos + word.len])) return false;
        return true;
    }

    /// Check if current position is at a top-level statement-starting keyword
    pub fn isTopLevelKeyword(self: *const Scanner) bool {
        if (self.pos >= self.len) return false;
        const c = self.source[self.pos];
        return switch (c) {
            'e' => self.matchWord("export") or self.matchWord("enum"),
            'i' => self.matchWord("import") or self.matchWord("interface"),
            'f' => self.matchWord("function"),
            'c' => self.matchWord("class") or self.matchWord("const"),
            't' => self.matchWord("type"),
            'l' => self.matchWord("let"),
            'v' => self.matchWord("var"),
            'd' => self.matchWord("declare") or self.matchWord("default"),
            'm' => self.matchWord("module"),
            'n' => self.matchWord("namespace"),
            'a' => self.matchWord("abstract") or self.matchWord("async"),
            else => false,
        };
    }

    /// Check for ASI boundary at top level
    pub fn checkASITopLevel(self: *Scanner) bool {
        if (self.pos >= self.len) return false;
        const c = self.source[self.pos];
        if (c != ch.CH_LF and c != ch.CH_CR) return false;
        const saved = self.pos;
        self.pos += 1;
        if (c == ch.CH_CR and self.pos < self.len and self.source[self.pos] == ch.CH_LF) self.pos += 1;
        while (self.pos < self.len) {
            const sc = self.source[self.pos];
            if (sc == ch.CH_SPACE or sc == ch.CH_TAB or sc == ch.CH_CR or sc == ch.CH_LF) {
                self.pos += 1;
                continue;
            }
            if (sc == ch.CH_SLASH and self.pos + 1 < self.len) {
                const next = self.source[self.pos + 1];
                if (next == ch.CH_SLASH) {
                    const nl = ch.indexOfChar(self.source, ch.CH_LF, self.pos + 2);
                    self.pos = if (nl) |n| n + 1 else self.len;
                    continue;
                }
                if (next == ch.CH_STAR) {
                    const end_idx = ch.indexOf(self.source, "*/", self.pos + 2);
                    self.pos = if (end_idx) |e| e + 2 else self.len;
                    continue;
                }
            }
            break;
        }
        const result = self.pos >= self.len or self.isTopLevelKeyword() or self.source[self.pos] == ch.CH_RBRACE;
        self.pos = saved;
        return result;
    }

    /// Check for ASI boundary in class member context
    pub fn checkASIMember(self: *Scanner) bool {
        if (self.pos >= self.len) return false;
        const c = self.source[self.pos];
        if (c != ch.CH_LF and c != ch.CH_CR) return false;
        const saved = self.pos;
        self.pos += 1;
        if (c == ch.CH_CR and self.pos < self.len and self.source[self.pos] == ch.CH_LF) self.pos += 1;
        while (self.pos < self.len) {
            const sc = self.source[self.pos];
            if (sc == ch.CH_SPACE or sc == ch.CH_TAB or sc == ch.CH_CR or sc == ch.CH_LF) {
                self.pos += 1;
                continue;
            }
            if (sc == ch.CH_SLASH and self.pos + 1 < self.len and self.source[self.pos + 1] == ch.CH_SLASH) {
                const nl = ch.indexOfChar(self.source, ch.CH_LF, self.pos + 2);
                self.pos = if (nl) |n| n + 1 else self.len;
                continue;
            }
            break;
        }
        if (self.pos >= self.len) {
            self.pos = saved;
            return true;
        }
        const nc = self.source[self.pos];
        // Type continuation operators — NOT end of member
        if (nc == ch.CH_PIPE or nc == ch.CH_AMP or nc == ch.CH_DOT or nc == ch.CH_QUESTION) {
            self.pos = saved;
            return false;
        }
        // Type continuation keywords
        if (self.matchWord("extends") or self.matchWord("keyof") or self.matchWord("typeof") or
            self.matchWord("infer") or self.matchWord("is") or self.matchWord("as") or self.matchWord("in"))
        {
            self.pos = saved;
            return false;
        }
        self.pos = saved;
        return true;
    }

    /// Check if > at current pos is part of => (arrow function)
    pub fn isArrowGT(self: *const Scanner) bool {
        return self.pos > 0 and self.source[self.pos - 1] == ch.CH_EQUAL;
    }

    /// Find matching closing bracket, respecting nesting and strings/comments.
    /// Uses SIMD to skip 16 "boring" bytes (alphanumeric/spaces) at a time.
    pub fn findMatchingClose(self: *Scanner, open: u8, close: u8) usize {
        var depth: usize = 1;
        self.pos += 1; // skip opening

        while (self.pos < self.len) {
            // SIMD fast-skip: skip 16 bytes at a time when none are structural chars.
            // Structural chars: open/close brackets, quotes, slash, backtick.
            // Most bytes in TS source are alphanumeric/spaces — skip them in bulk.
            while (self.pos + 16 <= self.len) {
                const chunk: @Vector(16, u8) = self.source[self.pos..][0..16].*;
                const is_open = chunk == @as(@Vector(16, u8), @splat(open));
                const is_close = chunk == @as(@Vector(16, u8), @splat(close));
                const is_squote = chunk == @as(@Vector(16, u8), @splat(ch.CH_SQUOTE));
                const is_dquote = chunk == @as(@Vector(16, u8), @splat(ch.CH_DQUOTE));
                const is_btick = chunk == @as(@Vector(16, u8), @splat(ch.CH_BACKTICK));
                const is_slash = chunk == @as(@Vector(16, u8), @splat(ch.CH_SLASH));
                const interesting = is_open | is_close | is_squote | is_dquote | is_btick | is_slash;
                if (!@reduce(.Or, interesting)) {
                    self.pos += 16;
                } else {
                    break;
                }
            }
            if (self.pos >= self.len) break;

            const c = self.source[self.pos];

            // Handle string/comment/template delimiters
            if (c == ch.CH_SQUOTE or c == ch.CH_DQUOTE) {
                self.skipString(c);
                continue;
            }
            if (c == ch.CH_BACKTICK) {
                self.skipTemplateLiteral();
                continue;
            }
            if (c == ch.CH_SLASH and self.pos + 1 < self.len) {
                // Inline slash handling — avoid skipNonCode overhead
                const next = self.source[self.pos + 1];
                if (next == ch.CH_SLASH) {
                    const nl = ch.indexOfChar(self.source, ch.CH_LF, self.pos + 2);
                    self.pos = if (nl) |n| n + 1 else self.len;
                    continue;
                }
                if (next == ch.CH_STAR) {
                    const end_idx = ch.indexOf(self.source, "*/", self.pos + 2);
                    self.pos = if (end_idx) |e| e + 2 else self.len;
                    continue;
                }
                if (self.isRegexStart()) {
                    self.skipRegex();
                    continue;
                }
            }

            if (c == open) {
                depth += 1;
            } else if (c == close) {
                // Don't match > that's part of =>
                if (close == ch.CH_RANGLE and self.pos > 0 and self.source[self.pos - 1] == ch.CH_EQUAL) {
                    self.pos += 1;
                    continue;
                }
                depth -= 1;
                if (depth == 0) {
                    self.pos += 1;
                    return self.pos;
                }
            }
            self.pos += 1;
        }
        return self.pos;
    }

    /// Skip to statement end (semicolon at depth 0, matching brace, or ASI).
    /// Uses SIMD to skip 16 non-structural bytes at a time.
    pub fn skipToStatementEnd(self: *Scanner) void {
        var brace_depth: isize = 0;
        while (self.pos < self.len) {
            // SIMD fast-skip: bulk-skip bytes that can't be structural.
            // Look for: { } ; ' " ` / \n \r
            if (brace_depth > 0) {
                while (self.pos + 16 <= self.len) {
                    const chunk: @Vector(16, u8) = self.source[self.pos..][0..16].*;
                    const interesting = (chunk == @as(@Vector(16, u8), @splat(ch.CH_LBRACE))) |
                        (chunk == @as(@Vector(16, u8), @splat(ch.CH_RBRACE))) |
                        (chunk == @as(@Vector(16, u8), @splat(ch.CH_SQUOTE))) |
                        (chunk == @as(@Vector(16, u8), @splat(ch.CH_DQUOTE))) |
                        (chunk == @as(@Vector(16, u8), @splat(ch.CH_BACKTICK))) |
                        (chunk == @as(@Vector(16, u8), @splat(ch.CH_SLASH)));
                    if (!@reduce(.Or, interesting)) {
                        self.pos += 16;
                    } else {
                        break;
                    }
                }
                if (self.pos >= self.len) break;
            }

            const c = self.source[self.pos];

            if (c == ch.CH_SQUOTE or c == ch.CH_DQUOTE) {
                self.skipString(c);
                continue;
            }
            if (c == ch.CH_BACKTICK) {
                self.skipTemplateLiteral();
                continue;
            }
            if (c == ch.CH_SLASH) {
                if (self.skipNonCode()) continue;
                self.pos += 1;
                continue;
            }
            if (c == ch.CH_LBRACE) {
                brace_depth += 1;
                self.pos += 1;
                continue;
            }
            if (c == ch.CH_RBRACE) {
                brace_depth -= 1;
                if (brace_depth <= 0) {
                    self.pos += 1;
                    return;
                }
                self.pos += 1;
                continue;
            }
            if (c == ch.CH_SEMI and brace_depth == 0) {
                self.pos += 1;
                return;
            }
            if ((c == ch.CH_LF or c == ch.CH_CR) and brace_depth == 0) {
                if (self.checkASITopLevel()) return;
            }
            self.pos += 1;
        }
    }

    /// Skip export braces: { ... } [from '...'] [;]
    pub fn skipExportBraces(self: *Scanner) void {
        _ = self.findMatchingClose(ch.CH_LBRACE, ch.CH_RBRACE);
        while (self.pos < self.len and ch.isWhitespace(self.source[self.pos])) self.pos += 1;
        if (self.matchWord("from")) {
            self.pos += 4;
            while (self.pos < self.len and ch.isWhitespace(self.source[self.pos])) self.pos += 1;
            if (self.pos < self.len) {
                const qc = self.source[self.pos];
                if (qc == ch.CH_SQUOTE or qc == ch.CH_DQUOTE) self.skipString(qc);
            }
        }
        while (self.pos < self.len and (self.source[self.pos] == ch.CH_SPACE or self.source[self.pos] == ch.CH_TAB)) self.pos += 1;
        if (self.pos < self.len and self.source[self.pos] == ch.CH_SEMI) self.pos += 1;
    }

    /// Skip export star: * [as name] from '...' [;]
    pub fn skipExportStar(self: *Scanner) void {
        self.pos += 1; // skip *
        while (self.pos < self.len and ch.isWhitespace(self.source[self.pos])) self.pos += 1;
        if (self.matchWord("as")) {
            self.pos += 2;
            while (self.pos < self.len and ch.isWhitespace(self.source[self.pos])) self.pos += 1;
            _ = self.readIdent();
            while (self.pos < self.len and ch.isWhitespace(self.source[self.pos])) self.pos += 1;
        }
        if (self.matchWord("from")) {
            self.pos += 4;
            while (self.pos < self.len and ch.isWhitespace(self.source[self.pos])) self.pos += 1;
            if (self.pos < self.len) {
                const qc = self.source[self.pos];
                if (qc == ch.CH_SQUOTE or qc == ch.CH_DQUOTE) self.skipString(qc);
            }
        }
        while (self.pos < self.len and (self.source[self.pos] == ch.CH_SPACE or self.source[self.pos] == ch.CH_TAB)) self.pos += 1;
        if (self.pos < self.len and self.source[self.pos] == ch.CH_SEMI) self.pos += 1;
    }

    /// Peek at what char comes after a word (skipping whitespace)
    pub fn peekAfterWord(self: *const Scanner, word: []const u8) u8 {
        var p = self.pos + word.len;
        while (p < self.len and ch.isWhitespace(self.source[p])) p += 1;
        return if (p < self.len) self.source[p] else 0;
    }

    /// Peek ahead to check if word2 follows word1
    pub fn peekAfterKeyword(self: *const Scanner, word1: []const u8, word2: []const u8) bool {
        var p = self.pos + word1.len;
        while (p < self.len and ch.isWhitespace(self.source[p])) p += 1;
        if (p + word2.len > self.len) return false;
        if (!std.mem.eql(u8, self.source[p .. p + word2.len], word2)) return false;
        return p + word2.len >= self.len or !ch.isIdentChar(self.source[p + word2.len]);
    }

    /// Extract a brace-enclosed block as text from current position
    pub fn extractBraceBlock(self: *Scanner) []const u8 {
        const block_start = self.pos;
        _ = self.findMatchingClose(ch.CH_LBRACE, ch.CH_RBRACE);
        return self.source[block_start..self.pos];
    }

    /// Read a member name (identifier, computed property [expr], or #private)
    pub fn readMemberName(self: *Scanner) []const u8 {
        if (self.pos >= self.len) return "";
        const c = self.source[self.pos];
        if (c == ch.CH_LBRACKET) {
            const start = self.pos;
            _ = self.findMatchingClose(ch.CH_LBRACKET, ch.CH_RBRACKET);
            return self.source[start..self.pos];
        }
        if (c == ch.CH_HASH) {
            self.pos += 1;
            const ident = self.readIdent();
            // Return "#name" — we need to allocate this
            const result = self.allocator.alloc(u8, 1 + ident.len) catch return "";
            result[0] = '#';
            @memcpy(result[1..], ident);
            return result;
        }
        return self.readIdent();
    }

    /// Skip a class member (to next member boundary)
    pub fn skipClassMember(self: *Scanner) void {
        var depth: isize = 0;
        while (self.pos < self.len) {
            if (self.skipNonCode()) continue;
            const c = self.source[self.pos];
            if (c == ch.CH_LBRACE or c == ch.CH_LPAREN) {
                depth += 1;
            } else if (c == ch.CH_RBRACE or c == ch.CH_RPAREN) {
                if (depth == 0) return;
                depth -= 1;
            } else if (c == ch.CH_SEMI and depth == 0) {
                self.pos += 1;
                return;
            }
            if (depth == 0 and self.checkASIMember()) return;
            self.pos += 1;
        }
    }

    // ========================================================================
    // Public scan entry point
    // ========================================================================

    /// Scan TypeScript source and extract all declarations
    pub fn scan(self: *Scanner) !ScanResult {
        // Skip BOM
        if (self.pos < self.len and self.source[0] >= 0xEF) {
            // UTF-8 BOM is EF BB BF
            if (self.len >= 3 and self.source[0] == 0xEF and self.source[1] == 0xBB and self.source[2] == 0xBF) {
                self.pos = 3;
            }
        }

        // Main scan loop — delegate to scan_loop module
        try @import("scan_loop.zig").scanMainLoop(self);

        // Post-process: resolve referenced non-exported types
        if (self.non_exported_types.count() > 0) {
            resolveReferencedTypes(&self.declarations, &self.non_exported_types);
        }

        // Post-process: remove implementation signatures of overloaded functions
        if (self.func_body_indices.count() > 0) {
            removeOverloadImplementations(self);
        }

        return .{
            .declarations = self.declarations,
            .non_exported_types = self.non_exported_types,
        };
    }
};

// ========================================================================
// Post-processing helpers (outside Scanner for clarity)
// ========================================================================

/// Check if name appears as a whole word in text (fast indexOf + boundary check)
pub fn isWordInText(name: []const u8, text: []const u8) bool {
    var search_from: usize = 0;
    while (search_from < text.len) {
        const idx = ch.indexOf(text, name, search_from) orelse return false;
        const before: u8 = if (idx > 0) text[idx - 1] else ' ';
        const after: u8 = if (idx + name.len < text.len) text[idx + name.len] else ' ';
        const before_ok = !ch.isIdentChar(before);
        const after_ok = !ch.isIdentChar(after);
        if (before_ok and after_ok) return true;
        search_from = idx + 1;
    }
    return false;
}

/// Extract all identifier words from text into a HashSet (single pass, O(n))
fn extractWordsFromText(alloc: std.mem.Allocator, text: []const u8) std.StringHashMap(void) {
    var words = std.StringHashMap(void).init(alloc);
    var i: usize = 0;
    while (i < text.len) {
        const c = text[i];
        if (ch.isIdentStart(c)) {
            const start = i;
            i += 1;
            while (i < text.len and ch.isIdentChar(text[i])) i += 1;
            words.put(text[start..i], {}) catch {};
        } else {
            i += 1;
        }
    }
    return words;
}

/// Resolve non-exported types that are referenced by exported declarations
fn resolveReferencedTypes(declarations: *std.array_list.Managed(Declaration), non_exported_types: *std.StringHashMap(Declaration)) void {
    var resolved = std.StringHashMap(void).init(declarations.allocator);
    defer resolved.deinit();
    var decl_names = std.StringHashMap(void).init(declarations.allocator);
    defer decl_names.deinit();

    for (declarations.items) |d| {
        decl_names.put(d.name, {}) catch {};
    }

    // Collect text parts for searching
    var text_parts = std.array_list.Managed([]const u8).init(declarations.allocator);
    defer text_parts.deinit();
    for (declarations.items) |d| {
        if (d.kind != .import_decl) {
            text_parts.append(d.text) catch {};
        }
    }

    var word_set = std.StringHashMap(void).init(declarations.allocator);
    defer word_set.deinit();

    while (true) {
        // Build word set from all text parts (single pass per part)
        word_set.clearRetainingCapacity();
        for (text_parts.items) |part| {
            var i: usize = 0;
            while (i < part.len) {
                if (ch.isIdentStart(part[i])) {
                    const start = i;
                    i += 1;
                    while (i < part.len and ch.isIdentChar(part[i])) i += 1;
                    word_set.put(part[start..i], {}) catch {};
                } else {
                    i += 1;
                }
            }
        }

        var to_insert = std.array_list.Managed(Declaration).init(declarations.allocator);
        defer to_insert.deinit();

        var it = non_exported_types.iterator();
        while (it.next()) |entry| {
            const name = entry.key_ptr.*;
            if (resolved.contains(name)) continue;

            // O(1) lookup instead of O(n*m) text scanning
            if (word_set.contains(name)) {
                if (!decl_names.contains(name)) {
                    to_insert.append(entry.value_ptr.*) catch {};
                    decl_names.put(name, {}) catch {};
                }
                resolved.put(name, {}) catch {};
            }
        }

        if (to_insert.items.len == 0) break;

        // Sort by start position
        std.mem.sort(Declaration, to_insert.items, {}, struct {
            fn cmp(_: void, a: Declaration, b: Declaration) bool {
                return a.start < b.start;
            }
        }.cmp);

        // Merge at correct source positions
        var merged = std.array_list.Managed(Declaration).init(declarations.allocator);
        var ti: usize = 0;
        for (declarations.items) |d| {
            while (ti < to_insert.items.len and to_insert.items[ti].start <= d.start) {
                merged.append(to_insert.items[ti]) catch {};
                ti += 1;
            }
            merged.append(d) catch {};
        }
        while (ti < to_insert.items.len) {
            merged.append(to_insert.items[ti]) catch {};
            ti += 1;
        }

        declarations.clearRetainingCapacity();
        declarations.appendSlice(merged.items) catch {};
        merged.deinit();

        // Add new texts to search
        for (to_insert.items) |d| {
            if (d.kind != .import_decl) {
                text_parts.append(d.text) catch {};
            }
        }
    }
}

/// Remove implementation signatures of overloaded functions
fn removeOverloadImplementations(scanner: *Scanner) void {
    // Count function names
    var func_name_counts = std.StringHashMap(usize).init(scanner.allocator);
    defer func_name_counts.deinit();

    for (scanner.declarations.items) |d| {
        if (d.kind == .function_decl) {
            const entry = func_name_counts.getOrPut(d.name) catch continue;
            if (!entry.found_existing) {
                entry.value_ptr.* = 1;
            } else {
                entry.value_ptr.* += 1;
            }
        }
    }

    // Find overloaded names (count > 1)
    var overloaded = std.StringHashMap(void).init(scanner.allocator);
    defer overloaded.deinit();
    var it = func_name_counts.iterator();
    while (it.next()) |entry| {
        if (entry.value_ptr.* > 1) {
            overloaded.put(entry.key_ptr.*, {}) catch {};
        }
    }

    if (overloaded.count() == 0) return;

    // Find last body-bearing index for each overloaded name and remove them
    var to_remove = std.AutoHashMap(usize, void).init(scanner.allocator);
    defer to_remove.deinit();

    var oit = overloaded.iterator();
    while (oit.next()) |entry| {
        const name = entry.key_ptr.*;
        // Walk backwards
        var i: usize = scanner.declarations.items.len;
        while (i > 0) {
            i -= 1;
            const d = scanner.declarations.items[i];
            if (d.kind == .function_decl and std.mem.eql(u8, d.name, name) and scanner.func_body_indices.contains(i)) {
                to_remove.put(i, {}) catch {};
                break;
            }
        }
    }

    if (to_remove.count() == 0) return;

    // Filter in single pass — O(n) instead of O(k*n)
    var write: usize = 0;
    for (scanner.declarations.items, 0..) |d, i| {
        if (!to_remove.contains(i)) {
            scanner.declarations.items[write] = d;
            write += 1;
        }
    }
    scanner.declarations.shrinkRetainingCapacity(write);
}

// Tests
test "isWordInText" {
    try std.testing.expect(isWordInText("Foo", "extends Foo {"));
    try std.testing.expect(!isWordInText("Foo", "extends FooBar {"));
    try std.testing.expect(isWordInText("Bar", "type: Bar;"));
    try std.testing.expect(!isWordInText("Bar", "type: BarBaz;"));
}

test "scanner skipString" {
    var s = Scanner.init(std.testing.allocator, "'hello world' rest", true, false);
    defer s.deinit();
    s.skipString(ch.CH_SQUOTE);
    try std.testing.expectEqual(@as(usize, 13), s.pos);
}

test "scanner matchWord" {
    var s = Scanner.init(std.testing.allocator, "export const x", true, false);
    defer s.deinit();
    try std.testing.expect(s.matchWord("export"));
    try std.testing.expect(!s.matchWord("expo"));
}

test "scanner skipWhitespaceAndComments" {
    var s = Scanner.init(std.testing.allocator, "  // comment\n  hello", true, false);
    defer s.deinit();
    s.skipWhitespaceAndComments();
    try std.testing.expectEqualStrings("hello", s.source[s.pos .. s.pos + 5]);
}
