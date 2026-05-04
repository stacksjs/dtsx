/// Declaration extractors - extract specific declaration types from the scanner.
/// Port of scanner.ts high-level extraction functions (lines 590-2598).
const std = @import("std");
const ch = @import("char_utils.zig");
const types = @import("types.zig");
const type_inf = @import("type_inference.zig");
const Scanner = @import("scanner.zig").Scanner;
const Declaration = types.Declaration;
const DeclarationKind = types.DeclarationKind;
const Allocator = std.mem.Allocator;

// ========================================================================
// Comment extraction
// ========================================================================

/// Extract leading JSDoc/block/single-line comments before position
pub fn extractLeadingComments(s: *Scanner, decl_start: usize) ?[]const []const u8 {
    if (!s.keep_comments) return null;

    var p: isize = @as(isize, @intCast(decl_start)) - 1;
    while (p >= 0 and ch.isWhitespace(s.source[@intCast(p)])) p -= 1;
    if (p < 0) return null;

    var comments = std.array_list.Managed([]const u8).init(s.allocator);
    comments.ensureTotalCapacity(4) catch {};
    var has_block_comment = false;

    while (p >= 0) {
        const pu: usize = @intCast(p);
        // Check for block comment ending with */
        if (p >= 1 and s.source[pu] == ch.CH_SLASH and s.source[pu - 1] == ch.CH_STAR) {
            // Find matching `/*` opener — std.mem.lastIndexOf walks bytes via
            // the optimized scanner path. Was a manual byte-by-byte loop walking
            // backwards, which is O(N) for long block comments.
            const search_end = pu - 1;
            const found = std.mem.lastIndexOf(u8, s.source[0..search_end], "/*");
            if (found) |su| {
                comments.append(s.source[su .. pu + 1]) catch {};
                has_block_comment = true;
                p = @as(isize, @intCast(su)) - 1;
                while (p >= 0 and ch.isWhitespace(s.source[@intCast(p)])) p -= 1;
                continue;
            }
            break;
        }

        // Check for single-line comments
        var line_start: usize = pu;
        while (line_start > 0 and s.source[line_start - 1] != ch.CH_LF) line_start -= 1;
        const line_text = ch.sliceTrimmed(s.source, line_start, pu + 1);

        if (line_text.len >= 2 and line_text[0] == '/' and line_text[1] == '/') {
            if (has_block_comment) break;

            var single_lines = std.array_list.Managed([]const u8).init(s.allocator);
            single_lines.append(line_text) catch {};
            p = @as(isize, @intCast(line_start)) - 1;
            while (p >= 0 and (s.source[@intCast(p)] == ch.CH_LF or s.source[@intCast(p)] == ch.CH_CR)) p -= 1;

            while (p >= 0) {
                var ls: usize = @intCast(p);
                while (ls > 0 and s.source[ls - 1] != ch.CH_LF) ls -= 1;
                const lt = ch.sliceTrimmed(s.source, ls, @as(usize, @intCast(p)) + 1);
                if (lt.len >= 2 and lt[0] == '/' and lt[1] == '/') {
                    single_lines.append(lt) catch {};
                    p = @as(isize, @intCast(ls)) - 1;
                    while (p >= 0 and (s.source[@intCast(p)] == ch.CH_LF or s.source[@intCast(p)] == ch.CH_CR)) p -= 1;
                } else if (lt.len == 0) {
                    p = @as(isize, @intCast(ls)) - 1;
                    while (p >= 0 and (s.source[@intCast(p)] == ch.CH_LF or s.source[@intCast(p)] == ch.CH_CR)) p -= 1;
                } else {
                    break;
                }
            }

            // Single-line short-circuit: skip reverse + join when there's only one comment.
            if (single_lines.items.len == 1) {
                comments.append(single_lines.items[0]) catch {};
                continue;
            }

            // Reverse and join with newlines
            std.mem.reverse([]const u8, single_lines.items);
            var total_len: usize = single_lines.items.len - 1; // newlines between
            for (single_lines.items) |line| total_len += line.len;
            const joined = s.allocator.alloc(u8, total_len) catch break;
            var offset: usize = 0;
            const last_idx = single_lines.items.len - 1;
            for (single_lines.items, 0..) |line, i| {
                @memcpy(joined[offset .. offset + line.len], line);
                offset += line.len;
                if (i < last_idx) {
                    joined[offset] = '\n';
                    offset += 1;
                }
            }
            comments.append(joined) catch {};
            continue;
        }
        break;
    }

    if (comments.items.len == 0) return null;
    std.mem.reverse([]const u8, comments.items);
    return comments.toOwnedSlice() catch null;
}

// ========================================================================
// Import extraction
// ========================================================================

/// Extract import statement text from current position
pub fn extractImport(s: *Scanner, start: usize) Declaration {
    const stmt_start = start;
    var found_quote = false;
    while (s.pos < s.len) {
        const c = s.source[s.pos];
        if (c == ch.CH_SEMI) {
            s.pos += 1;
            break;
        }
        if (c == ch.CH_SQUOTE or c == ch.CH_DQUOTE) {
            s.skipString(c);
            found_quote = true;
            while (s.pos < s.len and (s.source[s.pos] == ch.CH_SPACE or s.source[s.pos] == ch.CH_TAB)) s.pos += 1;
            if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) s.pos += 1;
            break;
        }
        if (c == ch.CH_LF and found_quote) break;
        s.pos += 1;
    }

    const text = s.sliceTrimmed(stmt_start, s.pos);
    // Check for 'import type '
    const is_type_only = text.len > 11 and text[7] == 't' and
        (ch.startsWith(text, "import type ") or ch.startsWith(text, "import type{"));

    // Detect side-effect imports
    var is_side_effect = false;
    {
        var si: usize = 6; // skip 'import'
        while (si < text.len and (text[si] == ch.CH_SPACE or text[si] == ch.CH_TAB)) si += 1;
        if (si < text.len and text[si] == 't' and si + 4 <= text.len and std.mem.eql(u8, text[si .. si + 4], "type")) {
            si += 4;
            while (si < text.len and (text[si] == ch.CH_SPACE or text[si] == ch.CH_TAB)) si += 1;
        }
        if (si < text.len) {
            const qc = text[si];
            is_side_effect = qc == ch.CH_SQUOTE or qc == ch.CH_DQUOTE;
        }
    }

    // Extract source module — use indexOfChar (single-byte SIMD scan) for the
    // closing quote instead of indexOf with a 1-char needle.
    var module_src: []const u8 = "";
    {
        const from_idx = ch.indexOf(text, "from ", 0);
        if (from_idx) |fi| {
            var mi = fi + 5;
            while (mi < text.len and (text[mi] == ch.CH_SPACE or text[mi] == ch.CH_TAB)) mi += 1;
            if (mi < text.len) {
                const q = text[mi];
                if (q == ch.CH_SQUOTE or q == ch.CH_DQUOTE) {
                    if (ch.indexOfChar(text, q, mi + 1)) |ei| {
                        module_src = text[mi + 1 .. ei];
                    }
                }
            }
        } else if (is_side_effect) {
            var mi: usize = 6;
            while (mi < text.len and text[mi] != ch.CH_SQUOTE and text[mi] != ch.CH_DQUOTE) mi += 1;
            if (mi < text.len) {
                const q = text[mi];
                if (ch.indexOfChar(text, q, mi + 1)) |ei| {
                    module_src = text[mi + 1 .. ei];
                }
            }
        }
    }

    const comments = extractLeadingComments(s, stmt_start);

    // Parse import clause once (cached in Declaration to avoid re-parsing in emitter)
    var parsed_import: ?types.ParsedImport = null;
    if (!is_side_effect) pi: {
        const from_idx = ch.indexOf(text, " from ", 0) orelse break :pi;
        var import_part = ch.sliceTrimmed(text, 0, from_idx);

        // Strip 'import' and optional 'type'
        if (ch.startsWith(import_part, "import type ")) {
            import_part = ch.sliceTrimmed(import_part, 12, import_part.len);
        } else if (ch.startsWith(import_part, "import ")) {
            import_part = ch.sliceTrimmed(import_part, 7, import_part.len);
        }
        if (ch.startsWith(import_part, "type ")) {
            import_part = ch.sliceTrimmed(import_part, 5, import_part.len);
        }

        var default_name: ?[]const u8 = null;
        var named_items = std.array_list.Managed([]const u8).init(s.allocator);
        named_items.ensureTotalCapacity(8) catch break :pi;

        // Also collect "resolved" items (with type/as stripped) for filtering
        var resolved_items = std.array_list.Managed([]const u8).init(s.allocator);
        resolved_items.ensureTotalCapacity(8) catch break :pi;

        var is_namespace = false;
        var namespace_name: ?[]const u8 = null;

        const brace_start = ch.indexOfChar(import_part, '{', 0);
        const brace_end = std.mem.lastIndexOf(u8, import_part, "}");

        // Check for namespace import: * as Name
        if (ch.indexOf(import_part, "* as ", 0)) |star_idx| {
            is_namespace = true;
            const ns_name = ch.sliceTrimmed(import_part, star_idx + 5, if (brace_start) |bs| bs else import_part.len);
            if (ns_name.len > 0) {
                namespace_name = ns_name;
                resolved_items.append(ns_name) catch {};
            }
        }

        if (brace_start != null and brace_end != null) {
            const bs = brace_start.?;
            const be = brace_end.?;

            // Default import before braces
            if (bs > 0) {
                var before = ch.sliceTrimmed(import_part, 0, bs);
                if (before.len > 0 and before[before.len - 1] == ',') {
                    before = ch.sliceTrimmed(before, 0, before.len - 1);
                }
                if (before.len > 0 and !ch.contains(before, "*")) {
                    default_name = before;
                    resolved_items.append(before) catch {};
                }
            }

            // Named imports — splitScalar is faster than splitSequence for a 1-byte separator.
            const named_part = import_part[bs + 1 .. be];
            var iter = std.mem.splitScalar(u8, named_part, ',');
            while (iter.next()) |raw_item| {
                const trimmed = ch.sliceTrimmed(raw_item, 0, raw_item.len);
                if (trimmed.len == 0) continue;
                named_items.append(trimmed) catch {};

                // Resolve: strip 'type ' prefix, use alias after ' as '
                var resolved = trimmed;
                if (ch.startsWith(resolved, "type ")) {
                    resolved = ch.sliceTrimmed(resolved, 5, resolved.len);
                }
                if (ch.indexOf(resolved, " as ", 0)) |as_idx| {
                    resolved = ch.sliceTrimmed(resolved, as_idx + 4, resolved.len);
                }
                if (resolved.len > 0) resolved_items.append(resolved) catch {};
            }
        } else if (!is_namespace) {
            // Default import only
            if (import_part.len > 0 and !ch.contains(import_part, "*")) {
                default_name = import_part;
                resolved_items.append(import_part) catch {};
            }
        }

        // toOwnedSlice trims unused capacity — important for non-arena callers.
        parsed_import = .{
            .default_name = default_name,
            .named_items = named_items.toOwnedSlice() catch named_items.items,
            .source = module_src,
            .is_type_only = is_type_only,
            .is_namespace = is_namespace,
            .namespace_name = namespace_name,
            .resolved_items = resolved_items.toOwnedSlice() catch resolved_items.items,
        };
    }

    return .{
        .kind = .import_decl,
        .name = "",
        .text = text,
        .is_exported = false,
        .is_type_only = is_type_only,
        .is_side_effect = is_side_effect,
        .source_module = module_src,
        .leading_comments = comments,
        .start = stmt_start,
        .end = s.pos,
        .parsed_import = parsed_import,
    };
}

// ========================================================================
// Generics, params, return type extraction
// ========================================================================

/// Extract type parameters <...> (normalized to single line)
pub fn extractGenerics(s: *Scanner) []const u8 {
    if (s.pos >= s.len or s.source[s.pos] != ch.CH_LANGLE) return "";
    const start = s.pos;
    _ = s.findMatchingClose(ch.CH_LANGLE, ch.CH_RANGLE);
    const raw = s.source[start..s.pos];
    // Normalize multi-line generics to single line. indexOfChar is the
    // single-byte SIMD path; the previous code used the multi-byte indexOf.
    if (ch.indexOfChar(raw, '\n', 0) != null) {
        // Direct alloc: output ≤ input length (whitespace collapsed)
        const buf = s.allocator.alloc(u8, raw.len) catch return raw;
        var pos: usize = 0;
        var prev_space = false;
        for (raw) |c| {
            if (c == ' ' or c == '\t' or c == '\n' or c == '\r') {
                if (!prev_space and pos > 0 and buf[pos - 1] != '<') {
                    buf[pos] = ' ';
                    pos += 1;
                    prev_space = true;
                }
            } else {
                if (c == '>' and prev_space and pos > 0 and buf[pos - 1] == ' ') {
                    pos -= 1;
                }
                buf[pos] = c;
                pos += 1;
                prev_space = false;
            }
        }
        return buf[0..pos];
    }
    return raw;
}

/// Extract parameter list (...) as raw text
pub fn extractParamList(s: *Scanner) []const u8 {
    if (s.pos >= s.len or s.source[s.pos] != ch.CH_LPAREN) return "()";
    const start = s.pos;
    _ = s.findMatchingClose(ch.CH_LPAREN, ch.CH_RPAREN);
    return s.source[start..s.pos];
}

/// Extract return type annotation `: ReturnType` after params
pub fn extractReturnType(s: *Scanner) []const u8 {
    s.skipWhitespaceAndComments();
    if (s.pos < s.len and s.source[s.pos] == ch.CH_COLON) {
        s.pos += 1; // skip :
        s.skipWhitespaceAndComments();
        const start = s.pos;
        var depth: isize = 0;
        while (s.pos < s.len) {
            if (s.skipNonCode()) continue;
            const c = s.source[s.pos];
            if (c == ch.CH_LPAREN or c == ch.CH_LBRACKET or c == ch.CH_LANGLE) {
                depth += 1;
            } else if (c == ch.CH_RPAREN or c == ch.CH_RBRACKET or (c == ch.CH_RANGLE and !s.isArrowGT())) {
                depth -= 1;
            } else if (c == ch.CH_LBRACE) {
                if (depth > 0) {
                    depth += 1;
                } else {
                    const text_so_far = ch.sliceTrimmed(s.source, start, s.pos);
                    const is_type_ctx = text_so_far.len == 0 or
                        ch.endsWith(text_so_far, "|") or
                        ch.endsWith(text_so_far, "&") or
                        endsWithWord(text_so_far, "is") or
                        endsWithWord(text_so_far, "extends");
                    if (is_type_ctx) {
                        depth += 1;
                    } else {
                        break; // function body
                    }
                }
            } else if (c == ch.CH_RBRACE) {
                if (depth == 0) break;
                depth -= 1;
            } else if (depth == 0 and c == ch.CH_SEMI) {
                break;
            }
            if (depth == 0 and s.checkASIMember()) break;
            s.pos += 1;
        }
        return ch.sliceTrimmed(s.source, start, s.pos);
    }
    return "";
}

