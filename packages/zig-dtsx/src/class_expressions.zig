const std = @import("std");
const syntax = @import("module_specifiers.zig");
const scanner = @import("scanner.zig");
const extractors = @import("extractors.zig");
const Error = std.mem.Allocator.Error || error{InvalidContext};

/// Give an expression its own private declaration scope. The ordinary class
/// parser retains constructors, overloads, generics, self names and brands.
pub fn resolve(root: *scanner.Scanner, expression: []const u8) Error!?[]const u8 {
    const source = std.mem.trim(u8, expression, " \t\r\n");
    if (!std.mem.startsWith(u8, source, "class")) return null;
    const tokens = try syntax.tokenizeDeclarationSyntax(root.allocator, source);
    defer root.allocator.free(tokens);
    if (tokens.len == 0 or tokens[0].kind != .word or !std.mem.eql(u8, source[tokens[0].start..tokens[0].end], "class")) return null;
    var helper: []const u8 = undefined;
    while (true) {
        helper = try std.fmt.allocPrint(root.allocator, "__dtsx_class_{d}", .{root.class_helper_counter});
        root.class_helper_counter += 1;
        if (std.mem.indexOf(u8, root.source, helper) == null) break;
    }
    const candidate = if (tokens.len > 1) source[tokens[1].start..tokens[1].end] else "";
    const named = tokens.len > 1 and tokens[1].kind == .word and !std.mem.eql(u8, candidate, "extends") and !std.mem.eql(u8, candidate, "implements");
    const name = if (named) candidate else try std.fmt.allocPrint(root.allocator, "{s}_value", .{helper});
    const declaration_source = if (named) try std.fmt.allocPrint(root.allocator, "class {s}", .{source[5..]}) else try std.fmt.allocPrint(root.allocator, "class {s} {s}", .{ name, source[5..] });
    var nested = scanner.Scanner.init(root.allocator, declaration_source, root.keep_comments, false);
    defer nested.deinit();
    const declaration = extractors.extractClass(&nested, 0, false, false, false);
    if (nested.pending_error) |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.InvalidContext;
    if (declaration.text.len == 0) return error.OutOfMemory;
    const tail = declaration_source[nested.pos..];
    const trailing = try syntax.tokenizeDeclarationSyntax(root.allocator, tail);
    defer root.allocator.free(trailing);
    for (trailing) |token| if (!std.mem.eql(u8, tail[token.start..token.end], ";")) {
        return null;
    };
    var text = std.array_list.Managed(u8).init(root.allocator);
    try text.appendSlice("declare namespace ");
    try text.appendSlice(helper);
    try text.appendSlice(" {\n");
    var helpers = nested.non_exported_types.valueIterator();
    while (helpers.next()) |member| {
        const body = if (std.mem.startsWith(u8, member.text, "declare ")) member.text[8..] else member.text;
        try text.appendSlice(body);
        try text.append('\n');
    }
    const body = if (std.mem.startsWith(u8, declaration.text, "declare ")) declaration.text[8..] else declaration.text;
    try text.appendSlice(body);
    try text.appendSlice("\n}");
    const declaration_text = try text.toOwnedSlice();
    root.non_exported_types_inited = true;
    try root.non_exported_types.put(helper, .{ .kind = .module_decl, .name = helper, .text = declaration_text, .module_form = .namespace, .start = root.pos, .end = root.pos });
    return try std.fmt.allocPrint(root.allocator, "typeof {s}.{s}", .{ helper, name });
}

fn checkAllocations(backing: std.mem.Allocator) !void {
    var arena = std.heap.ArenaAllocator.init(backing);
    defer arena.deinit();
    const allocator = arena.allocator();
    const source = "function base() { return class { private brand: undefined; value = 7; constructor(public amount: number = 7) {} } } export class Counter extends base() {}";
    var root = scanner.Scanner.init(allocator, source, true, false);
    defer root.deinit();
    const result = try root.scan();
    const declarations = result.declarations.items;
    var namespace = false;
    var factory = false;
    for (declarations) |declaration| {
        if (std.mem.indexOf(u8, declaration.text, "declare namespace __dtsx_class_") != null) {
            namespace = true;
            try std.testing.expect(std.mem.indexOf(u8, declaration.text, "private brand;") != null);
            try std.testing.expect(std.mem.indexOf(u8, declaration.text, "constructor(") != null);
        }
        if (std.mem.indexOf(u8, declaration.text, "function base(): typeof __dtsx_class_") != null) factory = true;
    }
    try std.testing.expect(namespace and factory);
}

test "class expression scopes retain private identities and propagate backing allocation failures" {
    try checkAllocations(std.testing.allocator);
    try std.testing.checkAllAllocationFailures(std.testing.allocator, checkAllocations, .{});
}
