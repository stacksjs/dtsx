/// Emitter module — converts declarations to final .d.ts output.
/// Port of processor/index.ts.
const std = @import("std");
const ch = @import("char_utils.zig");
const types = @import("types.zig");
const type_inf = @import("type_inference.zig");
const Declaration = types.Declaration;
const DeclarationKind = types.DeclarationKind;

/// Check if a character is an identifier character (for word boundary checks)
fn isIdentChar(c: u8) bool {
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

/// Format leading comments
fn formatComments(alloc: std.mem.Allocator, comments: ?[]const []const u8, keep_comments: bool) ![]const u8 {
    if (!keep_comments) return "";
    const cmts = comments orelse return "";
    if (cmts.len == 0) return "";

    var result = std.array_list.Managed(u8).init(alloc);
    if (cmts.len == 1) {
        const t = ch.sliceTrimmed(cmts[0], 0, cmts[0].len);
        try result.appendSlice(t);
        try result.append('\n');
        return result.toOwnedSlice();
    }

    for (cmts, 0..) |c, idx| {
        if (idx > 0) try result.append('\n');
        const t = ch.sliceTrimmed(c, 0, c.len);
        try result.appendSlice(t);
    }
    try result.append('\n');
    return result.toOwnedSlice();
}

/// Parse import statement to extract components
fn parseImportStatement(alloc: std.mem.Allocator, import_text: []const u8) !?struct {
    default_name: ?[]const u8,
    named_items: [][]const u8,
    source: []const u8,
    is_type_only: bool,
} {
    // Find 'from' and extract source
    const from_idx = ch.indexOf(import_text, " from ", 0) orelse return null;

    // Extract source between quotes
    var after_from_start = from_idx + 6;
    while (after_from_start < import_text.len and ch.isWhitespace(import_text[after_from_start])) after_from_start += 1;
    if (after_from_start >= import_text.len) return null;

    const quote_char = import_text[after_from_start];
    if (quote_char != '"' and quote_char != '\'') return null;

    const end_quote = ch.indexOfChar(import_text, quote_char, after_from_start + 1) orelse return null;
    const source = import_text[after_from_start + 1 .. end_quote];

    // Parse the import part (before 'from')
    var import_part = ch.sliceTrimmed(import_text, 0, from_idx);

    // Check for 'import type'
    var is_type_only = false;
    if (ch.startsWith(import_part, "import type ")) {
        is_type_only = true;
        import_part = ch.sliceTrimmed(import_part, 12, import_part.len);
    } else if (ch.startsWith(import_part, "import ")) {
        import_part = ch.sliceTrimmed(import_part, 7, import_part.len);
    }

    // Handle 'type ' prefix after removing 'import'
    if (ch.startsWith(import_part, "type ")) {
        import_part = ch.sliceTrimmed(import_part, 5, import_part.len);
    }

    var default_name: ?[]const u8 = null;
    var named_items = std.array_list.Managed([]const u8).init(alloc);

    // Check for braces
    const brace_start = ch.indexOfChar(import_part, '{', 0);
    const brace_end = std.mem.lastIndexOf(u8, import_part, "}");

    if (brace_start != null and brace_end != null) {
        const bs = brace_start.?;
        const be = brace_end.?;

        // Check for default import before braces
        if (bs > 0) {
            var before_brace = ch.sliceTrimmed(import_part, 0, bs);
            if (before_brace.len > 0 and before_brace[before_brace.len - 1] == ',') {
                before_brace = ch.sliceTrimmed(before_brace, 0, before_brace.len - 1);
                if (before_brace.len > 0) default_name = before_brace;
            }
        }

        // Extract named imports
        const named_part = import_part[bs + 1 .. be];
        var iter = std.mem.splitSequence(u8, named_part, ",");
        while (iter.next()) |item| {
            const trimmed = ch.sliceTrimmed(item, 0, item.len);
            if (trimmed.len > 0) {
                try named_items.append(trimmed);
            }
        }
    } else {
        // Default import only
        if (import_part.len > 0) default_name = import_part;
    }

    return .{
        .default_name = default_name,
        .named_items = try named_items.toOwnedSlice(),
        .source = source,
        .is_type_only = is_type_only,
    };
}

/// Extract all imported item names from an import statement (for filtering)
fn extractAllImportedItems(alloc: std.mem.Allocator, import_text: []const u8) ![][]const u8 {
    var items = std.array_list.Managed([]const u8).init(alloc);

    const from_idx = ch.indexOf(import_text, " from ", 0) orelse return items.toOwnedSlice();

    var import_part = ch.sliceTrimmed(import_text, 0, from_idx);

    // Remove 'import' and optional 'type'
    if (ch.startsWith(import_part, "import ")) {
        import_part = ch.sliceTrimmed(import_part, 7, import_part.len);
    }
    if (ch.startsWith(import_part, "type ")) {
        import_part = ch.sliceTrimmed(import_part, 5, import_part.len);
    }

    const brace_start = ch.indexOfChar(import_part, '{', 0);
    const brace_end = std.mem.lastIndexOf(u8, import_part, "}");

    if (brace_start != null and brace_end != null) {
        const bs = brace_start.?;
        const be = brace_end.?;

        // Default before braces
        if (bs > 0) {
            var before = ch.sliceTrimmed(import_part, 0, bs);
            if (before.len > 0 and before[before.len - 1] == ',') {
                before = ch.sliceTrimmed(before, 0, before.len - 1);
            }
            if (before.len > 0 and !ch.contains(before, ",")) {
                try items.append(before);
            }
        }

        // Named imports
        const named_part = import_part[bs + 1 .. be];
        var iter = std.mem.splitSequence(u8, named_part, ",");
        while (iter.next()) |raw_item| {
            var trimmed = ch.sliceTrimmed(raw_item, 0, raw_item.len);
            if (trimmed.len == 0) continue;
            // Remove 'type ' prefix
            if (ch.startsWith(trimmed, "type ")) {
                trimmed = ch.sliceTrimmed(trimmed, 5, trimmed.len);
            }
            // Handle 'as' alias
            if (ch.indexOf(trimmed, " as ", 0)) |as_idx| {
                trimmed = ch.sliceTrimmed(trimmed, as_idx + 4, trimmed.len);
            }
            if (trimmed.len > 0) try items.append(trimmed);
        }
    } else {
        // Default import only
        if (import_part.len > 0) try items.append(import_part);
    }

    return items.items;
}

/// Process a variable declaration for DTS output
fn processVariableDeclaration(alloc: std.mem.Allocator, decl: Declaration, keep_comments: bool) ![]const u8 {
    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

    // Fast path: if we have type annotation and no value needing special inference
    if (decl.type_annotation.len > 0 and decl.value.len == 0) {
        var result = std.array_list.Managed(u8).init(alloc);
        try result.appendSlice(comments);
        try result.appendSlice(decl.text);
        return result.toOwnedSlice();
    }

    var result = std.array_list.Managed(u8).init(alloc);
    try result.ensureTotalCapacity(comments.len + decl.name.len + decl.type_annotation.len + decl.value.len + 32);
    try result.appendSlice(comments);

    if (decl.is_exported) try result.appendSlice("export ");
    try result.appendSlice("declare ");

    // Variable kind from modifiers
    const kind: []const u8 = if (decl.modifiers) |mods| (if (mods.len > 0) mods[0] else "const") else "const";
    try result.appendSlice(kind);
    try result.append(' ');
    try result.appendSlice(decl.name);

    // Determine type annotation
    var type_annotation: []const u8 = decl.type_annotation;

    if (decl.value.len > 0 and ch.contains(decl.value, " satisfies ")) {
        if (type_inf.extractSatisfiesType(decl.value)) |sat_type| {
            type_annotation = sat_type;
        }
    } else if (decl.value.len > 0 and ch.endsWith(std.mem.trim(u8, decl.value, " \t\n\r"), "as const")) {
        type_annotation = try type_inf.inferNarrowType(alloc, decl.value, true, false, 0);
    } else if (type_annotation.len == 0 and decl.value.len > 0 and std.mem.eql(u8, kind, "const")) {
        // Containers (objects/arrays) get widened types (sound: properties/elements are mutable)
        // Scalars keep narrow literal types (sound: const binding is immutable)
        const trimmed_val = std.mem.trim(u8, decl.value, " \t\n\r");
        const is_container = trimmed_val.len > 0 and (trimmed_val[0] == '{' or trimmed_val[0] == '[');
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
            // let/var with widened primitives
            const is_widened = std.mem.eql(u8, type_annotation, "string") or
                std.mem.eql(u8, type_annotation, "number") or
                std.mem.eql(u8, type_annotation, "boolean");
            if (is_widened and trimmed_val.len > 0) {
                default_val = trimmed_val;
            }
        } else if (trimmed_val.len > 0 and (trimmed_val[0] == '{' or trimmed_val[0] == '[')) {
            // const containers — clean @defaultValue with only primitive/simple values
            default_val = try type_inf.buildCleanDefault(alloc, trimmed_val);
            is_container = true;
        }

        // Skip generated @defaultValue if user already has one
        if (std.mem.indexOf(u8, comments, "@defaultValue") != null) {
            default_val = null;
        }

        if (default_val) |dv| {
            // Build the @defaultValue tag content
            var tag_buf = std.array_list.Managed(u8).init(alloc);
            if (std.mem.indexOf(u8, dv, "\n")) |_| {
                // Multi-line: use code fence (TSDoc standard)
                try tag_buf.appendSlice("@defaultValue\n * ```ts\n");
                var line_iter = std.mem.splitScalar(u8, dv, '\n');
                while (line_iter.next()) |line| {
                    try tag_buf.appendSlice(" * ");
                    try tag_buf.appendSlice(line);
                    try tag_buf.append('\n');
                }
                try tag_buf.appendSlice(" * ```");
            } else if (is_container) {
                try tag_buf.appendSlice("@defaultValue `");
                try tag_buf.appendSlice(dv);
                try tag_buf.append('`');
            } else {
                try tag_buf.appendSlice("@defaultValue ");
                try tag_buf.appendSlice(dv);
            }
            const default_tag = try tag_buf.toOwnedSlice();

            var rebuilt = std.array_list.Managed(u8).init(alloc);

            // Try to merge into existing JSDoc comment block
            const closing_idx = std.mem.lastIndexOf(u8, comments, "*/");
            if (closing_idx != null and comments.len > 0) {
                // Inject @defaultValue before closing */
                const before_raw = comments[0..closing_idx.?];
                // Trim trailing whitespace from before
                var end = before_raw.len;
                while (end > 0 and (before_raw[end - 1] == ' ' or before_raw[end - 1] == '\t' or before_raw[end - 1] == '\n' or before_raw[end - 1] == '\r')) : (end -= 1) {}
                const before = before_raw[0..end];
                // Convert single-line `/** text` to multi-line `/**\n * text`
                if (before.len > 4 and ch.startsWith(before, "/** ") and std.mem.indexOf(u8, before, "\n") == null) {
                    try rebuilt.appendSlice("/**\n * ");
                    try rebuilt.appendSlice(before[4..]);
                } else {
                    try rebuilt.appendSlice(before);
                }
                try rebuilt.appendSlice("\n * ");
                try rebuilt.appendSlice(default_tag);
                try rebuilt.appendSlice("\n */\n");
            } else if (comments.len > 0) {
                // Line comment (// ...) — convert to JSDoc block and merge
                const trimmed_cmt = std.mem.trim(u8, comments, " \t\n\r");
                // Strip leading "// " prefix
                const cmt_text = if (ch.startsWith(trimmed_cmt, "// "))
                    trimmed_cmt[3..]
                else if (ch.startsWith(trimmed_cmt, "//"))
                    trimmed_cmt[2..]
                else
                    trimmed_cmt;
                try rebuilt.appendSlice("/**\n * ");
                try rebuilt.appendSlice(cmt_text);
                try rebuilt.appendSlice("\n * ");
                try rebuilt.appendSlice(default_tag);
                try rebuilt.appendSlice("\n */\n");
            } else {
                // No existing comments — create standalone JSDoc
                if (std.mem.indexOf(u8, default_tag, "\n") != null) {
                    try rebuilt.appendSlice("/**\n * ");
                    try rebuilt.appendSlice(default_tag);
                    try rebuilt.appendSlice("\n */\n");
                } else {
                    try rebuilt.appendSlice("/** ");
                    try rebuilt.appendSlice(default_tag);
                    try rebuilt.appendSlice(" */\n");
                }
            }

            if (decl.is_exported) try rebuilt.appendSlice("export ");
            try rebuilt.appendSlice("declare ");
            try rebuilt.appendSlice(kind);
            try rebuilt.append(' ');
            try rebuilt.appendSlice(decl.name);
            try rebuilt.appendSlice(": ");
            try rebuilt.appendSlice(type_annotation);
            try rebuilt.append(';');
            return rebuilt.toOwnedSlice();
        }
    }

    try result.appendSlice(": ");
    try result.appendSlice(type_annotation);
    try result.append(';');

    return result.toOwnedSlice();
}