fn endsWithWord(text: []const u8, word: []const u8) bool {
    if (text.len < word.len) return false;
    const idx = text.len - word.len;
    if (!std.mem.eql(u8, text[idx..], word)) return false;
    return idx == 0 or !ch.isIdentChar(text[idx - 1]);
}

// ========================================================================
// Parameter processing
// ========================================================================

/// Check if string is a numeric literal
pub fn isNumericLiteral(v: []const u8) bool {
    if (v.len == 0) return false;
    var i: usize = 0;
    if (v[0] == '-') {
        i = 1;
        if (i >= v.len) return false;
    }
    if (!ch.isDigit(v[i])) return false;
    while (i < v.len and ch.isDigit(v[i])) i += 1;
    if (i < v.len and v[i] == '.') {
        i += 1;
        if (i >= v.len or !ch.isDigit(v[i])) return false;
        while (i < v.len and ch.isDigit(v[i])) i += 1;
    }
    return i == v.len;
}

/// Infer type from a default value expression (simple cases)
pub fn inferTypeFromDefault(value: []const u8) []const u8 {
    const v = std.mem.trim(u8, value, " \t\r\n");
    if (v.len == 0) return "unknown";
    // Dispatch on first byte to avoid running multiple checks for cases that
    // can't possibly match. e.g. a value starting with `[` is never `true`.
    return switch (v[0]) {
        't' => if (std.mem.eql(u8, v, "true")) "boolean" else "unknown",
        'f' => if (std.mem.eql(u8, v, "false")) "boolean" else "unknown",
        '[' => "unknown[]",
        '{' => "Record<string, unknown>",
        '\'', '"' => if (v.len >= 2 and v[v.len - 1] == v[0]) "string" else "unknown",
        '-', '0'...'9' => if (isNumericLiteral(v)) "number" else "unknown",
        else => "unknown",
    };
}

/// Infer literal type from initializer value (for const-like / static readonly)
pub fn inferLiteralType(value: []const u8) []const u8 {
    const v = std.mem.trim(u8, value, " \t\r\n");
    if (v.len == 0) return "unknown";
    return switch (v[0]) {
        't' => if (std.mem.eql(u8, v, "true")) v else "unknown",
        'f' => if (std.mem.eql(u8, v, "false")) v else "unknown",
        '\'', '"' => if (v.len >= 2 and v[v.len - 1] == v[0]) v else "unknown",
        '-', '0'...'9' => if (isNumericLiteral(v)) v else "unknown",
        else => "unknown",
    };
}

/// Extract type from `as Type` assertion in initializer
pub fn extractAssertion(init_text: []const u8) ?[]const u8 {
    if (ch.endsWith(init_text, "as const")) return null;
    // Cheap pre-check: if ` as ` doesn't appear anywhere, skip the entire walk.
    if (ch.indexOf(init_text, " as ", 0) == null) return null;

    // Only find " as " at depth 0 (not inside nested brackets/braces/parens).
    var last_as: ?usize = null;
    var depth: isize = 0;
    var in_str: u8 = 0;
    var i: usize = 0;
    while (i < init_text.len) {
        const c = init_text[i];
        if (in_str != 0) {
            if (c == '\\') {
                i += 2;
                continue;
            }
            if (c == in_str) in_str = 0;
            i += 1;
            continue;
        }
        if (c == '\'' or c == '"' or c == '`') {
            in_str = c;
        } else if (c == '(' or c == '[' or c == '{' or c == '<') {
            depth += 1;
        } else if (c == ')' or c == ']' or c == '}' or c == '>') {
            depth -= 1;
        } else if (depth == 0 and c == ' ' and i + 4 <= init_text.len and
            init_text[i + 1] == 'a' and init_text[i + 2] == 's' and init_text[i + 3] == ' ')
        {
            // Inline 4-byte check is faster than std.mem.eql for a fixed-length
            // needle, and gates the comparison on the leading space first.
            last_as = i;
        }
        i += 1;
    }
    if (last_as) |idx| {
        const after = std.mem.trim(u8, init_text[idx + 4 ..], " \t\r\n");
        if (after.len > 0 and !std.mem.eql(u8, after, "const")) return after;
    }
    return null;
}

/// Build DTS-safe parameter text from raw parameter text
pub fn buildDtsParams(s: *Scanner, raw_params: []const u8) []const u8 {
    if (raw_params.len < 2) return "()";
    const inner = std.mem.trim(u8, raw_params[1 .. raw_params.len - 1], " \t\r\n");
    if (inner.len == 0) return "()";

    // Fast path: single-pass analysis — allow { and [ in type positions (after colon).
    // Only reject destructuring ({ or [ before colon), defaults (=), and decorators (@).
    if (ch.indexOfChar(raw_params, '\n', 0) == null and inner.len > 0) {
        var depth: isize = 0;
        var seen_colon = false;
        var colons: usize = 0;
        var commas: usize = 0;
        var can_passthrough = true;
        var fp_i: usize = 0;
        while (fp_i < inner.len) : (fp_i += 1) {
            const c = inner[fp_i];
            if (c == ch.CH_LPAREN or c == ch.CH_LANGLE) {
                depth += 1;
            } else if (c == ch.CH_RPAREN or c == ch.CH_RANGLE) {
                depth -= 1;
            } else if (c == ch.CH_LBRACE or c == ch.CH_LBRACKET) {
                if (depth == 0 and !seen_colon) { can_passthrough = false; break; }
                depth += 1;
            } else if (c == ch.CH_RBRACE or c == ch.CH_RBRACKET) {
                depth -= 1;
            } else if (depth == 0) {
                if (c == ch.CH_COLON) { colons += 1; seen_colon = true; } else if (c == ch.CH_COMMA) { commas += 1; seen_colon = false; } else if (c == ch.CH_EQUAL and (fp_i + 1 >= inner.len or (inner[fp_i + 1] != ch.CH_RANGLE and inner[fp_i + 1] != ch.CH_EQUAL))) {
                    can_passthrough = false;
                    break;
                } else if (c == ch.CH_AT) {
                    can_passthrough = false;
                    break;
                }
            }
        }
        if (can_passthrough and colons >= commas + 1) {
            // Check for parameter modifiers. First-byte fast-fail: param
            // modifiers start with one of `p`, `r`, or `o`. If `inner` doesn't
            // even contain any of those bytes, skip the per-modifier loop
            // entirely — saves ~5 full string scans on every parameter list
            // that lacks modifiers (the common case).
            const has_p = ch.indexOfChar(inner, 'p', 0) != null;
            const has_r = ch.indexOfChar(inner, 'r', 0) != null;
            const has_o = ch.indexOfChar(inner, 'o', 0) != null;
            if (!has_p and !has_r and !has_o) return raw_params;

            var has_modifier = false;
            for (types.PARAM_MODIFIERS) |mod| {
                if (ch.indexOf(inner, mod, 0)) |mod_idx| {
                    const after_idx = mod_idx + mod.len;
                    const before_ok = mod_idx == 0 or !ch.isIdentChar(inner[mod_idx - 1]);
                    const after_ok = after_idx >= inner.len or !ch.isIdentChar(inner[after_idx]);
                    if (before_ok and after_ok) {
                        has_modifier = true;
                        break;
                    }
                }
            }
            if (!has_modifier) return raw_params;
        }
    }

    // Split parameters by comma at depth 0
    var params = std.array_list.Managed([]const u8).init(s.allocator);
    params.ensureTotalCapacity(8) catch {};
    var param_start: usize = 0;
    var depth: isize = 0;
    var in_str = false;
    var str_ch: u8 = 0;
    var skip_next = false;

    var in_block_comment = false;
    var skip_to_eol = false;
    for (inner, 0..) |c, i| {
        if (skip_next) {
            skip_next = false;
            continue;
        }
        if (skip_to_eol) {
            if (c == '\n') skip_to_eol = false;
            continue;
        }
        if (in_block_comment) {
            if (c == '/' and i > 0 and inner[i - 1] == '*') in_block_comment = false;
            continue;
        }
        if (in_str) {
            if (c == ch.CH_BACKSLASH) {
                skip_next = true; // skip the escaped character
                continue;
            }
            if (c == str_ch) in_str = false;
            continue;
        }
        // Skip block and line comments — JSDoc prose can contain unmatched
        // quote chars (e.g. apostrophe in "error's") that would otherwise
        // trip the scanner into a string-literal mode it never escapes.
        if (c == '/' and i + 1 < inner.len) {
            const nc = inner[i + 1];
            if (nc == '*') {
                in_block_comment = true;
                continue;
            }
            if (nc == '/') {
                skip_to_eol = true;
                continue;
            }
        }
        if (c == ch.CH_SQUOTE or c == ch.CH_DQUOTE or c == ch.CH_BACKTICK) {
            in_str = true;
            str_ch = c;
            continue;
        }
        if (c == ch.CH_LPAREN or c == ch.CH_LBRACE or c == ch.CH_LBRACKET or c == ch.CH_LANGLE) {
            depth += 1;
        } else if (c == ch.CH_RPAREN or c == ch.CH_RBRACE or c == ch.CH_RBRACKET or c == ch.CH_RANGLE) {
            depth -= 1;
        } else if (c == ch.CH_COMMA and depth == 0) {
            params.append(std.mem.trim(u8, inner[param_start..i], " \t\r\n")) catch {};
            param_start = i + 1;
        }
    }
    params.append(std.mem.trim(u8, inner[param_start..], " \t\r\n")) catch {};

    // Build DTS params — direct alloc, output ≤ raw_params.len + extra for type annotations
    const buf = s.allocator.alloc(u8, raw_params.len * 2 + 16) catch return "()";
    var pos: usize = 0;
    buf[pos] = '(';
    pos += 1;
    var first = true;
    for (params.items) |param| {
        if (param.len == 0) continue;
        if (!first) {
            @memcpy(buf[pos..][0..2], ", ");
            pos += 2;
        }
        first = false;
        const dts_param = buildSingleDtsParam(s, param);
        @memcpy(buf[pos..][0..dts_param.len], dts_param);
        pos += dts_param.len;
    }
    buf[pos] = ')';
    pos += 1;
    return buf[0..pos];
}

/// Build a single DTS parameter from raw source text
pub fn buildSingleDtsParam(s: *Scanner, raw: []const u8) []const u8 {
    var p = std.mem.trim(u8, raw, " \t\r\n");

    // Handle rest parameter
    const is_rest = ch.startsWith(p, "...");
    if (is_rest) p = std.mem.trim(u8, p[3..], " \t\r\n");

    // Handle decorators (skip @... before param)
    while (p.len > 0 and p[0] == '@') {
        var di: usize = 1;
        while (di < p.len and ch.isIdentChar(p[di])) di += 1;
        if (di < p.len and p[di] == ch.CH_LPAREN) {
            var dd: isize = 1;
            di += 1;
            while (di < p.len and dd > 0) {
                if (p[di] == ch.CH_LPAREN) dd += 1 else if (p[di] == ch.CH_RPAREN) dd -= 1;
                di += 1;
            }
        }
        p = std.mem.trim(u8, p[di..], " \t\r\n");
    }

    // Strip parameter modifiers — fast-fail by first byte. The 5 PARAM_MODIFIERS
    // ("public", "protected", "private", "readonly", "override") all start with
    // 'p', 'r', or 'o', so we can reject most bytes in O(1) without iterating
    // the full list.
    var stripped = true;
    while (stripped and p.len > 0) {
        stripped = false;
        const c0 = p[0];
        if (c0 != 'p' and c0 != 'r' and c0 != 'o') break;
        for (types.PARAM_MODIFIERS) |mod| {
            if (p.len > mod.len and ch.startsWith(p, mod) and !ch.isIdentChar(p[mod.len])) {
                p = std.mem.trim(u8, p[mod.len..], " \t\r\n");
                stripped = true;
                break;
            }
        }
    }

    // Find : and = at depth 0
    var colon_idx: ?usize = null;
    var equal_idx: ?usize = null;
    var depth: isize = 0;
    var in_str2 = false;
    var str_ch2: u8 = 0;
    var skip_next2 = false;

    var in_block_comment2 = false;
    var skip_to_eol2 = false;
    for (p, 0..) |c, i| {
        if (skip_next2) {
            skip_next2 = false;
            continue;
        }
        if (skip_to_eol2) {
            if (c == '\n') skip_to_eol2 = false;
            continue;
        }
        if (in_block_comment2) {
            if (c == '/' and i > 0 and p[i - 1] == '*') in_block_comment2 = false;
            continue;
        }
        if (in_str2) {
            if (c == ch.CH_BACKSLASH) {
                skip_next2 = true;
                continue;
            }
            if (c == str_ch2) in_str2 = false;
            continue;
        }
        // Skip block and line comments before string-mode detection so JSDoc
        // apostrophes (e.g. "error's") don't trigger an unclosed string.
        if (c == '/' and i + 1 < p.len) {
            const nc = p[i + 1];
            if (nc == '*') {
                in_block_comment2 = true;
                continue;
            }
            if (nc == '/') {
                skip_to_eol2 = true;
                continue;
            }
        }
        if (c == ch.CH_SQUOTE or c == ch.CH_DQUOTE or c == ch.CH_BACKTICK) {
            in_str2 = true;
            str_ch2 = c;
            continue;
        }
        if (c == ch.CH_LPAREN or c == ch.CH_LBRACE or c == ch.CH_LBRACKET or c == ch.CH_LANGLE) {
            depth += 1;
        } else if (c == ch.CH_RPAREN or c == ch.CH_RBRACE or c == ch.CH_RBRACKET or c == ch.CH_RANGLE) {
            depth -= 1;
        } else if (depth == 0) {
            if (c == ch.CH_COLON and colon_idx == null) {
                colon_idx = i;
            } else if (c == ch.CH_EQUAL and equal_idx == null) {
                // Check it's not == or =>
                const not_double = i == 0 or p[i - 1] != ch.CH_EQUAL;
                const not_arrow = i + 1 >= p.len or (p[i + 1] != ch.CH_EQUAL and p[i + 1] != ch.CH_RANGLE);
                if (not_double and not_arrow) {
                    equal_idx = i;
                }
            }
        }
    }

    var name: []const u8 = undefined;
    var param_type: []const u8 = undefined;
    const has_default = equal_idx != null;

    if (colon_idx) |ci| {
        if (equal_idx == null or ci < equal_idx.?) {
            name = std.mem.trim(u8, p[0..ci], " \t\r\n");
            if (equal_idx) |ei| {
                param_type = std.mem.trim(u8, p[ci + 1 .. ei], " \t\r\n");
            } else {
                param_type = std.mem.trim(u8, p[ci + 1 ..], " \t\r\n");
            }
        } else {
            name = std.mem.trim(u8, p[0..equal_idx.?], " \t\r\n");
            param_type = inferTypeFromDefault(std.mem.trim(u8, p[equal_idx.? + 1 ..], " \t\r\n"));
        }
    } else if (equal_idx) |ei| {
        name = std.mem.trim(u8, p[0..ei], " \t\r\n");
        param_type = inferTypeFromDefault(std.mem.trim(u8, p[ei + 1 ..], " \t\r\n"));
    } else {
        name = p;
        param_type = "unknown";
    }

    // Clean destructured patterns: strip defaults and rest operators
    if (name.len > 0 and (name[0] == '{' or name[0] == '[')) {
        name = cleanDestructuredPattern(s.allocator, name);
    }

    // Handle optional marker
    const is_optional = (name.len > 0 and name[name.len - 1] == '?') or has_default;
    if (name.len > 0 and name[name.len - 1] == '?') {
        name = std.mem.trim(u8, name[0 .. name.len - 1], " \t\r\n");
    }
    const opt_marker: []const u8 = if (is_optional and !is_rest) "?" else "";

    // Build result — direct alloc (no ArrayList overhead)
    const rest_prefix: []const u8 = if (is_rest) "..." else "";
    const total = rest_prefix.len + name.len + opt_marker.len + 2 + param_type.len;
    const result_buf = s.allocator.alloc(u8, total) catch return "unknown: unknown";
    var rp: usize = 0;
    if (is_rest) { @memcpy(result_buf[rp..][0..3], "..."); rp += 3; }
    @memcpy(result_buf[rp..][0..name.len], name); rp += name.len;
    @memcpy(result_buf[rp..][0..opt_marker.len], opt_marker); rp += opt_marker.len;
    @memcpy(result_buf[rp..][0..2], ": "); rp += 2;
    @memcpy(result_buf[rp..][0..param_type.len], param_type); rp += param_type.len;
    return result_buf[0..rp];
}

