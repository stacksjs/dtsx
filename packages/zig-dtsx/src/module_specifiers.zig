//! Resolved module context for native declaration emission. Resolution and
//! package delivery belong to the project planner, not this source-only pass.
const std = @import("std");
const ch = @import("char_utils.zig");
const lexical = @import("lexical.zig");

pub const Rewrite = struct {
    specifier: []const u8,
    resolvedSource: []const u8,
    declarationOutput: []const u8,
    emittedSpecifier: []const u8,
};

pub const InferenceSource = struct { specifier: []const u8, source: []const u8 };

pub const WireContext = struct {
    version: u32,
    moduleSpecifierMode: []const u8,
    sourceFile: []const u8,
    outputFile: []const u8,
    sourceHash: []const u8,
    rewrites: []const Rewrite,
    augmentationImports: []const []const u8 = &.{},
    inferenceSources: []const InferenceSource = &.{},
};

pub const Context = struct {
    wire: WireContext,
    parsed: ?std.json.Parsed(WireContext) = null,
    /// Set only by the checked batch owner after validating the full request.
    delivered_sources: ?*const std.StringHashMap([]const u8) = null,

    pub fn deinit(self: Context) void {
        if (self.parsed) |parsed| parsed.deinit();
    }

    pub fn requiresImport(self: *const Context, specifier: []const u8) bool {
        for (self.wire.augmentationImports) |required| {
            if (std.mem.eql(u8, required, specifier)) return true;
        }
        return false;
    }

    fn lookup(self: *const Context, specifier: []const u8) ![]const u8 {
        for (self.wire.rewrites) |entry| {
            if (std.mem.eql(u8, entry.specifier, specifier)) {
                if (self.delivered_sources) |delivered| {
                    const output = delivered.get(entry.resolvedSource) orelse return error.UndeliveredModuleSpecifier;
                    if (!std.mem.eql(u8, output, entry.declarationOutput)) return error.InvalidContext;
                }
                return entry.emittedSpecifier;
            }
        }
        if (self.delivered_sources == null and std.mem.eql(u8, self.wire.moduleSpecifierMode, "preserve")) return specifier;
        if (std.mem.startsWith(u8, specifier, "./") or std.mem.startsWith(u8, specifier, "../") or
            std.mem.eql(u8, specifier, ".") or std.mem.eql(u8, specifier, "..") or
            std.mem.startsWith(u8, specifier, "/") or std.mem.startsWith(u8, specifier, "\\") or
            (specifier.len >= 3 and std.ascii.isAlphabetic(specifier[0]) and specifier[1] == ':' and (specifier[2] == '/' or specifier[2] == '\\')))
        {
            return error.UnresolvedModuleSpecifier;
        }
        return specifier;
    }
};

fn validString(value: []const u8) bool {
    return value.len > 0 and std.mem.indexOfScalar(u8, value, 0) == null;
}

pub fn parse(allocator: std.mem.Allocator, json: []const u8, source: []const u8) !Context {
    const parsed = std.json.parseFromSlice(WireContext, allocator, json, .{ .allocate = .alloc_always }) catch |err| switch (err) {
        error.OutOfMemory => return err,
        else => return error.InvalidContext,
    };
    errdefer parsed.deinit();
    const context = try fromWire(parsed.value, source);
    return .{ .wire = context.wire, .parsed = parsed };
}

/// Borrow already decoded batch metadata. The request owns every string until
/// emission finishes; deinit never frees that request's arena.
pub fn fromWire(wire: WireContext, source: []const u8) !Context {
    if (wire.version != 1) return error.UnsupportedContextVersion;
    if ((!std.mem.eql(u8, wire.moduleSpecifierMode, "preserve") and !std.mem.eql(u8, wire.moduleSpecifierMode, "node")) or
        !validString(wire.sourceFile) or !validString(wire.outputFile) or wire.sourceHash.len != 64)
        return error.InvalidContext;
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(source, &digest, .{});
    const hex = "0123456789abcdef";
    for (digest, 0..) |byte, index| {
        if (wire.sourceHash[index * 2] != hex[byte >> 4] or wire.sourceHash[index * 2 + 1] != hex[byte & 15])
            return error.InvalidContext;
    }
    for (wire.rewrites, 0..) |entry, index| {
        if (!validString(entry.specifier) or !validString(entry.resolvedSource) or
            !validString(entry.declarationOutput) or !validString(entry.emittedSpecifier)) return error.InvalidContext;
        for (wire.rewrites[0..index]) |previous| {
            if (std.mem.eql(u8, previous.specifier, entry.specifier) and
                (!std.mem.eql(u8, previous.resolvedSource, entry.resolvedSource) or
                    !std.mem.eql(u8, previous.declarationOutput, entry.declarationOutput) or
                    !std.mem.eql(u8, previous.emittedSpecifier, entry.emittedSpecifier))) return error.InvalidContext;
        }
    }
    for (wire.augmentationImports) |specifier| {
        if (!validString(specifier)) return error.InvalidContext;
    }
    return .{ .wire = wire };
}

/// Byte offsets are 32-bit (sources over 4 GiB are rejected by tokens()),
/// which halves token arrays and the memory traffic of whole-source lexing.
inline fn tok(start: usize, end: usize, kind: @FieldType(Token, "kind")) Token {
    return .{ .start = @intCast(start), .end = @intCast(end), .kind = kind };
}