/// Process an interface declaration for DTS output
fn processInterfaceDeclaration(alloc: std.mem.Allocator, decl: Declaration, keep_comments: bool) ![]const u8 {
    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

    // If the text already starts with proper keywords, use it
    if (ch.startsWith(decl.text, "export declare interface") or ch.startsWith(decl.text, "declare interface")) {
        var result = std.array_list.Managed(u8).init(alloc);
        try result.appendSlice(comments);
        try result.appendSlice(decl.text);
        return result.toOwnedSlice();
    }

    var result = std.array_list.Managed(u8).init(alloc);
    try result.appendSlice(comments);

    if (decl.is_exported) try result.appendSlice("export ");
    try result.appendSlice("declare interface ");
    try result.appendSlice(decl.name);

    if (decl.generics.len > 0) try result.appendSlice(decl.generics);
    if (decl.extends_clause.len > 0) {
        try result.appendSlice(" extends ");
        try result.appendSlice(decl.extends_clause);
    }

    // Find body brace
    if (ch.indexOfChar(decl.text, '{', 0)) |brace_idx| {
        try result.append(' ');
        try result.appendSlice(decl.text[brace_idx..]);
    } else {
        try result.appendSlice(" {}");
    }

    return result.toOwnedSlice();
}

/// Process a type alias declaration for DTS output
fn processTypeDeclaration(alloc: std.mem.Allocator, decl: Declaration, keep_comments: bool) ![]const u8 {
    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

    var result = std.array_list.Managed(u8).init(alloc);
    try result.appendSlice(comments);

    if (decl.is_exported) try result.appendSlice("export ");
    if (!decl.is_exported and !ch.contains(decl.text, " from ")) {
        try result.appendSlice("declare ");
    }

    // Extract type definition from original text
    if (ch.indexOf(decl.text, "type ", 0)) |type_idx| {
        var type_def = decl.text[type_idx..];
        // Strip trailing semicolons and whitespace
        var end = type_def.len;
        while (end > 0 and (type_def[end - 1] == ';' or type_def[end - 1] == ' ' or type_def[end - 1] == '\n' or type_def[end - 1] == '\r')) end -= 1;
        type_def = type_def[0..end];
        try result.appendSlice(type_def);
    } else {
        try result.appendSlice("type ");
        try result.appendSlice(decl.name);
        if (decl.generics.len > 0) try result.appendSlice(decl.generics);
        try result.appendSlice(" = any");
    }

    // Ensure semicolon
    const trimmed_end = result.items;
    if (trimmed_end.len > 0 and trimmed_end[trimmed_end.len - 1] != ';' and trimmed_end[trimmed_end.len - 1] != '}') {
        try result.append(';');
    }

    return result.toOwnedSlice();
}