/// Clean a destructured pattern by stripping default values and rest operators.
/// E.g., "{ name, age = 0, ...props }" → "{ name, age, props }"
/// Also handles multiline patterns like:
/// "{\n  name,\n  headers = { ... },\n}" → "{\n  name,\n  headers,\n}"
fn cleanDestructuredPattern(alloc: std.mem.Allocator, pattern: []const u8) []const u8 {
    // Fast path: if there's nothing to clean (no defaults, no rest operators,
    // no newlines), the pattern is already in DTS-friendly form. The previous
    // code always allocated and walked the entire pattern.
    const has_eq = ch.indexOfChar(pattern, '=', 0) != null;
    const has_dots = ch.indexOf(pattern, "...", 0) != null;
    const has_nl = ch.indexOfChar(pattern, '\n', 0) != null;
    if (!has_eq and !has_dots and !has_nl) return pattern;

    var result = std.array_list.Managed(u8).init(alloc);
    result.ensureTotalCapacity(pattern.len) catch {};
    var i: usize = 0;
    var depth: isize = 0;
    var in_str = false;
    var str_c: u8 = 0;

    while (i < pattern.len) : (i += 1) {
        const c = pattern[i];

        // Preserve block and line comments verbatim (useful JSDoc) but skip
        // parsing inside them so apostrophes in prose (e.g. "error's") don't
        // put us in an inescapable string mode.
        if (!in_str and c == '/' and i + 1 < pattern.len) {
            const nc = pattern[i + 1];
            if (nc == '*') {
                const start = i;
                var j = i + 2;
                while (j + 1 < pattern.len and !(pattern[j] == '*' and pattern[j + 1] == '/')) : (j += 1) {}
                const end = if (j + 1 < pattern.len) j + 2 else pattern.len;
                result.appendSlice(pattern[start..end]) catch {};
                i = end - 1; // loop's += 1 advances past
                continue;
            }
            if (nc == '/') {
                const start = i;
                var j = i;
                while (j < pattern.len and pattern[j] != '\n') : (j += 1) {}
                result.appendSlice(pattern[start..j]) catch {};
                i = if (j == 0) 0 else j - 1; // loop's += 1 lands on the newline
                continue;
            }
        }

        // String tracking
        if (!in_str and (c == '\'' or c == '"' or c == '`')) {
            in_str = true;
            str_c = c;
            result.append(c) catch {};
            continue;
        }
        if (in_str) {
            result.append(c) catch {};
            if (c == str_c and (i == 0 or pattern[i - 1] != '\\')) {
                in_str = false;
            }
            continue;
        }

        // Track depth
        if (c == '{' or c == '[' or c == '(') depth += 1;
        if (c == '}' or c == ']' or c == ')') depth -= 1;

        // At depth 1 (inside the outermost braces), handle defaults and rest
        if (depth == 1) {
            // Skip "..." rest operator before identifiers
            if (c == '.' and i + 2 < pattern.len and pattern[i + 1] == '.' and pattern[i + 2] == '.') {
                i += 2; // skip 2 more dots (loop will advance 1 more)
                continue;
            }

            // Skip "= value" default values
            if (c == '=' and i + 1 < pattern.len and pattern[i + 1] != '>' and (i == 0 or pattern[i - 1] != '!')) {
                // Skip whitespace before '='
                while (result.items.len > 0 and (result.items[result.items.len - 1] == ' ' or result.items[result.items.len - 1] == '\t')) {
                    _ = result.pop();
                }
                // Skip the default value: everything up to ',' or '}'/']' at this depth
                i += 1; // skip '='
                var inner_depth: isize = 0;
                while (i < pattern.len) {
                    const dc = pattern[i];
                    if (!in_str and (dc == '\'' or dc == '"' or dc == '`')) {
                        in_str = true;
                        str_c = dc;
                        i += 1;
                        continue;
                    }
                    if (in_str) {
                        if (dc == str_c and (i == 0 or pattern[i - 1] != '\\')) {
                            in_str = false;
                        }
                        i += 1;
                        continue;
                    }
                    if (dc == '{' or dc == '[' or dc == '(') inner_depth += 1;
                    if (dc == '}' or dc == ']' or dc == ')') {
                        if (inner_depth == 0) break; // Hit the closing brace
                        inner_depth -= 1;
                    }
                    if (dc == ',' and inner_depth == 0) break;
                    i += 1;
                }
                // Don't advance i further — the loop's :i+=1 will handle it,
                // but we need to emit the comma or closing brace
                i -= 1; // compensate for the loop's += 1
                continue;
            }
        }

        result.append(c) catch {};
    }

    const cleaned = result.toOwnedSlice() catch return pattern;

    // If the pattern contains newlines, try to collapse to single line if short enough.
    // indexOfChar is the SIMD-optimized single-byte search.
    if (ch.indexOfChar(cleaned, '\n', 0) != null) {
        // Collapse newlines and extra whitespace to single spaces
        var collapsed = std.array_list.Managed(u8).init(alloc);
        collapsed.ensureTotalCapacity(cleaned.len) catch {};
        var in_ws = false;
        for (cleaned) |c2| {
            if (c2 == '\n' or c2 == '\r' or c2 == ' ' or c2 == '\t') {
                if (!in_ws) {
                    collapsed.append(' ') catch {};
                    in_ws = true;
                }
            } else {
                collapsed.append(c2) catch {};
                in_ws = false;
            }
        }
        const collapsed_str = std.mem.trim(u8, collapsed.items, " \t\r\n");
        if (collapsed_str.len <= 40) {
            return collapsed_str;
        }
        // Keep multiline but normalize indent
        var normalized = std.array_list.Managed(u8).init(alloc);
        normalized.ensureTotalCapacity(cleaned.len) catch {};
        var line_start: usize = 0;
        var ci: usize = 0;
        while (ci <= cleaned.len) : (ci += 1) {
            if (ci == cleaned.len or cleaned[ci] == '\n') {
                const line = std.mem.trim(u8, cleaned[line_start..ci], " \t\r\n");
                if (line.len > 0) {
                    if (normalized.items.len > 0) normalized.append('\n') catch {};
                    if (line[0] == '{' or line[0] == '}' or line[0] == '[' or line[0] == ']') {
                        normalized.appendSlice(line) catch {};
                    } else {
                        normalized.appendSlice("  ") catch {};
                        normalized.appendSlice(line) catch {};
                    }
                }
                line_start = ci + 1;
            }
        }
        return normalized.toOwnedSlice() catch cleaned;
    }

    return cleaned;
}

// ========================================================================
// Function extraction
// ========================================================================

/// Extract a function declaration and build DTS text
pub fn extractFunction(s: *Scanner, decl_start: usize, is_exported: bool, is_async: bool, is_default: bool) ?Declaration {
    s.pos += 8; // skip 'function'
    s.skipWhitespaceAndComments();

    const is_generator = s.pos < s.len and s.source[s.pos] == ch.CH_STAR;
    if (is_generator) {
        s.pos += 1;
        s.skipWhitespaceAndComments();
    }

    const name = s.readIdent();
    if (name.len == 0 and !is_default) return null;
    s.skipWhitespaceAndComments();

    const generics = extractGenerics(s);
    s.skipWhitespaceAndComments();

    const raw_params = extractParamList(s);
    s.skipWhitespaceAndComments();

    var return_type = extractReturnType(s);
    if (return_type.len == 0) {
        if (is_async and is_generator) {
            return_type = "AsyncGenerator<unknown, void, unknown>";
        } else if (is_generator) {
            return_type = "Generator<unknown, void, unknown>";
        } else if (is_async) {
            return_type = "Promise<void>";
        } else {
            return_type = "void";
        }
    }

    s.skipWhitespaceAndComments();
    var has_body = false;
    if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) {
        has_body = true;
        _ = s.findMatchingClose(ch.CH_LBRACE, ch.CH_RBRACE);
    } else if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) {
        s.pos += 1;
    }

    const dts_params = buildDtsParams(s, raw_params);
    const func_name = if (name.len > 0) name else "default";

    // Build DTS text — single alloc + memcpy is cheaper than ArrayList init +
    // multiple appendSlice + toOwnedSlice for the fixed-shape function header.
    const export_prefix: []const u8 = if (is_exported) "export " else "";
    const declare_kw = "declare function ";
    const colon_sep = ": ";
    const total = export_prefix.len + declare_kw.len + func_name.len + generics.len +
        dts_params.len + colon_sep.len + return_type.len + 1; // +1 for ';'
    const dts_text = blk: {
        const buf = s.allocator.alloc(u8, total) catch break :blk @as([]const u8, "");
        var tp: usize = 0;
        @memcpy(buf[tp..][0..export_prefix.len], export_prefix); tp += export_prefix.len;
        @memcpy(buf[tp..][0..declare_kw.len], declare_kw); tp += declare_kw.len;
        @memcpy(buf[tp..][0..func_name.len], func_name); tp += func_name.len;
        @memcpy(buf[tp..][0..generics.len], generics); tp += generics.len;
        @memcpy(buf[tp..][0..dts_params.len], dts_params); tp += dts_params.len;
        @memcpy(buf[tp..][0..colon_sep.len], colon_sep); tp += colon_sep.len;
        @memcpy(buf[tp..][0..return_type.len], return_type); tp += return_type.len;
        buf[tp] = ';';
        break :blk @as([]const u8, buf);
    };
    const comments = extractLeadingComments(s, decl_start);

    if (has_body) {
        s.putFuncBodyIndex(s.declarations.items.len);
    }

    return .{
        .kind = .function_decl,
        .name = func_name,
        .text = dts_text,
        .is_exported = is_exported,
        .is_default = is_default,
        .is_async = is_async,
        .is_generator = is_generator,
        .generics = generics,
        .leading_comments = comments,
        .start = decl_start,
        .end = s.pos,
        .has_body = has_body,
    };
}

// ========================================================================
// Variable extraction
// ========================================================================