const Token = struct {
    start: u32,
    end: u32,
    kind: enum(u8) { word, quoted, punctuation, template },
};

pub const SyntaxToken = Token;
pub const SyntaxError = std.mem.Allocator.Error || error{InvalidContext};
/// Visitors may stop a token walk early by returning error.StopVisit.
pub const VisitError = SyntaxError || error{StopVisit};
pub const tokenizeDeclarationSyntax = tokens;

fn tokens(allocator: std.mem.Allocator, content: []const u8) SyntaxError![]Token {
    if (content.len > std.math.maxInt(u32)) return error.InvalidContext;
    var result = std.array_list.Managed(Token).init(allocator);
    errdefer result.deinit();
    // Declaration syntax averages well under one token per three bytes; sizing
    // up front avoids repeated regrowth while tokenizing whole sources.
    try result.ensureTotalCapacity(content.len / 3 + 8);
    var i: usize = 0;
    var jsx_reader = lexical.JsxReader{ .source = content, .allocator = allocator };
    defer jsx_reader.deinit();
    scanCode(ListSink{ .list = &result }, content, &i, false, &jsx_reader) catch |err| switch (err) {
        error.StopVisit => unreachable, // ListSink never stops early
        else => |e| return e,
    };
    return result.toOwnedSlice();
}

const ListSink = struct {
    list: *std.array_list.Managed(Token),
    inline fn push(self: ListSink, token: Token) VisitError!void {
        // Pre-sized in tokens(); keep the common case free of a call.
        if (self.list.items.len < self.list.capacity) {
            self.list.appendAssumeCapacity(token);
        } else {
            try self.list.append(token);
        }
    }
};

/// Stream every token to `sink` without materializing a token array. The sink
/// sees exactly the sequence `tokens` would return, and the same lexical
/// errors are reported, so whole-source checks avoid allocating a token array.
pub fn visitDeclarationSyntax(allocator: std.mem.Allocator, content: []const u8, sink: anytype) VisitError!void {
    if (content.len > std.math.maxInt(u32)) return error.InvalidContext;
    var i: usize = 0;
    var jsx_reader = lexical.JsxReader{ .source = content, .allocator = allocator };
    defer jsx_reader.deinit();
    try scanCode(sink, content, &i, false, &jsx_reader);
}

// Template raw text is literal data. Only ${...} switches back to TypeScript
// syntax, including nested templates and object/type braces in a substitution.
fn scanTemplate(sink: anytype, content: []const u8, position: *usize, jsx_reader: *lexical.JsxReader) VisitError!void {
    var raw_start = position.*;
    position.* += 1;
    while (position.* < content.len) {
        const i = position.*;
        if (content[i] == '\\') {
            if (i + 1 >= content.len) return error.InvalidContext;
            position.* += 2;
        } else if (content[i] == '`') {
            position.* += 1;
            try sink.push(tok(raw_start, position.*, .template));
            return;
        } else if (content[i] == '$' and i + 1 < content.len and content[i + 1] == '{') {
            try sink.push(tok(raw_start, i + 1, .template));
            try sink.push(tok(i + 1, i + 2, .punctuation));
            position.* += 2;
            try scanCode(sink, content, position, true, jsx_reader);
            raw_start = position.*;
        } else position.* += 1;
    }
    return error.InvalidContext;
}

/// Identifier byte classes, identical to ch.isIdentStart / ch.isIdentChar.
pub const ident_start_table: [256]bool = blk: {
    var table: [256]bool = @splat(false);
    for (0..256) |c| table[c] = ch.isIdentStart(@intCast(c));
    break :blk table;
};
pub const ident_char_table: [256]bool = blk: {
    var table: [256]bool = @splat(false);
    for (0..256) |c| table[c] = ch.isIdentChar(@intCast(c));
    break :blk table;
};

/// Index of the `*/` closing a block comment whose body starts at `from`.
/// A vectorized scan for `*` followed by a byte check beats a generic
/// substring search for this two-byte needle.
fn blockCommentEnd(content: []const u8, from: usize) ?usize {
    var p = from;
    while (std.mem.indexOfScalarPos(u8, content, p, '*')) |star| {
        if (star + 1 < content.len and content[star + 1] == '/') return star;
        p = star + 1;
    }
    return null;
}

