/// Main scan loop - first-character dispatch for keyword detection.
/// Port of scanner.ts lines 2600-2994.
const std = @import("std");
const ch = @import("char_utils.zig");
const types = @import("types.zig");
const Scanner = @import("scanner.zig").Scanner;
const ext = @import("extractors.zig");
const Declaration = types.Declaration;

/// Main scan loop: iterate through source and extract declarations
pub fn scanMainLoop(s: *Scanner) !void {
    while (s.pos < s.len) {
        s.skipWhitespaceAndComments();
        if (s.pos >= s.len) break;

        const stmt_start = s.pos;
        const ch0 = s.source[s.pos];

        if (ch0 == 'i' and s.matchWord("import")) {
            const decl = ext.extractImport(s, stmt_start);
            try s.declarations.append(decl);
        } else if (ch0 == 'e' and s.matchWord("export")) {
            try handleExport(s, stmt_start);
        } else if (ch0 == 'd' and s.matchWord("declare")) {
            s.pos += 7;
            s.skipWhitespaceAndComments();
            ext.handleDeclare(s, stmt_start, false);
        } else if (ch0 == 'i' and s.matchWord("interface")) {
            const decl = ext.extractInterface(s, stmt_start, false);
            s.non_exported_types.put(decl.name, decl) catch {};
        } else if (ch0 == 't' and s.matchWord("type")) {
            const decl = ext.extractTypeAlias(s, stmt_start, false);
            s.non_exported_types.put(decl.name, decl) catch {};
            try s.declarations.append(decl);
        } else if (ch0 == 'f' and s.matchWord("function")) {
            s.skipToStatementEnd();
        } else if (ch0 == 'a') {
            if (s.matchWord("async")) {
                s.skipToStatementEnd();
            } else if (s.matchWord("abstract")) {
                s.pos += 8;
                s.skipWhitespaceAndComments();
                if (s.matchWord("class")) {
                    const decl = ext.extractClass(s, stmt_start, false, false);
                    s.non_exported_types.put(decl.name, decl) catch {};
                    try s.declarations.append(decl);
                } else {
                    s.skipToStatementEnd();
                }
            } else {
                s.pos += 1;
                s.skipToStatementEnd();
            }
        } else if (ch0 == 'c') {
            if (s.matchWord("class")) {
                const decl = ext.extractClass(s, stmt_start, false, false);
                s.non_exported_types.put(decl.name, decl) catch {};
                try s.declarations.append(decl);
            } else if (s.matchWord("const")) {
                const saved_pos = s.pos;
                s.pos += 5;
                s.skipWhitespaceAndComments();
                if (s.matchWord("enum")) {
                    s.pos = saved_pos + 5;
                    s.skipWhitespaceAndComments();
                    const decl = ext.extractEnum(s, stmt_start, false, true);
                    s.non_exported_types.put(decl.name, decl) catch {};
                    try s.declarations.append(decl);
                } else {
                    s.pos = saved_pos;
                    s.skipToStatementEnd();
                }
            } else {
                s.pos += 1;
                s.skipToStatementEnd();
            }
        } else if (ch0 == 'e' and s.matchWord("enum")) {
            const decl = ext.extractEnum(s, stmt_start, false, false);
            s.non_exported_types.put(decl.name, decl) catch {};
            try s.declarations.append(decl);
        } else if (ch0 == 'l' and s.matchWord("let")) {
            s.skipToStatementEnd();
        } else if (ch0 == 'v' and s.matchWord("var")) {
            s.skipToStatementEnd();
        } else if (ch0 == 'm' and s.matchWord("module")) {
            const decl = ext.extractModule(s, stmt_start, false, "module");
            try s.declarations.append(decl);
        } else if (ch0 == 'n' and s.matchWord("namespace")) {
            const decl = ext.extractModule(s, stmt_start, false, "namespace");
            try s.declarations.append(decl);
        } else {
            // Skip unknown top-level content
            if (ch0 == ch.CH_SQUOTE or ch0 == ch.CH_DQUOTE) {
                s.skipString(ch0);
                if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) s.pos += 1;
            } else if (ch0 == ch.CH_BACKTICK) {
                s.skipTemplateLiteral();
                if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) s.pos += 1;
            } else if (ch0 == ch.CH_AT) {
                // Decorator
                s.pos += 1;
                _ = s.readIdent();
                s.skipWhitespaceAndComments();
                if (s.pos < s.len and s.source[s.pos] == ch.CH_DOT) {
                    s.pos += 1;
                    _ = s.readIdent();
                    s.skipWhitespaceAndComments();
                }
                if (s.pos < s.len and s.source[s.pos] == ch.CH_LPAREN) {
                    _ = s.findMatchingClose(ch.CH_LPAREN, ch.CH_RPAREN);
                }
            } else {
                s.pos += 1;
                s.skipToStatementEnd();
            }
        }
    }
}