/// Extract variable declaration(s)
pub fn extractVariable(s: *Scanner, decl_start: usize, kind: []const u8, is_exported: bool) []const Declaration {
    s.pos += kind.len; // skip const/let/var
    s.skipWhitespaceAndComments();

    var results = std.array_list.Managed(Declaration).init(s.allocator);
    results.ensureTotalCapacity(2) catch {};

    if (s.pos >= s.len) return results.toOwnedSlice() catch &.{};

    const c = s.source[s.pos];
    // Skip destructuring patterns
    if (c == ch.CH_LBRACE or c == ch.CH_LBRACKET) {
        s.skipToStatementEnd();
        return results.toOwnedSlice() catch &.{};
    }

    const name = s.readIdent();
    if (name.len == 0) {
        s.skipToStatementEnd();
        return results.toOwnedSlice() catch &.{};
    }
    s.skipWhitespaceAndComments();

    var type_annotation: []const u8 = "";
    var initializer_text: []const u8 = "";
    var is_as_const = false;

    // Type annotation
    if (s.pos < s.len and s.source[s.pos] == ch.CH_COLON) {
        s.pos += 1;
        s.skipWhitespaceAndComments();
        const type_start = s.pos;
        var depth: isize = 0;
        while (s.pos < s.len) {
            if (s.skipNonCode()) continue;
            const tc = s.source[s.pos];
            if (tc == ch.CH_LPAREN or tc == ch.CH_LBRACE or tc == ch.CH_LBRACKET or tc == ch.CH_LANGLE) {
                depth += 1;
            } else if (tc == ch.CH_RPAREN or tc == ch.CH_RBRACE or tc == ch.CH_RBRACKET or (tc == ch.CH_RANGLE and !s.isArrowGT())) {
                depth -= 1;
            } else if (depth == 0 and (tc == ch.CH_EQUAL or tc == ch.CH_SEMI or tc == ch.CH_COMMA)) {
                break;
            }
            if (depth == 0 and s.checkASITopLevel()) break;
            s.pos += 1;
        }
        type_annotation = s.sliceTrimmed(type_start, s.pos);
    }

    // Initializer
    if (s.pos < s.len and s.source[s.pos] == ch.CH_EQUAL) {
        if (s.isolated_declarations and type_annotation.len > 0 and !type_inf.isGenericType(type_annotation)) {
            s.skipToStatementEnd();
        } else {
            s.pos += 1;
            s.skipWhitespaceAndComments();
            const init_start = s.pos;
            var depth: isize = 0;
            while (s.pos < s.len) {
                // SIMD fast-skip: bulk-skip bytes that can't be structural
                if (depth > 0) {
                    while (s.pos + 16 <= s.len) {
                        const chunk: @Vector(16, u8) = s.source[s.pos..][0..16].*;
                        const interesting = (chunk == @as(@Vector(16, u8), @splat(ch.CH_LPAREN))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_RPAREN))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_LBRACE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_RBRACE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_LBRACKET))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_RBRACKET))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_LANGLE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_RANGLE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_SQUOTE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_DQUOTE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_BACKTICK))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_SLASH)));
                        if (!@reduce(.Or, interesting)) {
                            s.pos += 16;
                        } else {
                            break;
                        }
                    }
                } else {
                    while (s.pos + 16 <= s.len) {
                        const chunk: @Vector(16, u8) = s.source[s.pos..][0..16].*;
                        const interesting = (chunk == @as(@Vector(16, u8), @splat(ch.CH_LPAREN))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_RPAREN))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_LBRACE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_RBRACE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_LBRACKET))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_RBRACKET))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_LANGLE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_RANGLE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_SQUOTE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_DQUOTE))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_BACKTICK))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_SLASH))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_SEMI))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_COMMA))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_LF))) |
                            (chunk == @as(@Vector(16, u8), @splat(ch.CH_CR)));
                        if (!@reduce(.Or, interesting)) {
                            s.pos += 16;
                        } else {
                            break;
                        }
                    }
                }
                if (s.pos >= s.len) break;
                if (s.skipNonCode()) continue;
                const ic = s.source[s.pos];
                if (ic == ch.CH_LPAREN or ic == ch.CH_LBRACE or ic == ch.CH_LBRACKET or ic == ch.CH_LANGLE) {
                    depth += 1;
                } else if (ic == ch.CH_RPAREN or ic == ch.CH_RBRACE or ic == ch.CH_RBRACKET or (ic == ch.CH_RANGLE and !s.isArrowGT())) {
                    depth -= 1;
                } else if (depth == 0 and (ic == ch.CH_SEMI or ic == ch.CH_COMMA)) {
                    break;
                }
                if (depth == 0 and s.checkASITopLevel()) break;
                s.pos += 1;
            }
            initializer_text = s.sliceTrimmed(init_start, s.pos);
            if (ch.endsWith(initializer_text, " as const") or std.mem.eql(u8, initializer_text, "const")) {
                is_as_const = true;
                if (type_annotation.len == 0) {
                    const val = if (ch.endsWith(initializer_text, " as const"))
                        std.mem.trim(u8, initializer_text[0 .. initializer_text.len - 9], " \t\r\n")
                    else
                        initializer_text;
                    const lit = inferLiteralType(val);
                    if (!std.mem.eql(u8, lit, "unknown")) {
                        type_annotation = lit;
                    }
                }
            } else if (type_annotation.len == 0) {
                const as_type = extractAssertion(initializer_text);
                if (as_type) |t| type_annotation = t;
            }
        }
    }

    // Skip comma or semicolon
    if (s.pos < s.len) {
        const sc = s.source[s.pos];
        if (sc == ch.CH_SEMI) s.pos += 1;
    }

    const comments = extractLeadingComments(s, decl_start);
    const final_type = if (type_annotation.len > 0) type_annotation else "unknown";

    // Build DTS text — direct alloc (no ArrayList overhead).
    const export_prefix: []const u8 = if (is_exported) "export " else "";
    const declare_kw = "declare ";
    const total = export_prefix.len + declare_kw.len + kind.len + 1 + name.len + 2 + final_type.len + 1;
    const text_buf = blk: {
        const buf = s.allocator.alloc(u8, total) catch break :blk @as([]const u8, "");
        var tp: usize = 0;
        @memcpy(buf[tp..][0..export_prefix.len], export_prefix); tp += export_prefix.len;
        @memcpy(buf[tp..][0..declare_kw.len], declare_kw); tp += declare_kw.len;
        @memcpy(buf[tp..][0..kind.len], kind); tp += kind.len;
        buf[tp] = ' '; tp += 1;
        @memcpy(buf[tp..][0..name.len], name); tp += name.len;
        @memcpy(buf[tp..][0..2], ": "); tp += 2;
        @memcpy(buf[tp..][0..final_type.len], final_type); tp += final_type.len;
        buf[tp] = ';';
        break :blk @as([]const u8, buf);
    };

    // Store the variable kind in modifiers
    const mods = s.allocator.alloc([]const u8, 1) catch null;
    if (mods) |m| {
        m[0] = kind;
    }

    results.append(.{
        .kind = .variable_decl,
        .name = name,
        .text = text_buf,
        .is_exported = is_exported,
        .modifiers = mods,
        .type_annotation = type_annotation,
        .value = initializer_text,
        .leading_comments = comments,
        .start = decl_start,
        .end = s.pos,
    }) catch {};

    return results.toOwnedSlice() catch &.{};
}

// ========================================================================
// Interface extraction
// ========================================================================

/// Extract interface declaration
pub fn extractInterface(s: *Scanner, decl_start: usize, is_exported: bool) Declaration {
    s.pos += 9; // skip 'interface'
    s.skipWhitespaceAndComments();

    const name = s.readIdent();
    s.skipWhitespaceAndComments();

    const generics = extractGenerics(s);
    s.skipWhitespaceAndComments();

    var extends_clause: []const u8 = "";
    if (s.matchWord("extends")) {
        s.pos += 7;
        s.skipWhitespaceAndComments();
        const ext_start = s.pos;
        var depth: isize = 0;
        while (s.pos < s.len) {
            if (s.skipNonCode()) continue;
            const c = s.source[s.pos];
            if (c == ch.CH_LANGLE) {
                depth += 1;
            } else if (c == ch.CH_RANGLE and !s.isArrowGT()) {
                depth -= 1;
            } else if (c == ch.CH_LBRACE and depth == 0) {
                break;
            }
            s.pos += 1;
        }
        extends_clause = s.sliceTrimmed(ext_start, s.pos);
    }

    s.skipWhitespaceAndComments();
    const raw_body = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) s.extractBraceBlock() else "{}";
    const body = cleanBraceBlock(s, raw_body);

    // Build DTS text — direct alloc + memcpy for better cache behavior on the
    // many-interfaces hot path.
    const export_prefix: []const u8 = if (is_exported) "export " else "";
    const declare_kw = "declare interface ";
    const extends_kw: []const u8 = if (extends_clause.len > 0) " extends " else "";
    const total = export_prefix.len + declare_kw.len + name.len + generics.len +
        extends_kw.len + extends_clause.len + 1 + body.len;
    const text = blk: {
        const buf = s.allocator.alloc(u8, total) catch break :blk @as([]const u8, "");
        var tp: usize = 0;
        @memcpy(buf[tp..][0..export_prefix.len], export_prefix); tp += export_prefix.len;
        @memcpy(buf[tp..][0..declare_kw.len], declare_kw); tp += declare_kw.len;
        @memcpy(buf[tp..][0..name.len], name); tp += name.len;
        @memcpy(buf[tp..][0..generics.len], generics); tp += generics.len;
        @memcpy(buf[tp..][0..extends_kw.len], extends_kw); tp += extends_kw.len;
        @memcpy(buf[tp..][0..extends_clause.len], extends_clause); tp += extends_clause.len;
        buf[tp] = ' '; tp += 1;
        @memcpy(buf[tp..][0..body.len], body); tp += body.len;
        break :blk @as([]const u8, buf);
    };

    const comments = extractLeadingComments(s, decl_start);

    return .{
        .kind = .interface_decl,
        .name = name,
        .text = text,
        .is_exported = is_exported,
        .extends_clause = extends_clause,
        .generics = generics,
        .leading_comments = comments,
        .start = decl_start,
        .end = s.pos,
    };
}

// ========================================================================
// Type alias extraction
// ========================================================================

/// Extract type alias declaration
pub fn extractTypeAlias(s: *Scanner, decl_start: usize, is_exported: bool) Declaration {
    s.pos += 4; // skip 'type'
    s.skipWhitespaceAndComments();

    const name = s.readIdent();
    s.skipWhitespaceAndComments();

    const generics = extractGenerics(s);
    s.skipWhitespaceAndComments();

    if (s.pos < s.len and s.source[s.pos] == ch.CH_EQUAL) s.pos += 1;
    s.skipWhitespaceAndComments();

    const type_start = s.pos;
    var depth: isize = 0;
    while (s.pos < s.len) {
        if (s.skipNonCode()) continue;
        const c = s.source[s.pos];
        if (c == ch.CH_LPAREN or c == ch.CH_LBRACE or c == ch.CH_LBRACKET or c == ch.CH_LANGLE) {
            depth += 1;
        } else if (c == ch.CH_RPAREN or c == ch.CH_RBRACE or c == ch.CH_RBRACKET or (c == ch.CH_RANGLE and !s.isArrowGT())) {
            depth -= 1;
        } else if (depth == 0 and c == ch.CH_SEMI) {
            break;
        }
        if (depth == 0 and s.checkASITopLevel()) break;
        s.pos += 1;
    }
    const type_body = s.sliceTrimmed(type_start, s.pos);
    if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) s.pos += 1;

    // Direct alloc — fixed-shape "[export ]type name<G> = body".
    const export_prefix: []const u8 = if (is_exported) "export " else "";
    const type_kw = "type ";
    const eq_sep = " = ";
    const total = export_prefix.len + type_kw.len + name.len + generics.len + eq_sep.len + type_body.len;
    const text = blk: {
        const buf = s.allocator.alloc(u8, total) catch break :blk @as([]const u8, "");
        var tp: usize = 0;
        @memcpy(buf[tp..][0..export_prefix.len], export_prefix); tp += export_prefix.len;
        @memcpy(buf[tp..][0..type_kw.len], type_kw); tp += type_kw.len;
        @memcpy(buf[tp..][0..name.len], name); tp += name.len;
        @memcpy(buf[tp..][0..generics.len], generics); tp += generics.len;
        @memcpy(buf[tp..][0..eq_sep.len], eq_sep); tp += eq_sep.len;
        @memcpy(buf[tp..][0..type_body.len], type_body); tp += type_body.len;
        break :blk @as([]const u8, buf);
    };

    const comments = extractLeadingComments(s, decl_start);

    return .{
        .kind = .type_decl,
        .name = name,
        .text = text,
        .is_exported = is_exported,
        .generics = generics,
        .leading_comments = comments,
        .start = decl_start,
        .end = s.pos,
    };
}

// ========================================================================
// Enum extraction
// ========================================================================

/// Extract enum declaration
pub fn extractEnum(s: *Scanner, decl_start: usize, is_exported: bool, is_const: bool) Declaration {
    s.pos += 4; // skip 'enum'
    s.skipWhitespaceAndComments();

    const name = s.readIdent();
    s.skipWhitespaceAndComments();

    if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) {
        _ = s.findMatchingClose(ch.CH_LBRACE, ch.CH_RBRACE);
    }

    const raw_text = s.sliceTrimmed(decl_start, s.pos);
    const comments = extractLeadingComments(s, decl_start);

    // Store const modifier
    const mods: ?[]const []const u8 = if (is_const) blk: {
        const mod_list = s.allocator.alloc([]const u8, 1) catch break :blk null;
        mod_list[0] = "const";
        break :blk mod_list;
    } else null;

    return .{
        .kind = .enum_decl,
        .name = name,
        .text = raw_text,
        .is_exported = is_exported,
        .modifiers = mods,
        .leading_comments = comments,
        .start = decl_start,
        .end = s.pos,
    };
}

// ========================================================================
// Class extraction
// ========================================================================

/// Extract class declaration and build DTS
pub fn extractClass(s: *Scanner, decl_start: usize, is_exported: bool, is_abstract: bool) Declaration {
    s.pos += 5; // skip 'class'
    s.skipWhitespaceAndComments();

    const name_raw = s.readIdent();
    const name = if (name_raw.len > 0) name_raw else "AnonymousClass";
    s.skipWhitespaceAndComments();

    const generics = extractGenerics(s);
    s.skipWhitespaceAndComments();

    var extends_clause: []const u8 = "";
    if (s.matchWord("extends")) {
        s.pos += 7;
        s.skipWhitespaceAndComments();
        const ext_start = s.pos;
        var depth: isize = 0;
        while (s.pos < s.len) {
            if (s.skipNonCode()) continue;
            const c = s.source[s.pos];
            if (c == ch.CH_LANGLE) {
                depth += 1;
            } else if (c == ch.CH_RANGLE and !s.isArrowGT()) {
                depth -= 1;
            } else if (depth == 0 and (c == ch.CH_LBRACE or s.matchWord("implements"))) {
                break;
            }
            s.pos += 1;
        }
        extends_clause = s.sliceTrimmed(ext_start, s.pos);
    }

    var implements_text: []const u8 = "";
    if (s.matchWord("implements")) {
        s.pos += 10;
        s.skipWhitespaceAndComments();
        const impl_start = s.pos;
        var depth: isize = 0;
        while (s.pos < s.len) {
            if (s.skipNonCode()) continue;
            const c = s.source[s.pos];
            if (c == ch.CH_LANGLE) {
                depth += 1;
            } else if (c == ch.CH_RANGLE and !s.isArrowGT()) {
                depth -= 1;
            } else if (depth == 0 and c == ch.CH_LBRACE) {
                break;
            }
            s.pos += 1;
        }
        implements_text = s.sliceTrimmed(impl_start, s.pos);
    }

    s.skipWhitespaceAndComments();
    const class_body = buildClassBodyDts(s);

    // Build DTS text — direct alloc + memcpy.
    const export_prefix: []const u8 = if (is_exported) "export " else "";
    const declare_kw = "declare ";
    const abstract_kw: []const u8 = if (is_abstract) "abstract " else "";
    const class_kw = "class ";
    const extends_sep: []const u8 = if (extends_clause.len > 0) " extends " else "";
    const implements_sep: []const u8 = if (implements_text.len > 0) " implements " else "";
    const total = export_prefix.len + declare_kw.len + abstract_kw.len + class_kw.len +
        name.len + generics.len + extends_sep.len + extends_clause.len +
        implements_sep.len + implements_text.len + 1 + class_body.len;
    const text = blk: {
        const buf = s.allocator.alloc(u8, total) catch break :blk @as([]const u8, "");
        var tp: usize = 0;
        @memcpy(buf[tp..][0..export_prefix.len], export_prefix); tp += export_prefix.len;
        @memcpy(buf[tp..][0..declare_kw.len], declare_kw); tp += declare_kw.len;
        @memcpy(buf[tp..][0..abstract_kw.len], abstract_kw); tp += abstract_kw.len;
        @memcpy(buf[tp..][0..class_kw.len], class_kw); tp += class_kw.len;
        @memcpy(buf[tp..][0..name.len], name); tp += name.len;
        @memcpy(buf[tp..][0..generics.len], generics); tp += generics.len;
        @memcpy(buf[tp..][0..extends_sep.len], extends_sep); tp += extends_sep.len;
        @memcpy(buf[tp..][0..extends_clause.len], extends_clause); tp += extends_clause.len;
        @memcpy(buf[tp..][0..implements_sep.len], implements_sep); tp += implements_sep.len;
        @memcpy(buf[tp..][0..implements_text.len], implements_text); tp += implements_text.len;
        buf[tp] = ' '; tp += 1;
        @memcpy(buf[tp..][0..class_body.len], class_body); tp += class_body.len;
        break :blk @as([]const u8, buf);
    };

    const comments = extractLeadingComments(s, decl_start);

    return .{
        .kind = .class_decl,
        .name = name,
        .text = text,
        .is_exported = is_exported,
        .extends_clause = extends_clause,
        .generics = generics,
        .leading_comments = comments,
        .start = decl_start,
        .end = s.pos,
    };
}