fn scanCode(sink: anytype, content: []const u8, position: *usize, substitution: bool, jsx_reader: *lexical.JsxReader) VisitError!void {
    var braces: usize = 0;
    var jsx_depth: usize = 0;
    // End of the last real token. Regex detection looks back from here, so a
    // comment between a token and `/` is not mistaken for preceding code.
    var code_end = position.*;
    while (position.* < content.len) {
        const i = position.*;
        const c = content[i];
        if (c == '<' and (jsx_depth > 0 or ((i + 1 >= content.len or content[i + 1] != '/') and lexical.canStartJsxAfterToken(content, code_end)))) {
            if (try jsx_reader.read(i)) |tag| {
                jsx_depth = @intCast(@max(0, @as(isize, @intCast(jsx_depth)) + tag.delta));
                if (tag.delta < 0) {
                    position.* = tag.end + 1;
                    try sink.push(tok(i, position.*, .template));
                    code_end = position.*;
                    continue;
                }
            }
        }
        switch (c) {
            ' ', '\t', '\n', '\r' => {
                position.* += 1;
                continue;
            },
            '/' => {
                if (i + 1 < content.len and content[i + 1] == '/') {
                    position.* = ch.lineCommentEnd(content, i + 2);
                    continue;
                }
                if (i + 1 < content.len and content[i + 1] == '*') {
                    position.* = (blockCommentEnd(content, i + 2) orelse return error.InvalidContext) + 2;
                    continue;
                }
                if (!jsx_reader.isTagSlash(i) and lexical.isRegexStartAfterToken(content, code_end)) {
                    position.* = lexical.skipRegex(content, i);
                    try sink.push(tok(i, position.*, .template));
                    code_end = position.*;
                    continue;
                }
            },
            '`' => {
                try scanTemplate(sink, content, position, jsx_reader);
                code_end = position.*;
                continue;
            },
            '\'', '"' => {
                var p = i + 1;
                while (true) {
                    // Jump straight to the next quote or escape.
                    p = std.mem.indexOfAnyPos(u8, content, p, &.{ c, '\\' }) orelse return error.InvalidContext;
                    if (content[p] == c) break;
                    if (p + 1 >= content.len) return error.InvalidContext;
                    p += 2;
                }
                position.* = p + 1;
                try sink.push(tok(i, position.*, .quoted));
                code_end = position.*;
                continue;
            },
            else => if (ident_start_table[c]) {
                var p = i + 1;
                while (p < content.len and ident_char_table[content[p]]) p += 1;
                position.* = p;
                try sink.push(tok(i, p, .word));
                code_end = p;
                continue;
            },
        }
        position.* += 1;
        try sink.push(tok(i, position.*, .punctuation));
        code_end = position.*;
        if (substitution) {
            if (c == '{') braces += 1;
            if (c == '}') {
                if (braces == 0) return;
                braces -= 1;
            }
        }
    }
    if (substitution) return error.InvalidContext;
}

fn isToken(content: []const u8, items: []const Token, index: usize, text: []const u8) bool {
    return index < items.len and std.mem.eql(u8, content[items[index].start..items[index].end], text);
}

pub const ImportEquals = struct {
    name: []const u8,
    source: []const u8,
    is_type_only: bool,
};

/// Parse one complete external import-equals statement using the same native
/// lexical grammar as contextual module emission. Borrow the binding name;
/// the decoded module value is allocated from allocator.
pub fn parseImportEquals(allocator: std.mem.Allocator, content: []const u8) !?ImportEquals {
    const items = try tokens(allocator, content);
    defer allocator.free(items);
    if (!isToken(content, items, 0, "import")) return null;
    const type_only = isToken(content, items, 1, "type") and !isToken(content, items, 2, "=");
    const binding: usize = if (type_only) 2 else 1;
    if (binding + 5 >= items.len or items[binding].kind != .word or
        !isToken(content, items, binding + 1, "=") or !isToken(content, items, binding + 2, "require") or
        !isToken(content, items, binding + 3, "(") or items[binding + 4].kind != .quoted or
        !isToken(content, items, binding + 5, ")")) return null;
    const end = binding + 6;
    if (items.len != end and !(items.len == end + 1 and isToken(content, items, end, ";"))) return null;
    const literal = items[binding + 4];
    const value = try decodeLiteral(allocator, content[literal.start..literal.end]);
    return .{ .name = content[items[binding].start..items[binding].end], .source = value, .is_type_only = type_only };
}

/// Borrow the original module literal, including its quotes and escapes, from
/// one grammatical import. The source text outlives this returned slice.
pub fn importSourceLiteral(allocator: std.mem.Allocator, content: []const u8) !?[]const u8 {
    const items = try tokens(allocator, content);
    defer allocator.free(items);
    if (!isToken(content, items, 0, "import")) return null;
    const index = moduleLiteral(content, items, 0) orelse return null;
    return content[items[index].start..items[index].end];
}

/// Canonical trivia for binding parsing; quoted names and specifiers stay raw.
pub fn normalizeImportSyntax(allocator: std.mem.Allocator, content: []const u8) ![]const u8 {
    const items = try tokens(allocator, content);
    defer allocator.free(items);
    var output = std.array_list.Managed(u8).init(allocator);
    errdefer output.deinit();
    for (items, 0..) |item, index| {
        if (index > 0) try output.append(' ');
        try output.appendSlice(content[item.start..item.end]);
    }
    return output.toOwnedSlice();
}

pub fn importClauseEnd(allocator: std.mem.Allocator, content: []const u8) !?usize {
    const items = try tokens(allocator, content);
    defer allocator.free(items);
    const literal = moduleLiteral(content, items, 0) orelse return null;
    if (literal == 0 or !isToken(content, items, literal - 1, "from")) return null;
    return items[literal - 1].start;
}

pub fn splitImportItems(allocator: std.mem.Allocator, content: []const u8) ![][]const u8 {
    const items = try tokens(allocator, content);
    defer allocator.free(items);
    var result = std.array_list.Managed([]const u8).init(allocator);
    errdefer result.deinit();
    var start: usize = 0;
    for (items) |item| {
        if (item.kind != .punctuation or !std.mem.eql(u8, content[item.start..item.end], ",")) continue;
        const value = ch.sliceTrimmed(content, start, item.start);
        if (value.len > 0) try result.append(value);
        start = item.end;
    }
    const value = ch.sliceTrimmed(content, start, content.len);
    if (value.len > 0) try result.append(value);
    return result.toOwnedSlice();
}

