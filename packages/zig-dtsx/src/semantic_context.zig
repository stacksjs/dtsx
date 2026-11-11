//! Scoped, conservative inference for known monomorphic calls and instance fields.
const std = @import("std");
const Scanner = @import("scanner.zig").Scanner;
const syntax = @import("module_specifiers.zig");
const inference = @import("type_inference.zig");
const ch = @import("char_utils.zig");

pub const PendingReturn = struct { marker: []const u8, body: []const u8, parameters: []const u8, generics: []const u8, is_async: bool, is_static: bool };

pub const ConstructorBinding = enum { nominal_class, value, namespace };
pub const ConstructorNamespace = struct { parent: ?usize, path: []const u8, bindings: std.StringHashMap(ConstructorBinding), exports: std.StringHashMap(void), annotated_values: std.StringHashMap(void), ambient: bool };
pub const PendingConstructorField = struct { marker: []const u8, initializer: []const u8, class_name: []const u8, namespace: ?usize, binding: bool };

pub fn enterConstructorNamespace(s: *Scanner, name: []const u8, ambient: bool) !void {
    const parent = s.constructor_namespace;
    const prefix = if (parent) |index| s.constructor_namespaces.items[index].path else "";
    const path = if (prefix.len > 0) try std.fmt.allocPrint(s.allocator, "{s}.{s}", .{ prefix, name }) else name;
    const index = s.constructor_namespaces.items.len;
    try s.constructor_namespaces.append(.{ .parent = parent, .path = path, .bindings = std.StringHashMap(ConstructorBinding).init(s.allocator), .exports = std.StringHashMap(void).init(s.allocator), .annotated_values = std.StringHashMap(void).init(s.allocator), .ambient = ambient or (if (parent) |outer| s.constructor_namespaces.items[outer].ambient else false) });
    s.constructor_namespace = index;
}

pub fn registerNamespaceConstructorBinding(s: *Scanner, name: []const u8, binding: ConstructorBinding, exported: bool) !void {
    if (s.constructor_namespace) |index| {
        const scope = &s.constructor_namespaces.items[index];
        const merged = if (binding == .namespace) scope.bindings.get(name) orelse binding else binding;
        try scope.bindings.put(name, merged);
        if (exported or scope.ambient) try scope.exports.put(name, {});
    }
}

pub fn namespaceHeaderIsAmbient(s: *Scanner, start: usize, end: usize) bool {
    const tokens = s.sourceTokens() catch |err| {
        s.pending_error = err;
        return false;
    };
    var low: usize = 0;
    var high = tokens.len;
    while (low < high) {
        const middle = (low + high) / 2;
        if (tokens[middle].start < start) low = middle + 1 else high = middle;
    }
    for (tokens[low..]) |token| {
        if (token.start >= end) break;
        if (token.kind == .word and std.mem.eql(u8, s.source[token.start..token.end], "declare")) return true;
        if (token.kind == .word and (std.mem.eql(u8, s.source[token.start..token.end], "namespace") or std.mem.eql(u8, s.source[token.start..token.end], "module"))) return false;
    }
    return false;
}

pub fn deferClassInitializer(s: *Scanner, initializer: []const u8, binding: bool) ![]const u8 {
    var marker = try std.fmt.allocPrint(s.allocator, "__dtsx_constructor_field_{d}__", .{s.constructor_fields.items.len});
    if (!s.constructor_marker_names_loaded) {
        for (try s.sourceTokens()) |token| {
            const name = s.source[token.start..token.end];
            if (token.kind == .word and std.mem.startsWith(u8, name, "__dtsx_constructor_field_")) try s.occupied_constructor_markers.put(s.allocator, name, {});
        }
        s.constructor_marker_names_loaded = true;
    }
    while (s.occupied_constructor_markers.contains(marker)) marker = try std.fmt.allocPrint(s.allocator, "{s}_", .{marker});
    try s.constructor_fields.append(.{ .marker = marker, .initializer = initializer, .class_name = s.class_name, .namespace = s.constructor_namespace, .binding = binding });
    return marker;
}