/// Build class body DTS (members only, no implementations)
fn buildClassBodyDts(s: *Scanner) []const u8 {
    if (s.pos >= s.len or s.source[s.pos] != ch.CH_LBRACE) return "{}";
    s.pos += 1; // skip {

    var members = std.array_list.Managed([]const u8).init(s.allocator);
    members.ensureTotalCapacity(16) catch {};

    while (s.pos < s.len) {
        s.skipWhitespaceAndComments();
        if (s.pos >= s.len) break;
        if (s.source[s.pos] == ch.CH_RBRACE) {
            s.pos += 1;
            break;
        }
        if (s.source[s.pos] == ch.CH_SEMI) {
            s.pos += 1;
            continue;
        }

        // Skip static blocks
        if (s.matchWord("static") and s.peekAfterWord("static") == ch.CH_LBRACE) {
            s.pos += 6;
            s.skipWhitespaceAndComments();
            _ = s.findMatchingClose(ch.CH_LBRACE, ch.CH_RBRACE);
            continue;
        }

        // Collect modifiers
        var is_private = false;
        var is_protected = false;
        var is_static = false;
        var is_abstract = false;
        var is_readonly = false;
        var is_async = false;

        while (true) {
            s.skipWhitespaceAndComments();
            if (s.pos >= s.len) break;
            // First-byte dispatch — most class members have at most one or two
            // modifiers. The previous code ran up to 10 matchWord calls per
            // member iteration; this lets us reject most bytes immediately.
            const mc = s.source[s.pos];
            switch (mc) {
                'p' => {
                    if (s.matchWord("private")) { is_private = true; s.pos += 7; }
                    else if (s.matchWord("protected")) { is_protected = true; s.pos += 9; }
                    else if (s.matchWord("public")) { s.pos += 6; }
                    else break;
                },
                's' => {
                    if (s.matchWord("static")) { is_static = true; s.pos += 6; }
                    else break;
                },
                'a' => {
                    if (s.matchWord("abstract")) { is_abstract = true; s.pos += 8; }
                    else if (s.matchWord("accessor")) { s.pos += 8; }
                    else if (s.matchWord("async")) { is_async = true; s.pos += 5; }
                    else break;
                },
                'r' => {
                    if (s.matchWord("readonly")) { is_readonly = true; s.pos += 8; }
                    else break;
                },
                'o' => {
                    if (s.matchWord("override")) { s.pos += 8; }
                    else break;
                },
                'd' => {
                    if (s.matchWord("declare")) { s.pos += 7; }
                    else break;
                },
                else => break,
            }
        }

        s.skipWhitespaceAndComments();
        if (s.pos >= s.len or s.source[s.pos] == ch.CH_RBRACE) break;

        // Skip private # members
        if (s.source[s.pos] == ch.CH_HASH) is_private = true;

        if (is_private) {
            s.skipClassMember();
            continue;
        }

        // Build modifier prefix — direct alloc + memcpy beats ArrayList for the
        // ≤4 known fixed-length tokens. Saves an ArrayList init + toOwnedSlice
        // shrink per class member.
        const proto_len: usize = 2 +
            @as(usize, if (is_protected) "protected ".len else 0) +
            @as(usize, if (is_static) "static ".len else 0) +
            @as(usize, if (is_abstract) "abstract ".len else 0) +
            @as(usize, if (is_readonly) "readonly ".len else 0);
        const prefix = blk: {
            const pbuf = s.allocator.alloc(u8, proto_len) catch break :blk @as([]const u8, "  ");
            pbuf[0] = ' '; pbuf[1] = ' ';
            var pp: usize = 2;
            if (is_protected) { @memcpy(pbuf[pp..][0.."protected ".len], "protected "); pp += "protected ".len; }
            if (is_static) { @memcpy(pbuf[pp..][0.."static ".len], "static "); pp += "static ".len; }
            if (is_abstract) { @memcpy(pbuf[pp..][0.."abstract ".len], "abstract "); pp += "abstract ".len; }
            if (is_readonly) { @memcpy(pbuf[pp..][0.."readonly ".len], "readonly "); pp += "readonly ".len; }
            break :blk @as([]const u8, pbuf);
        };

        // Detect member type
        if (s.matchWord("constructor")) {
            s.pos += 11;
            s.skipWhitespaceAndComments();
            const raw_params = extractParamList(s);
            s.skipWhitespaceAndComments();

            // Extract parameter properties
            extractParamProperties(s, raw_params, &members);

            // Skip constructor body
            if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) {
                _ = s.findMatchingClose(ch.CH_LBRACE, ch.CH_RBRACE);
            } else if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) {
                s.pos += 1;
            }

            const dts_params = buildDtsParams(s, raw_params);
            // Direct alloc — fixed-shape "  constructor<params>;".
            const ctor_prefix = "  constructor";
            const ctor_total = ctor_prefix.len + dts_params.len + 1;
            const ctor_buf = s.allocator.alloc(u8, ctor_total) catch break;
            @memcpy(ctor_buf[0..ctor_prefix.len], ctor_prefix);
            @memcpy(ctor_buf[ctor_prefix.len..][0..dts_params.len], dts_params);
            ctor_buf[ctor_total - 1] = ';';
            members.append(ctor_buf) catch {};
        } else if (s.matchWord("get") and isAccessorFollowed(s)) {
            s.pos += 3;
            s.skipWhitespaceAndComments();
            const member_name = s.readMemberName();
            if (ch.startsWith(member_name, "#")) {
                skipAccessorBody(s);
                continue;
            }
            s.skipWhitespaceAndComments();
            _ = extractParamList(s);
            s.skipWhitespaceAndComments();
            const ret_type_raw = extractReturnType(s);
            const ret_type = if (ret_type_raw.len > 0) ret_type_raw else "unknown";
            s.skipWhitespaceAndComments();
            if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) {
                _ = s.findMatchingClose(ch.CH_LBRACE, ch.CH_RBRACE);
            } else if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) {
                s.pos += 1;
            }
            // Direct alloc — fixed shape "<prefix>get <name>(): <ret>;".
            const get_kw = "get ";
            const get_sep = "(): ";
            const get_total = prefix.len + get_kw.len + member_name.len + get_sep.len + ret_type.len + 1;
            const get_buf = s.allocator.alloc(u8, get_total) catch break;
            var gp: usize = 0;
            @memcpy(get_buf[gp..][0..prefix.len], prefix); gp += prefix.len;
            @memcpy(get_buf[gp..][0..get_kw.len], get_kw); gp += get_kw.len;
            @memcpy(get_buf[gp..][0..member_name.len], member_name); gp += member_name.len;
            @memcpy(get_buf[gp..][0..get_sep.len], get_sep); gp += get_sep.len;
            @memcpy(get_buf[gp..][0..ret_type.len], ret_type); gp += ret_type.len;
            get_buf[gp] = ';';
            members.append(get_buf) catch {};
        } else if (s.matchWord("set") and isAccessorFollowed(s)) {
            s.pos += 3;
            s.skipWhitespaceAndComments();
            const member_name = s.readMemberName();
            if (ch.startsWith(member_name, "#")) {
                skipAccessorBody(s);
                continue;
            }
            s.skipWhitespaceAndComments();
            const raw_params = extractParamList(s);
            s.skipWhitespaceAndComments();
            if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) {
                _ = s.findMatchingClose(ch.CH_LBRACE, ch.CH_RBRACE);
            } else if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) {
                s.pos += 1;
            }
            const dts_params = buildDtsParams(s, raw_params);
            // Direct alloc — fixed shape "<prefix>set <name><params>;".
            const set_kw = "set ";
            const set_total = prefix.len + set_kw.len + member_name.len + dts_params.len + 1;
            const set_buf = s.allocator.alloc(u8, set_total) catch break;
            var sp: usize = 0;
            @memcpy(set_buf[sp..][0..prefix.len], prefix); sp += prefix.len;
            @memcpy(set_buf[sp..][0..set_kw.len], set_kw); sp += set_kw.len;
            @memcpy(set_buf[sp..][0..member_name.len], member_name); sp += member_name.len;
            @memcpy(set_buf[sp..][0..dts_params.len], dts_params); sp += dts_params.len;
            set_buf[sp] = ';';
            members.append(set_buf) catch {};
        } else {
            // Regular method or property
            const is_generator = s.source[s.pos] == ch.CH_STAR;
            if (is_generator) {
                s.pos += 1;
                s.skipWhitespaceAndComments();
            }
            const member_name = s.readMemberName();
            if (member_name.len == 0) {
                s.skipClassMember();
                continue;
            }
            handleMethodOrPropertyAfterName(s, member_name, prefix, is_static, is_readonly, is_generator, is_abstract, is_async, &members);
        }
    }

    if (members.items.len == 0) return "{}";

    // Join members — direct alloc + memcpy. Total = "{\n" + members joined by
    // '\n' + "\n}". Previously used ArrayList with per-member appendSlice + a
    // boundary conditional inside the loop.
    var total_len: usize = 4; // "{\n" (2) + "\n}" (2)
    for (members.items) |m| total_len += m.len;
    total_len += members.items.len - 1; // newlines between
    const buf = s.allocator.alloc(u8, total_len) catch return "{}";
    buf[0] = '{'; buf[1] = '\n';
    var rp: usize = 2;
    @memcpy(buf[rp..][0..members.items[0].len], members.items[0]);
    rp += members.items[0].len;
    for (members.items[1..]) |m| {
        buf[rp] = '\n'; rp += 1;
        @memcpy(buf[rp..][0..m.len], m);
        rp += m.len;
    }
    buf[rp] = '\n'; rp += 1;
    buf[rp] = '}'; rp += 1;
    return buf[0..rp];
}

fn isAccessorFollowed(s: *const Scanner) bool {
    // Both "get" and "set" are 3 chars — the caller already verified one matched.
    // Inspect the byte at +3 directly instead of calling matchWord again.
    const next_after = s.peekAfterWord("get"); // length is what matters; "get".len == "set".len
    return next_after != 0 and (ch.isIdentStart(next_after) or next_after == ch.CH_LBRACKET or next_after == ch.CH_HASH);
}

fn skipAccessorBody(s: *Scanner) void {
    s.skipWhitespaceAndComments();
    if (s.pos < s.len and s.source[s.pos] == ch.CH_LPAREN) _ = extractParamList(s);
    s.skipWhitespaceAndComments();
    _ = extractReturnType(s);
    s.skipWhitespaceAndComments();
    if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) {
        _ = s.findMatchingClose(ch.CH_LBRACE, ch.CH_RBRACE);
    } else if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) {
        s.pos += 1;
    }
}

/// Handle method or property after reading member name
fn handleMethodOrPropertyAfterName(s: *Scanner, member_name: []const u8, mod_prefix: []const u8, is_static: bool, is_readonly: bool, is_generator: bool, is_abstract: bool, is_async: bool, members: *std.array_list.Managed([]const u8)) void {
    _ = is_abstract;
    s.skipWhitespaceAndComments();
    if (s.pos >= s.len) return;

    var c = s.source[s.pos];
    var is_optional = false;
    if (c == ch.CH_QUESTION) {
        is_optional = true;
        s.pos += 1;
        s.skipWhitespaceAndComments();
    }
    // Definite assignment !
    if (s.pos < s.len and s.source[s.pos] == ch.CH_EXCL) {
        s.pos += 1;
        s.skipWhitespaceAndComments();
    }

    const next_ch: u8 = if (s.pos < s.len) s.source[s.pos] else 0;

    if (next_ch == ch.CH_LPAREN or next_ch == ch.CH_LANGLE) {
        // Method
        const generics = if (next_ch == ch.CH_LANGLE) extractGenerics(s) else "";
        s.skipWhitespaceAndComments();
        const raw_params = extractParamList(s);
        s.skipWhitespaceAndComments();
        var ret_type = extractReturnType(s);
        if (ret_type.len == 0) {
            if (is_async and is_generator) {
                ret_type = "AsyncGenerator<unknown, void, unknown>";
            } else if (is_generator) {
                ret_type = "Generator<unknown, void, unknown>";
            } else if (is_async) {
                ret_type = "Promise<void>";
            } else {
                ret_type = "void";
            }
        }
        s.skipWhitespaceAndComments();
        if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) {
            _ = s.findMatchingClose(ch.CH_LBRACE, ch.CH_RBRACE);
        } else if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) {
            s.pos += 1;
        }
        const dts_params = buildDtsParams(s, raw_params);
        const opt_mark: []const u8 = if (is_optional) "?" else "";
        const gen_text: []const u8 = if (is_generator) "*" else "";

        // Direct alloc — class methods are emitted in tight loops, so the
        // ArrayList overhead added up to a non-trivial fraction of class
        // emission time on member-heavy classes.
        const meth_total = mod_prefix.len + gen_text.len + member_name.len + opt_mark.len +
            generics.len + dts_params.len + 2 + ret_type.len + 1;
        const meth_buf = s.allocator.alloc(u8, meth_total) catch return;
        var mp: usize = 0;
        @memcpy(meth_buf[mp..][0..mod_prefix.len], mod_prefix); mp += mod_prefix.len;
        @memcpy(meth_buf[mp..][0..gen_text.len], gen_text); mp += gen_text.len;
        @memcpy(meth_buf[mp..][0..member_name.len], member_name); mp += member_name.len;
        @memcpy(meth_buf[mp..][0..opt_mark.len], opt_mark); mp += opt_mark.len;
        @memcpy(meth_buf[mp..][0..generics.len], generics); mp += generics.len;
        @memcpy(meth_buf[mp..][0..dts_params.len], dts_params); mp += dts_params.len;
        @memcpy(meth_buf[mp..][0..2], ": "); mp += 2;
        @memcpy(meth_buf[mp..][0..ret_type.len], ret_type); mp += ret_type.len;
        meth_buf[mp] = ';';
        members.append(meth_buf) catch {};
    } else if (next_ch == ch.CH_COLON or next_ch == ch.CH_EQUAL or next_ch == ch.CH_SEMI or next_ch == ch.CH_RBRACE or next_ch == ch.CH_LF or next_ch == ch.CH_CR) {
        // Property
        var prop_type: []const u8 = "";
        if (next_ch == ch.CH_COLON) {
            s.pos += 1;
            s.skipWhitespaceAndComments();
            const type_start = s.pos;
            var depth: isize = 0;
            while (s.pos < s.len) {
                if (s.skipNonCode()) continue;
                c = s.source[s.pos];
                if (c == ch.CH_LPAREN or c == ch.CH_LBRACE or c == ch.CH_LBRACKET or c == ch.CH_LANGLE) {
                    depth += 1;
                } else if (c == ch.CH_RPAREN or c == ch.CH_RBRACE or c == ch.CH_RBRACKET or (c == ch.CH_RANGLE and !s.isArrowGT())) {
                    if (depth == 0) break;
                    depth -= 1;
                } else if (depth == 0 and (c == ch.CH_SEMI or c == ch.CH_EQUAL or c == ch.CH_COMMA)) {
                    break;
                }
                if (depth == 0 and s.checkASIMember()) break;
                s.pos += 1;
            }
            prop_type = s.sliceTrimmed(type_start, s.pos);
        }

        // Capture initializer
        var init_text: []const u8 = "";
        if (s.pos < s.len and s.source[s.pos] == ch.CH_EQUAL) {
            s.pos += 1;
            s.skipWhitespaceAndComments();
            const init_start = s.pos;
            var depth: isize = 0;
            while (s.pos < s.len) {
                if (s.skipNonCode()) continue;
                const ic = s.source[s.pos];
                if (ic == ch.CH_LPAREN or ic == ch.CH_LBRACE or ic == ch.CH_LBRACKET) {
                    depth += 1;
                } else if (ic == ch.CH_RPAREN or ic == ch.CH_RBRACE or ic == ch.CH_RBRACKET) {
                    if (depth == 0 and ic == ch.CH_RBRACE) break;
                    depth -= 1;
                } else if (depth == 0 and ic == ch.CH_SEMI) {
                    break;
                }
                if (depth == 0 and s.checkASIMember()) break;
                s.pos += 1;
            }
            init_text = s.sliceTrimmed(init_start, s.pos);
        }

        if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) s.pos += 1;

        if (prop_type.len == 0) {
            if (init_text.len > 0) {
                const as_type = extractAssertion(init_text);
                if (as_type) |t| {
                    prop_type = t;
                } else {
                    const is_const_like = is_static and is_readonly;
                    prop_type = if (is_const_like) inferLiteralType(init_text) else inferTypeFromDefault(init_text);
                }
            } else {
                prop_type = "unknown";
            }
        }

        const opt_mark: []const u8 = if (is_optional) "?" else "";
        // Direct alloc — fixed shape "<prefix><name>[?]: <type>;".
        const prop_total = mod_prefix.len + member_name.len + opt_mark.len + 2 + prop_type.len + 1;
        const prop_buf = s.allocator.alloc(u8, prop_total) catch return;
        var pp: usize = 0;
        @memcpy(prop_buf[pp..][0..mod_prefix.len], mod_prefix); pp += mod_prefix.len;
        @memcpy(prop_buf[pp..][0..member_name.len], member_name); pp += member_name.len;
        @memcpy(prop_buf[pp..][0..opt_mark.len], opt_mark); pp += opt_mark.len;
        @memcpy(prop_buf[pp..][0..2], ": "); pp += 2;
        @memcpy(prop_buf[pp..][0..prop_type.len], prop_type); pp += prop_type.len;
        prop_buf[pp] = ';';
        members.append(prop_buf) catch {};
    } else {
        s.skipClassMember();
    }
}