pub fn isTypeOnlyImportItem(allocator: std.mem.Allocator, content: []const u8) !bool {
    if (!std.mem.startsWith(u8, content, "type")) return false;
    const items = try tokens(allocator, content);
    defer allocator.free(items);
    if (items.len < 2 or !isToken(content, items, 0, "type")) return false;
    return !(items.len == 3 and isToken(content, items, 1, "as"));
}

/// Rebuild imports with the canonical single-quote style while retaining the
/// actual decoded module identity, including escaped matching quote bytes.
pub fn appendImportSourceLiteral(allocator: std.mem.Allocator, content: []const u8, result: *std.array_list.Managed(u8)) !void {
    const literal = try importSourceLiteral(allocator, content) orelse return error.InvalidModuleLiteral;
    const decoded = try decodeLiteral(allocator, literal);
    defer allocator.free(decoded);
    try appendLiteral(result, decoded, '\'');
}

fn moduleLiteral(content: []const u8, items: []const Token, index: usize) ?usize {
    if (index > 0 and isToken(content, items, index - 1, ".")) return null;
    const importing = isToken(content, items, index, "import");
    if (!importing and !isToken(content, items, index, "export")) return null;
    var next = index + 1;
    if (next >= items.len) return null;
    if (importing) {
        if (items[next].kind == .quoted) return next;
        if (isToken(content, items, next, "(")) {
            return if (next + 2 < items.len and items[next + 1].kind == .quoted and
                (isToken(content, items, next + 2, ")") or isToken(content, items, next + 2, ","))) next + 1 else null;
        }
        if (items[next].kind != .word and !isToken(content, items, next, "*") and !isToken(content, items, next, "{")) return null;
    } else {
        if (isToken(content, items, next, "type")) next += 1;
        if (!isToken(content, items, next, "*") and !isToken(content, items, next, "{")) return null;
    }
    var depth: usize = 0;
    while (next < items.len) : (next += 1) {
        if (isToken(content, items, next, ";")) return null;
        if (isToken(content, items, next, "{")) depth += 1;
        if (isToken(content, items, next, "}")) {
            if (depth == 0) return null;
            depth -= 1;
        }
        if (depth == 0 and isToken(content, items, next, "from") and next + 1 < items.len and items[next + 1].kind == .quoted)
            return next + 1;
        if (depth == 0 and isToken(content, items, next, "=")) {
            if (importing and isToken(content, items, next + 1, "require") and isToken(content, items, next + 2, "(") and
                next + 4 < items.len and items[next + 3].kind == .quoted and isToken(content, items, next + 4, ")")) return next + 3;
            return null;
        }
    }
    return null;
}

fn hexValue(value: u8) !u32 {
    return if (value >= '0' and value <= '9') value - '0' else if (value >= 'a' and value <= 'f') value - 'a' + 10 else if (value >= 'A' and value <= 'F') value - 'A' + 10 else error.InvalidContext;
}

fn readHex(content: []const u8, start: usize, length: usize) !u32 {
    if (start + length > content.len) return error.InvalidContext;
    var result: u32 = 0;
    for (content[start..][0..length]) |byte| result = result * 16 + try hexValue(byte);
    return result;
}

fn decodeLiteral(allocator: std.mem.Allocator, literal: []const u8) ![]u8 {
    const decoded = try decodeStringLiteral(allocator, literal);
    errdefer allocator.free(decoded);
    if (std.mem.indexOfScalar(u8, decoded, 0) != null or !std.unicode.utf8ValidateSlice(decoded)) return error.InvalidContext;
    return decoded;
}