/// Resolve source-order-independent constructor inference before private closure.
pub fn resolveConstructorFields(s: *Scanner) !void {
    if (s.constructor_fields.items.len == 0) return;
    var names = std.StringHashMap(void).init(s.allocator);
    defer names.deinit();
    for (s.declarations.items) |declaration| {
        if (declaration.kind == .class_decl) try names.put(declaration.name, {});
    }
    var candidates = s.non_exported_types.valueIterator();
    while (candidates.next()) |declaration| {
        if (declaration.kind == .class_decl) try names.put(declaration.name, {});
    }
    var qualified_bindings = std.StringHashMap(ConstructorBinding).init(s.allocator);
    defer qualified_bindings.deinit();
    for (s.constructor_namespaces.items) |scope| {
        var bindings = scope.bindings.iterator();
        while (bindings.next()) |binding| {
            if (scope.exports.contains(binding.key_ptr.*)) {
                const qualified = if (scope.path.len > 0) try std.fmt.allocPrint(s.allocator, "{s}.{s}", .{ scope.path, binding.key_ptr.* }) else binding.key_ptr.*;
                if (binding.value_ptr.* != .namespace or !qualified_bindings.contains(qualified)) try qualified_bindings.put(qualified, binding.value_ptr.*);
            }
        }
    }
    var annotated_bindings = std.StringHashMap(void).init(s.allocator);
    defer annotated_bindings.deinit();
    for (s.declarations.items) |declaration| {
        if (declaration.kind == .variable_decl and declaration.preserve_type_annotation) try annotated_bindings.put(declaration.name, {});
    }
    candidates = s.non_exported_types.valueIterator();
    while (candidates.next()) |declaration| {
        if (declaration.kind == .variable_decl and declaration.preserve_type_annotation) try annotated_bindings.put(declaration.name, {});
    }
    var qualified_annotated = std.StringHashMap(void).init(s.allocator);
    defer qualified_annotated.deinit();
    for (s.constructor_namespaces.items) |scope| {
        var values = scope.annotated_values.keyIterator();
        while (values.next()) |name| {
            if (scope.exports.contains(name.*)) try qualified_annotated.put(try std.fmt.allocPrint(s.allocator, "{s}.{s}", .{ scope.path, name.* }), {});
        }
    }
    var types = std.StringHashMap([]const u8).init(s.allocator);
    defer types.deinit();
    for (s.constructor_fields.items) |field| {
        try types.put(field.marker, if (field.binding) try annotatedBindingField(s, field, &annotated_bindings, &qualified_bindings, &qualified_annotated) else try inference.inferNewExpressionType(s.allocator, field.initializer, .{ .names = &names, .class_name = field.class_name, .namespaces = s.constructor_namespaces.items, .namespace = field.namespace, .qualified_bindings = &qualified_bindings }));
    }
    for (s.declarations.items) |*declaration| try resolveConstructorField(s, declaration, &types);
    candidates = s.non_exported_types.valueIterator();
    while (candidates.next()) |declaration| try resolveConstructorField(s, declaration, &types);
}

// Resolve after the full module scan so forward constants retain their authored types.
fn annotatedBindingField(s: *Scanner, field: PendingConstructorField, annotated: *const std.StringHashMap(void), qualified: *const std.StringHashMap(ConstructorBinding), qualified_annotated: *const std.StringHashMap(void)) ![]const u8 {
    var namespace = field.namespace;
    while (namespace) |index| {
        const scope = &s.constructor_namespaces.items[index];
        if (scope.bindings.contains(field.initializer)) return if (scope.annotated_values.contains(field.initializer)) try std.fmt.allocPrint(s.allocator, "typeof {s}", .{field.initializer}) else "unknown";
        const name = try std.fmt.allocPrint(s.allocator, "{s}.{s}", .{ scope.path, field.initializer });
        if (qualified.contains(name)) return if (qualified_annotated.contains(name)) try std.fmt.allocPrint(s.allocator, "typeof {s}", .{field.initializer}) else "unknown";
        namespace = scope.parent;
    }
    return if (annotated.contains(field.initializer)) try std.fmt.allocPrint(s.allocator, "typeof {s}", .{field.initializer}) else "unknown";
}

fn resolveConstructorField(s: *Scanner, declaration: *@import("types.zig").Declaration, types: *const std.StringHashMap([]const u8)) !void {
    inline for (.{ "text", "type_annotation", "inferred_type" }) |key| {
        const value = @field(declaration, key);
        if (std.mem.indexOf(u8, value, "__dtsx_constructor_field_") != null) {
            const tokens = try syntax.tokenizeDeclarationSyntax(s.allocator, value);
            defer s.allocator.free(tokens);
            var result = std.array_list.Managed(u8).init(s.allocator);
            defer result.deinit();
            var cursor: usize = 0;
            for (tokens) |token| {
                if (token.kind != .word) continue;
                const type_text = types.get(value[token.start..token.end]) orelse continue;
                try result.appendSlice(value[cursor..token.start]);
                try result.appendSlice(type_text);
                cursor = token.end;
            }
            try result.appendSlice(value[cursor..]);
            @field(declaration, key) = try result.toOwnedSlice();
        }
    }
}

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

/// Top-level `function <name>` declarations among `tokens` (lexed from `source`).
pub fn functionCount(source: []const u8, tokens: []const syntax.SyntaxToken, name: []const u8) usize {
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
    if (functionCount(s.source, try s.sourceTokens(), name) != 1) return null;
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
                if (candidate.kind != .function_decl or candidate.generics.len > 0 or !candidate.is_exported or functionCount(dependency.source, try nested.sourceTokens(), candidate.name) != 1) continue;
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