/// Handle `export ...` after `export` keyword
fn handleExport(s: *Scanner, stmt_start: usize) !void {
    s.pos += 6; // skip 'export'
    s.skipWhitespaceAndComments();
    if (s.pos >= s.len) return;
    const ech = s.source[s.pos];

    if (ech == 'd' and s.matchWord("default")) {
        s.pos += 7;
        s.skipWhitespaceAndComments();
        if (s.pos >= s.len) return;
        const dch = s.source[s.pos];

        if (dch == 'f' and s.matchWord("function")) {
            const decl = ext.extractFunction(s, stmt_start, true, false, true);
            if (decl) |d| try s.declarations.append(d);
        } else if (dch == 'a' and s.matchWord("async")) {
            s.pos += 5;
            s.skipWhitespaceAndComments();
            if (s.matchWord("function")) {
                const decl = ext.extractFunction(s, stmt_start, true, true, true);
                if (decl) |d| try s.declarations.append(d);
            } else {
                s.skipToStatementEnd();
                const full_text = s.sliceTrimmed(stmt_start, s.pos);
                try s.declarations.append(.{
                    .kind = .export_decl,
                    .name = "default",
                    .text = full_text,
                    .is_exported = true,
                    .start = stmt_start,
                    .end = s.pos,
                });
            }
        } else if (dch == 'c' and s.matchWord("class")) {
            const decl = ext.extractClass(s, stmt_start, true, false);
            try s.declarations.append(decl);
        } else if (dch == 'a' and s.matchWord("abstract")) {
            s.pos += 8;
            s.skipWhitespaceAndComments();
            if (s.matchWord("class")) {
                const decl = ext.extractClass(s, stmt_start, true, true);
                try s.declarations.append(decl);
            }
        } else {
            s.skipToStatementEnd();
            const text = s.sliceTrimmed(stmt_start, s.pos);
            const comments = ext.extractLeadingComments(s, stmt_start);
            try s.declarations.append(.{
                .kind = .export_decl,
                .name = "default",
                .text = text,
                .is_exported = true,
                .leading_comments = comments,
                .start = stmt_start,
                .end = s.pos,
            });
        }
    } else if (ech == 't' and s.matchWord("type")) {
        const saved_pos = s.pos;
        s.pos += 4;
        s.skipWhitespaceAndComments();
        if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) {
            s.skipExportBraces();
            const text = s.sliceTrimmed(stmt_start, s.pos);
            const comments = ext.extractLeadingComments(s, stmt_start);
            try s.declarations.append(.{
                .kind = .export_decl,
                .name = "",
                .text = text,
                .is_exported = true,
                .is_type_only = true,
                .leading_comments = comments,
                .start = stmt_start,
                .end = s.pos,
            });
        } else if (s.pos < s.len and s.source[s.pos] == ch.CH_STAR) {
            s.skipExportStar();
            const text = s.sliceTrimmed(stmt_start, s.pos);
            try s.declarations.append(.{
                .kind = .export_decl,
                .name = "",
                .text = text,
                .is_exported = true,
                .is_type_only = true,
                .start = stmt_start,
                .end = s.pos,
            });
        } else {
            s.pos = saved_pos;
            const decl = ext.extractTypeAlias(s, stmt_start, true);
            try s.declarations.append(decl);
        }
    } else if (ech == 'i' and s.matchWord("interface")) {
        const decl = ext.extractInterface(s, stmt_start, true);
        try s.declarations.append(decl);
    } else if (ech == 'f' and s.matchWord("function")) {
        const decl = ext.extractFunction(s, stmt_start, true, false, false);
        if (decl) |d| try s.declarations.append(d);
    } else if (ech == 'a' and s.matchWord("async")) {
        s.pos += 5;
        s.skipWhitespaceAndComments();
        if (s.matchWord("function")) {
            const decl = ext.extractFunction(s, stmt_start, true, true, false);
            if (decl) |d| try s.declarations.append(d);
        } else {
            s.skipToStatementEnd();
        }
    } else if (ech == 'c') {
        if (s.matchWord("class")) {
            const decl = ext.extractClass(s, stmt_start, true, false);
            try s.declarations.append(decl);
        } else if (s.matchWord("const")) {
            const saved_pos = s.pos;
            s.pos += 5;
            s.skipWhitespaceAndComments();
            if (s.matchWord("enum")) {
                s.pos = saved_pos + 5;
                s.skipWhitespaceAndComments();
                const decl = ext.extractEnum(s, stmt_start, true, true);
                try s.declarations.append(decl);
            } else {
                s.pos = saved_pos;
                const decls = ext.extractVariable(s, stmt_start, "const", true);
                for (decls) |d| try s.declarations.append(d);
            }
        } else {
            s.skipToStatementEnd();
        }
    } else if (ech == 'a' and s.matchWord("abstract")) {
        s.pos += 8;
        s.skipWhitespaceAndComments();
        if (s.matchWord("class")) {
            const decl = ext.extractClass(s, stmt_start, true, true);
            try s.declarations.append(decl);
        }
    } else if (ech == 'l' and s.matchWord("let")) {
        const decls = ext.extractVariable(s, stmt_start, "let", true);
        for (decls) |d| try s.declarations.append(d);
    } else if (ech == 'v' and s.matchWord("var")) {
        const decls = ext.extractVariable(s, stmt_start, "var", true);
        for (decls) |d| try s.declarations.append(d);
    } else if (ech == 'e' and s.matchWord("enum")) {
        const decl = ext.extractEnum(s, stmt_start, true, false);
        try s.declarations.append(decl);
    } else if (ech == 'd' and s.matchWord("declare")) {
        s.pos += 7;
        s.skipWhitespaceAndComments();
        ext.handleDeclare(s, stmt_start, true);
    } else if (ech == 'n' and s.matchWord("namespace")) {
        const decl = ext.extractModule(s, stmt_start, true, "namespace");
        try s.declarations.append(decl);
    } else if (ech == 'm' and s.matchWord("module")) {
        const decl = ext.extractModule(s, stmt_start, true, "module");
        try s.declarations.append(decl);
    } else if (ech == ch.CH_LBRACE) {
        s.skipExportBraces();
        const text = s.sliceTrimmed(stmt_start, s.pos);
        const is_type_only = ch.contains(text, "export type");
        const comments = ext.extractLeadingComments(s, stmt_start);
        try s.declarations.append(.{
            .kind = .export_decl,
            .name = "",
            .text = text,
            .is_exported = true,
            .is_type_only = is_type_only,
            .leading_comments = comments,
            .start = stmt_start,
            .end = s.pos,
        });
    } else if (ech == ch.CH_STAR) {
        s.skipExportStar();
        const text = s.sliceTrimmed(stmt_start, s.pos);
        const comments = ext.extractLeadingComments(s, stmt_start);
        // Extract source from 'from "..."'
        var export_source: []const u8 = "";
        const from_idx = ch.indexOf(text, "from ", 0);
        if (from_idx) |fi| {
            var qi = fi + 5;
            while (qi < text.len and (text[qi] == ' ' or text[qi] == '\t')) qi += 1;
            if (qi < text.len and (text[qi] == '\'' or text[qi] == '"')) {
                const q_str: []const u8 = if (text[qi] == '\'') "'" else "\"";
                const q_end = ch.indexOf(text, q_str, qi + 1);
                if (q_end) |qe| export_source = text[qi + 1 .. qe];
            }
        }
        try s.declarations.append(.{
            .kind = .export_decl,
            .name = "",
            .text = text,
            .is_exported = true,
            .source_module = export_source,
            .leading_comments = comments,
            .start = stmt_start,
            .end = s.pos,
        });
    } else {
        s.skipToStatementEnd();
        const text = s.sliceTrimmed(stmt_start, s.pos);
        if (text.len > 0) {
            try s.declarations.append(.{
                .kind = .export_decl,
                .name = "",
                .text = text,
                .is_exported = true,
                .start = stmt_start,
                .end = s.pos,
            });
        }
    }
}