/// Decode JavaScript string/template text. Lone UTF-16 surrogates use WTF-8
/// internally and are escaped again by quoteStringLiteral, never written raw.
pub fn decodeStringLiteral(allocator: std.mem.Allocator, literal: []const u8) ![]u8 {
    var decoded = std.array_list.Managed(u8).init(allocator);
    errdefer decoded.deinit();
    const body = literal[1 .. literal.len - 1];
    var i: usize = 0;
    while (i < body.len) : (i += 1) {
        if (body[i] != '\\') {
            try decoded.append(body[i]);
            continue;
        }
        i += 1;
        if (i >= body.len) return error.InvalidContext;
        switch (body[i]) {
            '\n' => {},
            '\r' => {
                if (i + 1 < body.len and body[i + 1] == '\n') i += 1;
            },
            'n' => try decoded.append('\n'),
            'r' => try decoded.append('\r'),
            't' => try decoded.append('\t'),
            'b' => try decoded.append(8),
            'f' => try decoded.append(12),
            'v' => try decoded.append(11),
            '0' => {
                if (i + 1 < body.len and std.ascii.isDigit(body[i + 1])) return error.InvalidContext;
                try decoded.append(0);
            },
            'x' => {
                const codepoint = try readHex(body, i + 1, 2);
                var bytes: [4]u8 = undefined;
                const length = std.unicode.utf8Encode(@intCast(codepoint), &bytes) catch return error.InvalidContext;
                try decoded.appendSlice(bytes[0..length]);
                i += 2;
            },
            'u' => {
                var codepoint: u32 = 0;
                if (i + 1 < body.len and body[i + 1] == '{') {
                    i += 2;
                    const start = i;
                    while (i < body.len and body[i] != '}') : (i += 1) {
                        if (i - start >= 6) return error.InvalidContext;
                        codepoint = codepoint * 16 + try hexValue(body[i]);
                    }
                    if (i == start or i >= body.len or codepoint > 0x10ffff) return error.InvalidContext;
                } else {
                    codepoint = try readHex(body, i + 1, 4);
                    i += 4;
                }
                if (codepoint >= 0xd800 and codepoint <= 0xdbff and i + 6 < body.len and body[i + 1] == '\\' and body[i + 2] == 'u' and body[i + 3] != '{') {
                    const low = try readHex(body, i + 3, 4);
                    if (low >= 0xdc00 and low <= 0xdfff) {
                        codepoint = 0x10000 + (codepoint - 0xd800) * 0x400 + low - 0xdc00;
                        i += 6;
                    }
                }
                if (codepoint >= 0xd800 and codepoint <= 0xdfff) {
                    try decoded.appendSlice(&.{ 0xed, @as(u8, @intCast(0x80 | ((codepoint >> 6) & 0x3f))), @as(u8, @intCast(0x80 | (codepoint & 0x3f))) });
                    continue;
                }
                var bytes: [4]u8 = undefined;
                const length = std.unicode.utf8Encode(@intCast(codepoint), &bytes) catch return error.InvalidContext;
                try decoded.appendSlice(bytes[0..length]);
            },
            else => try decoded.append(body[i]),
        }
    }
    return decoded.toOwnedSlice();
}

fn appendLiteral(result: *std.array_list.Managed(u8), value: []const u8, quote: u8) !void {
    const hex = "0123456789abcdef";
    try result.append(quote);
    var index: usize = 0;
    while (index < value.len) : (index += 1) {
        const byte = value[index];
        // WTF-8 surrogate encodings are internal only. Preserve their actual
        // UTF-16 identity through a valid escaped declaration literal.
        if (byte == 0xed and index + 2 < value.len and value[index + 1] >= 0xa0 and value[index + 1] <= 0xbf and value[index + 2] & 0xc0 == 0x80) {
            const point: u16 = (@as(u16, byte & 15) << 12) | (@as(u16, value[index + 1] & 63) << 6) | @as(u16, value[index + 2] & 63);
            try result.appendSlice("\\u");
            for ([_]u4{ 12, 8, 4, 0 }) |shift| try result.append(hex[@as(usize, (point >> shift) & 15)]);
            index += 2;
            continue;
        }
        if (byte == quote or byte == '\\') {
            try result.append('\\');
            try result.append(byte);
        } else if (byte < 32) {
            try result.appendSlice("\\u00");
            try result.append(hex[byte >> 4]);
            try result.append(hex[byte & 15]);
        } else try result.append(byte);
    }
    try result.append(quote);
}

pub fn quoteStringLiteral(allocator: std.mem.Allocator, value: []const u8, quote: u8) std.mem.Allocator.Error![]u8 {
    var result = std.array_list.Managed(u8).init(allocator);
    errdefer result.deinit();
    try appendLiteral(&result, value, quote);
    return result.toOwnedSlice();
}

fn isExternalModule(content: []const u8, items: []const Token) bool {
    var depth: usize = 0;
    for (items, 0..) |token, index| {
        const member = index > 0 and (isToken(content, items, index - 1, ".") or isToken(content, items, index - 1, "#"));
        if (depth == 0 and token.kind == .word and !member and
            (isToken(content, items, index, "export") or
                (isToken(content, items, index, "import") and !isToken(content, items, index + 1, "(") and !isToken(content, items, index + 1, ".")))) return true;
        if (isToken(content, items, index, "{") or isToken(content, items, index, "(") or isToken(content, items, index, "[")) depth += 1 else if (depth > 0 and (isToken(content, items, index, "}") or isToken(content, items, index, ")") or isToken(content, items, index, "]"))) depth -= 1;
    }
    return false;
}

pub const ModuleReference = struct {
    specifier: []const u8,
    kind: enum { static_import, re_export, import_type, augmentation },
};

/// The project graph uses the same decoded grammatical literals as rewriting.
/// Each returned specifier and the returned slice belong to the caller.
pub fn collectModuleReferences(allocator: std.mem.Allocator, content: []const u8) ![]ModuleReference {
    const items = try tokens(allocator, content);
    defer allocator.free(items);
    var result = std.array_list.Managed(ModuleReference).init(allocator);
    errdefer {
        for (result.items) |reference| allocator.free(reference.specifier);
        result.deinit();
    }
    const external_module = isExternalModule(content, items);
    var depth: usize = 0;
    for (items, 0..) |token, index| {
        const top_level = depth == 0;
        if (isToken(content, items, index, "{") or isToken(content, items, index, "(") or isToken(content, items, index, "[")) depth += 1 else if (depth > 0 and (isToken(content, items, index, "}") or isToken(content, items, index, ")") or isToken(content, items, index, "]"))) depth -= 1;
        if (token.kind != .word) continue;
        const augmentation = top_level and external_module and isToken(content, items, index, "declare") and
            isToken(content, items, index + 1, "module") and index + 3 < items.len and
            items[index + 2].kind == .quoted and isToken(content, items, index + 3, "{");
        const literal_index = if (augmentation) index + 2 else moduleLiteral(content, items, index) orelse continue;
        const kind: @FieldType(ModuleReference, "kind") = if (augmentation) .augmentation else if (isToken(content, items, index, "export")) .re_export else if (top_level and !isToken(content, items, index + 1, "(")) .static_import else .import_type;
        const literal = items[literal_index];
        const decoded = try decodeLiteral(allocator, content[literal.start..literal.end]);
        errdefer allocator.free(decoded);
        if (!validString(decoded)) return error.InvalidContext;
        try result.append(.{ .specifier = decoded, .kind = kind });
    }
    return result.toOwnedSlice();
}