/// Extract parameter properties from constructor params
fn extractParamProperties(s: *Scanner, raw_params: []const u8, members: *std.array_list.Managed([]const u8)) void {
    if (raw_params.len < 2) return;
    const inner = std.mem.trim(u8, raw_params[1 .. raw_params.len - 1], " \t\r\n");
    if (inner.len == 0) return;

    // Split by comma at depth 0
    var params = std.array_list.Managed([]const u8).init(s.allocator);
    var start: usize = 0;
    var depth: isize = 0;
    var in_str = false;
    var str_ch_val: u8 = 0;
    var skip_next3 = false;
    for (inner, 0..) |c, i| {
        if (skip_next3) {
            skip_next3 = false;
            continue;
        }
        if (in_str) {
            if (c == ch.CH_BACKSLASH) {
                skip_next3 = true;
                continue;
            }
            if (c == str_ch_val) in_str = false;
            continue;
        }
        if (c == ch.CH_SQUOTE or c == ch.CH_DQUOTE or c == ch.CH_BACKTICK) {
            in_str = true;
            str_ch_val = c;
            continue;
        }
        if (c == ch.CH_LPAREN or c == ch.CH_LBRACE or c == ch.CH_LBRACKET or c == ch.CH_LANGLE) {
            depth += 1;
        } else if (c == ch.CH_RPAREN or c == ch.CH_RBRACE or c == ch.CH_RBRACKET or c == ch.CH_RANGLE) {
            depth -= 1;
        } else if (c == ch.CH_COMMA and depth == 0) {
            params.append(std.mem.trim(u8, inner[start..i], " \t\r\n")) catch {};
            start = i + 1;
        }
    }
    params.append(std.mem.trim(u8, inner[start..], " \t\r\n")) catch {};

    for (params.items) |param| {
        if (param.len == 0) continue;
        // First-byte fast-fail — only constructor params starting with 'p' or
        // 'r' can carry an access modifier, so reject everything else without
        // running the four startsWith / contains scans.
        const first = param[0];
        if (first != 'p' and first != 'r') continue;

        const has_public = first == 'p' and (ch.startsWith(param, "public ") or ch.startsWith(param, "public\t"));
        const has_protected = first == 'p' and (ch.startsWith(param, "protected ") or ch.startsWith(param, "protected\t"));
        const has_private = first == 'p' and (ch.startsWith(param, "private ") or ch.startsWith(param, "private\t"));
        const has_readonly = (first == 'r' and (ch.startsWith(param, "readonly ") or ch.startsWith(param, "readonly\t"))) or ch.contains(param, " readonly ");

        if (!has_public and !has_protected and !has_private and !has_readonly) continue;
        if (has_private) continue;

        var p = param;
        if (has_public) {
            var si: usize = 6;
            while (si < p.len and ch.isWhitespace(p[si])) si += 1;
            p = p[si..];
        }
        if (has_protected) {
            var si: usize = 9;
            while (si < p.len and ch.isWhitespace(p[si])) si += 1;
            p = p[si..];
        }
        if (has_readonly) {
            if (ch.indexOf(p, "readonly ", 0)) |ri| {
                var si = ri + 8;
                while (si < p.len and ch.isWhitespace(p[si])) si += 1;
                // Reconstruct without 'readonly '
                const before = p[0..ri];
                const after = p[si..];
                const new_p = s.allocator.alloc(u8, before.len + after.len) catch continue;
                @memcpy(new_p[0..before.len], before);
                @memcpy(new_p[before.len..], after);
                p = new_p;
            }
        }

        // Compute total mod_text length up front — at most 3 modifier tokens
        // are possible (public/protected, readonly) plus separators. Direct
        // alloc avoids the ArrayList init + per-modifier append + toOwnedSlice
        // cost the previous code paid for every parameter property.
        const dts_param = buildSingleDtsParam(s, p);
        const pub_token: []const u8 = if (has_public) "public" else "";
        const prot_token: []const u8 = if (has_protected) "protected" else "";
        const ro_token: []const u8 = if (has_readonly) "readonly" else "";
        const num_mods: usize = @as(usize, if (has_public) 1 else 0) +
            @as(usize, if (has_protected) 1 else 0) +
            @as(usize, if (has_readonly) 1 else 0);
        const mod_text_len = pub_token.len + prot_token.len + ro_token.len +
            (if (num_mods > 0) num_mods else 0); // separators + trailing space when any modifier present

        const m_total = 2 + mod_text_len + dts_param.len + 1;
        const mbuf = s.allocator.alloc(u8, m_total) catch continue;
        var mp: usize = 0;
        mbuf[mp] = ' '; mp += 1;
        mbuf[mp] = ' '; mp += 1;
        var first_mod = true;
        if (has_public) {
            @memcpy(mbuf[mp..][0..pub_token.len], pub_token); mp += pub_token.len;
            first_mod = false;
        }
        if (has_protected) {
            if (!first_mod) { mbuf[mp] = ' '; mp += 1; }
            @memcpy(mbuf[mp..][0..prot_token.len], prot_token); mp += prot_token.len;
            first_mod = false;
        }
        if (has_readonly) {
            if (!first_mod) { mbuf[mp] = ' '; mp += 1; }
            @memcpy(mbuf[mp..][0..ro_token.len], ro_token); mp += ro_token.len;
        }
        if (num_mods > 0) { mbuf[mp] = ' '; mp += 1; }
        @memcpy(mbuf[mp..][0..dts_param.len], dts_param); mp += dts_param.len;
        mbuf[mp] = ';'; mp += 1;
        members.append(mbuf[0..mp]) catch {};
    }
}

// ========================================================================
// Module/Namespace extraction
// ========================================================================

/// Extract module/namespace declaration
pub fn extractModule(s: *Scanner, decl_start: usize, is_exported: bool, keyword: []const u8) Declaration {
    s.pos += keyword.len;
    s.skipWhitespaceAndComments();

    var name: []const u8 = "";
    if (s.pos >= s.len) return .{
        .kind = .module_decl,
        .name = name,
        .text = "",
        .is_exported = is_exported,
        .start = decl_start,
        .end = s.pos,
    };
    const c = s.source[s.pos];
    if (c == ch.CH_SQUOTE or c == ch.CH_DQUOTE) {
        const quote_start = s.pos;
        s.skipString(c);
        name = s.source[quote_start..s.pos];
    } else {
        name = s.readIdent();
        while (s.pos < s.len and s.source[s.pos] == ch.CH_DOT) {
            s.pos += 1;
            const next_ident = s.readIdent();
            const new_name = s.allocator.alloc(u8, name.len + 1 + next_ident.len) catch break;
            @memcpy(new_name[0..name.len], name);
            new_name[name.len] = '.';
            @memcpy(new_name[name.len + 1 ..], next_ident);
            name = new_name;
        }
    }

    s.skipWhitespaceAndComments();
    const body = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE)
        buildNamespaceBodyDts(s, "  ")
    else
        "{}";

    // Direct alloc — fixed-shape "[export ]declare <keyword> <name> <body>".
    const export_prefix: []const u8 = if (is_exported) "export " else "";
    const declare_kw = "declare ";
    const total = export_prefix.len + declare_kw.len + keyword.len + 1 + name.len + 1 + body.len;
    const text = blk: {
        const buf = s.allocator.alloc(u8, total) catch break :blk @as([]const u8, "");
        var tp: usize = 0;
        @memcpy(buf[tp..][0..export_prefix.len], export_prefix); tp += export_prefix.len;
        @memcpy(buf[tp..][0..declare_kw.len], declare_kw); tp += declare_kw.len;
        @memcpy(buf[tp..][0..keyword.len], keyword); tp += keyword.len;
        buf[tp] = ' '; tp += 1;
        @memcpy(buf[tp..][0..name.len], name); tp += name.len;
        buf[tp] = ' '; tp += 1;
        @memcpy(buf[tp..][0..body.len], body); tp += body.len;
        break :blk @as([]const u8, buf);
    };

    const comments = extractLeadingComments(s, decl_start);
    const is_ambient = name.len > 0 and (name[0] == '\'' or name[0] == '"');

    return .{
        .kind = .module_decl,
        .name = name,
        .text = text,
        .is_exported = is_exported,
        .source_module = if (is_ambient and name.len > 2) name[1 .. name.len - 1] else "",
        .leading_comments = comments,
        .start = decl_start,
        .end = s.pos,
    };
}