/// Process an enum declaration for DTS output
fn processEnumDeclaration(alloc: std.mem.Allocator, decl: Declaration, keep_comments: bool) ![]const u8 {
    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

    var result = std.array_list.Managed(u8).init(alloc);
    try result.appendSlice(comments);

    if (decl.is_exported) try result.appendSlice("export ");
    try result.appendSlice("declare ");

    // Check for const modifier
    if (decl.modifiers) |mods| {
        for (mods) |m| {
            if (std.mem.eql(u8, m, "const")) {
                try result.appendSlice("const ");
                break;
            }
        }
    }

    try result.appendSlice("enum ");
    try result.appendSlice(decl.name);

    // Extract body
    if (ch.indexOfChar(decl.text, '{', 0)) |brace_idx| {
        try result.append(' ');
        try result.appendSlice(decl.text[brace_idx..]);
    } else {
        try result.appendSlice(" {}");
    }

    return result.toOwnedSlice();
}

/// Process a module/namespace declaration for DTS output
fn processModuleDeclaration(alloc: std.mem.Allocator, decl: Declaration, keep_comments: bool) ![]const u8 {
    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

    // Global augmentation
    if (ch.startsWith(decl.text, "declare global")) {
        var result = std.array_list.Managed(u8).init(alloc);
        try result.appendSlice(comments);
        try result.appendSlice(decl.text);
        return result.toOwnedSlice();
    }

    // Ambient module (quoted name)
    const is_ambient = decl.source_module.len > 0 or
        (decl.name.len > 0 and (decl.name[0] == '"' or decl.name[0] == '\'' or decl.name[0] == '`'));

    if (is_ambient) {
        var result = std.array_list.Managed(u8).init(alloc);
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

/// Main entry point: process declarations array into final .d.ts output
pub fn processDeclarations(
    alloc: std.mem.Allocator,
    declarations: []const Declaration,
    source_code: []const u8,
    keep_comments: bool,
    import_order: []const []const u8,
) ![]const u8 {
    var result = std.array_list.Managed(u8).init(alloc);
    try result.ensureTotalCapacity(source_code.len / 2);

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

    // Group declarations by type
    var imports = std.array_list.Managed(Declaration).init(alloc);
    var functions = std.array_list.Managed(Declaration).init(alloc);
    var variables = std.array_list.Managed(Declaration).init(alloc);
    var interfaces = std.array_list.Managed(Declaration).init(alloc);
    var type_decls = std.array_list.Managed(Declaration).init(alloc);
    var classes = std.array_list.Managed(Declaration).init(alloc);
    var enums = std.array_list.Managed(Declaration).init(alloc);
    var modules = std.array_list.Managed(Declaration).init(alloc);
    var exports = std.array_list.Managed(Declaration).init(alloc);

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
    var value_export_stmts = std.array_list.Managed([]const u8).init(alloc);
    var default_exports = std.array_list.Managed([]const u8).init(alloc);
    var seen_exports = std.StringHashMap(void).init(alloc);
    try seen_exports.ensureTotalCapacity(@intCast(@max(exports.items.len, 4)));

    for (exports.items) |decl| {
        const comments = try formatComments(alloc, decl.leading_comments, keep_comments);

        if (ch.startsWith(decl.text, "export default")) {
            var stmt = std.array_list.Managed(u8).init(alloc);
            try stmt.appendSlice(comments);
            try stmt.appendSlice(decl.text);
            if (!ch.endsWith(decl.text, ";")) try stmt.append(';');
            try default_exports.append(try stmt.toOwnedSlice());
        } else {
            var export_text = ch.sliceTrimmed(decl.text, 0, decl.text.len);
            // Ensure semicolon
            var text_buf = std.array_list.Managed(u8).init(alloc);
            try text_buf.appendSlice(export_text);
            if (!ch.endsWith(export_text, ";")) try text_buf.append(';');
            export_text = try text_buf.toOwnedSlice();

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

            var full = std.array_list.Managed(u8).init(alloc);
            try full.appendSlice(comments);
            try full.appendSlice(export_text);
            const full_text = try full.toOwnedSlice();

            if (!seen_exports.contains(full_text)) {
                try seen_exports.put(full_text, {});
                if (ch.contains(full_text, "export type")) {
                    try type_export_stmts.append(full_text);
                } else {
                    try value_export_stmts.append(full_text);
                }
            }
        }
    }

    // Build import-item-to-declaration map
    const ImportDeclMap = std.StringHashMap(Declaration);
    var all_imported_items_map = ImportDeclMap.init(alloc);
    try all_imported_items_map.ensureTotalCapacity(@intCast(@max(imports.items.len * 4, 8)));
    for (imports.items) |imp| {
        const items = try extractAllImportedItems(alloc, imp.text);
        for (items) |item| {
            try all_imported_items_map.put(item, imp);
        }
    }

    // Build combined word set — used for BOTH interface reference detection
    // AND import usage filtering. Single pass over all declaration texts.
    var combined_words = std.StringHashMap(void).init(alloc);
    try combined_words.ensureTotalCapacity(128);
    for (functions.items) |func| {
        if (func.is_exported) extractWords(&combined_words, func.text);
    }
    for (variables.items) |variable| {
        if (variable.is_exported) {
            extractWords(&combined_words, variable.text);
            if (variable.type_annotation.len > 0) {
                extractWords(&combined_words, variable.type_annotation);
            }
        }
    }
    for (type_decls.items) |td| {
        extractWords(&combined_words, td.text);
    }
    for (classes.items) |cls| {
        extractWords(&combined_words, cls.text);
    }
    for (enums.items) |e| {
        extractWords(&combined_words, e.text);
    }
    for (modules.items) |m| {
        extractWords(&combined_words, m.text);
    }
    for (exports.items) |exp| {
        extractWords(&combined_words, exp.text);
    }

    // Interface reference detection using the combined word set
    var interface_references = std.StringHashMap(void).init(alloc);
    try interface_references.ensureTotalCapacity(@intCast(@max(interfaces.items.len, 4)));
    if (interfaces.items.len > 0 and combined_words.count() > 0) {
        for (interfaces.items) |iface| {
            if (combined_words.contains(iface.name)) {
                try interface_references.put(iface.name, {});
            }
        }
    }

    // Now add interface text to combined_words (after reference detection, before import filtering)
    for (interfaces.items) |iface| {
        if (iface.is_exported or interface_references.contains(iface.name)) {
            extractWords(&combined_words, iface.text);
        }
    }

    // Import usage detection using the same combined word set
    var processed_imports = std.array_list.Managed([]const u8).init(alloc);
    if (imports.items.len > 0) {
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
        for (imports.items) |imp| {
            // Preserve side-effect imports
            if (imp.is_side_effect) {
                const trimmed_imp = ch.sliceTrimmed(imp.text, 0, imp.text.len);
                var se_buf = std.array_list.Managed(u8).init(alloc);
                try se_buf.appendSlice(trimmed_imp);
                if (!ch.endsWith(trimmed_imp, ";")) try se_buf.append(';');
                try processed_imports.append(try se_buf.toOwnedSlice());
                continue;
            }

            const parsed = try parseImportStatement(alloc, imp.text) orelse continue;

            const used_default = if (parsed.default_name) |dn| used_import_items.contains(dn) else false;
            var used_named = std.array_list.Managed([]const u8).init(alloc);

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
                var import_stmt = std.array_list.Managed(u8).init(alloc);
                if (parsed.is_type_only) {
                    try import_stmt.appendSlice("import type ");
                } else {
                    try import_stmt.appendSlice("import ");
                }

                if (used_default) {
                    if (parsed.default_name) |dn| try import_stmt.appendSlice(dn);
                    if (used_named.items.len > 0) {
                        try import_stmt.appendSlice(", { ");
                        for (used_named.items, 0..) |ni, idx| {
                            if (idx > 0) try import_stmt.appendSlice(", ");
                            try import_stmt.appendSlice(ni);
                        }
                        try import_stmt.appendSlice(" }");
                    }
                } else if (used_named.items.len > 0) {
                    try import_stmt.appendSlice("{ ");
                    for (used_named.items, 0..) |ni, idx| {
                        if (idx > 0) try import_stmt.appendSlice(", ");
                        try import_stmt.appendSlice(ni);
                    }
                    try import_stmt.appendSlice(" }");
                }

                try import_stmt.appendSlice(" from '");
                try import_stmt.appendSlice(parsed.source);
                try import_stmt.appendSlice("';");

                try processed_imports.append(try import_stmt.toOwnedSlice());
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
            const processed = switch (decl.kind) {
                .function_decl => blk: {
                    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);
                    var buf = std.array_list.Managed(u8).init(alloc);
                    try buf.appendSlice(comments);
                    try buf.appendSlice(decl.text);
                    break :blk try buf.toOwnedSlice();
                },
                .variable_decl => try processVariableDeclaration(alloc, decl, keep_comments),
                .interface_decl => try processInterfaceDeclaration(alloc, decl, keep_comments),
                .type_decl => try processTypeDeclaration(alloc, decl, keep_comments),
                .class_decl => blk: {
                    const comments = try formatComments(alloc, decl.leading_comments, keep_comments);
                    var buf = std.array_list.Managed(u8).init(alloc);
                    try buf.appendSlice(comments);
                    try buf.appendSlice(decl.text);
                    break :blk try buf.toOwnedSlice();
                },
                .enum_decl => try processEnumDeclaration(alloc, decl, keep_comments),
                .module_decl, .namespace_decl => try processModuleDeclaration(alloc, decl, keep_comments),
                else => "",
            };

            if (processed.len > 0) {
                if (result.items.len > 0) try result.append('\n');
                try result.appendSlice(processed);
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

    return result.toOwnedSlice();
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