pub fn freeModuleReferences(allocator: std.mem.Allocator, references: []ModuleReference) void {
    for (references) |reference| allocator.free(reference.specifier);
    allocator.free(references);
}

fn checkModuleReferenceAllocations(allocator: std.mem.Allocator) !void {
    const references = try collectModuleReferences(allocator, "import /* activation */ { 'from, as' as Bound } from\n'./child\\u002ejs'; export type { Bound } from './types.js'; export type Value = import('./model.js').Value; declare module './target.js' { interface Added {} } const raw = `import './ignored.js'`; ");
    defer freeModuleReferences(allocator, references);
    try std.testing.expectEqual(@as(usize, 4), references.len);
    try std.testing.expectEqualStrings("./child.js", references[0].specifier);
    try std.testing.expectEqual(.static_import, references[0].kind);
    try std.testing.expectEqual(.re_export, references[1].kind);
    try std.testing.expectEqual(.import_type, references[2].kind);
    try std.testing.expectEqual(.augmentation, references[3].kind);
}

test "module graph reference collection shares literal grammar and allocation errors" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, checkModuleReferenceAllocations, .{});
}

/// Emit only grammatical module literals through the resolved context. This
/// runs inside the native emitter before its result allocation is finalized.
pub fn rewrite(allocator: std.mem.Allocator, content: []const u8, context: *const Context) ![]u8 {
    if (context.delivered_sources == null and std.mem.eql(u8, context.wire.moduleSpecifierMode, "preserve") and context.wire.rewrites.len == 0)
        return allocator.dupe(u8, content);
    const items = try tokens(allocator, content);
    defer allocator.free(items);
    var result = std.array_list.Managed(u8).init(allocator);
    errdefer result.deinit();
    var copied: usize = 0;
    const external_module = isExternalModule(content, items);
    var depth: usize = 0;
    for (items, 0..) |token, index| {
        const top_level = depth == 0;
        if (isToken(content, items, index, "{") or isToken(content, items, index, "(") or isToken(content, items, index, "[")) depth += 1 else if (depth > 0 and (isToken(content, items, index, "}") or isToken(content, items, index, ")") or isToken(content, items, index, "]"))) depth -= 1;
        if (token.kind != .word) continue;
        const augmentation = top_level and external_module and isToken(content, items, index, "declare") and
            isToken(content, items, index + 1, "module") and index + 3 < items.len and
            items[index + 2].kind == .quoted and isToken(content, items, index + 3, "{");
        const literal_index = if (augmentation) index + 2 else moduleLiteral(content, items, index) orelse continue;
        const literal = items[literal_index];
        if (literal.start < copied) continue;
        const decoded = try decodeLiteral(allocator, content[literal.start..literal.end]);
        defer allocator.free(decoded);
        if (!validString(decoded)) return error.InvalidContext;
        const replacement = try context.lookup(decoded);
        try result.appendSlice(content[copied..literal.start]);
        if (std.mem.eql(u8, replacement, decoded)) try result.appendSlice(content[literal.start..literal.end]) else try appendLiteral(&result, replacement, content[literal.start]);
        copied = literal.end;
    }
    try result.appendSlice(content[copied..]);
    return result.toOwnedSlice();
}

fn testContext(allocator: std.mem.Allocator, mode: []const u8, source: []const u8, rewrites: []const u8) !Context {
    return testContextWithImports(allocator, mode, source, rewrites, "[]");
}

fn testContextWithImports(allocator: std.mem.Allocator, mode: []const u8, source: []const u8, rewrites: []const u8, imports: []const u8) !Context {
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(source, &digest, .{});
    const alphabet = "0123456789abcdef";
    var hash: [64]u8 = undefined;
    for (digest, 0..) |byte, i| {
        hash[i * 2] = alphabet[byte >> 4];
        hash[i * 2 + 1] = alphabet[byte & 15];
    }
    const json = try std.fmt.allocPrint(allocator, "{{\"version\":1,\"moduleSpecifierMode\":\"{s}\",\"sourceFile\":\"/src/index.ts\",\"outputFile\":\"/dist/index.d.ts\",\"sourceHash\":\"{s}\",\"rewrites\":{s},\"augmentationImports\":{s}}}", .{ mode, hash, rewrites, imports });
    defer allocator.free(json);
    return parse(allocator, json, source);
}