/// Build DTS text for namespace/module body by processing inner declarations
pub fn buildNamespaceBodyDts(s: *Scanner, indent: []const u8) []const u8 {
    if (s.pos >= s.len or s.source[s.pos] != ch.CH_LBRACE) return "{}";
    s.pos += 1; // skip {

    var lines = std.array_list.Managed([]const u8).init(s.allocator);
    lines.ensureTotalCapacity(16) catch {};

    while (s.pos < s.len) {
        s.skipWhitespaceAndComments();
        if (s.pos >= s.len) break;
        if (s.source[s.pos] == ch.CH_RBRACE) {
            s.pos += 1;
            break;
        }
        if (s.source[s.pos] == ch.CH_SEMI) {
            s.pos += 1;
            continue;
        }

        // First-byte gate for "export"/"declare" — avoids running matchWord on
        // every byte that can't possibly start either keyword.
        var has_export = false;
        if (s.pos < s.len and s.source[s.pos] == 'e' and s.matchWord("export")) {
            has_export = true;
            s.pos += 6;
            s.skipWhitespaceAndComments();
        }
        if (s.pos < s.len and s.source[s.pos] == 'd' and s.matchWord("declare")) {
            s.pos += 7;
            s.skipWhitespaceAndComments();
        }

        const prefix: []const u8 = if (has_export) "export " else "";

        // First-byte gate: only check `function`/`async function` when the next
        // byte could start either. Saves matchWord on every other dispatch path.
        const dispatch_byte: u8 = if (s.pos < s.len) s.source[s.pos] else 0;
        if ((dispatch_byte == 'f' and s.matchWord("function")) or
            (dispatch_byte == 'a' and s.matchWord("async") and s.peekAfterKeyword("async", "function"))) {
            var is_async = false;
            if (dispatch_byte == 'a' and s.matchWord("async")) {
                is_async = true;
                s.pos += 5;
                s.skipWhitespaceAndComments();
            }
            s.pos += 8; // function
            s.skipWhitespaceAndComments();
            const is_gen = s.pos < s.len and s.source[s.pos] == ch.CH_STAR;
            if (is_gen) {
                s.pos += 1;
                s.skipWhitespaceAndComments();
            }
            const fname = s.readIdent();
            s.skipWhitespaceAndComments();
            const generics = extractGenerics(s);
            s.skipWhitespaceAndComments();
            const raw_params = extractParamList(s);
            s.skipWhitespaceAndComments();
            var ret_type = extractReturnType(s);
            if (ret_type.len == 0) ret_type = if (is_async) "Promise<void>" else "void";
            s.skipWhitespaceAndComments();
            if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) {
                _ = s.findMatchingClose(ch.CH_LBRACE, ch.CH_RBRACE);
            } else if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) {
                s.pos += 1;
            }
            const dts_params = buildDtsParams(s, raw_params);
            // Direct alloc — fixed shape "<indent><prefix>function <name><generics><params>: <ret>;".
            const fn_kw = "function ";
            const colon_sep = ": ";
            const fn_total = indent.len + prefix.len + fn_kw.len + fname.len +
                generics.len + dts_params.len + colon_sep.len + ret_type.len + 1;
            const fn_buf = s.allocator.alloc(u8, fn_total) catch continue;
            var fp: usize = 0;
            @memcpy(fn_buf[fp..][0..indent.len], indent); fp += indent.len;
            @memcpy(fn_buf[fp..][0..prefix.len], prefix); fp += prefix.len;
            @memcpy(fn_buf[fp..][0..fn_kw.len], fn_kw); fp += fn_kw.len;
            @memcpy(fn_buf[fp..][0..fname.len], fname); fp += fname.len;
            @memcpy(fn_buf[fp..][0..generics.len], generics); fp += generics.len;
            @memcpy(fn_buf[fp..][0..dts_params.len], dts_params); fp += dts_params.len;
            @memcpy(fn_buf[fp..][0..colon_sep.len], colon_sep); fp += colon_sep.len;
            @memcpy(fn_buf[fp..][0..ret_type.len], ret_type); fp += ret_type.len;
            fn_buf[fp] = ';';
            lines.append(fn_buf) catch {};
        } else if (s.matchWord("const") or s.matchWord("let") or s.matchWord("var")) {
            // First-char dispatch — previously matchWord ran twice more here.
            const kw: []const u8 = switch (s.source[s.pos]) {
                'c' => "const",
                'l' => "let",
                else => "var",
            };
            s.pos += kw.len;
            s.skipWhitespaceAndComments();

            // Check for const enum
            // kw is one of "const", "let", "var" — check by first byte instead of mem.eql.
            if (kw[0] == 'c' and s.matchWord("enum")) {
                s.pos += 4;
                s.skipWhitespaceAndComments();
                const ce_name = s.readIdent();
                s.skipWhitespaceAndComments();
                const ce_body = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) s.extractBraceBlock() else "{}";
                // Direct alloc — fixed shape "<indent><prefix>const enum <name> <body>".
                const ce_kw = "const enum ";
                const ce_total = indent.len + prefix.len + ce_kw.len + ce_name.len + 1 + ce_body.len;
                const ce_buf = s.allocator.alloc(u8, ce_total) catch continue;
                var cp: usize = 0;
                @memcpy(ce_buf[cp..][0..indent.len], indent); cp += indent.len;
                @memcpy(ce_buf[cp..][0..prefix.len], prefix); cp += prefix.len;
                @memcpy(ce_buf[cp..][0..ce_kw.len], ce_kw); cp += ce_kw.len;
                @memcpy(ce_buf[cp..][0..ce_name.len], ce_name); cp += ce_name.len;
                ce_buf[cp] = ' '; cp += 1;
                @memcpy(ce_buf[cp..][0..ce_body.len], ce_body); cp += ce_body.len;
                lines.append(ce_buf) catch {};
                continue;
            }

            const vname = s.readIdent();
            if (vname.len == 0) {
                s.skipToStatementEnd();
                continue;
            }
            s.skipWhitespaceAndComments();
            var vtype: []const u8 = "";
            if (s.pos < s.len and s.source[s.pos] == ch.CH_COLON) {
                s.pos += 1;
                s.skipWhitespaceAndComments();
                const ts = s.pos;
                var depth: isize = 0;
                while (s.pos < s.len) {
                    if (s.skipNonCode()) continue;
                    const tc = s.source[s.pos];
                    if (tc == ch.CH_LPAREN or tc == ch.CH_LBRACE or tc == ch.CH_LBRACKET or tc == ch.CH_LANGLE) {
                        depth += 1;
                    } else if (tc == ch.CH_RPAREN or tc == ch.CH_RBRACE or tc == ch.CH_RBRACKET or (tc == ch.CH_RANGLE and !s.isArrowGT())) {
                        depth -= 1;
                    } else if (depth == 0 and (tc == ch.CH_EQUAL or tc == ch.CH_SEMI or tc == ch.CH_COMMA)) {
                        break;
                    }
                    if (depth == 0 and s.checkASITopLevel()) break;
                    s.pos += 1;
                }
                vtype = s.sliceTrimmed(ts, s.pos);
            }
            var init_text: []const u8 = "";
            if (s.pos < s.len and s.source[s.pos] == ch.CH_EQUAL) {
                s.pos += 1;
                s.skipWhitespaceAndComments();
                const is2 = s.pos;
                var depth: isize = 0;
                while (s.pos < s.len) {
                    if (s.skipNonCode()) continue;
                    const ic = s.source[s.pos];
                    if (ic == ch.CH_LPAREN or ic == ch.CH_LBRACE or ic == ch.CH_LBRACKET or ic == ch.CH_LANGLE) {
                        depth += 1;
                    } else if (ic == ch.CH_RPAREN or ic == ch.CH_RBRACE or ic == ch.CH_RBRACKET or (ic == ch.CH_RANGLE and !s.isArrowGT())) {
                        depth -= 1;
                    } else if (depth == 0 and (ic == ch.CH_SEMI or ic == ch.CH_COMMA)) {
                        break;
                    }
                    if (depth == 0 and s.checkASITopLevel()) break;
                    s.pos += 1;
                }
                init_text = s.sliceTrimmed(is2, s.pos);
            }
            if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) s.pos += 1;

            if (vtype.len == 0 and init_text.len > 0) {
                const as_type = extractAssertion(init_text);
                if (as_type) |t| {
                    vtype = t;
                } else if (kw[0] == 'c') {
                    // kw is "const" — first-byte check is sufficient since it's
                    // one of "const" / "let" / "var".
                    vtype = inferLiteralType(init_text);
                } else {
                    vtype = inferTypeFromDefault(init_text);
                }
            }
            if (vtype.len == 0) vtype = "unknown";

            // Direct alloc — fixed shape "<indent><prefix><kw> <name>: <type>;".
            const var_total = indent.len + prefix.len + kw.len + 1 + vname.len + 2 + vtype.len + 1;
            const var_buf = s.allocator.alloc(u8, var_total) catch continue;
            var vp: usize = 0;
            @memcpy(var_buf[vp..][0..indent.len], indent); vp += indent.len;
            @memcpy(var_buf[vp..][0..prefix.len], prefix); vp += prefix.len;
            @memcpy(var_buf[vp..][0..kw.len], kw); vp += kw.len;
            var_buf[vp] = ' '; vp += 1;
            @memcpy(var_buf[vp..][0..vname.len], vname); vp += vname.len;
            @memcpy(var_buf[vp..][0..2], ": "); vp += 2;
            @memcpy(var_buf[vp..][0..vtype.len], vtype); vp += vtype.len;
            var_buf[vp] = ';';
            lines.append(var_buf) catch {};
        } else if (s.matchWord("interface")) {
            s.pos += 9;
            s.skipWhitespaceAndComments();
            const iname = s.readIdent();
            s.skipWhitespaceAndComments();
            const generics = extractGenerics(s);
            s.skipWhitespaceAndComments();
            var ext: []const u8 = "";
            if (s.matchWord("extends")) {
                const ext_start = s.pos;
                while (s.pos < s.len and s.source[s.pos] != ch.CH_LBRACE) {
                    if (s.skipNonCode()) continue;
                    s.pos += 1;
                }
                ext = s.source[ext_start..s.pos];
            }
            const body = cleanBraceBlock(s, s.extractBraceBlock());
            // Direct alloc — fixed shape "<indent><prefix>interface <name><gen><ext> <body>".
            const if_kw = "interface ";
            const if_total = indent.len + prefix.len + if_kw.len + iname.len +
                generics.len + ext.len + 1 + body.len;
            const if_buf = s.allocator.alloc(u8, if_total) catch continue;
            var ifp: usize = 0;
            @memcpy(if_buf[ifp..][0..indent.len], indent); ifp += indent.len;
            @memcpy(if_buf[ifp..][0..prefix.len], prefix); ifp += prefix.len;
            @memcpy(if_buf[ifp..][0..if_kw.len], if_kw); ifp += if_kw.len;
            @memcpy(if_buf[ifp..][0..iname.len], iname); ifp += iname.len;
            @memcpy(if_buf[ifp..][0..generics.len], generics); ifp += generics.len;
            @memcpy(if_buf[ifp..][0..ext.len], ext); ifp += ext.len;
            if_buf[ifp] = ' '; ifp += 1;
            @memcpy(if_buf[ifp..][0..body.len], body); ifp += body.len;
            lines.append(if_buf) catch {};
        } else if (s.matchWord("type")) {
            s.pos += 4;
            s.skipWhitespaceAndComments();
            const tname = s.readIdent();
            s.skipWhitespaceAndComments();
            const generics = extractGenerics(s);
            s.skipWhitespaceAndComments();
            if (s.pos < s.len and s.source[s.pos] == ch.CH_EQUAL) {
                s.pos += 1;
                s.skipWhitespaceAndComments();
                const ts = s.pos;
                var depth: isize = 0;
                while (s.pos < s.len) {
                    if (s.skipNonCode()) continue;
                    const tc = s.source[s.pos];
                    if (tc == ch.CH_LPAREN or tc == ch.CH_LBRACE or tc == ch.CH_LBRACKET or tc == ch.CH_LANGLE) {
                        depth += 1;
                    } else if (tc == ch.CH_RPAREN or tc == ch.CH_RBRACE or tc == ch.CH_RBRACKET or (tc == ch.CH_RANGLE and !s.isArrowGT())) {
                        depth -= 1;
                    } else if (depth == 0 and tc == ch.CH_SEMI) {
                        break;
                    }
                    if (depth == 0 and s.checkASITopLevel()) break;
                    s.pos += 1;
                }
                const type_body = s.sliceTrimmed(ts, s.pos);
                if (s.pos < s.len and s.source[s.pos] == ch.CH_SEMI) s.pos += 1;
                // Direct alloc — fixed shape "<indent><prefix>type <name><gen> = <body>".
                const ty_kw = "type ";
                const eq_sep = " = ";
                const ty_total = indent.len + prefix.len + ty_kw.len + tname.len +
                    generics.len + eq_sep.len + type_body.len;
                const ty_buf = s.allocator.alloc(u8, ty_total) catch continue;
                var typ: usize = 0;
                @memcpy(ty_buf[typ..][0..indent.len], indent); typ += indent.len;
                @memcpy(ty_buf[typ..][0..prefix.len], prefix); typ += prefix.len;
                @memcpy(ty_buf[typ..][0..ty_kw.len], ty_kw); typ += ty_kw.len;
                @memcpy(ty_buf[typ..][0..tname.len], tname); typ += tname.len;
                @memcpy(ty_buf[typ..][0..generics.len], generics); typ += generics.len;
                @memcpy(ty_buf[typ..][0..eq_sep.len], eq_sep); typ += eq_sep.len;
                @memcpy(ty_buf[typ..][0..type_body.len], type_body); typ += type_body.len;
                lines.append(ty_buf) catch {};
            }
        } else if (s.matchWord("enum")) {
            // Handle enum inside namespace
            s.pos += 4; // enum
            s.skipWhitespaceAndComments();
            const ename = s.readIdent();
            s.skipWhitespaceAndComments();
            const ebody = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) s.extractBraceBlock() else "{}";
            // Direct alloc — fixed shape "<indent><prefix>enum <name> <body>".
            const en_kw = "enum ";
            const en_total = indent.len + prefix.len + en_kw.len + ename.len + 1 + ebody.len;
            const en_buf = s.allocator.alloc(u8, en_total) catch continue;
            var ep: usize = 0;
            @memcpy(en_buf[ep..][0..indent.len], indent); ep += indent.len;
            @memcpy(en_buf[ep..][0..prefix.len], prefix); ep += prefix.len;
            @memcpy(en_buf[ep..][0..en_kw.len], en_kw); ep += en_kw.len;
            @memcpy(en_buf[ep..][0..ename.len], ename); ep += ename.len;
            en_buf[ep] = ' '; ep += 1;
            @memcpy(en_buf[ep..][0..ebody.len], ebody); ep += ebody.len;
            lines.append(en_buf) catch {};
        } else if (s.matchWord("namespace") or s.matchWord("module")) {
            // First-char dispatch — previously matchWord ran twice more.
            const ns_kw: []const u8 = if (s.source[s.pos] == 'n') "namespace" else "module";
            s.pos += ns_kw.len;
            s.skipWhitespaceAndComments();
            const ns_name = s.readIdent();
            s.skipWhitespaceAndComments();
            // Use same indent level for nested namespace body (matches TS behavior)
            const ns_body = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) buildNamespaceBodyDts(s, indent) else "{}";
            // Direct alloc — fixed shape "<indent><prefix><ns_kw> <name> <body>".
            const ns_total = indent.len + prefix.len + ns_kw.len + 1 + ns_name.len + 1 + ns_body.len;
            const ns_buf = s.allocator.alloc(u8, ns_total) catch continue;
            var nsp: usize = 0;
            @memcpy(ns_buf[nsp..][0..indent.len], indent); nsp += indent.len;
            @memcpy(ns_buf[nsp..][0..prefix.len], prefix); nsp += prefix.len;
            @memcpy(ns_buf[nsp..][0..ns_kw.len], ns_kw); nsp += ns_kw.len;
            ns_buf[nsp] = ' '; nsp += 1;
            @memcpy(ns_buf[nsp..][0..ns_name.len], ns_name); nsp += ns_name.len;
            ns_buf[nsp] = ' '; nsp += 1;
            @memcpy(ns_buf[nsp..][0..ns_body.len], ns_body); nsp += ns_body.len;
            lines.append(ns_buf) catch {};
        } else if (s.matchWord("class") or s.matchWord("abstract")) {
            // Handle class inside namespace
            var is_abs = false;
            if (s.matchWord("abstract")) {
                is_abs = true;
                s.pos += 8;
                s.skipWhitespaceAndComments();
            }
            if (s.matchWord("class")) {
                s.pos += 5;
                s.skipWhitespaceAndComments();
                const cname = s.readIdent();
                s.skipWhitespaceAndComments();
                const cgen = extractGenerics(s);
                s.skipWhitespaceAndComments();
                // Skip extends/implements — first-byte dispatch saves redundant
                // matchWord calls (the previous code ran matchWord up to 4× per
                // outer iteration just to determine the keyword length).
                while (true) {
                    if (s.pos >= s.len) break;
                    const c0 = s.source[s.pos];
                    var kw_len: usize = 0;
                    if (c0 == 'e' and s.matchWord("extends")) kw_len = 7
                    else if (c0 == 'i' and s.matchWord("implements")) kw_len = 10
                    else break;
                    s.pos += kw_len;
                    s.skipWhitespaceAndComments();
                    var depth: isize = 0;
                    while (s.pos < s.len) {
                        if (s.skipNonCode()) continue;
                        const tc = s.source[s.pos];
                        if (tc == ch.CH_LANGLE) depth += 1
                        else if (tc == ch.CH_RANGLE and !s.isArrowGT()) depth -= 1
                        else if (depth == 0 and (tc == ch.CH_LBRACE or (tc == 'i' and s.matchWord("implements")))) break;
                        s.pos += 1;
                    }
                }
                s.skipWhitespaceAndComments();
                const cbody = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) buildClassBodyDts(s) else "{}";
                // Direct alloc — "<indent><prefix>[abstract ]class <name><gen> <body>".
                const abs_kw: []const u8 = if (is_abs) "abstract " else "";
                const cl_kw = "class ";
                const cl_total = indent.len + prefix.len + abs_kw.len + cl_kw.len +
                    cname.len + cgen.len + 1 + cbody.len;
                const cl_buf = s.allocator.alloc(u8, cl_total) catch continue;
                var cp: usize = 0;
                @memcpy(cl_buf[cp..][0..indent.len], indent); cp += indent.len;
                @memcpy(cl_buf[cp..][0..prefix.len], prefix); cp += prefix.len;
                @memcpy(cl_buf[cp..][0..abs_kw.len], abs_kw); cp += abs_kw.len;
                @memcpy(cl_buf[cp..][0..cl_kw.len], cl_kw); cp += cl_kw.len;
                @memcpy(cl_buf[cp..][0..cname.len], cname); cp += cname.len;
                @memcpy(cl_buf[cp..][0..cgen.len], cgen); cp += cgen.len;
                cl_buf[cp] = ' '; cp += 1;
                @memcpy(cl_buf[cp..][0..cbody.len], cbody); cp += cbody.len;
                lines.append(cl_buf) catch {};
            } else {
                s.skipToStatementEnd();
            }
        } else if (has_export and s.matchWord("default")) {
            s.pos += 7;
            s.skipWhitespaceAndComments();
            const def_start = s.pos;
            s.skipToStatementEnd();
            var def_text = s.sliceTrimmed(def_start, s.pos);
            if (def_text.len > 0 and def_text[def_text.len - 1] == ';') def_text = def_text[0 .. def_text.len - 1];
            if (def_text.len > 0) {
                // Direct alloc — fixed shape "<indent>export default <text>;".
                const def_kw = "export default ";
                const def_total = indent.len + def_kw.len + def_text.len + 1;
                const def_buf = s.allocator.alloc(u8, def_total) catch continue;
                var dp: usize = 0;
                @memcpy(def_buf[dp..][0..indent.len], indent); dp += indent.len;
                @memcpy(def_buf[dp..][0..def_kw.len], def_kw); dp += def_kw.len;
                @memcpy(def_buf[dp..][0..def_text.len], def_text); dp += def_text.len;
                def_buf[dp] = ';';
                lines.append(def_buf) catch {};
            }
        } else {
            s.skipToStatementEnd();
        }
    }

    if (lines.items.len == 0) return "{}";
    // Direct alloc — pre-compute total and emit in one pass.
    var total_len: usize = 4; // "{\n" + "\n}"
    for (lines.items) |line| total_len += line.len;
    total_len += lines.items.len - 1; // newlines between
    const buf = s.allocator.alloc(u8, total_len) catch return "{}";
    buf[0] = '{'; buf[1] = '\n';
    var rp: usize = 2;
    @memcpy(buf[rp..][0..lines.items[0].len], lines.items[0]);
    rp += lines.items[0].len;
    for (lines.items[1..]) |line| {
        buf[rp] = '\n'; rp += 1;
        @memcpy(buf[rp..][0..line.len], line);
        rp += line.len;
    }
    buf[rp] = '\n'; rp += 1;
    buf[rp] = '}'; rp += 1;
    return buf[0..rp];
}

