/// Emitter module — converts declarations to final .d.ts output.
/// Port of processor/index.ts.
const std = @import("std");
const ch = @import("char_utils.zig");
const types = @import("types.zig");
const type_inf = @import("type_inference.zig");
const Declaration = types.Declaration;
const DeclarationKind = types.DeclarationKind;

/// Check if a character is an identifier character (for word boundary checks)
inline fn isIdentChar(c: u8) bool {
    return (c >= 'A' and c <= 'Z') or (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '_' or c == '$' or c > 127;
}

/// Check if `name` appears as a whole word in `text` (fast indexOf + boundary check)
pub fn isWordInText(name: []const u8, text: []const u8) bool {
    if (name.len == 0) return false;
    var search_from: usize = 0;
    while (search_from < text.len) {
        const idx = ch.indexOf(text, name, search_from) orelse return false;
        const before: u8 = if (idx > 0) text[idx - 1] else ' ';
        const after: u8 = if (idx + name.len < text.len) text[idx + name.len] else ' ';
        if (!isIdentChar(before) and !isIdentChar(after)) return true;
        search_from = idx + 1;
    }
    return false;
}

/// Extract all identifier words from text into an existing HashMap (single pass, O(n))
fn extractWords(words: *std.StringHashMap(void), text: []const u8) void {
    var i: usize = 0;
    while (i < text.len) {
        const c = text[i];
        if ((c >= 'A' and c <= 'Z') or (c >= 'a' and c <= 'z') or c == '_' or c == '$' or c > 127) {
            const start = i;
            i += 1;
            while (i < text.len and isIdentChar(text[i])) i += 1;
            words.put(text[start..i], {}) catch {};
        } else {
            i += 1;
        }
    }
}

/// Extract triple-slash directives from source start
fn extractTripleSlashDirectives(alloc: std.mem.Allocator, source: []const u8) ![][]const u8 {
    var directives = std.array_list.Managed([]const u8).init(alloc);
    var line_start: usize = 0;

    var i: usize = 0;
    while (i <= source.len) : (i += 1) {
        if (i == source.len or source[i] == '\n') {
            // Extract and trim line
            var start = line_start;
            var end = i;
            while (start < end and (source[start] == ' ' or source[start] == '\t' or source[start] == '\r')) start += 1;
            while (end > start and (source[end - 1] == ' ' or source[end - 1] == '\t' or source[end - 1] == '\r')) end -= 1;
            const trimmed = source[start..end];
            line_start = i + 1;

            if (trimmed.len >= 3 and trimmed[0] == '/' and trimmed[1] == '/' and trimmed[2] == '/') {
                // Check for /// <reference .../>
                if (ch.contains(trimmed, "<reference ") or ch.contains(trimmed, "<amd-module ") or ch.contains(trimmed, "<amd-dependency ")) {
                    try directives.append(trimmed);
                }
            } else if (trimmed.len == 0 or (trimmed.len >= 2 and trimmed[0] == '/' and trimmed[1] == '/')) {
                continue;
            } else {
                break;
            }
        }
    }

    return directives.toOwnedSlice();
}

/// Format leading comments — direct alloc, output ≤ total comment length + newlines
fn formatComments(alloc: std.mem.Allocator, comments: ?[]const []const u8, keep_comments: bool) ![]const u8 {
    if (!keep_comments) return "";
    const cmts = comments orelse return "";
    if (cmts.len == 0) return "";

    // Fast path: single comment (very common)
    if (cmts.len == 1) {
        const t = ch.sliceTrimmed(cmts[0], 0, cmts[0].len);
        const buf = try alloc.alloc(u8, t.len + 1);
        @memcpy(buf[0..t.len], t);
        buf[t.len] = '\n';
        return buf;
    }

    // Pre-compute exact size
    var total_len: usize = cmts.len; // newlines between + trailing
    for (cmts) |c| {
        const t = ch.sliceTrimmed(c, 0, c.len);
        total_len += t.len;
    }

    const buf = try alloc.alloc(u8, total_len);
    var pos: usize = 0;
    for (cmts, 0..) |c, idx| {
        if (idx > 0) {
            buf[pos] = '\n';
            pos += 1;
        }
        const t = ch.sliceTrimmed(c, 0, c.len);
        @memcpy(buf[pos..][0..t.len], t);
        pos += t.len;
    }
    buf[pos] = '\n';
    pos += 1;
    return buf[0..pos];
}

const ParsedImportResult = struct {
    default_name: ?[]const u8,
    named_items: []const []const u8,
    source: []const u8,
    is_type_only: bool,
};

/// Get parsed import components from a declaration's cached parsed_import.
fn getParsedImport(decl: Declaration) ?ParsedImportResult {
    const pi = decl.parsed_import orelse return null;
    return .{
        .default_name = pi.default_name,
        .named_items = pi.named_items,
        .source = pi.source,
        .is_type_only = pi.is_type_only,
    };
}

/// Extract all imported item names from an import declaration (for filtering).
/// Uses cached parsed_import when available to avoid re-parsing.
fn extractAllImportedItems(decl: Declaration) []const []const u8 {
    if (decl.parsed_import) |pi| {
        return pi.resolved_items;
    }
    return &.{};
}

/// Process a variable declaration for DTS output
fn processVariableDeclaration(alloc: std.mem.Allocator, decl: Declaration, keep_comments: bool) ![]const u8 {
    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

    // Fast path: if we have type annotation and no value needing special inference
    if (decl.type_annotation.len > 0 and decl.value.len == 0) {
        if (comments.len == 0) return decl.text;
        const buf = try alloc.alloc(u8, comments.len + decl.text.len);
        @memcpy(buf[0..comments.len], comments);
        @memcpy(buf[comments.len..][0..decl.text.len], decl.text);
        return buf;
    }

    // Fast path: type annotation set + value exists but doesn't need special handling.
    // The scanner already built the correct DTS text using the type annotation,
    // so we can return it directly without type inference or value processing.
    if (decl.type_annotation.len > 0 and decl.value.len > 0) {
        const trimmed_val = std.mem.trim(u8, decl.value, " \t\n\r");
        if (!ch.endsWith(trimmed_val, "as const") and
            !ch.contains(decl.value, " satisfies "))
        {
            const kind: []const u8 = if (decl.modifiers) |mods| (if (mods.len > 0) mods[0] else "const") else "const";
            if (!std.mem.eql(u8, kind, "const") or !type_inf.isGenericType(decl.type_annotation)) {
                if (comments.len == 0) return decl.text;
                const buf = try alloc.alloc(u8, comments.len + decl.text.len);
                @memcpy(buf[0..comments.len], comments);
                @memcpy(buf[comments.len..][0..decl.text.len], decl.text);
                return buf;
            }
        }
    }

    // Variable kind from modifiers
    const kind: []const u8 = if (decl.modifiers) |mods| (if (mods.len > 0) mods[0] else "const") else "const";

    // Determine type annotation
    var type_annotation: []const u8 = decl.type_annotation;

    if (decl.value.len > 0 and ch.contains(decl.value, " satisfies ")) {
        if (type_inf.extractSatisfiesType(decl.value)) |sat_type| {
            type_annotation = sat_type;
        }
    } else if (decl.value.len > 0 and ch.endsWith(std.mem.trim(u8, decl.value, " \t\n\r"), "as const")) {
        type_annotation = try type_inf.inferNarrowType(alloc, decl.value, true, false, 0);
    } else if (type_annotation.len == 0 and decl.value.len > 0 and std.mem.eql(u8, kind, "const")) {
        const trimmed_val = std.mem.trim(u8, decl.value, " \t\n\r");
        const is_container = trimmed_val.len > 0 and (trimmed_val[0] == '{' or trimmed_val[0] == '[');
        if (is_container) type_inf.enableCleanDefaultCollection();
        type_annotation = try type_inf.inferNarrowType(alloc, decl.value, !is_container, false, 0);
    } else if (type_annotation.len > 0 and decl.value.len > 0 and std.mem.eql(u8, kind, "const") and type_inf.isGenericType(type_annotation)) {
        const inferred = try type_inf.inferNarrowType(alloc, decl.value, true, false, 0);
        if (!std.mem.eql(u8, inferred, "unknown")) {
            type_annotation = inferred;
        }
    } else if (type_annotation.len == 0 and decl.value.len > 0) {
        type_annotation = try type_inf.inferNarrowType(alloc, decl.value, std.mem.eql(u8, kind, "const"), false, 0);
    }

    if (type_annotation.len == 0) type_annotation = "unknown";

    // Add @defaultValue JSDoc for widened declarations
    // Skip when value uses 'as const' — types are already narrow/self-documenting
    const val_trimmed_for_check = std.mem.trim(u8, decl.value, " \t\n\r");
    const has_as_const = ch.endsWith(val_trimmed_for_check, "as const");
    if (decl.value.len > 0 and decl.type_annotation.len == 0 and !has_as_const) {
        var default_val: ?[]const u8 = null;
        var is_container = false;
        const trimmed_val = std.mem.trim(u8, decl.value, " \t\n\r");

        if (!std.mem.eql(u8, kind, "const")) {
            const is_widened = std.mem.eql(u8, type_annotation, "string") or
                std.mem.eql(u8, type_annotation, "number") or
                std.mem.eql(u8, type_annotation, "boolean");
            if (is_widened and trimmed_val.len > 0) {
                default_val = trimmed_val;
            }
        } else if (trimmed_val.len > 0 and (trimmed_val[0] == '{' or trimmed_val[0] == '[')) {
            default_val = type_inf.consumeCleanDefault();
            is_container = true;
        }

        // Skip generated @defaultValue if user already has one
        if (std.mem.indexOf(u8, comments, "@defaultValue") != null) {
            default_val = null;
        }

        if (default_val) |dv| {
            // Build the @defaultValue tag content using direct alloc
            const tag_max = 24 + dv.len * 4 + 16; // generous upper bound for multi-line
            const tag_mem = try alloc.alloc(u8, tag_max);
            var tp: usize = 0;

            if (std.mem.indexOf(u8, dv, "\n")) |_| {
                const hdr = "@defaultValue\n * ```ts\n";
                @memcpy(tag_mem[tp..][0..hdr.len], hdr); tp += hdr.len;
                var line_iter = std.mem.splitScalar(u8, dv, '\n');
                while (line_iter.next()) |line| {
                    @memcpy(tag_mem[tp..][0..3], " * "); tp += 3;
                    @memcpy(tag_mem[tp..][0..line.len], line); tp += line.len;
                    tag_mem[tp] = '\n'; tp += 1;
                }
                @memcpy(tag_mem[tp..][0..6], " * ```"); tp += 6;
            } else if (is_container) {
                @memcpy(tag_mem[tp..][0..15], "@defaultValue `"); tp += 15;
                @memcpy(tag_mem[tp..][0..dv.len], dv); tp += dv.len;
                tag_mem[tp] = '`'; tp += 1;
            } else {
                @memcpy(tag_mem[tp..][0..14], "@defaultValue "); tp += 14;
                @memcpy(tag_mem[tp..][0..dv.len], dv); tp += dv.len;
            }
            const default_tag = tag_mem[0..tp];

            // Build rebuilt output using direct alloc
            const export_prefix: []const u8 = if (decl.is_exported) "export " else "";
            const decl_suffix_len = export_prefix.len + 8 + kind.len + 1 + decl.name.len + 2 + type_annotation.len + 1; // "declare " + kind + ' ' + name + ": " + type + ';'
            const rebuilt_max = comments.len + default_tag.len + decl_suffix_len + 64;
            const rbuf = try alloc.alloc(u8, rebuilt_max);
            var rp: usize = 0;

            // Try to merge into existing JSDoc comment block
            const closing_idx = std.mem.lastIndexOf(u8, comments, "*/");
            if (closing_idx != null and comments.len > 0) {
                const before_raw = comments[0..closing_idx.?];
                var end = before_raw.len;
                while (end > 0 and (before_raw[end - 1] == ' ' or before_raw[end - 1] == '\t' or before_raw[end - 1] == '\n' or before_raw[end - 1] == '\r')) : (end -= 1) {}
                const before = before_raw[0..end];
                if (before.len > 4 and ch.startsWith(before, "/** ") and std.mem.indexOf(u8, before, "\n") == null) {
                    @memcpy(rbuf[rp..][0..7], "/**\n * "); rp += 7;
                    @memcpy(rbuf[rp..][0..before.len - 4], before[4..]); rp += before.len - 4;
                } else {
                    @memcpy(rbuf[rp..][0..before.len], before); rp += before.len;
                }
                @memcpy(rbuf[rp..][0..4], "\n * "); rp += 4;
                @memcpy(rbuf[rp..][0..default_tag.len], default_tag); rp += default_tag.len;
                @memcpy(rbuf[rp..][0..5], "\n */\n"); rp += 5;
            } else if (comments.len > 0) {
                const trimmed_cmt = std.mem.trim(u8, comments, " \t\n\r");
                const cmt_text = if (ch.startsWith(trimmed_cmt, "// "))
                    trimmed_cmt[3..]
                else if (ch.startsWith(trimmed_cmt, "//"))
                    trimmed_cmt[2..]
                else
                    trimmed_cmt;
                @memcpy(rbuf[rp..][0..7], "/**\n * "); rp += 7;
                @memcpy(rbuf[rp..][0..cmt_text.len], cmt_text); rp += cmt_text.len;
                @memcpy(rbuf[rp..][0..4], "\n * "); rp += 4;
                @memcpy(rbuf[rp..][0..default_tag.len], default_tag); rp += default_tag.len;
                @memcpy(rbuf[rp..][0..5], "\n */\n"); rp += 5;
            } else {
                if (std.mem.indexOf(u8, default_tag, "\n") != null) {
                    @memcpy(rbuf[rp..][0..7], "/**\n * "); rp += 7;
                    @memcpy(rbuf[rp..][0..default_tag.len], default_tag); rp += default_tag.len;
                    @memcpy(rbuf[rp..][0..5], "\n */\n"); rp += 5;
                } else {
                    @memcpy(rbuf[rp..][0..4], "/** "); rp += 4;
                    @memcpy(rbuf[rp..][0..default_tag.len], default_tag); rp += default_tag.len;
                    @memcpy(rbuf[rp..][0..4], " */\n"); rp += 4;
                }
            }

            @memcpy(rbuf[rp..][0..export_prefix.len], export_prefix); rp += export_prefix.len;
            @memcpy(rbuf[rp..][0..8], "declare "); rp += 8;
            @memcpy(rbuf[rp..][0..kind.len], kind); rp += kind.len;
            rbuf[rp] = ' '; rp += 1;
            @memcpy(rbuf[rp..][0..decl.name.len], decl.name); rp += decl.name.len;
            @memcpy(rbuf[rp..][0..2], ": "); rp += 2;
            @memcpy(rbuf[rp..][0..type_annotation.len], type_annotation); rp += type_annotation.len;
            rbuf[rp] = ';'; rp += 1;
            return rbuf[0..rp];
        }
    }

    // Build final result with direct alloc
    const export_prefix: []const u8 = if (decl.is_exported) "export " else "";
    const total = comments.len + export_prefix.len + 8 + kind.len + 1 + decl.name.len + 2 + type_annotation.len + 1;
    const buf = try alloc.alloc(u8, total);
    var pos: usize = 0;

    if (comments.len > 0) { @memcpy(buf[pos..][0..comments.len], comments); pos += comments.len; }
    @memcpy(buf[pos..][0..export_prefix.len], export_prefix); pos += export_prefix.len;
    @memcpy(buf[pos..][0..8], "declare "); pos += 8;
    @memcpy(buf[pos..][0..kind.len], kind); pos += kind.len;
    buf[pos] = ' '; pos += 1;
    @memcpy(buf[pos..][0..decl.name.len], decl.name); pos += decl.name.len;
    @memcpy(buf[pos..][0..2], ": "); pos += 2;
    @memcpy(buf[pos..][0..type_annotation.len], type_annotation); pos += type_annotation.len;
    buf[pos] = ';'; pos += 1;

    return buf[0..pos];
}

/// Process an interface declaration for DTS output
fn processInterfaceDeclaration(alloc: std.mem.Allocator, decl: Declaration, keep_comments: bool) ![]const u8 {
    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

    // If the text already starts with proper keywords, use it
    if (ch.startsWith(decl.text, "export declare interface") or ch.startsWith(decl.text, "declare interface")) {
        if (comments.len == 0) return decl.text;
        const buf = try alloc.alloc(u8, comments.len + decl.text.len);
        @memcpy(buf[0..comments.len], comments);
        @memcpy(buf[comments.len..][0..decl.text.len], decl.text);
        return buf;
    }

    // Direct alloc: compute max size
    const export_prefix: []const u8 = if (decl.is_exported) "export " else "";
    const extends_kw: []const u8 = if (decl.extends_clause.len > 0) " extends " else "";
    const body_start = ch.indexOfChar(decl.text, '{', 0);
    const body = if (body_start) |bi| decl.text[bi..] else "{}";
    const max_len = comments.len + export_prefix.len + "declare interface ".len +
        decl.name.len + decl.generics.len + extends_kw.len + decl.extends_clause.len + 1 + body.len;

    const buf = try alloc.alloc(u8, max_len);
    var pos: usize = 0;
    @memcpy(buf[pos..][0..comments.len], comments);
    pos += comments.len;
    @memcpy(buf[pos..][0..export_prefix.len], export_prefix);
    pos += export_prefix.len;
    const di = "declare interface ";
    @memcpy(buf[pos..][0..di.len], di);
    pos += di.len;
    @memcpy(buf[pos..][0..decl.name.len], decl.name);
    pos += decl.name.len;
    if (decl.generics.len > 0) {
        @memcpy(buf[pos..][0..decl.generics.len], decl.generics);
        pos += decl.generics.len;
    }
    if (decl.extends_clause.len > 0) {
        @memcpy(buf[pos..][0..extends_kw.len], extends_kw);
        pos += extends_kw.len;
        @memcpy(buf[pos..][0..decl.extends_clause.len], decl.extends_clause);
        pos += decl.extends_clause.len;
    }
    buf[pos] = ' ';
    pos += 1;
    @memcpy(buf[pos..][0..body.len], body);
    pos += body.len;

    return buf[0..pos];
}

/// Process a type alias declaration for DTS output
fn processTypeDeclaration(alloc: std.mem.Allocator, decl: Declaration, keep_comments: bool) ![]const u8 {
    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

    const export_prefix: []const u8 = if (decl.is_exported) "export " else "";
    const declare_prefix: []const u8 = if (!decl.is_exported and !ch.contains(decl.text, " from ")) "declare " else "";

    // Extract type definition from original text
    var type_def: []const u8 = undefined;
    var fallback = false;
    if (ch.indexOf(decl.text, "type ", 0)) |type_idx| {
        var td = decl.text[type_idx..];
        var end = td.len;
        while (end > 0 and (td[end - 1] == ';' or td[end - 1] == ' ' or td[end - 1] == '\n' or td[end - 1] == '\r')) end -= 1;
        type_def = td[0..end];
    } else {
        fallback = true;
        type_def = ""; // unused, assembled below
    }

    // Calculate total length
    const needs_semi = if (!fallback)
        (type_def.len > 0 and type_def[type_def.len - 1] != ';' and type_def[type_def.len - 1] != '}')
    else
        true; // fallback " = any" always needs semi

    const body_len = if (!fallback) type_def.len else 5 + decl.name.len + decl.generics.len + 6; // "type " + name + generics + " = any"
    const total = comments.len + export_prefix.len + declare_prefix.len + body_len + @as(usize, if (needs_semi) 1 else 0);

    const buf = try alloc.alloc(u8, total);
    var pos: usize = 0;

    if (comments.len > 0) { @memcpy(buf[pos..][0..comments.len], comments); pos += comments.len; }
    if (export_prefix.len > 0) { @memcpy(buf[pos..][0..export_prefix.len], export_prefix); pos += export_prefix.len; }
    if (declare_prefix.len > 0) { @memcpy(buf[pos..][0..declare_prefix.len], declare_prefix); pos += declare_prefix.len; }

    if (!fallback) {
        @memcpy(buf[pos..][0..type_def.len], type_def);
        pos += type_def.len;
    } else {
        @memcpy(buf[pos..][0..5], "type ");
        pos += 5;
        @memcpy(buf[pos..][0..decl.name.len], decl.name);
        pos += decl.name.len;
        if (decl.generics.len > 0) { @memcpy(buf[pos..][0..decl.generics.len], decl.generics); pos += decl.generics.len; }
        @memcpy(buf[pos..][0..6], " = any");
        pos += 6;
    }

    if (needs_semi) { buf[pos] = ';'; pos += 1; }

    return buf[0..pos];
}

/// Process an enum declaration for DTS output
fn processEnumDeclaration(alloc: std.mem.Allocator, decl: Declaration, keep_comments: bool) ![]const u8 {
    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

    const export_prefix: []const u8 = if (decl.is_exported) "export " else "";
    var is_const = false;
    if (decl.modifiers) |mods| {
        for (mods) |m| {
            if (std.mem.eql(u8, m, "const")) {
                is_const = true;
                break;
            }
        }
    }
    const const_kw: []const u8 = if (is_const) "const " else "";
    const body_start = ch.indexOfChar(decl.text, '{', 0);
    const body = if (body_start) |bi| decl.text[bi..] else "{}";

    const buf = try alloc.alloc(u8, comments.len + export_prefix.len + "declare ".len +
        const_kw.len + "enum ".len + decl.name.len + 1 + body.len);
    var pos: usize = 0;
    @memcpy(buf[pos..][0..comments.len], comments);
    pos += comments.len;
    @memcpy(buf[pos..][0..export_prefix.len], export_prefix);
    pos += export_prefix.len;
    const dec = "declare ";
    @memcpy(buf[pos..][0..dec.len], dec);
    pos += dec.len;
    @memcpy(buf[pos..][0..const_kw.len], const_kw);
    pos += const_kw.len;
    const en = "enum ";
    @memcpy(buf[pos..][0..en.len], en);
    pos += en.len;
    @memcpy(buf[pos..][0..decl.name.len], decl.name);
    pos += decl.name.len;
    buf[pos] = ' ';
    pos += 1;
    @memcpy(buf[pos..][0..body.len], body);
    pos += body.len;

    return buf[0..pos];
}

/// Process a module/namespace declaration for DTS output
fn processModuleDeclaration(alloc: std.mem.Allocator, decl: Declaration, keep_comments: bool) ![]const u8 {
    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

    // Global augmentation
    if (ch.startsWith(decl.text, "declare global")) {
        if (comments.len == 0) return decl.text;
        var result = std.array_list.Managed(u8).init(alloc);
        try result.ensureTotalCapacity(comments.len + decl.text.len);
        try result.appendSlice(comments);
        try result.appendSlice(decl.text);
        return result.toOwnedSlice();
    }

    // Ambient module (quoted name)
    const is_ambient = decl.source_module.len > 0 or
        (decl.name.len > 0 and (decl.name[0] == '"' or decl.name[0] == '\'' or decl.name[0] == '`'));

    if (is_ambient) {
        var result = std.array_list.Managed(u8).init(alloc);
        try result.ensureTotalCapacity(comments.len + decl.text.len + 32);
        try result.appendSlice(comments);
        try result.appendSlice("declare module ");
        try result.appendSlice(decl.name);

        if (ch.indexOfChar(decl.text, '{', 0)) |brace_idx| {
            try result.append(' ');
            try result.appendSlice(decl.text[brace_idx..]);
        } else {
            try result.appendSlice(" {}");
        }
        return result.toOwnedSlice();
    }

    // Regular namespace
    var result = std.array_list.Managed(u8).init(alloc);
    try result.ensureTotalCapacity(comments.len + decl.text.len + 32);
    try result.appendSlice(comments);

    if (decl.is_exported) try result.appendSlice("export ");

    // Check if declare is already in modifiers
    var has_declare = false;
    if (decl.modifiers) |mods| {
        for (mods) |m| {
            if (std.mem.eql(u8, m, "declare")) {
                has_declare = true;
                break;
            }
        }
    }
    if (!has_declare) try result.appendSlice("declare ");

    try result.appendSlice("namespace ");
    try result.appendSlice(decl.name);

    if (ch.indexOfChar(decl.text, '{', 0)) |brace_idx| {
        try result.append(' ');
        try result.appendSlice(decl.text[brace_idx..]);
    } else {
        try result.appendSlice(" {}");
    }

    return result.toOwnedSlice();
}

/// Main entry point: process declarations array into final .d.ts output.
/// `result_alloc` is used for the final output buffer (may differ from `alloc`
/// so the result can survive arena reset in FFI mode).
pub fn processDeclarations(
    alloc: std.mem.Allocator,
    result_alloc: std.mem.Allocator,
    declarations: []const Declaration,
    source_code: []const u8,
    keep_comments: bool,
    import_order: []const []const u8,
) ![]const u8 {
    var result = std.array_list.Managed(u8).init(result_alloc);
    try result.ensureTotalCapacity(source_code.len);

    // Extract triple-slash directives
    // Fast check: skip whitespace
    var si: usize = 0;
    while (si < source_code.len and ch.isWhitespace(source_code[si])) si += 1;
    if (si + 2 < source_code.len and source_code[si] == '/' and source_code[si + 1] == '/' and source_code[si + 2] == '/') {
        const directives = try extractTripleSlashDirectives(alloc, source_code);
        for (directives) |d| {
            if (result.items.len > 0) try result.append('\n');
            try result.appendSlice(d);
        }
    }

    // Group declarations by type (pre-size to avoid incremental reallocation)
    const group_cap: usize = @max(declarations.len / 4, 4);
    var imports = std.array_list.Managed(Declaration).init(alloc);
    try imports.ensureTotalCapacity(group_cap);
    var functions = std.array_list.Managed(Declaration).init(alloc);
    try functions.ensureTotalCapacity(group_cap);
    var variables = std.array_list.Managed(Declaration).init(alloc);
    try variables.ensureTotalCapacity(group_cap);
    var interfaces = std.array_list.Managed(Declaration).init(alloc);
    try interfaces.ensureTotalCapacity(group_cap);
    var type_decls = std.array_list.Managed(Declaration).init(alloc);
    try type_decls.ensureTotalCapacity(group_cap);
    var classes = std.array_list.Managed(Declaration).init(alloc);
    try classes.ensureTotalCapacity(group_cap);
    var enums = std.array_list.Managed(Declaration).init(alloc);
    try enums.ensureTotalCapacity(group_cap);
    var modules = std.array_list.Managed(Declaration).init(alloc);
    try modules.ensureTotalCapacity(group_cap);
    var exports = std.array_list.Managed(Declaration).init(alloc);
    try exports.ensureTotalCapacity(group_cap);

    for (declarations) |d| {
        switch (d.kind) {
            .import_decl => try imports.append(d),
            .function_decl => try functions.append(d),
            .variable_decl => try variables.append(d),
            .interface_decl => try interfaces.append(d),
            .type_decl => try type_decls.append(d),
            .class_decl => try classes.append(d),
            .enum_decl => try enums.append(d),
            .module_decl, .namespace_decl => try modules.append(d),
            .export_decl => try exports.append(d),
            .unknown_decl => {},
        }
    }

    // Parse exports to track exported items
    var exported_items = std.StringHashMap(void).init(alloc);
    try exported_items.ensureTotalCapacity(@intCast(@max(exports.items.len * 4, 8)));
    var type_export_stmts = std.array_list.Managed([]const u8).init(alloc);
    try type_export_stmts.ensureTotalCapacity(@max(exports.items.len / 2, 2));
    var value_export_stmts = std.array_list.Managed([]const u8).init(alloc);
    try value_export_stmts.ensureTotalCapacity(@max(exports.items.len / 2, 2));
    var default_exports = std.array_list.Managed([]const u8).init(alloc);
    var seen_exports = std.StringHashMap(void).init(alloc);
    try seen_exports.ensureTotalCapacity(@intCast(@max(exports.items.len, 4)));

    // Reusable buffer for building export statements (avoids per-iteration alloc)
    var stmt_buf = std.array_list.Managed(u8).init(alloc);
    try stmt_buf.ensureTotalCapacity(256);

    for (exports.items) |decl| {
        const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

        if (ch.startsWith(decl.text, "export default")) {
            stmt_buf.clearRetainingCapacity();
            try stmt_buf.appendSlice(comments);
            try stmt_buf.appendSlice(decl.text);
            if (!ch.endsWith(decl.text, ";")) try stmt_buf.append(';');
            try default_exports.append(try stmt_buf.toOwnedSlice());
        } else {
            var export_text = ch.sliceTrimmed(decl.text, 0, decl.text.len);
            // Ensure semicolon
            if (!ch.endsWith(export_text, ";")) {
                stmt_buf.clearRetainingCapacity();
                try stmt_buf.appendSlice(export_text);
                try stmt_buf.append(';');
                export_text = try stmt_buf.toOwnedSlice();
            }

            // Extract exported items for tracking
            // Look for export { items } or export type { items }
            if (ch.indexOfChar(export_text, '{', 0)) |brace_s| {
                if (ch.indexOfChar(export_text, '}', brace_s)) |brace_e| {
                    const items_str = export_text[brace_s + 1 .. brace_e];
                    var iter = std.mem.splitSequence(u8, items_str, ",");
                    while (iter.next()) |item| {
                        const trimmed_item = ch.sliceTrimmed(item, 0, item.len);
                        if (trimmed_item.len > 0) {
                            try exported_items.put(trimmed_item, {});
                        }
                    }
                }
            }

            stmt_buf.clearRetainingCapacity();
            try stmt_buf.appendSlice(comments);
            try stmt_buf.appendSlice(export_text);
            const full_text = try stmt_buf.toOwnedSlice();

            const gop = try seen_exports.getOrPut(full_text);
            if (!gop.found_existing) {
                if (ch.contains(full_text, "export type")) {
                    try type_export_stmts.append(full_text);
                } else {
                    try value_export_stmts.append(full_text);
                }
            }
        }
    }

    // Short-circuit: skip combined_words building and import map when there are no imports.
    // For import-free code (e.g. synthetic benchmarks), this avoids O(n) word
    // extraction across all declarations — a significant saving on large inputs.
    var interface_references = std.StringHashMap(void).init(alloc);
    var processed_imports = std.array_list.Managed([]const u8).init(alloc);

    if (imports.items.len > 0) {
        // Build import-item-to-declaration map (only when imports exist)
        const ImportDeclMap = std.StringHashMap(Declaration);
        var all_imported_items_map = ImportDeclMap.init(alloc);
        try all_imported_items_map.ensureTotalCapacity(@intCast(@max(imports.items.len * 4, 8)));
        for (imports.items) |imp| {
            const items = extractAllImportedItems(imp);
            for (items) |item| {
                try all_imported_items_map.put(item, imp);
            }
        }
        // Build combined word set for interface reference detection AND import filtering.
        // Single pass over all declarations instead of 7 separate loops per group.
        var combined_words = std.StringHashMap(void).init(alloc);
        try combined_words.ensureTotalCapacity(@intCast(@max(declarations.len * 4, 128)));
        for (declarations) |d| {
            switch (d.kind) {
                .function_decl => {
                    if (d.is_exported) extractWords(&combined_words, d.text);
                },
                .variable_decl => {
                    if (d.is_exported) {
                        extractWords(&combined_words, d.text);
                        if (d.type_annotation.len > 0)
                            extractWords(&combined_words, d.type_annotation);
                    }
                },
                .type_decl, .class_decl, .enum_decl, .module_decl, .namespace_decl, .export_decl => {
                    extractWords(&combined_words, d.text);
                },
                .interface_decl, .import_decl, .unknown_decl => {},
            }
        }

        // Interface reference detection
        try interface_references.ensureTotalCapacity(@intCast(@max(interfaces.items.len, 4)));
        if (interfaces.items.len > 0 and combined_words.count() > 0) {
            for (interfaces.items) |iface| {
                if (combined_words.contains(iface.name)) {
                    try interface_references.put(iface.name, {});
                }
            }
        }

        // Add interface text to combined_words (after ref detection, before import filtering)
        for (interfaces.items) |iface| {
            if (iface.is_exported or interface_references.contains(iface.name)) {
                extractWords(&combined_words, iface.text);
            }
        }
        var used_import_items = std.StringHashMap(void).init(alloc);
        try used_import_items.ensureTotalCapacity(@intCast(@max(imports.items.len * 4, 8)));

        if (combined_words.count() > 0) {
            var map_iter = all_imported_items_map.keyIterator();
            while (map_iter.next()) |key_ptr| {
                if (combined_words.contains(key_ptr.*)) {
                    try used_import_items.put(key_ptr.*, {});
                }
            }
        }

        // Check re-exports
        var exp_iter = exported_items.keyIterator();
        while (exp_iter.next()) |key_ptr| {
            if (all_imported_items_map.contains(key_ptr.*)) {
                try used_import_items.put(key_ptr.*, {});
            }
        }

        // Filter and rebuild imports
        try processed_imports.ensureTotalCapacity(imports.items.len);
        // Reusable buffer for building import statements
        var import_buf = std.array_list.Managed(u8).init(alloc);
        try import_buf.ensureTotalCapacity(256);
        var used_named = std.array_list.Managed([]const u8).init(alloc);
        try used_named.ensureTotalCapacity(16);

        for (imports.items) |imp| {
            // Preserve side-effect imports
            if (imp.is_side_effect) {
                const trimmed_imp = ch.sliceTrimmed(imp.text, 0, imp.text.len);
                import_buf.clearRetainingCapacity();
                try import_buf.appendSlice(trimmed_imp);
                if (!ch.endsWith(trimmed_imp, ";")) try import_buf.append(';');
                try processed_imports.append(try import_buf.toOwnedSlice());
                continue;
            }

            const parsed = getParsedImport(imp) orelse continue;

            const used_default = if (parsed.default_name) |dn| used_import_items.contains(dn) else false;
            used_named.clearRetainingCapacity();

            for (parsed.named_items) |item| {
                var clean_item = item;
                if (ch.startsWith(clean_item, "type ")) {
                    clean_item = ch.sliceTrimmed(clean_item, 5, clean_item.len);
                }
                if (ch.indexOf(clean_item, " as ", 0)) |as_idx| {
                    clean_item = ch.sliceTrimmed(clean_item, as_idx + 4, clean_item.len);
                }
                if (used_import_items.contains(clean_item)) {
                    try used_named.append(item);
                }
            }

            if (used_default or used_named.items.len > 0) {
                import_buf.clearRetainingCapacity();
                if (parsed.is_type_only) {
                    try import_buf.appendSlice("import type ");
                } else {
                    try import_buf.appendSlice("import ");
                }

                if (used_default) {
                    if (parsed.default_name) |dn| try import_buf.appendSlice(dn);
                    if (used_named.items.len > 0) {
                        try import_buf.appendSlice(", { ");
                        for (used_named.items, 0..) |ni, idx| {
                            if (idx > 0) try import_buf.appendSlice(", ");
                            try import_buf.appendSlice(ni);
                        }
                        try import_buf.appendSlice(" }");
                    }
                } else if (used_named.items.len > 0) {
                    try import_buf.appendSlice("{ ");
                    for (used_named.items, 0..) |ni, idx| {
                        if (idx > 0) try import_buf.appendSlice(", ");
                        try import_buf.appendSlice(ni);
                    }
                    try import_buf.appendSlice(" }");
                }

                try import_buf.appendSlice(" from '");
                try import_buf.appendSlice(parsed.source);
                try import_buf.appendSlice("';");

                try processed_imports.append(try import_buf.toOwnedSlice());
            }
        }

        // Sort imports by priority then locale-aware alphabetical
        if (processed_imports.items.len > 1) {
            const SortCtx = struct {
                import_order_items: []const []const u8,
                default_priority: usize,

                pub fn priority(self: @This(), imp: []const u8) usize {
                    for (self.import_order_items, 0..) |p, idx| {
                        var found = false;
                        if (ch.indexOf(imp, "from '", 0)) |fi| {
                            if (ch.indexOf(imp, p, fi + 6) != null) found = true;
                        }
                        if (!found) {
                            if (ch.indexOf(imp, "from \"", 0)) |fi| {
                                if (ch.indexOf(imp, p, fi + 6) != null) found = true;
                            }
                        }
                        if (found) return idx;
                    }
                    return self.default_priority;
                }

                /// Locale-aware char sort key: symbols < digits < letters
                /// Matches JavaScript's localeCompare behavior
                fn charSortKey(c_val: u8) u32 {
                    if (c_val >= 'a' and c_val <= 'z') return @as(u32, c_val - 'a') * 4 + 1000;
                    if (c_val >= 'A' and c_val <= 'Z') return @as(u32, c_val - 'A') * 4 + 1001;
                    if (c_val >= '0' and c_val <= '9') return @as(u32, c_val - '0') + 500;
                    return @as(u32, c_val);
                }

                pub fn localeCompare(_: @This(), a: []const u8, b: []const u8) bool {
                    const min_len = @min(a.len, b.len);
                    for (0..min_len) |i| {
                        const ak = charSortKey(a[i]);
                        const bk = charSortKey(b[i]);
                        if (ak != bk) return ak < bk;
                    }
                    return a.len < b.len;
                }
            };

            const ctx = SortCtx{
                .import_order_items = import_order,
                .default_priority = import_order.len,
            };

            std.mem.sort([]const u8, processed_imports.items, ctx, struct {
                fn lessThan(c_ctx: SortCtx, a: []const u8, b: []const u8) bool {
                    const ap = c_ctx.priority(a);
                    const bp = c_ctx.priority(b);
                    if (ap != bp) return ap < bp;
                    return c_ctx.localeCompare(a, b);
                }
            }.lessThan);
        }
    }

    // Emit imports
    for (processed_imports.items) |imp| {
        if (result.items.len > 0) try result.append('\n');
        try result.appendSlice(imp);
    }

    // Emit type exports
    for (type_export_stmts.items) |stmt| {
        if (result.items.len > 0) try result.append('\n');
        try result.appendSlice(stmt);
    }

    // Emit declaration groups: functions, variables, interfaces, types, classes, enums, modules
    const decl_groups = [_]struct { items: []const Declaration, kind_tag: u8 }{
        .{ .items = functions.items, .kind_tag = 'f' },
        .{ .items = variables.items, .kind_tag = 'v' },
        .{ .items = interfaces.items, .kind_tag = 'i' },
        .{ .items = type_decls.items, .kind_tag = 't' },
        .{ .items = classes.items, .kind_tag = 'c' },
        .{ .items = enums.items, .kind_tag = 'e' },
        .{ .items = modules.items, .kind_tag = 'm' },
    };

    for (decl_groups) |group| {
        for (group.items) |decl| {
            switch (decl.kind) {
                .function_decl, .class_decl => {
                    // Direct emit: write comments + text straight to result buffer
                    // avoiding intermediate allocation + double copy
                    if (decl.text.len == 0) continue;
                    if (result.items.len > 0) try result.append('\n');
                    if (keep_comments) {
                        if (decl.leading_comments) |cmts| {
                            if (cmts.len > 0) {
                                const comments = try formatComments(alloc, cmts, true);
                                if (comments.len > 0) try result.appendSlice(comments);
                            }
                        }
                    }
                    try result.appendSlice(decl.text);
                },
                .variable_decl => {
                    const processed = try processVariableDeclaration(alloc, decl, keep_comments);
                    if (processed.len > 0) {
                        if (result.items.len > 0) try result.append('\n');
                        try result.appendSlice(processed);
                    }
                },
                .interface_decl => {
                    // Fast path: text already has correct keywords → direct emit
                    if (decl.text.len > 0 and (ch.startsWith(decl.text, "export declare interface") or
                        ch.startsWith(decl.text, "declare interface")))
                    {
                        if (result.items.len > 0) try result.append('\n');
                        if (keep_comments) {
                            if (decl.leading_comments) |cmts| {
                                if (cmts.len > 0) {
                                    const comments = try formatComments(alloc, cmts, true);
                                    if (comments.len > 0) try result.appendSlice(comments);
                                }
                            }
                        }
                        try result.appendSlice(decl.text);
                    } else {
                        const processed = try processInterfaceDeclaration(alloc, decl, keep_comments);
                        if (processed.len > 0) {
                            if (result.items.len > 0) try result.append('\n');
                            try result.appendSlice(processed);
                        }
                    }
                },
                .type_decl => {
                    const processed = try processTypeDeclaration(alloc, decl, keep_comments);
                    if (processed.len > 0) {
                        if (result.items.len > 0) try result.append('\n');
                        try result.appendSlice(processed);
                    }
                },
                .enum_decl => {
                    // Fast path: text already has correct keywords → direct emit
                    if (decl.text.len > 0 and ch.startsWith(decl.text, "declare ")) {
                        if (result.items.len > 0) try result.append('\n');
                        if (keep_comments) {
                            if (decl.leading_comments) |cmts| {
                                if (cmts.len > 0) {
                                    const comments = try formatComments(alloc, cmts, true);
                                    if (comments.len > 0) try result.appendSlice(comments);
                                }
                            }
                        }
                        if (decl.is_exported) try result.appendSlice("export ");
                        try result.appendSlice(decl.text);
                    } else {
                        const processed = try processEnumDeclaration(alloc, decl, keep_comments);
                        if (processed.len > 0) {
                            if (result.items.len > 0) try result.append('\n');
                            try result.appendSlice(processed);
                        }
                    }
                },
                .module_decl, .namespace_decl => {
                    // Fast path: text already has correct keywords → direct emit
                    if (decl.text.len > 0 and (ch.startsWith(decl.text, "export declare namespace") or
                        ch.startsWith(decl.text, "declare namespace") or
                        ch.startsWith(decl.text, "declare module")))
                    {
                        if (result.items.len > 0) try result.append('\n');
                        if (keep_comments) {
                            if (decl.leading_comments) |cmts| {
                                if (cmts.len > 0) {
                                    const comments = try formatComments(alloc, cmts, true);
                                    if (comments.len > 0) try result.appendSlice(comments);
                                }
                            }
                        }
                        try result.appendSlice(decl.text);
                    } else {
                        const processed = try processModuleDeclaration(alloc, decl, keep_comments);
                        if (processed.len > 0) {
                            if (result.items.len > 0) try result.append('\n');
                            try result.appendSlice(processed);
                        }
                    }
                },
                else => {},
            }
        }
    }

    // Emit value exports
    for (value_export_stmts.items) |stmt| {
        if (result.items.len > 0) try result.append('\n');
        try result.appendSlice(stmt);
    }

    // Emit default exports last
    for (default_exports.items) |stmt| {
        if (result.items.len > 0) try result.append('\n');
        try result.appendSlice(stmt);
    }

    // Append null terminator so FFI callers get a C string without extra copy.
    // Returned slice length does NOT include the null byte.
    const content_len = result.items.len;
    try result.append(0);
    const owned = try result.toOwnedSlice();
    return owned[0..content_len];
}

// --- Tests ---
test "isWordInText" {
    try std.testing.expect(isWordInText("Foo", "const x: Foo = 1"));
    try std.testing.expect(!isWordInText("Foo", "const x: FooBar = 1"));
    try std.testing.expect(isWordInText("Bar", "type X = Bar | Baz"));
    try std.testing.expect(!isWordInText("ar", "type X = Bar | Baz"));
}

test "extractTripleSlashDirectives" {
    const alloc = std.testing.allocator;
    {
        const source = "/// <reference types=\"node\" />\nimport { foo } from 'bar';";
        const directives = try extractTripleSlashDirectives(alloc, source);
        defer alloc.free(directives);
        try std.testing.expectEqual(@as(usize, 1), directives.len);
        try std.testing.expectEqualStrings("/// <reference types=\"node\" />", directives[0]);
    }
}