test "context maps only actual emitted module literals" {
    const a = std.testing.allocator;
    const source = "source identity";
    const entries = "[{\"specifier\":\"./value\",\"resolvedSource\":\"/src/value.ts\",\"declarationOutput\":\"/dist/value.d.ts\",\"emittedSpecifier\":\"./value.js\"}]";
    const context = try testContext(a, "node", source, entries);
    defer context.deinit();
    const input =
        "// import('./missing')\n" ++
        "/* export * from './missing' */\n" ++
        "import './value';\nimport type { Value } from './value';\n" ++
        "export type { Value } from './value';\nexport * as values from './value';\n" ++
        "import Value = require('./value');\n" ++
        "export type T = import('./value').Value;\n" ++
        "export interface X { value: typeof import('./value'); literal: './missing'; from: './missing'; }\n" ++
        "declare module './value' { export type T = import('./value').Value }\n" ++
        "export type Template = `import('./missing')`;\n" ++
        "export type Name = './missing';\n" ++
        "import type { External } from 'external';\n";
    const output = try rewrite(a, input, &context);
    defer a.free(output);
    try std.testing.expect(std.mem.indexOf(u8, output, "import './value.js'") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "from './value.js'") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "require('./value.js')") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "typeof import('./value.js')") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "declare module './value.js'") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "literal: './missing'") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "`import('./missing')`") != null);
    try std.testing.expect(std.mem.indexOf(u8, output, "from 'external'") != null);
}

test "import-equals parsing shares comment and quoted literal grammar" {
    const a = std.testing.allocator;
    const parsed = (try parseImportEquals(a, "import /* binding */ type Options = require /* module */ ( './options.cjs' /* close */ );")).?;
    defer a.free(parsed.source);
    try std.testing.expectEqualStrings("Options", parsed.name);
    try std.testing.expectEqualStrings("./options.cjs", parsed.source);
    try std.testing.expect(parsed.is_type_only);
    const named_type = (try parseImportEquals(a, "import type = require('./type.cjs')")).?;
    defer a.free(named_type.source);
    try std.testing.expectEqualStrings("type", named_type.name);
    try std.testing.expect(!named_type.is_type_only);
    try std.testing.expect((try parseImportEquals(a, "import Options from './options.cjs';")) == null);
    try std.testing.expect((try parseImportEquals(a, "import Options = require('./options.cjs';")) == null);
}

test "context checks source identity, missing edges and preserves legacy spelling" {
    const a = std.testing.allocator;
    const context = try testContext(a, "node", "source", "[]");
    defer context.deinit();
    try std.testing.expectError(error.UnresolvedModuleSpecifier, rewrite(a, "export * from './missing';", &context));
    const preserved = try testContext(a, "preserve", "source", "[]");
    defer preserved.deinit();
    const input = "export * from './missing';";
    const output = try rewrite(a, input, &preserved);
    defer a.free(output);
    try std.testing.expectEqualStrings(input, output);
    try std.testing.expectError(error.InvalidContext, parse(a, "{}", "source"));
    try std.testing.expectError(error.InvalidContext, parse(a, "{\"version\":1,\"moduleSpecifierMode\":\"node\",\"sourceFile\":\"/src\",\"outputFile\":\"/dist\",\"sourceHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"rewrites\":[]}", "source"));
}

test "escaped module literals map decoded values and safely escape emitted paths" {
    const a = std.testing.allocator;
    const context = try testContext(a, "node", "source", "[{\"specifier\":\"./value\",\"resolvedSource\":\"/src/value.ts\",\"declarationOutput\":\"/dist/value.d.ts\",\"emittedSpecifier\":\"./value's.js\"}]");
    defer context.deinit();
    const output = try rewrite(a, "export * from '\\u002e/value';", &context);
    defer a.free(output);
    try std.testing.expectEqualStrings("export * from './value\\'s.js';", output);
}

test "preserve context applies explicit private mappings without inferring extensions" {
    const a = std.testing.allocator;
    const context = try testContext(a, "preserve", "source", "[{\"specifier\":\"local/value\",\"resolvedSource\":\"/src/value.ts\",\"declarationOutput\":\"/dist/value.d.ts\",\"emittedSpecifier\":\"./value\"}]");
    defer context.deinit();
    const output = try rewrite(a, "export type { Value } from 'local/value';\nexport * from './unmapped';", &context);
    defer a.free(output);
    try std.testing.expectEqualStrings("export type { Value } from './value';\nexport * from './unmapped';", output);
}

test "template substitutions recurse through syntax while raw characters remain literal" {
    const a = std.testing.allocator;
    const context = try testContext(a, "node", "source", "[{\"specifier\":\"./value\",\"resolvedSource\":\"/src/value.ts\",\"declarationOutput\":\"/dist/value.d.ts\",\"emittedSpecifier\":\"./value.js\"}]");
    defer context.deinit();
    const input =
        "export type T = `raw import('./missing') ${import('./value').Name} " ++
        "\\${import('./missing')} " ++
        "${{ brace: '}'; literal: \"import('./missing')\"; name: import('./value').Name }['name']} " ++
        "${`nested import('./missing') ${/* } */ import('./value').Name}`} end`;";
    const expected =
        "export type T = `raw import('./missing') ${import('./value.js').Name} " ++
        "\\${import('./missing')} " ++
        "${{ brace: '}'; literal: \"import('./missing')\"; name: import('./value.js').Name }['name']} " ++
        "${`nested import('./missing') ${/* } */ import('./value.js').Name}`} end`;";
    const output = try rewrite(a, input, &context);
    defer a.free(output);
    try std.testing.expectEqualStrings(expected, output);
    try std.testing.expectError(error.InvalidContext, rewrite(a, "type T = `${{ name: import('./value') }`;", &context));
}