// ========================================================================
// Clean brace block helper
// ========================================================================

/// Strip trailing inline comments from a line (respecting strings)
fn stripTrailingInlineComment(line: []const u8) []const u8 {
    // Fast path: most lines have no `/` at all — `indexOfChar` SIMD-scans for it
    // in a single pass. If absent, we know there's no inline comment and can
    // skip the string-state walking entirely.
    const slash_idx = ch.indexOfChar(line, '/', 0);
    if (slash_idx == null) {
        // Trim trailing whitespace.
        var end = line.len;
        while (end > 0 and (line[end - 1] == ' ' or line[end - 1] == '\t' or line[end - 1] == '\r')) end -= 1;
        return line[0..end];
    }

    var in_string: u8 = 0;
    var i: usize = 0;
    while (i < line.len) {
        const c = line[i];
        if (in_string != 0) {
            if (c == '\\') {
                i += 2;
                continue;
            }
            if (c == in_string) in_string = 0;
            i += 1;
            continue;
        }
        if (c == '\'' or c == '"' or c == '`') {
            in_string = c;
            i += 1;
            continue;
        }
        if (c == '/' and i + 1 < line.len and line[i + 1] == '/') {
            // Trim trailing whitespace before //
            var end = i;
            while (end > 0 and (line[end - 1] == ' ' or line[end - 1] == '\t')) end -= 1;
            return line[0..end];
        }
        i += 1;
    }
    // Trim trailing whitespace
    var end = line.len;
    while (end > 0 and (line[end - 1] == ' ' or line[end - 1] == '\t' or line[end - 1] == '\r')) end -= 1;
    return line[0..end];
}

/// Strip inline comments from a brace block and normalize indentation
pub fn cleanBraceBlock(s: *Scanner, raw: []const u8) []const u8 {
    if (raw.len < 2) return raw;

    // Fast path: no comment markers, no semicolons, and ≤2-space indent → body is already clean.
    // This avoids line-by-line processing for simple interface/namespace bodies.
    if (ch.indexOfChar(raw, '/', 0) == null and ch.indexOfChar(raw, ';', 0) == null) {
        // Verify first member line has ≤ 2-space indentation (else re-indent is needed)
        var needs_reindent = false;
        if (ch.indexOfChar(raw, '\n', 0)) |nl| {
            var after = nl + 1;
            var indent: usize = 0;
            while (after < raw.len and (raw[after] == ' ' or raw[after] == '\t')) {
                indent += 1;
                after += 1;
            }
            if (after < raw.len and raw[after] != '\n' and raw[after] != '\r' and
                raw[after] != '}' and raw[after] != ']' and indent > 2)
            {
                needs_reindent = true;
            }
        }
        if (!needs_reindent) return raw;
    }

    // Check if there are any comment markers — single scan for '/' and only do
    // the multi-byte verification if found.
    const has_comments = blk: {
        var i: usize = 0;
        while (ch.indexOfChar(raw, '/', i)) |slash_idx| {
            if (slash_idx + 1 < raw.len and (raw[slash_idx + 1] == '/' or raw[slash_idx + 1] == '*')) {
                break :blk true;
            }
            i = slash_idx + 1;
        }
        break :blk false;
    };

    // Split raw text by newlines and process line by line
    const est_lines = @max(raw.len / 30, 4);
    var filtered = std.array_list.Managed([]const u8).init(s.allocator);
    filtered.ensureTotalCapacity(est_lines) catch {};
    var indent_cache = std.array_list.Managed(usize).init(s.allocator);
    indent_cache.ensureTotalCapacity(est_lines) catch {};
    var in_block_comment = false;
    var min_indent: usize = std.math.maxInt(usize);

    var line_start: usize = 0;
    var li: usize = 0;
    while (li <= raw.len) : (li += 1) {
        if (li == raw.len or raw[li] == '\n') {
            const line = raw[line_start..li];
            line_start = li + 1;

            if (has_comments) {
                if (in_block_comment) {
                    if (ch.contains(line, "*/"))
                        in_block_comment = false;
                    continue;
                }

                const trimmed = ch.sliceTrimmed(line, 0, line.len);
                if (trimmed.len == 0) continue;

                // Skip standalone comment lines
                if (trimmed[0] == '/') {
                    if (trimmed.len > 1 and trimmed[1] == '/') continue; // //
                    if (trimmed.len > 1 and trimmed[1] == '*') { // /* or /**
                        if (!ch.contains(trimmed, "*/"))
                            in_block_comment = true;
                        continue;
                    }
                }
                if (trimmed[0] == '*') continue; // continuation of block comment

                // Strip trailing inline comments and whitespace
                var cleaned_line = stripTrailingInlineComment(line);
                // Strip trailing semicolons (DTS convention for interfaces)
                if (cleaned_line.len > 0 and cleaned_line[cleaned_line.len - 1] == ';')
                    cleaned_line = cleaned_line[0 .. cleaned_line.len - 1];
                const ct = ch.sliceTrimmed(cleaned_line, 0, cleaned_line.len);
                if (ct.len == 0) continue;

                filtered.append(cleaned_line) catch {};

                // Compute indent
                var iw: usize = 0;
                while (iw < cleaned_line.len and (cleaned_line[iw] == ' ' or cleaned_line[iw] == '\t')) iw += 1;
                // Single-byte literal check — `std.mem.eql` is overkill for a 1-char comparison.
                if (!(ct.len == 1 and (ct[0] == '{' or ct[0] == '}'))) {
                    if (iw < min_indent) min_indent = iw;
                }
                indent_cache.append(iw) catch {};
            } else {
                // No comments — just trim trailing whitespace
                var end = line.len;
                while (end > 0 and (line[end - 1] == ' ' or line[end - 1] == '\t' or line[end - 1] == '\r')) end -= 1;
                if (end == 0) continue;
                var cleaned_line = line[0..end];
                // Strip trailing semicolons
                if (cleaned_line.len > 0 and cleaned_line[cleaned_line.len - 1] == ';')
                    cleaned_line = cleaned_line[0 .. cleaned_line.len - 1];
                const ct = ch.sliceTrimmed(cleaned_line, 0, cleaned_line.len);
                if (ct.len == 0) continue;

                filtered.append(cleaned_line) catch {};

                var iw: usize = 0;
                while (iw < cleaned_line.len and (cleaned_line[iw] == ' ' or cleaned_line[iw] == '\t')) iw += 1;
                // Single-byte literal check — `std.mem.eql` is overkill for a 1-char comparison.
                if (!(ct.len == 1 and (ct[0] == '{' or ct[0] == '}'))) {
                    if (iw < min_indent) min_indent = iw;
                }
                indent_cache.append(iw) catch {};
            }
        }
    }

    if (filtered.items.len == 0) return "{}";

    // Direct alloc: output ≤ raw.len (we're only removing/shifting content)
    const buf = s.allocator.alloc(u8, raw.len) catch return raw;
    var pos: usize = 0;

    // If minIndent <= 2, return filtered lines as-is
    if (min_indent == std.math.maxInt(usize) or min_indent <= 2) {
        for (filtered.items, 0..) |line, i| {
            if (i > 0) {
                buf[pos] = '\n';
                pos += 1;
            }
            @memcpy(buf[pos..][0..line.len], line);
            pos += line.len;
        }
        return buf[0..pos];
    }

    // Re-indent: offset = minIndent - 2
    const offs = min_indent - 2;
    for (filtered.items, 0..) |line, i| {
        if (i > 0) {
            buf[pos] = '\n';
            pos += 1;
        }

        const ct = ch.sliceTrimmed(line, 0, line.len);
        if (ct.len == 1 and ct[0] == '{') {
            buf[pos] = '{';
            pos += 1;
            continue;
        }

        const current_indent = indent_cache.items[i];
        if (current_indent > min_indent) {
            @memcpy(buf[pos..][0..line.len], line);
            pos += line.len;
        } else if (current_indent == min_indent and ct.len > 0 and (ct[0] == '}' or ct[0] == ']' or ct[0] == ')')) {
            @memcpy(buf[pos..][0..line.len], line);
            pos += line.len;
        } else {
            const new_indent = if (current_indent >= offs) current_indent - offs else 0;
            @memset(buf[pos..][0..new_indent], ' ');
            pos += new_indent;
            @memcpy(buf[pos..][0..ct.len], ct);
            pos += ct.len;
        }
    }

    return buf[0..pos];
}

// ========================================================================
// Declare handler
// ========================================================================

/// Handle `declare ...` after `declare` keyword
pub fn handleDeclare(s: *Scanner, stmt_start: usize, is_exported: bool) void {
    // First-byte dispatch — most declare keywords are uniquely identified by
    // their first byte, so we avoid running the full matchWord scan against
    // unrelated keywords (each matchWord costs a length+boundary check).
    if (s.pos >= s.len) return;
    const c0 = s.source[s.pos];
    if (c0 == 'f' and s.matchWord("function")) {
        const decl = extractFunction(s, stmt_start, is_exported, false, false);
        if (decl) |d| s.declarations.append(d) catch {};
    } else if (c0 == 'a') {
        if (s.matchWord("async")) {
            s.pos += 5;
            s.skipWhitespaceAndComments();
            if (s.matchWord("function")) {
                const decl = extractFunction(s, stmt_start, is_exported, true, false);
                if (decl) |d| s.declarations.append(d) catch {};
            }
        } else if (s.matchWord("abstract")) {
            s.pos += 8;
            s.skipWhitespaceAndComments();
            if (s.matchWord("class")) {
                const decl = extractClass(s, stmt_start, is_exported, true);
                s.declarations.append(decl) catch {};
            }
        }
    } else if (c0 == 'c') {
        if (s.matchWord("class")) {
            const decl = extractClass(s, stmt_start, is_exported, false);
            s.declarations.append(decl) catch {};
        } else if (s.matchWord("const")) {
            const saved_pos = s.pos;
            s.pos += 5;
            s.skipWhitespaceAndComments();
            if (s.matchWord("enum")) {
                s.pos = saved_pos + 5;
                s.skipWhitespaceAndComments();
                const decl = extractEnum(s, stmt_start, is_exported, true);
                s.declarations.append(decl) catch {};
            } else if (is_exported) {
                s.pos = saved_pos;
                const decls = extractVariable(s, stmt_start, "const", true);
                for (decls) |d| s.declarations.append(d) catch {};
            } else {
                s.skipToStatementEnd();
            }
        }
    } else if (c0 == 'i' and s.matchWord("interface")) {
        const decl = extractInterface(s, stmt_start, is_exported);
        s.declarations.append(decl) catch {};
    } else if (c0 == 't' and s.matchWord("type")) {
        const decl = extractTypeAlias(s, stmt_start, is_exported);
        s.declarations.append(decl) catch {};
    } else if (c0 == 'e' and s.matchWord("enum")) {
        const decl = extractEnum(s, stmt_start, is_exported, false);
        s.declarations.append(decl) catch {};
    } else if ((c0 == 'l' and s.matchWord("let")) or (c0 == 'v' and s.matchWord("var"))) {
        if (is_exported) {
            // First-char dispatch — saves a redundant matchWord call.
            const kind: []const u8 = if (c0 == 'l') "let" else "var";
            const decls = extractVariable(s, stmt_start, kind, true);
            for (decls) |d| s.declarations.append(d) catch {};
        } else {
            s.skipToStatementEnd();
        }
    } else if (c0 == 'm' and s.matchWord("module")) {
        const decl = extractModule(s, stmt_start, is_exported, "module");
        s.declarations.append(decl) catch {};
    } else if (c0 == 'n' and s.matchWord("namespace")) {
        const decl = extractModule(s, stmt_start, is_exported, "namespace");
        s.declarations.append(decl) catch {};
    } else if (c0 == 'g' and s.matchWord("global")) {
        s.pos += 6;
        s.skipWhitespaceAndComments();
        const body = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) buildNamespaceBodyDts(s, "  ") else "{}";
        // Direct alloc — fixed prefix + body slice.
        const prefix = "declare global ";
        const text_buf = blk: {
            const buf = s.allocator.alloc(u8, prefix.len + body.len) catch break :blk @as([]const u8, "");
            @memcpy(buf[0..prefix.len], prefix);
            @memcpy(buf[prefix.len..][0..body.len], body);
            break :blk @as([]const u8, buf);
        };
        const comments = extractLeadingComments(s, stmt_start);
        s.declarations.append(.{
            .kind = .module_decl,
            .name = "global",
            .text = text_buf,
            .is_exported = false,
            .leading_comments = comments,
            .start = stmt_start,
            .end = s.pos,
        }) catch {};
    } else {
        s.skipToStatementEnd();
    }
}
