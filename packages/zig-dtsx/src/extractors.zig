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
            // Find matching /* or /**
            var start: isize = p - 2;
            while (start >= 1) {
                const su: usize = @intCast(start);
                if (s.source[su] == ch.CH_SLASH and s.source[su + 1] == ch.CH_STAR) break;
                start -= 1;
            }
            if (start >= 0) {
                const su: usize = @intCast(start);
                if (s.source[su] == ch.CH_SLASH and s.source[su + 1] == ch.CH_STAR) {
                    comments.append(s.source[su .. pu + 1]) catch {};
                    has_block_comment = true;
                    p = start - 1;
                    while (p >= 0 and ch.isWhitespace(s.source[@intCast(p)])) p -= 1;
                    continue;
                }
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

            // Reverse and join with newlines
            std.mem.reverse([]const u8, single_lines.items);
            var total_len: usize = 0;
            for (single_lines.items, 0..) |line, i| {
                total_len += line.len;
                if (i < single_lines.items.len - 1) total_len += 1;
            }
            const joined = s.allocator.alloc(u8, total_len) catch break;
            var offset: usize = 0;
            for (single_lines.items, 0..) |line, i| {
                @memcpy(joined[offset .. offset + line.len], line);
                offset += line.len;
                if (i < single_lines.items.len - 1) {
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

    // Extract source module
    var module_src: []const u8 = "";
    {
        const from_idx = ch.indexOf(text, "from ", 0);
        if (from_idx) |fi| {
            var mi = fi + 5;
            while (mi < text.len and (text[mi] == ch.CH_SPACE or text[mi] == ch.CH_TAB)) mi += 1;
            if (mi < text.len) {
                const q = text[mi];
                if (q == ch.CH_SQUOTE or q == ch.CH_DQUOTE) {
                    const q_str: []const u8 = if (q == ch.CH_SQUOTE) "'" else "\"";
                    const end_idx = ch.indexOf(text, q_str, mi + 1);
                    if (end_idx) |ei| {
                        module_src = text[mi + 1 .. ei];
                    }
                }
            }
        } else if (is_side_effect) {
            var mi: usize = 6;
            while (mi < text.len and text[mi] != ch.CH_SQUOTE and text[mi] != ch.CH_DQUOTE) mi += 1;
            if (mi < text.len) {
                const q = text[mi];
                const q_str: []const u8 = if (q == ch.CH_SQUOTE) "'" else "\"";
                const end_idx = ch.indexOf(text, q_str, mi + 1);
                if (end_idx) |ei| {
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

            // Named imports
            const named_part = import_part[bs + 1 .. be];
            var iter = std.mem.splitSequence(u8, named_part, ",");
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

        parsed_import = .{
            .default_name = default_name,
            .named_items = named_items.items,
            .source = module_src,
            .is_type_only = is_type_only,
            .is_namespace = is_namespace,
            .namespace_name = namespace_name,
            .resolved_items = resolved_items.items,
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
    // Normalize multi-line generics to single line
    if (ch.indexOf(raw, "\n", 0) != null) {
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
    var i: usize = 0;
    if (i < v.len and v[i] == '-') i += 1;
    if (i >= v.len) return false;
    if (v[i] < '0' or v[i] > '9') return false;
    while (i < v.len and v[i] >= '0' and v[i] <= '9') i += 1;
    if (i < v.len and v[i] == '.') {
        i += 1;
        if (i >= v.len or v[i] < '0' or v[i] > '9') return false;
        while (i < v.len and v[i] >= '0' and v[i] <= '9') i += 1;
    }
    return i == v.len;
}

/// Infer type from a default value expression (simple cases)
pub fn inferTypeFromDefault(value: []const u8) []const u8 {
    const v = std.mem.trim(u8, value, " \t\r\n");
    if (std.mem.eql(u8, v, "true") or std.mem.eql(u8, v, "false")) return "boolean";
    if (isNumericLiteral(v)) return "number";
    if (v.len >= 2 and ((v[0] == '\'' and v[v.len - 1] == '\'') or (v[0] == '"' and v[v.len - 1] == '"'))) return "string";
    if (v.len > 0 and v[0] == '[') return "unknown[]";
    if (v.len > 0 and v[0] == '{') return "Record<string, unknown>";
    return "unknown";
}

/// Infer literal type from initializer value (for const-like / static readonly)
pub fn inferLiteralType(value: []const u8) []const u8 {
    const v = std.mem.trim(u8, value, " \t\r\n");
    if (std.mem.eql(u8, v, "true") or std.mem.eql(u8, v, "false")) return v;
    if (isNumericLiteral(v)) return v;
    if (v.len >= 2 and ((v[0] == '\'' and v[v.len - 1] == '\'') or (v[0] == '"' and v[v.len - 1] == '"'))) return v;
    return "unknown";
}

/// Extract type from `as Type` assertion in initializer
pub fn extractAssertion(init_text: []const u8) ?[]const u8 {
    if (ch.endsWith(init_text, "as const")) return null;
    // Only find " as " at depth 0 (not inside nested brackets/braces/parens)
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
        } else if (depth == 0 and i + 4 <= init_text.len and std.mem.eql(u8, init_text[i .. i + 4], " as ")) {
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
            // Check for parameter modifiers
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

    for (inner, 0..) |c, i| {
        if (skip_next) {
            skip_next = false;
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

    // Strip parameter modifiers
    var stripped = true;
    while (stripped) {
        stripped = false;
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

    for (p, 0..) |c, i| {
        if (skip_next2) {
            skip_next2 = false;
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

    // Build result
    var result = std.array_list.Managed(u8).init(s.allocator);
    if (is_rest) result.appendSlice("...") catch {};
    result.appendSlice(name) catch {};
    result.appendSlice(opt_marker) catch {};
    result.appendSlice(": ") catch {};
    result.appendSlice(param_type) catch {};
    return result.toOwnedSlice() catch "unknown: unknown";
}

/// Clean a destructured pattern by stripping default values and rest operators.
/// E.g., "{ name, age = 0, ...props }" → "{ name, age, props }"
/// Also handles multiline patterns like:
/// "{\n  name,\n  headers = { ... },\n}" → "{\n  name,\n  headers,\n}"
fn cleanDestructuredPattern(alloc: std.mem.Allocator, pattern: []const u8) []const u8 {
    var result = std.array_list.Managed(u8).init(alloc);
    result.ensureTotalCapacity(pattern.len) catch {};
    var i: usize = 0;
    var depth: isize = 0;
    var in_str = false;
    var str_c: u8 = 0;

    while (i < pattern.len) : (i += 1) {
        const c = pattern[i];

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

    // If the pattern contains newlines, try to collapse to single line if short enough
    if (ch.indexOf(cleaned, "\n", 0) != null) {
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

    // Build DTS text
    var text = std.array_list.Managed(u8).init(s.allocator);
    text.ensureTotalCapacity(128) catch {};
    if (is_exported) text.appendSlice("export ") catch {};
    text.appendSlice("declare function ") catch {};
    text.appendSlice(func_name) catch {};
    text.appendSlice(generics) catch {};
    text.appendSlice(dts_params) catch {};
    text.appendSlice(": ") catch {};
    text.appendSlice(return_type) catch {};
    text.append(';') catch {};

    const dts_text = text.toOwnedSlice() catch "";
    const comments = extractLeadingComments(s, decl_start);

    if (has_body) {
        s.func_body_indices.put(s.declarations.items.len, {}) catch {};
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

    // Build DTS text
    var text = std.array_list.Managed(u8).init(s.allocator);
    text.ensureTotalCapacity(128) catch {};
    if (is_exported) text.appendSlice("export ") catch {};
    text.appendSlice("declare ") catch {};
    text.appendSlice(kind) catch {};
    text.append(' ') catch {};
    text.appendSlice(name) catch {};
    text.appendSlice(": ") catch {};
    text.appendSlice(final_type) catch {};
    text.append(';') catch {};

    // Store the variable kind in modifiers
    const mods = s.allocator.alloc([]const u8, 1) catch null;
    if (mods) |m| {
        m[0] = kind;
    }

    results.append(.{
        .kind = .variable_decl,
        .name = name,
        .text = text.toOwnedSlice() catch "",
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

    // Build DTS text
    var text = std.array_list.Managed(u8).init(s.allocator);
    text.ensureTotalCapacity(128) catch {};
    if (is_exported) text.appendSlice("export ") catch {};
    text.appendSlice("declare interface ") catch {};
    text.appendSlice(name) catch {};
    text.appendSlice(generics) catch {};
    if (extends_clause.len > 0) {
        text.appendSlice(" extends ") catch {};
        text.appendSlice(extends_clause) catch {};
    }
    text.append(' ') catch {};
    text.appendSlice(body) catch {};

    const comments = extractLeadingComments(s, decl_start);

    return .{
        .kind = .interface_decl,
        .name = name,
        .text = text.toOwnedSlice() catch "",
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

    var text = std.array_list.Managed(u8).init(s.allocator);
    text.ensureTotalCapacity(128) catch {};
    if (is_exported) text.appendSlice("export ") catch {};
    text.appendSlice("type ") catch {};
    text.appendSlice(name) catch {};
    text.appendSlice(generics) catch {};
    text.appendSlice(" = ") catch {};
    text.appendSlice(type_body) catch {};

    const comments = extractLeadingComments(s, decl_start);

    return .{
        .kind = .type_decl,
        .name = name,
        .text = text.toOwnedSlice() catch "",
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

    // Build DTS text
    var text = std.array_list.Managed(u8).init(s.allocator);
    text.ensureTotalCapacity(128) catch {};
    if (is_exported) text.appendSlice("export ") catch {};
    text.appendSlice("declare ") catch {};
    if (is_abstract) text.appendSlice("abstract ") catch {};
    text.appendSlice("class ") catch {};
    text.appendSlice(name) catch {};
    text.appendSlice(generics) catch {};
    if (extends_clause.len > 0) {
        text.appendSlice(" extends ") catch {};
        text.appendSlice(extends_clause) catch {};
    }
    if (implements_text.len > 0) {
        text.appendSlice(" implements ") catch {};
        text.appendSlice(implements_text) catch {};
    }
    text.append(' ') catch {};
    text.appendSlice(class_body) catch {};

    const comments = extractLeadingComments(s, decl_start);

    return .{
        .kind = .class_decl,
        .name = name,
        .text = text.toOwnedSlice() catch "",
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
            if (s.matchWord("private")) {
                is_private = true;
                s.pos += 7;
            } else if (s.matchWord("protected")) {
                is_protected = true;
                s.pos += 9;
            } else if (s.matchWord("public")) {
                s.pos += 6;
            } else if (s.matchWord("static")) {
                is_static = true;
                s.pos += 6;
            } else if (s.matchWord("abstract")) {
                is_abstract = true;
                s.pos += 8;
            } else if (s.matchWord("readonly")) {
                is_readonly = true;
                s.pos += 8;
            } else if (s.matchWord("override")) {
                s.pos += 8;
            } else if (s.matchWord("accessor")) {
                s.pos += 8;
            } else if (s.matchWord("async")) {
                is_async = true;
                s.pos += 5;
            } else if (s.matchWord("declare")) {
                s.pos += 7;
            } else break;
        }

        s.skipWhitespaceAndComments();
        if (s.pos >= s.len or s.source[s.pos] == ch.CH_RBRACE) break;

        // Skip private # members
        if (s.source[s.pos] == ch.CH_HASH) is_private = true;

        if (is_private) {
            s.skipClassMember();
            continue;
        }

        // Build modifier prefix
        var mod_prefix = std.array_list.Managed(u8).init(s.allocator);
        mod_prefix.appendSlice("  ") catch {};
        if (is_protected) mod_prefix.appendSlice("protected ") catch {};
        if (is_static) mod_prefix.appendSlice("static ") catch {};
        if (is_abstract) mod_prefix.appendSlice("abstract ") catch {};
        if (is_readonly) mod_prefix.appendSlice("readonly ") catch {};
        const prefix = mod_prefix.toOwnedSlice() catch "  ";

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
            var member = std.array_list.Managed(u8).init(s.allocator);
            member.appendSlice("  constructor") catch {};
            member.appendSlice(dts_params) catch {};
            member.append(';') catch {};
            members.append(member.toOwnedSlice() catch "") catch {};
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
            var member = std.array_list.Managed(u8).init(s.allocator);
            member.appendSlice(prefix) catch {};
            member.appendSlice("get ") catch {};
            member.appendSlice(member_name) catch {};
            member.appendSlice("(): ") catch {};
            member.appendSlice(ret_type) catch {};
            member.append(';') catch {};
            members.append(member.toOwnedSlice() catch "") catch {};
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
            var member = std.array_list.Managed(u8).init(s.allocator);
            member.appendSlice(prefix) catch {};
            member.appendSlice("set ") catch {};
            member.appendSlice(member_name) catch {};
            member.appendSlice(dts_params) catch {};
            member.append(';') catch {};
            members.append(member.toOwnedSlice() catch "") catch {};
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

    // Join members — pre-calculate total length
    var total_len: usize = 4; // "{\n" + "\n}"
    for (members.items) |m| total_len += m.len + 1;
    var result = std.array_list.Managed(u8).init(s.allocator);
    result.ensureTotalCapacity(total_len) catch {};
    result.appendSlice("{\n") catch {};
    for (members.items, 0..) |m, i| {
        result.appendSlice(m) catch {};
        if (i < members.items.len - 1) result.append('\n') catch {};
    }
    result.appendSlice("\n}") catch {};
    return result.toOwnedSlice() catch "{}";
}

fn isAccessorFollowed(s: *const Scanner) bool {
    const next_after = s.peekAfterWord(if (s.matchWord("get")) "get" else "set");
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

        var member = std.array_list.Managed(u8).init(s.allocator);
        member.appendSlice(mod_prefix) catch {};
        member.appendSlice(gen_text) catch {};
        member.appendSlice(member_name) catch {};
        member.appendSlice(opt_mark) catch {};
        member.appendSlice(generics) catch {};
        member.appendSlice(dts_params) catch {};
        member.appendSlice(": ") catch {};
        member.appendSlice(ret_type) catch {};
        member.append(';') catch {};
        members.append(member.toOwnedSlice() catch "") catch {};
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
        var member = std.array_list.Managed(u8).init(s.allocator);
        member.appendSlice(mod_prefix) catch {};
        member.appendSlice(member_name) catch {};
        member.appendSlice(opt_mark) catch {};
        member.appendSlice(": ") catch {};
        member.appendSlice(prop_type) catch {};
        member.append(';') catch {};
        members.append(member.toOwnedSlice() catch "") catch {};
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
        const has_public = ch.startsWith(param, "public ") or ch.startsWith(param, "public\t");
        const has_protected = ch.startsWith(param, "protected ") or ch.startsWith(param, "protected\t");
        const has_private = ch.startsWith(param, "private ") or ch.startsWith(param, "private\t");
        const has_readonly = ch.contains(param, "readonly ");

        if (!has_public and !has_protected and !has_private and !has_readonly) continue;
        if (has_private) continue;

        var p = param;
        var mods = std.array_list.Managed([]const u8).init(s.allocator);
        if (has_public) {
            var si: usize = 6;
            while (si < p.len and ch.isWhitespace(p[si])) si += 1;
            p = p[si..];
            mods.append("public") catch {};
        }
        if (has_protected) {
            var si: usize = 9;
            while (si < p.len and ch.isWhitespace(p[si])) si += 1;
            p = p[si..];
            mods.append("protected") catch {};
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
            mods.append("readonly") catch {};
        }

        // Build mod text
        var mod_text = std.array_list.Managed(u8).init(s.allocator);
        for (mods.items, 0..) |m, i| {
            mod_text.appendSlice(m) catch {};
            if (i < mods.items.len - 1) mod_text.append(' ') catch {};
        }
        if (mods.items.len > 0) mod_text.append(' ') catch {};

        const dts_param = buildSingleDtsParam(s, p);
        var member = std.array_list.Managed(u8).init(s.allocator);
        member.appendSlice("  ") catch {};
        member.appendSlice(mod_text.toOwnedSlice() catch "") catch {};
        member.appendSlice(dts_param) catch {};
        member.append(';') catch {};
        members.append(member.toOwnedSlice() catch "") catch {};
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

    var text = std.array_list.Managed(u8).init(s.allocator);
    text.ensureTotalCapacity(128) catch {};
    if (is_exported) text.appendSlice("export ") catch {};
    text.appendSlice("declare ") catch {};
    text.appendSlice(keyword) catch {};
    text.append(' ') catch {};
    text.appendSlice(name) catch {};
    text.append(' ') catch {};
    text.appendSlice(body) catch {};

    const comments = extractLeadingComments(s, decl_start);
    const is_ambient = name.len > 0 and (name[0] == '\'' or name[0] == '"');

    return .{
        .kind = .module_decl,
        .name = name,
        .text = text.toOwnedSlice() catch "",
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

        var has_export = false;
        if (s.matchWord("export")) {
            has_export = true;
            s.pos += 6;
            s.skipWhitespaceAndComments();
        }
        if (s.matchWord("declare")) {
            s.pos += 7;
            s.skipWhitespaceAndComments();
        }

        const prefix: []const u8 = if (has_export) "export " else "";

        if (s.matchWord("function") or (s.matchWord("async") and s.peekAfterKeyword("async", "function"))) {
            var is_async = false;
            if (s.matchWord("async")) {
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
            var line = std.array_list.Managed(u8).init(s.allocator);
            line.appendSlice(indent) catch {};
            line.appendSlice(prefix) catch {};
            line.appendSlice("function ") catch {};
            line.appendSlice(fname) catch {};
            line.appendSlice(generics) catch {};
            line.appendSlice(dts_params) catch {};
            line.appendSlice(": ") catch {};
            line.appendSlice(ret_type) catch {};
            line.append(';') catch {};
            lines.append(line.toOwnedSlice() catch "") catch {};
        } else if (s.matchWord("const") or s.matchWord("let") or s.matchWord("var")) {
            const kw: []const u8 = if (s.matchWord("const")) "const" else if (s.matchWord("let")) "let" else "var";
            s.pos += kw.len;
            s.skipWhitespaceAndComments();

            // Check for const enum
            if (std.mem.eql(u8, kw, "const") and s.matchWord("enum")) {
                s.pos += 4;
                s.skipWhitespaceAndComments();
                const ce_name = s.readIdent();
                s.skipWhitespaceAndComments();
                const ce_body = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) s.extractBraceBlock() else "{}";
                var line = std.array_list.Managed(u8).init(s.allocator);
                line.appendSlice(indent) catch {};
                line.appendSlice(prefix) catch {};
                line.appendSlice("const enum ") catch {};
                line.appendSlice(ce_name) catch {};
                line.append(' ') catch {};
                line.appendSlice(ce_body) catch {};
                lines.append(line.toOwnedSlice() catch "") catch {};
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
                } else if (std.mem.eql(u8, kw, "const")) {
                    vtype = inferLiteralType(init_text);
                } else {
                    vtype = inferTypeFromDefault(init_text);
                }
            }
            if (vtype.len == 0) vtype = "unknown";

            var line = std.array_list.Managed(u8).init(s.allocator);
            line.appendSlice(indent) catch {};
            line.appendSlice(prefix) catch {};
            line.appendSlice(kw) catch {};
            line.append(' ') catch {};
            line.appendSlice(vname) catch {};
            line.appendSlice(": ") catch {};
            line.appendSlice(vtype) catch {};
            line.append(';') catch {};
            lines.append(line.toOwnedSlice() catch "") catch {};
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
            var line = std.array_list.Managed(u8).init(s.allocator);
            line.appendSlice(indent) catch {};
            line.appendSlice(prefix) catch {};
            line.appendSlice("interface ") catch {};
            line.appendSlice(iname) catch {};
            line.appendSlice(generics) catch {};
            line.appendSlice(ext) catch {};
            line.append(' ') catch {};
            line.appendSlice(body) catch {};
            lines.append(line.toOwnedSlice() catch "") catch {};
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
                var line = std.array_list.Managed(u8).init(s.allocator);
                line.appendSlice(indent) catch {};
                line.appendSlice(prefix) catch {};
                line.appendSlice("type ") catch {};
                line.appendSlice(tname) catch {};
                line.appendSlice(generics) catch {};
                line.appendSlice(" = ") catch {};
                line.appendSlice(type_body) catch {};
                lines.append(line.toOwnedSlice() catch "") catch {};
            }
        } else if (s.matchWord("enum")) {
            // Handle enum inside namespace
            s.pos += 4; // enum
            s.skipWhitespaceAndComments();
            const ename = s.readIdent();
            s.skipWhitespaceAndComments();
            const ebody = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) s.extractBraceBlock() else "{}";
            var line = std.array_list.Managed(u8).init(s.allocator);
            line.appendSlice(indent) catch {};
            line.appendSlice(prefix) catch {};
            line.appendSlice("enum ") catch {};
            line.appendSlice(ename) catch {};
            line.append(' ') catch {};
            line.appendSlice(ebody) catch {};
            lines.append(line.toOwnedSlice() catch "") catch {};
        } else if (s.matchWord("namespace") or s.matchWord("module")) {
            // Handle nested namespace/module
            const ns_kw: []const u8 = if (s.matchWord("namespace")) "namespace" else "module";
            s.pos += ns_kw.len;
            s.skipWhitespaceAndComments();
            const ns_name = s.readIdent();
            s.skipWhitespaceAndComments();
            // Use same indent level for nested namespace body (matches TS behavior)
            const ns_body = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) buildNamespaceBodyDts(s, indent) else "{}";
            var line = std.array_list.Managed(u8).init(s.allocator);
            line.appendSlice(indent) catch {};
            line.appendSlice(prefix) catch {};
            line.appendSlice(ns_kw) catch {};
            line.append(' ') catch {};
            line.appendSlice(ns_name) catch {};
            line.append(' ') catch {};
            line.appendSlice(ns_body) catch {};
            lines.append(line.toOwnedSlice() catch "") catch {};
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
                // Skip extends/implements
                while (s.matchWord("extends") or s.matchWord("implements")) {
                    const kw_len: usize = if (s.matchWord("extends")) 7 else 10;
                    s.pos += kw_len;
                    s.skipWhitespaceAndComments();
                    var depth: isize = 0;
                    while (s.pos < s.len) {
                        if (s.skipNonCode()) continue;
                        const tc = s.source[s.pos];
                        if (tc == ch.CH_LANGLE) depth += 1 else if (tc == ch.CH_RANGLE and !s.isArrowGT()) depth -= 1 else if (depth == 0 and (tc == ch.CH_LBRACE or s.matchWord("implements"))) break;
                        s.pos += 1;
                    }
                }
                s.skipWhitespaceAndComments();
                const cbody = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) buildClassBodyDts(s) else "{}";
                var line = std.array_list.Managed(u8).init(s.allocator);
                line.appendSlice(indent) catch {};
                line.appendSlice(prefix) catch {};
                if (is_abs) line.appendSlice("abstract ") catch {};
                line.appendSlice("class ") catch {};
                line.appendSlice(cname) catch {};
                line.appendSlice(cgen) catch {};
                line.append(' ') catch {};
                line.appendSlice(cbody) catch {};
                lines.append(line.toOwnedSlice() catch "") catch {};
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
                var line = std.array_list.Managed(u8).init(s.allocator);
                line.appendSlice(indent) catch {};
                line.appendSlice("export default ") catch {};
                line.appendSlice(def_text) catch {};
                line.append(';') catch {};
                lines.append(line.toOwnedSlice() catch "") catch {};
            }
        } else {
            s.skipToStatementEnd();
        }
    }

    if (lines.items.len == 0) return "{}";
    var result = std.array_list.Managed(u8).init(s.allocator);
    result.appendSlice("{\n") catch {};
    for (lines.items, 0..) |line, i| {
        result.appendSlice(line) catch {};
        if (i < lines.items.len - 1) result.append('\n') catch {};
    }
    result.appendSlice("\n}") catch {};
    return result.toOwnedSlice() catch "{}";
}

// ========================================================================
// Clean brace block helper
// ========================================================================

/// Strip trailing inline comments from a line (respecting strings)
fn stripTrailingInlineComment(line: []const u8) []const u8 {
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

    // Check if there are any comment markers
    const has_comments = ch.contains(raw, "//") or ch.contains(raw, "/*");

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
                if (!std.mem.eql(u8, ct, "{") and !std.mem.eql(u8, ct, "}")) {
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
                if (!std.mem.eql(u8, ct, "{") and !std.mem.eql(u8, ct, "}")) {
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
        if (std.mem.eql(u8, ct, "{")) {
            @memcpy(buf[pos..][0..ct.len], ct);
            pos += ct.len;
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
    if (s.matchWord("function")) {
        const decl = extractFunction(s, stmt_start, is_exported, false, false);
        if (decl) |d| s.declarations.append(d) catch {};
    } else if (s.matchWord("async")) {
        s.pos += 5;
        s.skipWhitespaceAndComments();
        if (s.matchWord("function")) {
            const decl = extractFunction(s, stmt_start, is_exported, true, false);
            if (decl) |d| s.declarations.append(d) catch {};
        }
    } else if (s.matchWord("class")) {
        const decl = extractClass(s, stmt_start, is_exported, false);
        s.declarations.append(decl) catch {};
    } else if (s.matchWord("abstract")) {
        s.pos += 8;
        s.skipWhitespaceAndComments();
        if (s.matchWord("class")) {
            const decl = extractClass(s, stmt_start, is_exported, true);
            s.declarations.append(decl) catch {};
        }
    } else if (s.matchWord("interface")) {
        const decl = extractInterface(s, stmt_start, is_exported);
        s.declarations.append(decl) catch {};
    } else if (s.matchWord("type")) {
        const decl = extractTypeAlias(s, stmt_start, is_exported);
        s.declarations.append(decl) catch {};
    } else if (s.matchWord("enum")) {
        const decl = extractEnum(s, stmt_start, is_exported, false);
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
    } else if (s.matchWord("let") or s.matchWord("var")) {
        if (is_exported) {
            const kind: []const u8 = if (s.matchWord("let")) "let" else "var";
            const decls = extractVariable(s, stmt_start, kind, true);
            for (decls) |d| s.declarations.append(d) catch {};
        } else {
            s.skipToStatementEnd();
        }
    } else if (s.matchWord("module")) {
        const decl = extractModule(s, stmt_start, is_exported, "module");
        s.declarations.append(decl) catch {};
    } else if (s.matchWord("namespace")) {
        const decl = extractModule(s, stmt_start, is_exported, "namespace");
        s.declarations.append(decl) catch {};
    } else if (s.matchWord("global")) {
        s.pos += 6;
        s.skipWhitespaceAndComments();
        const body = if (s.pos < s.len and s.source[s.pos] == ch.CH_LBRACE) buildNamespaceBodyDts(s, "  ") else "{}";
        var text = std.array_list.Managed(u8).init(s.allocator);
        text.ensureTotalCapacity(128) catch {};
        text.appendSlice("declare global ") catch {};
        text.appendSlice(body) catch {};
        const comments = extractLeadingComments(s, stmt_start);
        s.declarations.append(.{
            .kind = .module_decl,
            .name = "global",
            .text = text.toOwnedSlice() catch "",
            .is_exported = false,
            .leading_comments = comments,
            .start = stmt_start,
            .end = s.pos,
        }) catch {};
    } else {
        s.skipToStatementEnd();
    }
}