test "augmentation module literals resolve while ambient script definitions retain their identity" {
    const a = std.testing.allocator;
    const context = try testContext(a, "node", "source", "[{\"specifier\":\"local/value\",\"resolvedSource\":\"/src/value.ts\",\"declarationOutput\":\"/dist/value.d.ts\",\"emittedSpecifier\":\"./value.js\"}]");
    defer context.deinit();
    const ambient = "declare module 'local/value' { export interface Added {} }";
    const unchanged = try rewrite(a, ambient, &context);
    defer a.free(unchanged);
    try std.testing.expectEqualStrings(ambient, unchanged);
    const augmented = try rewrite(a, "export {}; declare /* module */ module 'local/value' { interface Added {} }", &context);
    defer a.free(augmented);
    try std.testing.expect(std.mem.indexOf(u8, augmented, "module './value.js'") != null);
    try std.testing.expectError(error.UnresolvedModuleSpecifier, rewrite(a, "export {}; declare module './missing' { interface Added {} }", &context));
    try std.testing.expectError(error.InvalidContext, testContextWithImports(a, "node", "source", "[]", "[\"\"]"));
    try std.testing.expectError(error.InvalidContext, testContextWithImports(a, "node", "source", "[]", "[\"bad\\u0000path\"]"));
}

fn checkAugmentationContextAllocations(a: std.mem.Allocator) !void {
    const syntax = try normalizeImportSyntax(a, "import /* binding */ type { Value as Alias } from\n'local/value';");
    defer a.free(syntax);
    const end = (try importClauseEnd(a, syntax)).?;
    try std.testing.expectEqualStrings("import type { Value as Alias }", ch.sliceTrimmed(syntax, 0, end));
    try std.testing.expectEqualStrings("'local/value'", (try importSourceLiteral(a, syntax)).?);
    const names = try splitImportItems(a, "\"name from, as label\" as Alias, type as Value, type Shape as Model");
    defer a.free(names);
    try std.testing.expectEqual(@as(usize, 3), names.len);
    try std.testing.expectEqualStrings("\"name from, as label\" as Alias", names[0]);
    try std.testing.expect(!(try isTypeOnlyImportItem(a, names[1])));
    try std.testing.expect(try isTypeOnlyImportItem(a, names[2]));
    var context = try testContextWithImports(a, "node", "source", "[{\"specifier\":\"local/value\",\"resolvedSource\":\"/src/value.ts\",\"declarationOutput\":\"/dist/value.d.ts\",\"emittedSpecifier\":\"./value.js\"}]", "[\"local/value\"]");
    defer context.deinit();
    var borrowed = try fromWire(context.wire, "source");
    borrowed.deinit();
    var delivered = std.StringHashMap([]const u8).init(a);
    defer delivered.deinit();
    try delivered.put("/src/value.ts", "/dist/value.d.ts");
    context.delivered_sources = &delivered;
    try std.testing.expect(context.requiresImport("local/value"));
    try std.testing.expect(!context.requiresImport("unrelated"));
    const output = try rewrite(a, "export {}; declare module 'local/value' { interface Added {} }", &context);
    defer a.free(output);
    try std.testing.expect(std.mem.indexOf(u8, output, "module './value.js'") != null);
}

test "augmentation context parsing and rewriting propagate every allocation failure" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, checkAugmentationContextAllocations, .{});
}

test "closed batch delivery rejects missing and inconsistent retained targets without changing standalone context semantics" {
    const a = std.testing.allocator;
    var context = try testContext(a, "preserve", "source", "[{\"specifier\":\"./value\",\"resolvedSource\":\"/src/value.ts\",\"declarationOutput\":\"/dist/value.d.ts\",\"emittedSpecifier\":\"./value.js\"}]");
    defer context.deinit();
    var delivered = std.StringHashMap([]const u8).init(a);
    defer delivered.deinit();
    context.delivered_sources = &delivered;
    try std.testing.expectError(error.UndeliveredModuleSpecifier, rewrite(a, "export type T = import('./value').Value;", &context));
    try std.testing.expectError(error.UnresolvedModuleSpecifier, rewrite(a, "export type T = import('./missing').Value;", &context));
    try delivered.put("/src/value.ts", "/dist/wrong.d.ts");
    try std.testing.expectError(error.InvalidContext, rewrite(a, "export type T = import('./value').Value;", &context));
    try delivered.put("/src/value.ts", "/dist/value.d.ts");
    const output = try rewrite(a, "export type T = import('./value').Value;", &context);
    defer a.free(output);
    try std.testing.expectEqualStrings("export type T = import('./value.js').Value;", output);
    context.delivered_sources = null;
    const standalone = try rewrite(a, "export type T = import('./missing').Value;", &context);
    defer a.free(standalone);
    try std.testing.expectEqualStrings("export type T = import('./missing').Value;", standalone);
}
