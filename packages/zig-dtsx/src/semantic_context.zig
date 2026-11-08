//! Scoped, conservative inference for known monomorphic calls and instance fields.
const std = @import("std");
const Scanner = @import("scanner.zig").Scanner;
const syntax = @import("module_specifiers.zig");
const inference = @import("type_inference.zig");
const ch = @import("char_utils.zig");

pub const PendingReturn = struct { marker: []const u8, body: []const u8, parameters: []const u8, generics: []const u8, is_async: bool, is_static: bool };

pub fn directCall(alloc: std.mem.Allocator, value: []const u8) !?[]const u8 {
    const tokens = try syntax.tokenizeDeclarationSyntax(alloc, value);
    if (tokens.len < 3 or tokens[0].kind != .word or !std.mem.eql(u8, value[tokens[1].start..tokens[1].end], "(")) return null;
    var depth: isize = 0;
    for (tokens[1..], 1..) |token, index| {
        const text = value[token.start..token.end];
        if (std.mem.eql(u8, text, "(")) depth += 1 else if (std.mem.eql(u8, text, ")")) {
            depth -= 1;
            if (depth == 0) return if (index == tokens.len - 1) value[tokens[0].start..tokens[0].end] else null;
        }
    }
    return null;
}

pub fn functionCount(alloc: std.mem.Allocator, source: []const u8, name: []const u8) !usize {
    const tokens = try syntax.tokenizeDeclarationSyntax(alloc, source);
    var depth: isize = 0;
    var count: usize = 0;
    for (tokens, 0..) |token, index| {
        const text = source[token.start..token.end];
        if (depth == 0 and std.mem.eql(u8, text, "function") and index + 1 < tokens.len) {
            const next = tokens[index + 1];
            if (next.kind == .word and std.mem.eql(u8, source[next.start..next.end], name)) count += 1;
        }
        if (std.mem.eql(u8, text, "{") or std.mem.eql(u8, text, "(") or std.mem.eql(u8, text, "[")) depth += 1 else if (std.mem.eql(u8, text, "}") or std.mem.eql(u8, text, ")") or std.mem.eql(u8, text, "]")) depth -= 1;
    }
    return count;
}

pub fn expressionType(s: *Scanner, value: []const u8) inference.InferError!?[]const u8 {
    if (ch.startsWith(value, "this.")) {
        if (s.class_fields) |fields| {
            const key = if (s.class_receiver_static) try std.fmt.allocPrint(s.allocator, "static:{s}", .{value[5..]}) else value[5..];
            return fields.get(key);
        }
    }
    const name = try directCall(s.allocator, value) orelse return null;
    if (try functionCount(s.allocator, s.source, name) != 1) return null;
    for (s.declarations.items) |declaration| {
        if (declaration.kind == .function_decl and declaration.generics.len == 0 and std.mem.eql(u8, declaration.name, name)) return try @import("value_inference.zig").functionReturn(s.allocator, declaration.text);
    }
    if (s.non_exported_types.get(name)) |declaration| {
        if (declaration.kind == .function_decl and declaration.generics.len == 0) return try @import("value_inference.zig").functionReturn(s.allocator, declaration.text);
    }
    return null;
}

pub fn deferReturn(s: *Scanner, body: []const u8, parameters: []const u8, generics: []const u8, is_async: bool) !?[]const u8 {
    const pending = s.class_returns orelse return null;
    var marker = try std.fmt.allocPrint(s.allocator, "__dtsx_member_return_{d}__", .{pending.items.len});
    while (std.mem.indexOf(u8, s.source, marker) != null) marker = try std.fmt.allocPrint(s.allocator, "{s}_", .{marker});
    try pending.append(.{ .marker = marker, .body = body, .parameters = parameters, .generics = generics, .is_async = is_async, .is_static = s.class_receiver_static });
    return marker;
}

/// Parse resolved authored dependencies in native code, rejecting overload and generic guesses.
pub fn importedFunctions(s: *Scanner) anyerror!std.StringHashMap(void) {
    var result = std.StringHashMap(void).init(s.allocator);
    errdefer result.deinit();
    for (s.declarations.items) |declaration| {
        if (declaration.kind != .import_decl) continue;
        const imported = declaration.parsed_import orelse continue;
        if (imported.is_type_only or imported.is_namespace) continue;
        for (s.inference_sources) |dependency| {
            if (!std.mem.eql(u8, dependency.specifier, imported.source)) continue;
            var nested = Scanner.init(s.allocator, dependency.source, false, true);
            defer nested.deinit();
            _ = try nested.scan();
            for (nested.declarations.items) |candidate| {
                if (candidate.kind != .function_decl or candidate.generics.len > 0 or !candidate.is_exported or try functionCount(s.allocator, dependency.source, candidate.name) != 1) continue;
                for (imported.named_items) |raw| {
                    const item = std.mem.trim(u8, raw, " \t\r\n");
                    if (std.mem.startsWith(u8, item, "type ")) continue;
                    const alias = std.mem.indexOf(u8, item, " as ");
                    const original = std.mem.trim(u8, item[0 .. alias orelse item.len], " \t\r\n");
                    const local = if (alias) |at| std.mem.trim(u8, item[at + 4 ..], " \t\r\n") else original;
                    if (std.mem.eql(u8, candidate.name, original)) try result.put(local, {});
                }
                if (candidate.is_default) if (imported.default_name) |name| try result.put(name, {});
            }
        }
    }
    return result;
}
